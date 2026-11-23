const FONTS = {
  sans: 'system-ui, "Segoe UI Variable", "Segoe UI", sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace',
  rounded: '"Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif'
};

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hexToHs(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [h, s] = rgb2hsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return { h, s };
}

// Finds the most visually prominent hue in an image (weighted by saturation and mid lightness).
function artHue(img) {
  const N = 40, c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  const bins = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    const w = s * (1 - Math.abs(2 * l - 1));
    const b = bins[Math.floor(h * 24) % 24];
    b.w += w; b.h += h * w; b.s += s * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < 0.5) return { h: 0, s: 0 };
  return { h: best.h / best.w, s: best.s / best.w };
}

function applyTheme(settings, art) {
  const base = settings.accentMode === 'album' && art ? art : hexToHs(settings.accent);
  const h = base.h * 360, s = base.s;
  const css = (hh, ss, ll) => `hsl(${Math.round(hh)} ${Math.round(ss * 100)}% ${Math.round(ll * 100)}%)`;
  const r = document.documentElement.style;
  r.setProperty('--bg', css(h, Math.min(s, 0.6) * 0.75, 0.12));
  r.setProperty('--bg2', css(h + 12, Math.min(s, 0.6) * 0.7, 0.22));
  r.setProperty('--fg', css(h, Math.min(s, 0.4) * 0.5, 0.95));
  r.setProperty('--muted', css(h, Math.min(s, 0.4) * 0.4, 0.72));
  r.setProperty('--accent', css(h, Math.max(Math.min(s, 0.9), 0.5), 0.68));
  r.setProperty('--radius', (settings.radius ?? 22) + 'px');
  r.setProperty('--font', FONTS[settings.font] || FONTS.sans);
}

/* ---------- shared helpers ---------- */

// Album art is only sent when it changes; keep the previous copy when a state update omits it.
function mergeState(prev, next) {
  if (prev && next.artData === undefined && next.artUrl === prev.artUrl) next.artData = prev.artData;
  return next;
}

// Custom background image (chosen in Settings). One copy per window, refreshed when it changes.
const BG = { key: null, url: '' };
async function syncBackground(cfg) {
  const key = cfg.bgPath ? cfg.bgPath + '|' + (cfg.bgVersion || 0) : '';
  if (key !== BG.key) { BG.key = key; BG.url = key ? await api.getBackground() : ''; }
  return BG.url;
}
function paintCardBg(el, cfg) {
  if (!BG.url) { el.style.backgroundImage = ''; return; }
  const dim = (cfg.bgDim ?? 35) / 100;
  el.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url(${BG.url})`;
  el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center';
}
