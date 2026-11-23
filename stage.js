const $ = (s) => document.querySelector(s);
const MODE = new URLSearchParams(location.search).get('mode');
let st = { connected: false }, cfg = null, artHs = null;
let dropping = false, droppedUri = '', dropTimer, toastTimer;
let lyricsFor = null, lines = [], lineEls = [], activeIdx = -1, userScrollUntil = 0;
let analyser = null, freq = null, haveAudio = false, audioTried = false, accentCss = '#7ad9c0';
let latestUrl = '', shownArt = '', animating = false, dropSkip = false, lastActivity = Date.now();
let anims = [], engine = null, seekHeld = false;
const vals = new Float32Array(72);

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fill = (el) => el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min || 1)) * 100 + '%');
const nowMs = () => (st.connected ? Math.min(st.duration, st.progress + (st.playing ? Date.now() - st.ts : 0)) : 0);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4500);
}
function retheme() {
  applyTheme(cfg, artHs);
  accentCss = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accentCss;
}

/* ---------- background + record art ---------- */

async function applyBackground() {
  const url = await syncBackground(cfg), bg = $('#bg');
  if (url) {
    const dim = (cfg.bgDim ?? 35) / 100;
    bg.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})), url(${url})`;
    bg.style.filter = `blur(${cfg.bgBlur || 0}px)`; bg.style.opacity = 1; bg.style.inset = '0';
    $('#wash').style.opacity = .35;
  } else {
    bg.style.filter = ''; bg.style.opacity = ''; bg.style.inset = ''; $('#wash').style.opacity = '';
    bg.style.backgroundImage = shownArt ? `url(${shownArt})` : '';
  }
}

function showArt(url) {
  shownArt = url;
  $('#record').style.backgroundImage = `url(${url})`;
  if (!BG.url) $('#bg').style.backgroundImage = `url(${url})`;
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => { try { artHs = artHue(probe); retheme(); } catch { /* cross-origin art: keep current colors */ } };
  probe.src = url;
}

/* ---------- state ---------- */

function renderState() {
  document.body.classList.toggle('spinning', !!st.playing && !dropping);
  $('#ic-play').toggleAttribute('hidden', !!st.playing); $('#ic-pause').toggleAttribute('hidden', !st.playing);   // SVG elements need the attribute, not the .hidden property
  $('#shuffle').setAttribute('aria-pressed', String(!!st.shuffle));

  const nx = st.connected && st.next;
  $('#upnext').hidden = !nx;
  if (nx) $('#upnext').textContent = 'Up next: ' + st.next.title + ' by ' + st.next.artists;

  if (!st.connected) return;
  if (dropping && st.id && droppedUri.endsWith(st.id)) {
    dropping = false; clearTimeout(dropTimer);
    document.body.classList.toggle('spinning', !!st.playing);
  }
  $('#title').textContent = st.title;
  $('#artists').textContent = st.artists;
  $('#seek').max = st.duration || 1;
  $('#t-dur').textContent = fmt(st.duration || 0);

  if (st.artUrl && st.artUrl !== latestUrl && st.artData) onNewArt();
  if (st.id !== lyricsFor) loadLyrics();
}

function onNewArt() {
  const first = !latestUrl;
  latestUrl = st.artUrl;
  if (animating) return;                             // the running animation swaps in the newest art itself
  if (!first && !dropSkip && cfg.animEnabled && engine && Math.random() * 100 < (cfg.animChance ?? 40)) {
    if (runAnim(pickAnim('songchange'), true)) return;
  }
  dropSkip = false;
  showArt(st.artData);
}

/* ---------- animations ---------- */

async function loadAnims() { try { anims = await api.anim.list(); } catch { anims = []; } }

function pickAnim(trigger) {
  const pool = anims.filter((a) => (!trigger || a.trigger === trigger) && !(cfg.animDisabled || []).includes(a.id));
  if (!pool.length) return null;
  let r = Math.random() * pool.reduce((n, a) => n + (a.weight || 1), 0);
  for (const a of pool) { r -= a.weight || 1; if (r <= 0) return a; }
  return pool[0];
}

function runAnim(anim, swap) {
  if (!anim || !engine || animating) return false;
  animating = true;
  engine.play(anim, { onSwap: () => { if (swap && st.artData) showArt(st.artData); } })
    .catch((e) => toast('Animation problem: ' + e.message))
    .finally(() => { animating = false; if (st.artData && st.artUrl) { latestUrl = st.artUrl; if (shownArt !== st.artData) showArt(st.artData); } });
  return true;
}

$('#animBtn').onclick = () => { if (!runAnim(pickAnim(null), false)) toast('No animations found. Check Settings > Animations.'); };
setInterval(() => {
  const idle = (cfg?.animIdleSeconds || 0) * 1000;
  if (!idle || !cfg.animEnabled || animating || Date.now() - lastActivity < idle) return;
  if (runAnim(pickAnim('idle'), false)) lastActivity = Date.now();
}, 5000);
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'dragover']) addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });

/* ---------- drag a song onto the record ---------- */

const deck = $('#deck');
deck.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; deck.classList.add('over'); });
deck.addEventListener('dragleave', () => deck.classList.remove('over'));
deck.addEventListener('drop', (e) => {
  e.preventDefault(); deck.classList.remove('over');
  try { play(JSON.parse(e.dataTransfer.getData('text/plain'))); } catch {}
});

function play(d) {
  droppedUri = d.uri;
  dropping = true;                                    // lift the needle until the new song is confirmed
  dropSkip = true; setTimeout(() => { dropSkip = false; }, 5000);
  document.body.classList.remove('spinning');
  clearTimeout(dropTimer); dropTimer = setTimeout(() => { dropping = false; renderState(); }, 4000);
  if (d.art && !animating) { $('#record').style.backgroundImage = `url(${d.art})`; }
  api.cmd('playtrack', { uri: d.uri, contextUri: d.contextUri, uris: d.uris });
  document.dispatchEvent(new CustomEvent('sonoma:played'));
}

/* ---------- library: whole playlists, endless scroll, search ---------- */

const lib = { mode: 'playlist', id: '', query: '', offset: 0, hasMore: false, loading: false, token: 0, tracks: [], total: null };
const preloaded = new Map();
function preload(url) { if (url && !preloaded.has(url)) { const i = new Image(); i.src = url; preloaded.set(url, i); } }
function note(msg) { const n = $('#lib-note'); n.textContent = msg || ''; n.hidden = !msg; }

function makeReplica(t) {                              // a small copy of the whole record, shown under the cursor
  const big = preloaded.get(t.artBig);
  const el = document.createElement('div'); el.className = 'minirec';
  el.style.backgroundImage = `url(${big && big.complete ? t.artBig : t.art})`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 60);
  return el;
}

const COARSE = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('wallpaper');   // tap or click to play
function wireTouch(li, payload, t) {
  let timer = null, dragging = false, sx = 0, sy = 0, ghost = null;
  const end = () => { clearTimeout(timer); if (ghost) { ghost.remove(); ghost = null; } dragging = false; deck.classList.remove('over'); };
  const inDeck = (p) => { const r = deck.getBoundingClientRect(); return p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom; };
  li.addEventListener('touchstart', (e) => {
    const p = e.touches[0]; sx = p.clientX; sy = p.clientY;
    timer = setTimeout(() => {
      dragging = true; navigator.vibrate?.(15);
      ghost = document.createElement('div'); ghost.className = 'minirec ghost';
      ghost.style.backgroundImage = `url(${t.artBig || t.art})`; ghost.style.left = sx - 42 + 'px'; ghost.style.top = sy - 42 + 'px';
      document.body.appendChild(ghost);
    }, 280);
  }, { passive: true });
  li.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (!dragging) { if (Math.hypot(p.clientX - sx, p.clientY - sy) > 10) clearTimeout(timer); return; }
    e.preventDefault();
    ghost.style.left = p.clientX - 42 + 'px'; ghost.style.top = p.clientY - 42 + 'px';
    deck.classList.toggle('over', inDeck(p));
  }, { passive: false });
  li.addEventListener('touchend', (e) => {
    const was = dragging, p = e.changedTouches[0], inside = inDeck(p);
    end();
    if (was) { e.preventDefault(); if (inside) play(payload()); }
  });
  li.addEventListener('touchcancel', end);
}

function addRows(tracks) {
  const ul = $('#tracks'), frag = document.createDocumentFragment();
  for (const t of tracks) {
    const index = lib.tracks.length; lib.tracks.push(t);
    const li = document.createElement('li'); li.draggable = true; li.tabIndex = 0;
    const img = document.createElement('img'); img.src = t.art; img.alt = ''; img.loading = 'lazy';
    const box = document.createElement('div');
    const b = document.createElement('b'); b.textContent = t.title;
    const sp = document.createElement('span'); sp.textContent = t.artists;
    box.append(b, sp); li.append(img, box);
    const payload = () => {
      const ctx = lib.mode === 'playlist' ? 'spotify:playlist:' + lib.id : null;
      return { uri: t.uri, contextUri: ctx, uris: ctx ? undefined : lib.tracks.slice(index, index + 50).map((x) => x.uri), art: t.artBig || t.art };
    };
    li.addEventListener('pointerenter', () => preload(t.artBig));
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify(payload()));
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setDragImage(makeReplica(t), 42, 42);
      li.classList.add('drag');
    });
    li.addEventListener('dragend', () => li.classList.remove('drag'));
    li.addEventListener('dblclick', () => play(payload()));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(payload()); });
    if (COARSE) li.addEventListener('click', () => play(payload()));            // touch screens: a tap plays
    if ('ontouchstart' in window) wireTouch(li, payload, t);                    // touch screens: hold and drag onto the record
    frag.append(li);
  }
  ul.append(frag);
}

async function loadMore() {
  if (lib.loading || !lib.hasMore) return;
  lib.loading = true;
  const token = lib.token;
  const r = lib.mode === 'search' ? await api.library.search(lib.query, lib.offset) : await api.library.items(lib.id, lib.offset);
  if (token !== lib.token) return;                     // switched playlist or search while loading
  lib.loading = false;
  if (r.error) { lib.hasMore = false; return note(r.error); }
  addRows(r.tracks);
  lib.hasMore = !!r.hasMore && r.next > lib.offset;
  lib.offset = r.next; lib.total = r.total;
  note(lib.total ? `${lib.tracks.length} of ${lib.total} songs` : '');
  requestAnimationFrame(() => { const u = $('#tracks'); if (lib.hasMore && u.scrollHeight <= u.clientHeight + 300) loadMore(); });
}

function resetLibrary(mode, key) {
  lib.token++; lib.loading = false; lib.mode = mode; lib.tracks = []; lib.offset = 0; lib.total = null;
  if (mode === 'search') lib.query = key; else lib.id = key;
  lib.hasMore = !!key;
  $('#tracks').replaceChildren(); $('#tracks').scrollTop = 0; note('');
  if (key) loadMore();
}
$('#tracks').addEventListener('scroll', () => {
  const u = $('#tracks');
  if (u.scrollTop + u.clientHeight > u.scrollHeight - 500) loadMore();
}, { passive: true });

async function loadPlaylists() {
  const sel = $('#playlist');
  const r = await api.library.playlists();
  if (r.error) { sel.replaceChildren(new Option('Playlists unavailable', '')); return note(r.error); }
  sel.replaceChildren(new Option('Choose a playlist', ''), ...r.playlists.map((p) => new Option(p.name, p.id)));
  let last = ''; try { last = localStorage.getItem('sonoma.playlist') || ''; } catch {}
  if (last && r.playlists.some((p) => p.id === last)) sel.value = last;
  else if (r.playlists.length) sel.value = r.playlists[0].id;     // first visit: start with your first playlist
  resetLibrary('playlist', sel.value);
}
$('#playlist').addEventListener('change', () => {
  $('#search').value = '';
  try { localStorage.setItem('sonoma.playlist', $('#playlist').value); } catch {}
  resetLibrary('playlist', $('#playlist').value);
});
let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = $('#search').value.trim();
    if (q) resetLibrary('search', q); else resetLibrary('playlist', $('#playlist').value);
  }, 350);
});

/* ---------- lyrics (LRCLIB; synced when available) ---------- */

function parseLrc(text) {
  const out = [];
  for (const ln of text.split('\n')) {
    const m = ln.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: (+m[1] * 60 + +m[2]) * 1000, text: m[3].trim() });
  }
  return out;
}

async function loadLyrics() {
  const id = st.id; lyricsFor = id; lines = []; lineEls = []; activeIdx = -1;
  const box = $('#lines'); box.replaceChildren();
  const res = await api.lyrics({ title: st.title, artist: (st.artists || '').split(', ')[0], album: st.album, duration: st.duration });
  if (lyricsFor !== id) return;
  if (res && res.synced) {
    lines = parseLrc(res.synced);
    lines.forEach((l) => {
      const d = document.createElement('div'); d.className = 'line'; d.textContent = l.text || '\u00a0';
      d.addEventListener('click', () => api.cmd('seek', l.t));
      box.append(d); lineEls.push(d);
    });
  } else {
    const p = document.createElement('div');
    p.className = res && res.plain ? 'plain' : 'empty';
    p.textContent = res && res.plain ? res.plain : 'No lyrics found for this song.';
    box.append(p);
  }
}

function tickLyrics() {
  if (!lines.length) return;
  const pos = nowMs();
  let i = activeIdx;
  if (i < 0 || pos < lines[i].t) i = 0;
  while (i + 1 < lines.length && lines[i + 1].t <= pos) i++;
  if (pos < lines[0].t) i = -1;
  if (i === activeIdx) return;
  activeIdx = i;
  lineEls.forEach((el, k) => { el.classList.toggle('active', k === i); el.classList.toggle('past', k < i); });
  const el = lineEls[i], pane = $('#lyrics');
  if (el && Date.now() > userScrollUntil) pane.scrollTo({ top: el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
}
$('#lyrics').addEventListener('wheel', () => { userScrollUntil = Date.now() + 4000; }, { passive: true });

/* ---------- visualizer ---------- */

async function startAudio() {
  if (haveAudio || audioTried) return;
  audioTried = true;
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    s.getVideoTracks().forEach((t) => t.stop());
    if (!s.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
    analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.78;
    src.connect(analyser);                             // analysis only; never routed to the speakers
    freq = new Uint8Array(analyser.frequencyBinCount); haveAudio = true;
  } catch { /* no system audio here: the synthetic animation takes over */ }
}

function drawViz(t) {
  const c = $('#viz'), size = c.clientWidth, dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(size * dpr)) c.width = c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
  const N = vals.length, cx = size / 2, r0 = size * 0.385, maxLen = size * 0.115;
  if (haveAudio) analyser.getByteFrequencyData(freq);
  g.lineCap = 'round'; g.lineWidth = Math.max(3, size * 0.007); g.strokeStyle = accentCss;
  for (let i = 0; i < N; i++) {
    const sym = i < N / 2 ? i : N - 1 - i;
    let v;
    if (haveAudio) v = freq[Math.floor((sym / (N / 2)) * freq.length * 0.62) + 1] / 255;
    else v = (st.playing ? 1 : 0.06) * (0.2 + 0.5 * Math.abs(Math.sin(t / 380 + sym * 0.55)) * (0.6 + 0.4 * Math.sin(t / 910 + sym)));
    vals[i] += (v - vals[i]) * 0.35;
    const a = (i / N) * Math.PI * 2 - Math.PI / 2, len = Math.max(2, vals[i] * maxLen);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 + len), cx + Math.sin(a) * (r0 + len));
    g.stroke();
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  drawViz(t); tickLyrics();
  if (!seekHeld) {
    const pos = nowMs();
    $('#seek').value = pos; fill($('#seek')); $('#t-pos').textContent = fmt(pos);
  }
}

/* ---------- stats ---------- */

let statTab = 'tracks';
function ago(iso) { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

async function loadStats() {
  const list = $('#statList'), sum = $('#statSummary');
  list.replaceChildren(); sum.textContent = 'Loading…';
  $('#range').hidden = statTab === 'recent';
  const r = await api.stats(statTab, $('#range').value);
  if (r.error) { sum.textContent = r.error; return; }
  const row = (n, img, title, sub, cls, onclick) => {
    const li = document.createElement('li'); if (cls) li.className = cls;
    const rk = document.createElement('span'); rk.className = 'rank'; rk.textContent = n;
    const im = document.createElement('img'); im.src = img || ''; im.alt = ''; im.loading = 'lazy';
    const box = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title;
    const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub;
    box.append(b, s); li.append(rk, im, box);
    if (onclick) li.addEventListener('click', onclick);
    return li;
  };
  if (statTab === 'artists') {
    const counts = {};
    r.artists.forEach((a) => (a.genres ? a.genres.split(', ') : []).forEach((g) => { counts[g] = (counts[g] || 0) + 1; }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    sum.textContent = top.length ? 'Your top genres: ' + top.join(', ') : '';
    r.artists.forEach((a, i) => list.append(row(i + 1, a.art, a.name, a.genres, 'artist')));
  } else {
    const mins = Math.round(r.tracks.reduce((n, t) => n + (t.duration || 0), 0) / 60000);
    sum.textContent = `${r.tracks.length} songs, about ${mins} minutes of music. Click one to play it.`;
    r.tracks.forEach((t, i) => list.append(row(i + 1, t.art, t.title, statTab === 'recent' ? `${t.artists} · ${ago(t.playedAt)}` : t.artists, '', () => api.cmd('playtrack', { uri: t.uri }))));
  }
}
$('#statsBtn').onclick = () => { $('#stats').hidden = false; loadStats(); };
$('#statsClose').onclick = () => { $('#stats').hidden = true; };
$('#range').addEventListener('change', loadStats);
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    statTab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    loadStats();
  });
}

/* ---------- clock + lock ---------- */

function tickClock() {
  const d = new Date();
  $('#time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(tickClock, 1000); tickClock();

function leave() { if (MODE === 'lock') showPin(); else api.closeStage(); }
function showPin() { $('#pin').hidden = false; $('#pinInput').value = ''; $('#pinInput').focus(); }
async function tryUnlock() {
  const r = await api.unlock($('#pinInput').value);
  if (r.ok) return;
  $('#pinInput').value = '';
  toast(r.wait ? `Too many tries. Wait ${r.wait} seconds.` : 'Wrong PIN.');
}
$('#pinGo').onclick = tryUnlock;
$('#pinCancel').onclick = () => { $('#pin').hidden = true; };
$('#pinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
  if (e.key === 'Escape') { $('#pin').hidden = true; e.stopPropagation(); }
});

/* ---------- controls ---------- */

$('#play').onclick = () => api.cmd('playpause');
$('#next').onclick = () => api.cmd('next');
$('#prev').onclick = () => api.cmd('prev');
$('#shuffle').onclick = () => api.cmd('shuffle');
$('#close').onclick = leave;
$('#seek').addEventListener('input', (e) => { seekHeld = true; fill(e.target); $('#t-pos').textContent = fmt(+e.target.value); });
$('#seek').addEventListener('change', (e) => { api.cmd('seek', +e.target.value); seekHeld = false; });
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.activeElement?.id === 'search') return;
  if (!$('#stats').hidden) { $('#stats').hidden = true; return; }
  leave();
});
addEventListener('pointerdown', startAudio, { once: true });

(async function init() {
  cfg = await api.getSettings();
  retheme();
  await applyBackground();
  st = await api.getState();
  engine = new AnimEngine({ overlay: $('#fx'), canvas: $('#fxc'), deck: $('#deck'), stage: $('#stage'), record: $('#recwrap') });
  await loadAnims();
  renderState();
  api.onState((s) => { st = mergeState(st, s); renderState(); });
  api.onSettings(async (c) => { cfg = c; retheme(); await applyBackground(); });
  api.onNotice(toast);
  api.anim.onChanged(loadAnims);
  if (MODE === 'lock') $('#close').textContent = 'Unlock';
  loadPlaylists();
  startAudio();
  requestAnimationFrame(frame);
})();
