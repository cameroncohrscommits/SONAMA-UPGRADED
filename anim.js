/* Sonoma animation engine.
   Plays declarative animation packs (animation.json + images). The format is described in
   animations/README.md. Coordinates are in "deck units": 0..1 spans the record player, and
   values outside that range are off to the sides, so monsters can enter from the screen edges. */
(function () {
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, f) => a + (b - a) * f;
  const rand = (a, b) => a + Math.random() * (b - a);
  const EASE = {
    linear: (t) => t,
    easeIn: (t) => t * t * t,
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    backOut: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };
  const hexA = (hex, a) => { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

  function normKeys(keys) {
    const out = []; let prev = { x: 0, y: 0, w: 0.3, rot: 0, opacity: 1, scale: 1 };
    for (const k of [...(keys || [])].sort((a, b) => a.t - b.t)) {
      const cur = { ...prev, ...k }; cur.ease = k.ease; out.push(cur); prev = cur;
    }
    return out;
  }
  function sampleLayer(keys, t) {
    if (!keys.length || t < keys[0].t || t > keys[keys.length - 1].t) return null;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1] || a;
    const f = clamp((t - a.t) / Math.max(1, b.t - a.t), 0, 1), e = (EASE[b.ease] || EASE.easeInOut)(f);
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), rot: lerp(a.rot, b.rot, e), opacity: lerp(a.opacity, b.opacity, e), scale: lerp(a.scale, b.scale, e) };
  }

  class AnimEngine {
    constructor(o) {
      Object.assign(this, { overlay: o.overlay, canvas: o.canvas, deck: o.deck, stage: o.stage, record: o.record });
      this.g = o.canvas.getContext('2d'); this.run = null; this._token = 0;
    }
    get busy() { return !!this.run; }
    stop() { if (this.run) this.run.finish(); }

    async play(anim, hooks = {}) {
      this.stop();
      const self = this, token = ++this._token, g = this.g, canvas = this.canvas;
      const W = innerWidth, H = innerHeight, dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

      const base = (window.SONOMA_ANIM_BASE || 'sonoma-anim://') + anim.id + '/';
      const layers = (anim.layers || []).filter((L) => L.src).map((L) => {
        const img = new Image(); img.className = 'fxlayer'; img.style.opacity = 0; img.src = base + L.src;
        this.overlay.appendChild(img);
        return { L, keys: normKeys(L.keys), img, cur: null, aspect: 1 };
      });
      await Promise.all(layers.map((l) => l.img.decode().then(() => { l.aspect = l.img.naturalHeight / (l.img.naturalWidth || 1) || 1; }).catch(() => {})));
      if (token !== this._token) { layers.forEach((l) => l.img.remove()); return; }

      return new Promise((resolve) => {
        const R = this.deck.getBoundingClientRect(), U = R.width;
        const P = (x, y) => [R.left + x * U, R.top + y * U];
        const effects = (anim.effects || []).map((e) => ({ ...e }));
        const rec = anim.record || {}, dur = anim.duration || 4000;
        const parts = [], rings = [];
        let done = false, raf = 0, swapped = false, destroyed = false, returned = false;
        let last = performance.now(); const t0 = last;

        const layerPoint = (l, at) => {
          const s = l.cur, wpx = s.w * U, hpx = wpx * l.aspect, [cx, cy] = P(s.x, s.y), flip = l.L.flip ? -1 : 1;
          const lx = (at[0] - 0.5) * wpx * s.scale * flip, ly = (at[1] - 0.5) * hpx * s.scale;
          const r = (s.rot * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
          return [cx + lx * c - ly * sn, cy + lx * sn + ly * c];
        };
        const pointOf = (spec) => {
          if (!spec || spec === 'record') return P(0.5, 0.5);
          if (Array.isArray(spec)) return P(spec[0], spec[1]);
          if (spec.layer) { const l = layers.find((q) => q.L.id === spec.layer); return l && l.cur ? layerPoint(l, spec.at || [0.5, 0.5]) : null; }
          if (spec.x !== undefined) return P(spec.x, spec.y);
          return null;
        };
        const circle = (x, y, r) => { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, 6.2832); g.fill(); };

        function spawn(e, p, count) {
          const kind = e.kind || 'ember', colors = e.colors || ['#ff9a3c', '#ff5a1f', '#ffd36b'];
          const sp = e.speed || [0.15, 0.6], life = e.life || [600, 1400], sz = e.size || [0.008, 0.02], spread = (e.spread || 0) * U;
          for (let i = 0; i < count && parts.length < 900; i++) {
            const ang = (e.angle ? rand(e.angle[0], e.angle[1]) : rand(0, 360)) * Math.PI / 180, v = rand(sp[0], sp[1]) * U;
            parts.push({
              kind, x: p[0] + rand(-spread, spread), y: p[1] + rand(-spread, spread),
              vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: rand(life[0], life[1]), age: 0, size: rand(sz[0], sz[1]) * U,
              color: colors[(Math.random() * colors.length) | 0], rot: rand(0, 6.28), vr: rand(-6, 6),
              g: (e.gravity ?? (kind === 'shard' ? 1.3 : kind === 'ember' ? -0.18 : kind === 'smoke' ? -0.05 : 0.2)) * U
            });
          }
        }
        const ring = (p, max, color, ms) => rings.push({ x: p[0], y: p[1], max: max * U, color, ms, age: 0 });

        function stepParts(dt) {
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i]; p.age += dt * 1000;
            if (p.age >= p.life) { parts.splice(i, 1); continue; }
            p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            const f = p.age / p.life, a = 1 - f;
            if (p.kind === 'shard') {
              g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = clamp(a * 1.5, 0, 1); g.fillStyle = p.color;
              g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); g.restore();
            } else if (p.kind === 'smoke') {
              g.globalAlpha = 0.3 * a; g.fillStyle = p.color; circle(p.x, p.y, p.size * (1 + f * 2.4));
            } else {
              g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.fillStyle = p.color;
              circle(p.x, p.y, p.size * (p.kind === 'spark' ? 0.6 : 1) * (1 - f * 0.5)); g.globalCompositeOperation = 'source-over';
            }
          }
          g.globalAlpha = 1;
        }

        function drawBeam(e, t) {
          const start = e.start || 0, end = e.end ?? start + 1000;
          if (t < start || t > end) return;
          const A = pointOf(e.from), B = pointOf(e.to);
          if (!A || !B) return;
          const grow = clamp((t - start) / (e.grow || 350), 0, 1), k = EASE.easeOut(grow);
          const tip = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k];
          const fade = clamp((end - t) / 220, 0, 1), w = (e.width || 0.04) * U * (0.86 + 0.14 * Math.sin(t / 35)) * fade;
          const color = e.color || '#ff6a2b', core = e.core || '#ffffff';
          g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
          for (const [mul, col, al] of [[2.6, color, 0.22], [1.4, color, 0.55], [0.55, core, 0.95]]) {
            g.strokeStyle = hexA(col, al); g.lineWidth = w * mul; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(tip[0], tip[1]); g.stroke();
          }
          const gr = g.createRadialGradient(A[0], A[1], 0, A[0], A[1], w * 2.4);
          gr.addColorStop(0, hexA(core, 0.9)); gr.addColorStop(1, hexA(color, 0));
          g.fillStyle = gr; circle(A[0], A[1], w * 2.4);
          g.restore();
          if (e.sparks && grow >= 1 && Math.random() < 0.8) spawn({ kind: 'spark', colors: [core, color], speed: [0.2, 0.7], life: [250, 600], size: [0.004, 0.01] }, tip, 2);
        }

        const finish = () => {
          if (done) return; done = true; cancelAnimationFrame(raf);
          layers.forEach((l) => l.img.remove());
          g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
          self.stage.style.transform = ''; self.record.style.filter = ''; self.record.style.visibility = '';
          if (!swapped && hooks.onSwap) { swapped = true; hooks.onSwap(); }   // never lose the new album art
          if (self.run === run) self.run = null;
          resolve();
        };
        const run = { finish }; this.run = run;

        const frame = (now) => {
          if (done) return;
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          const t = now - t0;
          g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);

          for (const l of layers) {
            const s = (l.cur = sampleLayer(l.keys, t));
            if (!s) { l.img.style.opacity = 0; continue; }
            const [px, py] = P(s.x, s.y), sx = l.L.flip ? -s.scale : s.scale;
            l.img.style.width = s.w * U + 'px'; l.img.style.opacity = s.opacity;
            l.img.style.transform = `translate(${px}px,${py}px) translate(-50%,-50%) rotate(${s.rot}deg) scale(${sx},${s.scale})`;
          }

          // the record: heats up, is destroyed, then a new one drops in
          const c = P(0.5, 0.5);
          if (rec.burn && t >= rec.burn[0] && !destroyed) {
            const p = clamp((t - rec.burn[0]) / (rec.burn[1] - rec.burn[0]), 0, 1);
            self.record.style.filter = `brightness(${1 - 0.55 * p}) sepia(${p}) saturate(${1 + 2.2 * p}) hue-rotate(${-18 * p}deg)`;
            const r = 0.36 * U, gr = g.createRadialGradient(c[0], c[1], r * 0.2, c[0], c[1], r);
            gr.addColorStop(0, 'rgba(255,140,40,0)'); gr.addColorStop(1, `rgba(255,80,10,${0.55 * p * (0.8 + 0.2 * Math.sin(t / 60))})`);
            g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; circle(c[0], c[1], r); g.restore();
            if (Math.random() < 0.7 * p) { const a = rand(0, 6.28), d = rand(0, 0.34) * U; spawn({ kind: 'ember', size: [0.005, 0.012], speed: [0.05, 0.25], angle: [-100, -80], life: [500, 1100] }, [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d], 1); }
          }
          if (rec.destroyAt !== undefined && !destroyed && t >= rec.destroyAt) {
            destroyed = true; self.record.style.visibility = 'hidden'; self.record.style.filter = '';
            if (rec.debris !== false) {
              spawn({ kind: 'shard', colors: ['#1a1416', '#3a1d14', '#ff7a3d', '#2a2a30'], speed: [0.3, 1.1], size: [0.012, 0.035], life: [900, 1700], spread: 0.22 }, c, 70);
              spawn({ kind: 'ember', speed: [0.2, 0.9], size: [0.006, 0.02], life: [700, 1600], spread: 0.2 }, c, 110);
              spawn({ kind: 'smoke', colors: ['#3a3236', '#4a4046'], speed: [0.05, 0.2], size: [0.03, 0.07], life: [1200, 2200], spread: 0.2 }, c, 22);
            }
          }
          if (rec.returnAt !== undefined && !returned && t >= rec.returnAt) {
            returned = true; swapped = true;
            self.record.style.visibility = ''; self.record.style.filter = '';
            if (hooks.onSwap) hooks.onSwap();
            self.record.animate([{ transform: 'scale(1.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
            ring(c, 0.55, '#ffffff', 600); spawn({ kind: 'smoke', colors: ['#d8d2cc'], speed: [0.05, 0.25], size: [0.02, 0.04], life: [600, 1100], spread: 0.3 }, c, 14);
          }

          let shx = 0, shy = 0, flashA = 0, flashC = '#ffffff';
          for (const e of effects) {
            const start = e.start || 0, end = e.end ?? start + 1000;
            if (e.type === 'beam') drawBeam(e, t);
            else if (e.type === 'particles') {
              if (e.count) { if (!e.fired && t >= start) { e.fired = true; const p = pointOf(e.at); if (p) spawn(e, p, e.count); } }
              else if (e.rate && t >= start && t <= end) {
                e._acc = (e._acc || 0) + e.rate * dt; const n = Math.floor(e._acc); e._acc -= n;
                const p = pointOf(e.at); if (p && n) spawn(e, p, n);
              }
            } else if (e.type === 'shockwave') {
              if (!e.fired && t >= start) { e.fired = true; const p = pointOf(e.at); if (p) ring(p, e.radius || 0.8, e.color || '#ffffff', end - start); }
            } else if (e.type === 'flash') {
              if (t >= start && t <= end) { const f = (t - start) / (end - start), a = (e.alpha ?? 0.6) * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85); if (a > flashA) { flashA = a; flashC = e.color || '#ffffff'; } }
            } else if (e.type === 'shake') {
              if (t >= start && t <= end) { const amp = (e.amp || 0.01) * U * (1 - (t - start) / (end - start)); shx += rand(-amp, amp); shy += rand(-amp, amp); }
            }
          }
          self.stage.style.transform = shx || shy ? `translate(${shx}px,${shy}px)` : '';

          stepParts(dt);
          for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i]; r.age += dt * 1000;
            if (r.age >= r.ms) { rings.splice(i, 1); continue; }
            const f = r.age / r.ms;
            g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = hexA(r.color, 0.8 * (1 - f));
            g.lineWidth = Math.max(2, U * 0.025 * (1 - f)); g.beginPath(); g.arc(r.x, r.y, r.max * EASE.easeOut(f), 0, 6.2832); g.stroke(); g.restore();
          }
          if (flashA > 0.01) { g.fillStyle = hexA(flashC, clamp(flashA, 0, 1)); g.fillRect(0, 0, W, H); }

          if (t >= dur) return finish();
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      });
    }
  }
  window.AnimEngine = AnimEngine;
})();
