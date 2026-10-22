(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnapEffect = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PALETTE = [
    [168, 85, 247], [192, 132, 252], [217, 70, 239], [124, 58, 237], [139, 92, 246],
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  function makeNoise(w, h, rnd) {
    const out = new Float32Array(w * h);
    const octaves = [[5, 0.5], [12, 0.3], [30, 0.2]];
    for (const [cells, weight] of octaves) {
      const rows = Math.max(2, Math.round((cells * h) / w));
      const gw = cells + 2, gh = rows + 2;
      const grid = new Float32Array(gw * gh);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd();
      const sx = cells / w, sy = rows / h;
      for (let y = 0; y < h; y++) {
        const fy = y * sy, y0 = Math.floor(fy), ty = fy - y0, wy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < w; x++) {
          const fx = x * sx, x0 = Math.floor(fx), tx = fx - x0, wx = tx * tx * (3 - 2 * tx);
          const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
          const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
          out[y * w + x] += weight * ((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy);
        }
      }
    }
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
    const span = mx - mn || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / span;
    return out;
  }

  function buildThreshold(noise, w, h, mask, minArea) {
    let minX = w, maxX = -1, minY = h, maxY = -1, area = 0;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        if (mask[i] > 128) {
          area++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (area < (minArea || 150)) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const thr = new Float32Array(w * h);
    for (let y = 0, i = 0; y < h; y++) {
      const ty = clamp01((y - minY) / bh);
      for (let x = 0; x < w; x++, i++) {
        const tx = clamp01((x - minX) / bw);
        thr[i] = 0.5 * tx + 0.08 * ty + 0.42 * noise[i];
      }
    }
    return { thr, bbox: { minX, maxX, minY, maxY }, area };
  }

  class Background {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.rgb = new Float32Array(w * h * 4);
      this.seen = new Uint8Array(w * h);
      this.low = new Uint8Array(w * h);
      this.gain = [1, 1, 1];
      this.minStable = 6;
    }
    reset() {
      this.rgb.fill(0); this.seen.fill(0); this.low.fill(0); this.gain = [1, 1, 1];
    }
    coverage() {
      let c = 0; const s = this.seen;
      for (let i = 0; i < s.length; i++) if (s[i] > 0) c++;
      return c / s.length;
    }
    update(frame, mask, rate) {
      const n = this.w * this.h, rgb = this.rgb, seen = this.seen, low = this.low;
      let cnt = 0, lr = 0, lg = 0, lb = 0, br = 0, bgc = 0, bb = 0;
      for (let i = 0; i < n; i += 5) {
        if (mask[i] < 6 && seen[i] >= 3) {
          const j = i * 4;
          lr += frame[j]; lg += frame[j + 1]; lb += frame[j + 2];
          br += rgb[j]; bgc += rgb[j + 1]; bb += rgb[j + 2];
          cnt++;
        }
      }
      if (cnt > 400) {
        const t = [lr / Math.max(1, br), lg / Math.max(1, bgc), lb / Math.max(1, bb)];
        for (let c = 0; c < 3; c++) {
          this.gain[c] += (Math.min(2, Math.max(0.5, t[c])) - this.gain[c]) * 0.15;
        }
      }
      const g0 = this.gain[0], g1 = this.gain[1], g2 = this.gain[2];
      for (let i = 0; i < n; i++) {
        if (mask[i] < 6) {
          if (low[i] < 255) low[i]++;
          const j = i * 4;
          if (seen[i] === 0) {
            if (low[i] < this.minStable) continue;
            rgb[j] = Math.min(255, frame[j] / g0);
            rgb[j + 1] = Math.min(255, frame[j + 1] / g1);
            rgb[j + 2] = Math.min(255, frame[j + 2] / g2);
            seen[i] = 1;
          } else {
            rgb[j] += (Math.min(255, frame[j] / g0) - rgb[j]) * rate;
            rgb[j + 1] += (Math.min(255, frame[j + 1] / g1) - rgb[j + 1]) * rate;
            rgb[j + 2] += (Math.min(255, frame[j + 2] / g2) - rgb[j + 2]) * rate;
            if (seen[i] < 255) seen[i]++;
          }
        } else {
          low[i] = 0;
        }
      }
    }
  }

  function buildPlate(bg) {
    const w = bg.w, h = bg.h, n = w * h;
    const f = new Float32Array(bg.rgb);
    const ok = new Uint8Array(n), res = new Uint8Array(n), hole = new Uint8Array(n);
    let holes = 0;
    for (let i = 0; i < n; i++) { ok[i] = bg.seen[i] > 0 ? 1 : 0; if (!ok[i]) { hole[i] = 1; holes++; } }

    if (holes === n) {
      for (let i = 0; i < n; i++) { f[i * 4] = 60; f[i * 4 + 1] = 58; f[i * 4 + 2] = 70; }
    } else if (holes > 0) {
      for (let y = 0; y < h; y++) {
        let x = 0;
        while (x < w) {
          if (ok[y * w + x]) { x++; continue; }
          let x1 = x;
          while (x1 < w && !ok[y * w + x1]) x1++;
          const L = x > 0 ? y * w + x - 1 : -1, R = x1 < w ? y * w + x1 : -1;
          if (L >= 0 || R >= 0) {
            for (let xx = x; xx < x1; xx++) {
              const i = y * w + xx, j = i * 4;
              const t = L >= 0 && R >= 0 ? (xx - (x - 1)) / (x1 - (x - 1)) : (L >= 0 ? 0 : 1);
              const a = (L >= 0 ? L : R) * 4, b = (R >= 0 ? R : L) * 4;
              for (let c = 0; c < 3; c++) f[j + c] = f[a + c] + (f[b + c] - f[a + c]) * t;
              res[i] = 1;
            }
          }
          x = x1;
        }
      }
      for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
          const i0 = y * w + x;
          if (ok[i0] || res[i0]) { y++; continue; }
          let y1 = y;
          while (y1 < h && !(ok[y1 * w + x] || res[y1 * w + x])) y1++;
          const L = y > 0 ? (y - 1) * w + x : -1, R = y1 < h ? y1 * w + x : -1;
          for (let yy = y; yy < y1; yy++) {
            const j = (yy * w + x) * 4;
            if (L < 0 && R < 0) { f[j] = 60; f[j + 1] = 58; f[j + 2] = 70; continue; }
            const t = L >= 0 && R >= 0 ? (yy - (y - 1)) / (y1 - (y - 1)) : (L >= 0 ? 0 : 1);
            const a = (L >= 0 ? L : R) * 4, b = (R >= 0 ? R : L) * 4;
            for (let c = 0; c < 3; c++) f[j + c] = f[a + c] + (f[b + c] - f[a + c]) * t;
          }
          y = y1;
        }
      }
      const r = 6, tmp = new Float32Array(f);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!hole[i]) continue;
          const xa = Math.max(0, x - r), xb = Math.min(w - 1, x + r), cn = xb - xa + 1;
          let s0 = 0, s1 = 0, s2 = 0;
          for (let xx = xa; xx <= xb; xx++) { const k = (y * w + xx) * 4; s0 += f[k]; s1 += f[k + 1]; s2 += f[k + 2]; }
          const j = i * 4; tmp[j] = s0 / cn; tmp[j + 1] = s1 / cn; tmp[j + 2] = s2 / cn;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!hole[i]) continue;
          const ya = Math.max(0, y - r), yb = Math.min(h - 1, y + r), cn = yb - ya + 1;
          let s0 = 0, s1 = 0, s2 = 0;
          for (let yy = ya; yy <= yb; yy++) { const k = (yy * w + x) * 4; s0 += tmp[k]; s1 += tmp[k + 1]; s2 += tmp[k + 2]; }
          const j = i * 4; f[j] = s0 / cn; f[j + 1] = s1 / cn; f[j + 2] = s2 / cn;
        }
      }
    }
    const plate = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      plate[j] = f[j]; plate[j + 1] = f[j + 1]; plate[j + 2] = f[j + 2]; plate[j + 3] = 255;
    }
    return plate;
  }

  class Particles {
    constructor(cap, w, h, rnd) {
      this.cap = cap; this.n = 0; this.w = w; this.h = h;
      this.rnd = rnd || Math.random;
      this.scale = w / 640;
      this.x = new Float32Array(cap); this.y = new Float32Array(cap);
      this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
      this.life = new Float32Array(cap); this.maxLife = new Float32Array(cap);
      this.size = new Uint8Array(cap); this.col = new Uint8Array(cap * 3);
    }
    clear() { this.n = 0; }
    spawn(x, y, r, g, b, dir) {
      if (this.n >= this.cap) return;
      const i = this.n++, rnd = this.rnd, s = this.scale;
      const pal = PALETTE[(rnd() * PALETTE.length) | 0];
      this.x[i] = x + rnd() - 0.5; this.y[i] = y + rnd() - 0.5;
      const sp = (25 + rnd() * 70) * s, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
      this.vx[i] = (Math.cos(ang) * sp + 35 * s) * dir;
      this.vy[i] = Math.sin(ang) * sp * dir;
      this.maxLife[i] = this.life[i] = 1.2 + rnd() * 2.2;
      const roll = rnd();
      this.size[i] = Math.max(1, Math.round((roll < 0.12 ? 3 : roll < 0.45 ? 2 : 1) * Math.max(1, s * 0.85)));
      this.col[i * 3] = Math.min(255, (r * 0.3 + pal[0] * 0.7) * 1.15);
      this.col[i * 3 + 1] = Math.min(255, (g * 0.3 + pal[1] * 0.7) * 1.15);
      this.col[i * 3 + 2] = Math.min(255, (b * 0.3 + pal[2] * 0.7) * 1.15);
    }
    step(dt, time, dir) {
      const s = this.scale, wx = 55 * s * dir, wy = -28 * s * dir, drag = Math.exp(-0.7 * dt);
      const { x, y, vx, vy, life, maxLife, size, col } = this;
      for (let i = this.n - 1; i >= 0; i--) {
        life[i] -= dt;
        if (life[i] <= 0) {
          const k = --this.n;
          if (k !== i) {
            x[i] = x[k]; y[i] = y[k]; vx[i] = vx[k]; vy[i] = vy[k];
            life[i] = life[k]; maxLife[i] = maxLife[k]; size[i] = size[k];
            col[i * 3] = col[k * 3]; col[i * 3 + 1] = col[k * 3 + 1]; col[i * 3 + 2] = col[k * 3 + 2];
          }
          continue;
        }
        vx[i] += (wx + Math.sin(y[i] * 0.045 + time * 2.2 + i) * 30 * s) * dt;
        vy[i] += (wy + Math.cos(x[i] * 0.04 + time * 1.7 + i * 0.3) * 20 * s) * dt;
        vx[i] *= drag; vy[i] *= drag;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      }
    }
    render(data, u32) {
      u32.fill(0xFF000000);
      const { x, y, life, maxLife, size, col, n, w, h } = this;
      for (let i = 0; i < n; i++) {
        const lt = life[i] / maxLife[i];
        const a = Math.min(1, (1 - lt) * 10) * Math.pow(lt, 0.7);
        if (a <= 0.01) continue;
        const px = x[i] | 0, py = y[i] | 0, s = size[i];
        const cr = col[i * 3] * a, cg = col[i * 3 + 1] * a, cb = col[i * 3 + 2] * a;
        for (let dy = 0; dy < s; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = 0; dx < s; dx++) {
            const xx = px + dx;
            if (xx < 0 || xx >= w) continue;
            const k = (yy * w + xx) * 4;
            data[k] += cr; data[k + 1] += cg; data[k + 2] += cb;
          }
        }
      }
    }
  }

  function composite(p) {
    const { w, h, frame, plate, mask, out, thr, progress, prevProgress, band, gain, spawn, spawnProb, rnd } = p;
    const lo = Math.min(progress, prevProgress), hi = Math.max(progress, prevProgress);
    const moving = hi > lo;
    const g0 = gain[0], g1 = gain[1], g2 = gain[2];
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const j = i << 2;
        const mv = mask[i];
        if (mv <= 1) { out[j + 3] = 0; continue; }
        const m = mv * (1 / 255), t = thr[i];
        if (moving && spawn && m > 0.5 && t > lo && t <= hi && rnd() < spawnProb) {
          spawn(x, y, frame[j], frame[j + 1], frame[j + 2]);
        }
        const d = clamp01((progress - t) * 40);
        const aP = m * d;
        const ahead = t - progress;
        let aG = 0;
        if (ahead > -0.015 && ahead < band) {
          const k = ahead <= 0 ? 1 : 1 - ahead / band;
          aG = Math.min(0.85, k * k * m * 0.85);
        }
        if (aP <= 0.002 && aG <= 0.002) { out[j + 3] = 0; continue; }
        const pr = Math.min(255, plate[j] * g0), pg = Math.min(255, plate[j + 1] * g1), pb = Math.min(255, plate[j + 2] * g2);
        const aO = aG + aP * (1 - aG);
        const wP = aP * (1 - aG);
        out[j] = (190 * aG + pr * wP) / aO;
        out[j + 1] = (95 * aG + pg * wP) / aO;
        out[j + 2] = (255 * aG + pb * wP) / aO;
        out[j + 3] = aO * 255;
      }
    }
  }

  return { PALETTE, mulberry32, smoothstep, makeNoise, buildThreshold, Background, buildPlate, Particles, composite };
});
