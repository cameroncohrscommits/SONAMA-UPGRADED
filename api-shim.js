/* Stands in for the desktop app's `window.api`, so the same stage code runs in a browser.
   Talks to Spotify directly from the page (PKCE login, no secret), keeps settings in localStorage. */
(function () {
  'use strict';
  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-top-read user-read-recently-played';
  const BASE = location.origin + location.pathname.replace(/index\.html$/, '');   // must match the redirect URI in the Spotify dashboard
  window.WEB = true;
  window.SONOMA_ANIM_BASE = 'animations/';

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  const DEFAULTS = { clientId: '', accentMode: 'album', accent: '#7ad9c0', font: 'sans', radius: 22, animEnabled: true, animChance: 40, animIdleSeconds: 60, animDisabled: [], bgPath: '', bgVersion: 0, bgDim: 35, bgBlur: 0 };
  let settings = { ...DEFAULTS, ...LS.get('sonoma.settings', {}) };
  let auth = LS.get('sonoma.auth', null);
  let state = { auth: !!auth, connected: false };
  let nextCache = { id: null, next: null }, backoffUntil = 0, timer = null;
  const cbs = { state: [], settings: [], notice: [] };
  const emit = (k, ...a) => cbs[k].forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });
  const emitState = () => emit('state', { ...state });
  const notice = (m) => emit('notice', m);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* ---------- login (PKCE) ---------- */

  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function tokenRequest(params) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params)
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error_description || 'Spotify login failed');
    auth = { access: j.access_token, refresh: j.refresh_token || (auth && auth.refresh), expiresAt: Date.now() + j.expires_in * 1000 };
    LS.set('sonoma.auth', auth);
  }

  async function login() {
    if (!settings.clientId) return notice('Paste your Spotify Client ID first.');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const st = b64url(crypto.getRandomValues(new Uint8Array(8)));
    localStorage.setItem('sonoma.pkce', JSON.stringify({ verifier, state: st, search: location.search }));
    location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: settings.clientId, response_type: 'code', redirect_uri: BASE,
      code_challenge_method: 'S256', code_challenge: challenge, state: st, scope: SCOPES
    });
  }

  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('sonoma.pkce') || '{}'); } catch {}
    localStorage.removeItem('sonoma.pkce');
    history.replaceState({}, '', BASE + (saved.search || ''));        // keep ?wallpaper=1 and friends after login
    if (q.get('error')) return notice('Spotify login was cancelled.');
    if (!saved.verifier || q.get('state') !== saved.state) return notice('Login could not be verified. Try connecting again.');
    try {
      await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: BASE, client_id: settings.clientId, code_verifier: saved.verifier });
      state = { auth: true, connected: false }; emitState();
    } catch (e) { notice(e.message); }
  }

  async function ensureToken() {
    if (!auth) throw new Error('Not connected to Spotify.');
    if (Date.now() > auth.expiresAt - 30000) await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: settings.clientId });
  }

  /* ---------- Spotify calls ---------- */

  async function spotify(method, endpoint, body) {
    await ensureToken();
    const headers = { Authorization: 'Bearer ' + auth.access };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch('https://api.spotify.com/v1' + endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204 || res.status === 202) return null;
    if (res.status === 401 && auth) { auth.expiresAt = 0; await ensureToken(); return spotify(method, endpoint, body); }
    if (!res.ok) {
      let msg = '', reason = '';
      try { const j = await res.json(); msg = j.error?.message || ''; reason = j.error?.reason || ''; } catch {}
      if (reason === 'ALREADY_PAUSED' || reason === 'NOT_PAUSED') return null;
      if (reason === 'PREMIUM_REQUIRED') throw new Error('Spotify Premium is required to control playback.');
      if (reason === 'NO_NEXT_TRACK') throw new Error('There is no next song in this queue.');
      if (reason === 'NO_PREV_TRACK') throw new Error('There is no previous song.');
      if (res.status === 403 && !endpoint.startsWith('/me/player')) throw new Error('Spotify refused access. Disconnect and reconnect to grant the new permissions.');
      if (res.status === 404) throw new Error('No active device. Open Spotify on this phone or PC and press play first.');
      if (res.status === 429) { backoffUntil = Date.now() + (Number(res.headers.get('retry-after')) || 5) * 1000; throw new Error('Spotify asked Sonoma to slow down. Try again in a few seconds.'); }
      throw new Error(msg ? msg + (reason ? ` (${reason})` : '') : 'Spotify error ' + res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function fetchNext() {
    try {
      const q = await spotify('GET', '/me/player/queue'); const n = q?.queue?.[0];
      return n ? { title: n.name, artists: (n.artists || []).map((a) => a.name).join(', ') } : null;
    } catch { return null; }
  }

  async function poll() {
    if (!auth) return;
    if (Date.now() < backoffUntil) return;
    try {
      const s = await spotify('GET', '/me/player');
      if (!s || !s.item) state = { ...state, auth: true, connected: false, playing: false };
      else {
        const it = s.item, artUrl = it.album?.images?.[0]?.url || it.images?.[0]?.url || '';
        state = {
          auth: true, connected: true, id: it.id || it.uri, title: it.name,
          artists: it.artists ? it.artists.map((a) => a.name).join(', ') : (it.show?.name || ''),
          album: it.album?.name || '', artUrl, artData: artUrl,
          duration: it.duration_ms, progress: s.progress_ms, playing: s.is_playing,
          volume: s.device?.volume_percent, shuffle: !!s.shuffle_state, device: s.device?.name, ts: Date.now()
        };
        if (state.id !== nextCache.id) nextCache = { id: state.id, next: await fetchNext() };
        state.next = nextCache.next;
      }
    } catch (e) { notice(e.message); }
    emitState();
  }
  function loop() { poll().finally(() => { timer = setTimeout(loop, document.hidden ? 8000 : 1500); }); }
  function pollNow() { clearTimeout(timer); if (auth) loop(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNow(); });

  async function command(name, arg) {
    if (!auth) return;
    const before = { ...state };
    const posNow = () => (state.connected ? Math.min(state.duration, state.progress + (state.playing ? Date.now() - state.ts : 0)) : 0);
    try {
      let call;
      switch (name) {
        case 'playpause': { const playing = !state.playing; state.progress = posNow(); state.playing = playing; state.ts = Date.now(); call = spotify('PUT', playing ? '/me/player/play' : '/me/player/pause'); break; }
        case 'next': call = spotify('POST', '/me/player/next'); break;
        case 'prev':
          if (posNow() > 5000) { state.progress = 0; state.ts = Date.now(); call = spotify('PUT', '/me/player/seek?position_ms=0'); }
          else call = spotify('POST', '/me/player/previous');
          break;
        case 'shuffle': state.shuffle = !state.shuffle; call = spotify('PUT', '/me/player/shuffle?state=' + state.shuffle); break;
        case 'volume': state.volume = clamp(Number(arg), 0, 100); call = spotify('PUT', '/me/player/volume?volume_percent=' + Math.round(state.volume)); break;
        case 'seek': state.progress = arg; state.ts = Date.now(); call = spotify('PUT', '/me/player/seek?position_ms=' + Math.round(arg)); break;
        case 'playtrack': {
          const body = arg.contextUri ? { context_uri: arg.contextUri, offset: { uri: arg.uri } } : { uris: (arg.uris && arg.uris.length ? arg.uris : [arg.uri]).slice(0, 100) };
          state.playing = true; state.ts = Date.now(); call = spotify('PUT', '/me/player/play', body); break;
        }
        default: return;
      }
      emitState(); await call;
      setTimeout(pollNow, ['next', 'prev', 'playtrack'].includes(name) ? 250 : 700);
    } catch (e) { state = before; emitState(); notice(e.message); }
  }

  const slim = (t) => {
    const imgs = t.album?.images || [];
    return { uri: t.uri, title: t.name, artists: (t.artists || []).map((a) => a.name).join(', '), album: t.album?.name || '', duration: t.duration_ms, art: imgs.length ? imgs[imgs.length - 1].url : '', artBig: imgs[0]?.url || '' };
  };

  /* ---------- the same surface the desktop app exposes ---------- */

  const ready = (async () => { await handleRedirect(); if (auth) loop(); })();

  window.api = {
    REDIRECT: BASE,
    getSettings: async () => settings,
    setSettings: async (patch) => { settings = { ...settings, ...patch }; LS.set('sonoma.settings', settings); emit('settings', settings); return settings; },
    getState: async () => { await ready; return { ...state }; },
    onState: (f) => cbs.state.push(f), onSettings: (f) => cbs.settings.push(f), onNotice: (f) => cbs.notice.push(f),
    cmd: command,
    login, closeStage() {}, unlock: async () => ({ ok: false }),
    logout: async () => { auth = null; localStorage.removeItem('sonoma.auth'); state = { auth: false, connected: false }; emitState(); },
    exportConnection: () => (auth ? btoa(JSON.stringify({ c: settings.clientId, r: auth.refresh })) : ''),
    importConnection: async (code) => {
      try {
        const j = JSON.parse(atob(String(code).trim())); if (!j.c || !j.r) return false;
        await api.setSettings({ clientId: j.c });
        auth = { access: '', refresh: j.r, expiresAt: 0 }; LS.set('sonoma.auth', auth);
        state = { auth: true, connected: false }; emitState(); pollNow(); return true;
      } catch { return false; }
    },
    library: {
      playlists: async () => {
        try { const j = await spotify('GET', '/me/playlists?limit=50'); return { playlists: (j?.items || []).filter(Boolean).map((p) => ({ id: p.id, uri: p.uri, name: p.name })) }; }
        catch (e) { return { error: e.message }; }
      },
      items: async (id, offset = 0) => {
        try {
          const o = offset | 0, j = await spotify('GET', `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${o}`), raw = j?.items || [];
          const rows = raw.map((x) => x.item || x.track).filter((t) => t && t.uri && t.type !== 'episode');
          return { tracks: rows.map(slim), next: o + raw.length, total: j?.total ?? null, hasMore: !!j?.next };
        } catch (e) { return { error: /refused/.test(e.message) ? 'Spotify only shares track lists for playlists you own or collaborate on.' : e.message }; }
      },
      search: async (q, offset = 0) => {
        try {
          const o = offset | 0, j = await spotify('GET', `/search?type=track&limit=10&offset=${o}&q=` + encodeURIComponent(q)), raw = j?.tracks?.items || [];
          return { tracks: raw.filter(Boolean).map(slim), next: o + raw.length, total: j?.tracks?.total ?? null, hasMore: !!j?.tracks?.next };
        } catch (e) { return { error: e.message }; }
      }
    },
    lyrics: async (t) => {
      try {
        let r = await fetch('https://lrclib.net/api/get?' + new URLSearchParams({ track_name: t.title, artist_name: t.artist, album_name: t.album || '', duration: String(Math.round(t.duration / 1000)) }));
        if (r.ok) { const j = await r.json(); return { synced: j.syncedLyrics || '', plain: j.plainLyrics || '' }; }
        r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: t.title, artist_name: t.artist }));
        if (!r.ok) return null;
        const arr = await r.json(), hit = arr.find((x) => x.syncedLyrics) || arr[0];
        return hit ? { synced: hit.syncedLyrics || '', plain: hit.plainLyrics || '' } : null;
      } catch { return null; }
    },
    stats: async (kind, range) => {
      try {
        if (kind === 'recent') { const j = await spotify('GET', '/me/player/recently-played?limit=40'); return { tracks: (j?.items || []).filter((x) => x.track).map((x) => ({ ...slim(x.track), playedAt: x.played_at })) }; }
        const r = ['short_term', 'medium_term', 'long_term'].includes(range) ? range : 'medium_term';
        if (kind === 'artists') {
          const j = await spotify('GET', `/me/top/artists?time_range=${r}&limit=30`);
          return { artists: (j?.items || []).map((a) => ({ name: a.name, art: a.images?.length ? a.images[a.images.length - 1].url : '', genres: (a.genres || []).slice(0, 2).join(', ') })) };
        }
        const j = await spotify('GET', `/me/top/tracks?time_range=${r}&limit=30`);
        return { tracks: (j?.items || []).map(slim) };
      } catch (e) { return { error: e.message }; }
    },
    getBackground: async () => localStorage.getItem('sonoma.bg') || '',
    setBackground: async (dataUrl) => {
      try { localStorage.setItem('sonoma.bg', dataUrl); } catch { notice('That image is too big to save on this device.'); return false; }
      await api.setSettings({ bgPath: 'local', bgVersion: (settings.bgVersion || 0) + 1 }); return true;
    },
    clearBackground: async () => { localStorage.removeItem('sonoma.bg'); await api.setSettings({ bgPath: '' }); },
    anim: {
      list: async () => {
        try {
          const ids = await (await fetch('animations/index.json')).json(), out = [];
          for (const id of ids) { try { out.push({ ...(await (await fetch(`animations/${id}/animation.json`)).json()), id, source: 'built-in' }); } catch {} }
          return out;
        } catch { return []; }
      },
      onChanged() {}, openFolder() {}
    }
  };
})();
