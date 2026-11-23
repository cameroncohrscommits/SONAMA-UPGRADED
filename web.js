/* Page chrome for the web version: tabs, login, settings sheet, wallpaper layout. */
(function () {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const params = new URLSearchParams(location.search);
  const narrow = () => matchMedia('(max-width: 800px)').matches;
  let cfg = null;

  if (params.has('wallpaper')) body.classList.add('wallpaper');

  /* tabs (phone layout) and the Songs / Lyrics switch (wallpaper layout) */
  const marks = () => {
    $('#tabPlayer').classList.toggle('on', !body.classList.contains('drawer') && !body.classList.contains('lyricsOpen'));
    $('#tabSongs').classList.toggle('on', body.classList.contains('drawer'));
    $('#tabLyrics').classList.toggle('on', body.classList.contains('lyricsOpen'));
  };
  $('#tabPlayer').onclick = () => { body.classList.remove('drawer', 'lyricsOpen'); marks(); };
  $('#tabSongs').onclick = () => { body.classList.toggle('drawer'); body.classList.remove('lyricsOpen'); marks(); };
  $('#tabLyrics').onclick = () => { body.classList.toggle('lyricsOpen'); body.classList.remove('drawer'); marks(); };
  document.addEventListener('sonoma:played', () => { if (narrow()) { body.classList.remove('drawer'); marks(); } });
  $('#wpSongs').onclick = () => body.classList.remove('wpLyrics');
  $('#wpLyrics').onclick = () => body.classList.add('wpLyrics');
  marks();

  /* login */
  $('#redirect').textContent = api.REDIRECT;
  $('#copyRedirect').onclick = () => navigator.clipboard?.writeText(api.REDIRECT).then(() => { $('#copyRedirect').textContent = 'Copied'; });
  $('#connect').onclick = async () => {
    const id = $('#clientId').value.trim();
    if (id.length < 20) return flash('Paste the Client ID from your Spotify app.');
    await api.setSettings({ clientId: id });
    api.login();
  };
  $('#importBtn').onclick = async () => {
    const ok = await api.importConnection($('#importCode').value);
    flash(ok ? 'Connected.' : 'That connection code did not work.');
  };
  function flash(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; setTimeout(() => (t.hidden = true), 4000); }
  const showLogin = (s) => { $('#login').hidden = !!s.auth; };
  api.onState(showLogin);
  api.getState().then(showLogin);

  /* settings sheet */
  $('#setBtn').onclick = async () => { cfg = await api.getSettings(); fillForm(); buildAnimList(); $('#connCode').value = api.exportConnection(); $('#sheet').hidden = false; };
  $('#sheetClose').onclick = () => { $('#sheet').hidden = true; };
  $('#disconnect').onclick = async () => { await api.logout(); $('#sheet').hidden = true; };
  $('#copyConn').onclick = () => { $('#connCode').select(); navigator.clipboard?.writeText($('#connCode').value); flash('Connection code copied.'); };
  $('#bgChoose').onclick = () => $('#bgFile').click();
  $('#bgClear').onclick = () => api.clearBackground();
  $('#bgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (await api.setBackground(c.toDataURL('image/jpeg', 0.82))) flash('Background saved.');
    } catch { flash('Could not read that image.'); }
    e.target.value = '';
  });

  function fillForm() {
    for (const el of document.querySelectorAll('#sheet [data-key]')) {
      const k = el.dataset.key;
      if (el.type === 'checkbox') el.checked = !!cfg[k]; else el.value = String(cfg[k]);
      el.oninput = () => api.setSettings({ [k]: el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.dataset.num) ? +el.value : el.value }).then((c) => { cfg = c; });
    }
  }
  async function buildAnimList() {
    const box = $('#animList'); box.replaceChildren();
    for (const a of await api.anim.list()) {
      const l = document.createElement('label'); l.className = 'check';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !(cfg.animDisabled || []).includes(a.id);
      cb.onchange = () => { const off = new Set(cfg.animDisabled || []); cb.checked ? off.delete(a.id) : off.add(a.id); api.setSettings({ animDisabled: [...off] }).then((c) => { cfg = c; }); };
      l.append(cb, document.createTextNode(` ${a.name} (${a.trigger === 'idle' ? 'idle' : 'song change'})`));
      box.append(l);
    }
  }
})();
