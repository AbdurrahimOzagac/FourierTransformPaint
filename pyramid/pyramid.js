'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sb = (n) => String(n).split('').map((d) => SUB[+d] || d).join('');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SERIES = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--s${i}`));

  // ===========================================================================
  // Görüntü işlemleri. Görüntü: { w, h, c: [Float32Array, ...] } (1 ya da 3 kanal)
  // ===========================================================================
  const mk = (w, h, nc = 1) => ({ w, h, c: Array.from({ length: nc }, () => new Float32Array(w * h)) });
  const fromCh = (w, h, chans) => ({ w, h, c: chans });

  let W = kernel(0.375);
  function kernel(a) { const c = 0.25 - a / 2; return [c, 0.25, a, 0.25, c]; }

  // Kenar yansıtma (kenar pikseli tekrarlanmadan): -1 -> 1, n -> n-2
  function refl(i, n) {
    if (n === 1) return 0;
    const p = 2 * n - 2;
    i %= p; if (i < 0) i += p;
    return i < n ? i : p - i;
  }

  // REDUCE: süz ve her iki yönde 2'ye seyrelt.
  function reduceCh(src, w, h) {
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
    const tmp = new Float32Array(w2 * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w2; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += W[k + 2] * src[r + refl(2 * x + k, w)];
        tmp[y * w2 + x] = s;
      }
    }
    const out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w2; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += W[k + 2] * tmp[refl(2 * y + k, h) * w2 + x];
        out[y * w2 + x] = s;
      }
    }
    return out;
  }
  // EXPAND: araya sıfır ekle, 2·çekirdek ile her yönde süz (2B'de toplam ×4).
  function expandCh(src, w, h, W2, H2) {
    const tmp = new Float32Array(W2 * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let j = 0; j < W2; j++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) {
          const jj = refl(j + k, W2);
          if (!(jj & 1)) s += W[k + 2] * src[r + Math.min(w - 1, jj >> 1)];
        }
        tmp[y * W2 + j] = 2 * s;
      }
    }
    const out = new Float32Array(W2 * H2);
    for (let i = 0; i < H2; i++) {
      for (let x = 0; x < W2; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) {
          const ii = refl(i + k, H2);
          if (!(ii & 1)) s += W[k + 2] * tmp[Math.min(h - 1, ii >> 1) * W2 + x];
        }
        out[i * W2 + x] = 2 * s;
      }
    }
    return out;
  }
  const reduce = (img) => fromCh(Math.max(1, img.w >> 1), Math.max(1, img.h >> 1), img.c.map((c) => reduceCh(c, img.w, img.h)));
  const expand = (img, w2 = img.w * 2, h2 = img.h * 2) => fromCh(w2, h2, img.c.map((c) => expandCh(c, img.w, img.h, w2, h2)));
  function zeroInsert(img) {
    const out = mk(img.w * 2, img.h * 2, img.c.length);
    img.c.forEach((c, k) => {
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.c[k][(2 * y) * out.w + 2 * x] = c[y * img.w + x];
    });
    return out;
  }
  function binop(a, b, f) {
    const nc = Math.max(a.c.length, b.c.length);
    const out = mk(a.w, a.h, nc);
    for (let k = 0; k < nc; k++) {
      const A = a.c[Math.min(k, a.c.length - 1)], B = b.c[Math.min(k, b.c.length - 1)], O = out.c[k];
      for (let i = 0; i < O.length; i++) O[i] = f(A[i], B[i]);
    }
    return out;
  }
  const sub = (a, b) => binop(a, b, (x, y) => x - y);
  const add = (a, b) => binop(a, b, (x, y) => x + y);
  const mapImg = (a, f) => fromCh(a.w, a.h, a.c.map((c) => c.map(f)));

  function gaussPyr(img, K) {
    const G = [img];
    for (let l = 0; l < K; l++) G.push(reduce(G[l]));
    return G;
  }
  function lapPyr(G) {
    const K = G.length - 1;
    const L = [];
    for (let l = 0; l < K; l++) L.push(sub(G[l], expand(G[l + 1], G[l].w, G[l].h)));
    L.push(G[K]);
    return L;
  }
  function collapse(L) {
    let r = L[L.length - 1];
    for (let l = L.length - 2; l >= 0; l--) r = add(L[l], expand(r, L[l].w, L[l].h));
    return r;
  }
  function upTo(img, w) {
    while (img.w < w) img = expand(img);
    return img;
  }
  // À trous: seyreltmeden, genişletilmiş çekirdekle süzme (k kez REDUCE'a eşdeğer bulanıklık).
  function atrous(img, k) {
    let cur = img;
    for (let s = 0; s < k; s++) {
      const d = 1 << s;
      cur = fromCh(cur.w, cur.h, cur.c.map((src) => {
        const { w, h } = cur;
        const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let t = 0;
          for (let q = -2; q <= 2; q++) t += W[q + 2] * src[y * w + refl(x + q * d, w)];
          tmp[y * w + x] = t;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let t = 0;
          for (let q = -2; q <= 2; q++) t += W[q + 2] * tmp[refl(y + q * d, h) * w + x];
          out[y * w + x] = t;
        }
        return out;
      }));
    }
    return cur;
  }
  function decimate(img, f) {
    const w = img.w / f, h = img.h / f;
    const out = mk(w, h, img.c.length);
    img.c.forEach((c, k) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.c[k][y * w + x] = c[(y * f) * img.w + x * f];
    });
    return out;
  }

  // ===========================================================================
  // FFT (radix-2) — Fourier Paint ile aynı
  // ===========================================================================
  const fftCache = {};
  function makeFFT(n) {
    if (fftCache[n]) return fftCache[n];
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    const f = (re, im) => {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const wr = cos[k], wi = -sin[k], l = j + half;
            const tr = re[l] * wr - im[l] * wi, ti = re[l] * wi + im[l] * wr;
            re[l] = re[j] - tr; im[l] = im[j] - ti; re[j] += tr; im[j] += ti;
          }
        }
      }
    };
    return (fftCache[n] = f);
  }
  // Genlik |F| (merkezlenmemiş).
  function fftMag(data, n) {
    const fft = makeFFT(n);
    const re = Float64Array.from(data), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) fft(re.subarray(y * n, (y + 1) * n), im.subarray(y * n, (y + 1) * n));
    const cr = new Float64Array(n), ci = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { cr[y] = re[y * n + x]; ci[y] = im[y * n + x]; }
      fft(cr, ci);
      for (let y = 0; y < n; y++) { re[y * n + x] = cr[y]; im[y * n + x] = ci[y]; }
    }
    const mag = new Float32Array(n * n);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
  }

  // ===========================================================================
  // Çizim (render)
  // ===========================================================================
  function lapScale(img) {
    if (S.lapGain !== 'auto') return +S.lapGain;
    const vals = [];
    const step = Math.max(1, Math.floor(img.c[0].length / 4096));
    for (const c of img.c) for (let i = 0; i < c.length; i += step) vals.push(Math.abs(c[i]));
    vals.sort((a, b) => a - b);
    const p = vals[Math.floor(vals.length * 0.99)] || 0;
    return Math.min(16, 100 / Math.max(p, 3));
  }
  // mode: 'img' (0–255 kırp), 'lap' (128 + k·v), 'norm' (min–max), 'scale' ({k, off})
  function render(canvas, img, mode = 'img', o = {}) {
    if (canvas.width !== img.w) canvas.width = img.w;
    if (canvas.height !== img.h) canvas.height = img.h;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(img.w, img.h);
    const d = id.data;
    let k = 1, off = 0;
    if (mode === 'lap') { k = o.k ?? lapScale(img); off = 128; }
    else if (mode === 'norm') {
      let lo = Infinity, hi = -Infinity;
      for (const c of img.c) for (let i = 0; i < c.length; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (!(hi - lo > 1e-9)) { hi = lo + 1; }
      k = 255 / (hi - lo); off = -lo * k;
    } else if (mode === 'scale') { k = o.k; off = o.off || 0; }
    const nc = img.c.length;
    const [R, G, B] = nc === 1 ? [img.c[0], img.c[0], img.c[0]] : img.c;
    for (let i = 0, p = 0; i < R.length; i++, p += 4) {
      d[p] = R[i] * k + off; d[p + 1] = G[i] * k + off; d[p + 2] = B[i] * k + off; d[p + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
  }
  const offscreen = (img, mode, o) => render(document.createElement('canvas'), img, mode, o);

  function figure(caption, cls) {
    const f = el('figure', cls);
    const box = el('div', 'canvas-box');
    const c = el('canvas');
    box.appendChild(c);
    f.appendChild(box);
    const cap = el('figcaption', '', caption);
    f.appendChild(cap);
    return { f, c, cap, box };
  }

  // ===========================================================================
  // Durum
  // ===========================================================================
  const S = {
    N: 256, K: 4, a: 0.375, lapGain: 'auto',
    img: null, src: { kind: 'gen', id: 'zebra' },
    G: [], L: [], drawing: false,
    tpl: null, // {x, y, w, h} 256 birim (seviye-b pikselleri)
  };
  const PYR = window.PYR_EXAMPLES;
  const PHOTOS = PYR.photos;
  const FEX = (window.FOURIER_EXAMPLES || []).filter((e) => e.gen);
  const allGray = [...PYR.gray, ...FEX];
  const maxK = () => Math.log2(S.N); // 1×1'e kadar

  // Fotoğraflar: tembel yükleme + önbellek
  const photoCache = new Map();
  function photoPromise(id) {
    const ph = PHOTOS.find((p) => p.id === id);
    if (!ph) return Promise.reject(new Error('yok: ' + id));
    let e = photoCache.get(id);
    if (!e) {
      e = { img: null };
      e.promise = new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => { e.img = im; res(im); };
        im.onerror = () => rej(new Error('yüklenemedi: ' + ph.file));
        im.src = ph.file;
      });
      photoCache.set(id, e);
    }
    return e.promise;
  }
  const photoNow = (id) => (photoCache.get(id) || {}).img || null;
  const TAINT_MSG = 'Fotoğraflar okunamadı: sayfa dosyadan (file://) açılmış. GitHub Pages üzerinden ya da yerelde <code>python3 -m http.server</code> ile açın.';
  function safeChannels(image, N, gray, tf) {
    try { return imageToChannels(image, N, gray, tf); }
    catch (err) {
      $('ex-info').innerHTML = TAINT_MSG;
      $('bl-msg').innerHTML = TAINT_MSG;
      return null;
    }
  }

  // Ana görüntüyü seç (sentetik ya da fotoğraf). Başarılıysa true döner.
  async function setMain(id) {
    if (id.startsWith('ph-')) {
      const ph = PHOTOS.find((p) => p.id === id);
      S.src = { kind: 'photo', id };
      $('ex-info').innerHTML = `<span class="status">${ph.name} yükleniyor…</span>`;
      let im;
      try { im = await photoPromise(id); } catch (err) { $('ex-info').textContent = err.message; return false; }
      if (S.src.id !== id) return false;
      const ch = safeChannels(im, S.N, true);
      if (!ch) return false;
      S.img = fromCh(S.N, S.N, ch);
      $('g-example').value = id;
      $('ex-info').innerHTML = `<b>${ph.name}.</b> ${ph.info} <span class="sub">(Kaynak: ${ph.credit}; gri seviyeye çevrildi.)</span>`;
      return true;
    }
    const ex = allGray.find((e) => e.id === id) || PYR.gray[0];
    S.src = { kind: 'gen', id: ex.id };
    S.img = fromCh(S.N, S.N, [Float32Array.from(ex.gen(S.N))]);
    $('g-example').value = ex.id;
    $('ex-info').innerHTML = `<b>${ex.name}.</b> ${ex.info || ''}`;
    return true;
  }
  function selectMain(id) { return setMain(id).then((ok) => { if (ok) fullRefresh(); }); }
  async function reloadImage() {
    if (S.src.kind === 'upload') {
      const ch = safeChannels(S.src.img, S.N, true);
      if (ch) S.img = fromCh(S.N, S.N, ch);
      $('g-example').value = 'upload';
      return true;
    }
    return setMain(S.src.id);
  }
  function imageToChannels(image, N, gray, tf) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const t = tf || { s: 1, dx: 0, dy: 0 };
    if (tf) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, N, N); }
    const s = Math.max(N / image.width, N / image.height) * t.s;
    const w = image.width * s, h = image.height * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, (N - w) / 2 + t.dx * N, (N - h) / 2 + t.dy * N, w, h);
    const d = ctx.getImageData(0, 0, N, N).data;
    const ch = [0, 1, 2].map(() => new Float32Array(N * N));
    for (let i = 0, o = 0; i < N * N; i++, o += 4) { ch[0][i] = d[o]; ch[1][i] = d[o + 1]; ch[2][i] = d[o + 2]; }
    if (!gray) return ch;
    const g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
    return [g];
  }
  function readFile(input, cb) {
    const f = input.files && input.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { cb(im); URL.revokeObjectURL(url); input.value = ''; };
    im.src = url;
  }

  // ===========================================================================
  // Hesap ve güncelleme
  // ===========================================================================
  function recompute() {
    W = kernel(S.a);
    S.G = gaussPyr(S.img, S.K);
    S.L = lapPyr(S.G);
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); renderAll(); });
  }
  function renderAll() {
    renderSource();
    renderSampling();
    renderGauss();
    renderLapFlow();
    renderUp();
    renderFull();
    renderRecon();
    renderApps();
    if (!S.drawing) {
      renderMatch();
      renderSpectra();
      if ($('bl-a').value === 'main' || $('bl-b').value === 'main') renderBlend();
    }
  }
  function fullRefresh() {
    recompute();
    buildLapFlow();
    buildRecon();
    buildGains();
    buildUpSelect();
    renderAll();
    renderStatic();
    renderBlend();
  }

  // ===========================================================================
  // Kaynak görüntü ve çizim
  // ===========================================================================
  const srcCanvas = $('src-canvas');
  function renderSource() { render(srcCanvas, S.img); }
  function canvasPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  }
  function stampLine(ax, ay, bx, by) {
    const size = +$('pen-size').value * S.N / 256;
    const v = +$('pen-value').value;
    const r = size / 2, N = S.N, d = S.img.c[0];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r / 2)));
    for (let s = 0; s <= steps; s++) {
      const cx = ax + (bx - ax) * s / steps, cy = ay + (by - ay) * s / steps;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r + 0.25) d[y * N + x] = v;
      }
    }
  }
  {
    let last = null;
    srcCanvas.addEventListener('pointerdown', (e) => {
      srcCanvas.setPointerCapture(e.pointerId);
      S.drawing = true;
      last = canvasPos(srcCanvas, e);
      stampLine(...last, ...last);
      schedule();
    });
    srcCanvas.addEventListener('pointermove', (e) => {
      const p = canvasPos(srcCanvas, e);
      const v = S.img.c[0][Math.min(S.N - 1, p[1] | 0) * S.N + Math.min(S.N - 1, p[0] | 0)];
      $('src-readout').textContent = `x = ${p[0] | 0}, y = ${p[1] | 0}   f = ${v === undefined ? '' : v.toFixed(1)}`;
      if (!last) return;
      stampLine(...last, ...p);
      last = p;
      schedule();
    });
    const end = () => {
      if (!last) return;
      last = null;
      S.drawing = false;
      schedule();
    };
    srcCanvas.addEventListener('pointerup', end);
    srcCanvas.addEventListener('pointercancel', end);
  }

  // ===========================================================================
  // 1. Şablon eşleme
  // ===========================================================================
  const tmCanvas = $('tm-canvas');
  let tmDrag = null;
  function matchScore(I, T, tw, th, method) {
    const w = I.w, h = I.h, f = I.c[0];
    const out = new Float32Array(w * h).fill(NaN);
    if (tw > w || th > h) return out;
    const n = tw * th;
    let tm = 0;
    for (let i = 0; i < n; i++) tm += T[i];
    tm /= n;
    const tz = new Float32Array(n);
    let tss = 0, t2 = 0;
    for (let i = 0; i < n; i++) { tz[i] = T[i] - tm; tss += tz[i] * tz[i]; t2 += T[i] * T[i]; }
    const W1 = w + 1;
    const ii = new Float64Array(W1 * (h + 1)), ii2 = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0, rs2 = 0;
      for (let x = 0; x < w; x++) {
        const v = f[y * w + x]; rs += v; rs2 += v * v;
        ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + rs;
        ii2[(y + 1) * W1 + x + 1] = ii2[y * W1 + x + 1] + rs2;
      }
    }
    for (let y = 0; y + th <= h; y++) {
      for (let x = 0; x + tw <= w; x++) {
        const a = y * W1 + x, b = a + tw, c = (y + th) * W1 + x, d = c + tw;
        const sf = ii[d] - ii[b] - ii[c] + ii[a];
        const sf2 = ii2[d] - ii2[b] - ii2[c] + ii2[a];
        let cross = 0;
        for (let q = 0; q < th; q++) {
          const ro = (y + q) * w + x, to = q * tw;
          for (let p = 0; p < tw; p++) cross += tz[to + p] * f[ro + p];
        }
        let s;
        if (method === 'ncc') {
          const vf = sf2 - sf * sf / n;
          s = vf > 1e-6 && tss > 1e-6 ? cross / Math.sqrt(tss * vf) : 0;
        } else {
          const tf = cross + tm * sf;
          const ssd = Math.max(0, t2 - 2 * tf + sf2);
          s = 1 - Math.sqrt(ssd / n) / 255;
        }
        out[(y + (th >> 1)) * w + x + (tw >> 1)] = s;
      }
    }
    return out;
  }
  function detect(map, w, h, tw, th, thr) {
    const cand = [];
    for (let i = 0; i < map.length; i++) if (map[i] >= thr) cand.push(i);
    cand.sort((a, b) => map[b] - map[a]);
    const keep = [];
    for (const i of cand.slice(0, 20000)) {
      const x = i % w, y = (i / w) | 0;
      if (keep.some((k) => Math.abs(k.x - x) < tw && Math.abs(k.y - y) < th)) continue;
      keep.push({ x, y, s: map[i] });
      if (keep.length >= 12) break;
    }
    return keep;
  }
  function drawBoxes(canvas, img, boxes, scale) {
    const s = scale;
    canvas.width = img.w * s; canvas.height = img.h * s;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen(img), 0, 0, canvas.width, canvas.height);
    for (const b of boxes) {
      ctx.strokeStyle = b.color; ctx.lineWidth = b.lw || 2;
      if (b.dash) ctx.setLineDash(b.dash); else ctx.setLineDash([]);
      ctx.strokeRect(b.x * s, b.y * s, b.w * s, b.h * s);
    }
  }
  let eyesCache = null;
  function matchImage() {
    if ($('tm-src').value === 'main') return S.img;
    if (!eyesCache || eyesCache.w !== S.N) {
      const ex = PYR.gray.find((e) => e.id === 'eyes');
      eyesCache = fromCh(S.N, S.N, [ex.gen(S.N)]);
    }
    return eyesCache;
  }
  function renderMatch() {
    const b = Math.log2(S.N / 256);
    const levels = 4;
    const MG = gaussPyr(matchImage(), b + levels - 1);
    const base = MG[b];
    const colors = SERIES();
    const method = $('tm-method').value;
    const thr = +$('tm-thr').value;
    const wrap = $('tm-levels');
    wrap.innerHTML = '';
    const baseBoxes = [];
    const tpl = S.tpl;
    const tc = $('tm-tpl');
    if (!tpl || tpl.w < 3 || tpl.h < 3) {
      $('tm-info').textContent = 'Henüz şablon seçilmedi.';
      tc.width = tc.height = 1;
      drawBoxes(tmCanvas, base, [], 2);
      return;
    }
    const tx = Math.round(tpl.x), ty = Math.round(tpl.y), tw = Math.round(tpl.w), th = Math.round(tpl.h);
    const T = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      T[y * tw + x] = base.c[0][Math.min(base.h - 1, Math.max(0, ty + y)) * base.w + Math.min(base.w - 1, Math.max(0, tx + x))];
    }
    render(tc, fromCh(tw, th, [T]));
    $('tm-info').innerHTML = `Şablon boyutu <b>${tw} × ${th}</b> piksel. Her seviyede aynı şablon kullanılır; seviye l’de bulunan bir eşleşme orijinalde 2<sup>l</sup> kat büyük bir nesneye karşılık gelir.`;
    for (let l = 0; l < levels; l++) {
      const I = MG[b + l];
      const map = matchScore(I, T, tw, th, method);
      const hits = detect(map, I.w, I.h, tw, th, thr);
      const card = el('div', 'lvl-card tm-level');
      const pair = el('div', 'pair');
      const c1 = el('canvas'), c2 = el('canvas');
      const b1 = el('div', 'canvas-box'); b1.appendChild(c1);
      const b2 = el('div', 'canvas-box'); b2.appendChild(c2);
      pair.append(b1, b2);
      const sc = 256 / I.w;
      drawBoxes(c1, I, hits.map((h) => ({ x: h.x - (tw >> 1), y: h.y - (th >> 1), w: tw, h: th, color: colors[l], lw: 2 / sc * Math.max(1, sc / 2) })), sc);
      const vis = map.map((v) => (Number.isNaN(v) ? (method === 'ncc' ? -1 : 0) : v));
      render(c2, fromCh(I.w, I.h, [vis]), 'scale', method === 'ncc' ? { k: 127.5, off: 127.5 } : { k: 255, off: 0 });
      const best = hits.length ? hits[0].s.toFixed(2) : '—';
      card.append(pair, el('div', 'hint', `<b style="color:${colors[l]}">Seviye ${l}</b> (${I.w}×${I.h}) · ${method === 'ncc' ? 'NCC' : '1−√SSD'} haritası sağda · ${hits.length} eşleşme, en iyi ${best}`));
      wrap.appendChild(card);
      const f = 1 << l;
      for (const h of hits) baseBoxes.push({ x: (h.x - (tw >> 1)) * f, y: (h.y - (th >> 1)) * f, w: tw * f, h: th * f, color: colors[l], lw: 1.5 });
    }
    baseBoxes.push({ x: tx, y: ty, w: tw, h: th, color: '#ffffff', dash: [3, 3], lw: 1 });
    drawBoxes(tmCanvas, base, baseBoxes, 2);
  }
  {
    const pos = (e) => canvasPos(tmCanvas, e).map((v) => v / 2);
    tmCanvas.addEventListener('pointerdown', (e) => {
      tmCanvas.setPointerCapture(e.pointerId);
      tmDrag = pos(e);
    });
    tmCanvas.addEventListener('pointermove', (e) => {
      if (!tmDrag) return;
      const p = pos(e);
      const ctx = tmCanvas.getContext('2d');
      renderMatchPreview(tmDrag, p, ctx);
    });
    tmCanvas.addEventListener('pointerup', (e) => {
      if (!tmDrag) return;
      const p = pos(e);
      const x = Math.min(tmDrag[0], p[0]), y = Math.min(tmDrag[1], p[1]);
      const w = Math.abs(p[0] - tmDrag[0]), h = Math.abs(p[1] - tmDrag[1]);
      tmDrag = null;
      if (w >= 4 && h >= 4) S.tpl = { x, y, w: Math.min(w, 96), h: Math.min(h, 96) };
      renderMatch();
    });
  }
  let previewBase = null;
  function renderMatchPreview(a, b, ctx) {
    if (!previewBase) previewBase = ctx.getImageData(0, 0, tmCanvas.width, tmCanvas.height);
    ctx.putImageData(previewBase, 0, 0);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.strokeRect(a[0] * 2, a[1] * 2, (b[0] - a[0]) * 2, (b[1] - a[1]) * 2);
    ctx.setLineDash([]);
  }
  tmCanvas.addEventListener('pointerup', () => { previewBase = null; });

  // ===========================================================================
  // 2. Örnekleme
  // ===========================================================================
  function renderSampling() {
    const f = +$('smp-factor').value;
    const k = Math.log2(f);
    const blurred = atrous(S.img, k);
    const good = decimate(blurred, f);
    const bad = decimate(S.img, f);
    render($('smp-orig'), S.img);
    render($('smp-blur'), blurred);
    render($('smp-good'), good);
    render($('smp-bad'), bad);
    $('smp-good-cap').innerHTML = `Gauss + ${f}’de bir örnek (${good.w}×${good.h}) = g<sub>${k}</sub>`;
    $('smp-bad-cap').innerHTML = `Süzmeden ${f}’de bir örnek (${bad.w}×${bad.h}): <b>örtüşme</b>`;
  }

  // ===========================================================================
  // 3. Gauss piramidi
  // ===========================================================================
  function renderGauss() {
    const wrap = $('gauss-same');
    wrap.innerHTML = '';
    S.G.forEach((g, l) => {
      const { f, c } = figure(`g<sub>${l}</sub> = x<sub>${l + 1}</sub> · ${g.w}×${g.h}`);
      render(c, g);
      wrap.appendChild(f);
    });
    drawLayout($('gauss-layout'), S.G, () => 'img');
  }
  function drawLayout(canvas, levels, modeOf) {
    const N = levels[0].w;
    canvas.width = N + (levels.length > 1 ? N / 2 : 0);
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cssVar('--surface');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen(levels[0], modeOf(0)), 0, 0);
    for (let l = 1; l < levels.length; l++) {
      ctx.drawImage(offscreen(levels[l], modeOf(l)), N, N - N / 2 ** (l - 1));
    }
    canvas.style.width = Math.min(canvas.width, 768) + 'px';
  }

  // Statik parçalar (yalnızca a ya da K değişince)
  function renderStatic() {
    const [c, b, a] = W.slice(0, 3);
    $('kernel-text').textContent = `[${fmt(c)}, ${fmt(b)}, ${fmt(a)}, ${fmt(b)}, ${fmt(c)}]` + (Math.abs(S.a - 0.375) < 1e-9 ? ' = [1 4 6 4 1] / 16' : '');
    drawGauss1D();
    renderMatrices();
    drawEqWeights();
    drawMatImages();
    renderReconText();
  }
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : (Math.abs(v) < 10 ? v.toFixed(Math.abs(v) < 1 ? 4 : 2) : v.toFixed(1)).replace(/0+$/, '').replace(/\.$/, ''));

  function drawGauss1D() {
    const svg = $('gauss-1d');
    const rows = [{ y: 30, n: 5, sp: 120, name: 'g₂' }, { y: 105, n: 9, sp: 60, name: 'g₁' }, { y: 180, n: 17, sp: 30, name: 'g₀' }];
    const x0 = 20;
    let h = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
    const lab = ['c', 'b', 'a', 'b', 'c'];
    // Kenarlar: g1 düğümleri 2..6 -> g2 düğümü 2; g0 düğümleri 6..10 -> g1 düğümü 4
    const edges = (from, to, center, tgt) => {
      for (let k = -2; k <= 2; k++) {
        const fx = x0 + (center + k) * from.sp, tx = x0 + tgt * to.sp;
        const fy = from.y - 6, ty = to.y + 8;
        h += `<line class="edge on" x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" style="color:var(--accent)" marker-end="url(#ah)"/>`;
        const mx = fx + (tx - fx) * 0.35, my = fy + (ty - fy) * 0.35;
        h += `<text x="${mx + (k < 0 ? -10 : k > 0 ? 4 : 4)}" y="${my}" class="ink">${lab[k + 2]}</text>`;
      }
    };
    edges(rows[1], rows[0], 4, 2);
    edges(rows[2], rows[1], 8, 4);
    for (const r of rows) {
      for (let i = 0; i < r.n; i++) h += `<circle class="dot${(r.name === 'g₂' && i === 2) || (r.name === 'g₁' && i >= 2 && i <= 6) || (r.name === 'g₀' && i >= 6 && i <= 10) ? ' on' : ''}" cx="${x0 + i * r.sp}" cy="${r.y}" r="4"/>`;
      h += `<text x="${x0 + 16 * 30 + 8}" y="${r.y + 4}" class="ink">${r.name}</text>`;
    }
    const [c, b, a] = W;
    h += `<text x="${x0}" y="212">a = ${fmt(a)}   b = ${fmt(b)}   c = ${fmt(c)}   (a + 2b + 2c = 1)</text>`;
    svg.innerHTML = h;
  }

  // ===========================================================================
  // 4. Matrisler
  // ===========================================================================
  function matHTML(M, scale) {
    const cols = M[0].length;
    let h = '';
    for (const row of M) for (const v of row) {
      const t = v * scale;
      h += `<span class="${Math.abs(t) > 1e-9 ? 'nz' : ''}">${fmt(t)}</span>`;
    }
    return { h, cols };
  }
  function setMat(id, M, scale) {
    const { h, cols } = matHTML(M, scale);
    const e = $(id);
    e.innerHTML = h;
    e.style.gridTemplateColumns = `repeat(${cols}, auto)`;
  }
  // Slayttaki gibi hizalı (satır i, sütun 2i'den başlar), sınırda kırpılmış matris.
  function gSlide(rows, cols) {
    return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => {
      const k = j - 2 * i;
      return k >= 0 && k <= 4 ? W[k] : 0;
    }));
  }
  function matMul(A, B) {
    return A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
  }
  function renderMatrices() {
    const G1 = gSlide(8, 20), G2 = gSlide(4, 8);
    setMat('mat-g1', G1, 16);
    setMat('mat-g2', G2, 16);
    setMat('mat-g2g1', matMul(G2, G1), 256);
    const F3 = Array.from({ length: 8 }, (_, j) => Array.from({ length: 4 }, (_, i) => {
      const k = j - 2 * i + 2;
      return k >= 0 && k <= 4 ? W[k] : 0;
    }));
    setMat('mat-f3', F3, 16);
  }
  // Ortalanmış (merkezli) matrisler: G (n/2 × n), F (n × n/2)
  const gC = (n) => Array.from({ length: n / 2 }, (_, i) => Array.from({ length: n }, (_, j) => {
    const k = j - 2 * i + 2; return k >= 0 && k <= 4 ? W[k] : 0;
  }));
  const fC = (n) => Array.from({ length: n }, (_, j) => Array.from({ length: n / 2 }, (_, i) => {
    const k = j - 2 * i + 2; return k >= 0 && k <= 4 ? 2 * W[k] : 0;
  }));
  const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  const matSub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));

  function drawEqWeights() {
    const svg = $('eqw');
    const n = 128;
    const G1 = gC(n), G2 = gC(n / 2), G3 = gC(n / 4);
    const H = [G1[n / 4], matMul(G2, G1)[n / 8], matMul(G3, matMul(G2, G1))[n / 16]];
    const panelH = 90, left = 46, width = 420;
    let h = '';
    H.forEach((row, p) => {
      const top = 6 + p * (panelH + 8);
      const idx = row.map((v, j) => [j, v]).filter(([, v]) => Math.abs(v) > 1e-12);
      const mu = idx.reduce((s, [j, v]) => s + j * v, 0);
      const varr = idx.reduce((s, [j, v]) => s + (j - mu) ** 2 * v, 0);
      const half = 3.2 * Math.sqrt(varr) + 1;
      const ymax = Math.max(...idx.map(([, v]) => v)) * 1.18;
      const X = (j) => left + ((j - mu + half) / (2 * half)) * width;
      const Y = (v) => top + panelH - 14 - (v / ymax) * (panelH - 22);
      h += `<line class="axis" x1="${left}" x2="${left + width}" y1="${Y(0)}" y2="${Y(0)}"/>`;
      h += `<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${Y(0)}"/>`;
      h += `<text x="4" y="${top + 30}" class="ink">h${sb(p + 1)}(x)</text>`;
      h += `<text x="${left - 4}" y="${top + 10}" text-anchor="end">${fmt(Math.max(...idx.map(([, v]) => v)))}</text>`;
      let d = '';
      for (const [j, v] of idx) d += `M${X(j - 0.5)},${Y(v)}H${X(j + 0.5)}`;
      // Basamak kenarlarını dikey çizgilerle birleştir
      let path = `M${X(idx[0][0] - 0.5)},${Y(0)}`;
      for (const [j, v] of idx) path += `V${Y(v)}H${X(j + 0.5)}`;
      path += `V${Y(0)}`;
      h += `<path class="step" d="${path}"/>`;
      let g = '';
      for (let s = 0; s <= 80; s++) {
        const x = mu - half + (2 * half * s) / 80;
        const v = Math.exp(-((x - mu) ** 2) / (2 * varr)) / Math.sqrt(2 * Math.PI * varr);
        g += (s ? 'L' : 'M') + X(x) + ',' + Y(v);
      }
      h += `<path class="fit" d="${g}"/>`;
      const sup = idx.length;
      h += `<text x="${left + width}" y="${top + 12}" text-anchor="end">destek: ${sup} piksel · σ = ${Math.sqrt(varr).toFixed(2)}</text>`;
      void d;
    });
    svg.innerHTML = h;
  }

  function heatmap(canvas, blocks, signed) {
    const cols = blocks[0][0].length;
    const rows = blocks.reduce((s, b) => s + b.length, 0) + (blocks.length - 1);
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(cols, rows);
    const d = id.data;
    let r0 = 0;
    for (const B of blocks) {
      const mx = Math.max(...B.flat().map(Math.abs)) || 1;
      B.forEach((row, i) => row.forEach((v, j) => {
        const p = ((r0 + i) * cols + j) * 4;
        const t = v / mx;
        const g = signed ? (t >= 0 ? 55 + t * 200 : 55 + t * 55) : t * 255;
        d[p] = d[p + 1] = d[p + 2] = g; d[p + 3] = 255;
      }));
      r0 += B.length;
      if (r0 < rows) {
        for (let j = 0; j < cols; j++) { const p = (r0 * cols + j) * 4; d[p] = 47; d[p + 1] = 111; d[p + 2] = 219; d[p + 3] = 255; }
        r0 += 1;
      }
    }
    ctx.putImageData(id, 0, 0);
  }
  function drawMatImages() {
    const n = 32;
    const G1 = gC(n), G2 = gC(n / 2), F1 = fC(n), F2 = fC(n / 2);
    const G2G1 = matMul(G2, G1);
    heatmap($('mat-gauss-img'), [eye(n), G1, G2G1], false);
    const L1 = matSub(eye(n), matMul(F1, G1));
    const L2 = matMul(matSub(eye(n / 2), matMul(F2, G2)), G1);
    heatmap($('mat-lap-img'), [L1, L2, G2G1], true);
  }

  // ===========================================================================
  // 5. Laplacian piramidi adım adım
  // ===========================================================================
  function makeStepper(prefix, total, onChange) {
    const st = { step: 1, timer: null };
    const update = () => {
      st.step = Math.max(1, Math.min(total(), st.step));
      $(`${prefix}-count`).textContent = `Adım ${st.step} / ${total()}`;
      $(`${prefix}-prev`).disabled = st.step <= 1;
      $(`${prefix}-next`).disabled = st.step >= total();
      onChange(st.step);
    };
    const stop = () => { clearInterval(st.timer); st.timer = null; $(`${prefix}-play`).textContent = '▶ Oynat'; };
    $(`${prefix}-prev`).onclick = () => { stop(); st.step--; update(); };
    $(`${prefix}-next`).onclick = () => { stop(); st.step++; update(); };
    $(`${prefix}-all`).onclick = () => { stop(); st.step = total(); update(); };
    $(`${prefix}-play`).onclick = () => {
      if (st.timer) { stop(); return; }
      if (st.step >= total()) st.step = 0;
      $(`${prefix}-play`).textContent = '❚❚ Durdur';
      const tick = () => { st.step++; update(); if (st.step >= total()) stop(); };
      tick();
      st.timer = setInterval(tick, 1400);
    };
    st.update = update;
    return st;
  }
  function applySteps(container, step) {
    container.querySelectorAll('[data-step]').forEach((e) => {
      const s = +e.dataset.step;
      e.classList.toggle('hidden', s > step);
      e.classList.toggle('fresh', s === step);
    });
  }

  let lapCanvases = [];
  const lapTotal = () => 4 * S.K + 1;
  const lapStepper = makeStepper('lap', lapTotal, (s) => {
    applySteps($('lap-flow'), s);
    $('lap-caption').innerHTML = lapCaption(s);
  });
  function lapCaption(s) {
    const K = S.K;
    if (s === 4 * K + 1) {
      return `<b>x${sb(K + 1)} = G${sb(K)}x${sb(K)}</b>: en kaba seviye (artık). Laplacian piramidi = { L₁, …, L${sb(K)}, x${sb(K + 1)} }. Katsayı sayısı yaklaşık N²·(1 + ¼ + ¹⁄₁₆ + …) ≈ 4/3·N²: Gauss piramidi kadar yer kaplar, ama artık bilgi bantlara ayrılmıştır.`;
    }
    const l = Math.floor((s - 1) / 4), i = l + 1, sub4 = (s - 1) % 4;
    const g = S.G[l];
    if (sub4 === 0) {
      return l === 0
        ? `<b>x₁</b>: giriş görüntüsü (${g.w}×${g.h}).`
        : `<b>x${sb(i)} = G${sb(l)}x${sb(l)}</b>: bir önceki seviyede küçültülen görüntü, şimdi bu seviyenin girdisi (${g.w}×${g.h}). Aynı işlemler tekrarlanır.`;
    }
    if (sub4 === 1) return `<b>G${sb(i)}x${sb(i)}</b>: Gauss ile süz ve her iki yönde 2’ye seyrelt (REDUCE). ${g.w}×${g.h} → ${S.G[i].w}×${S.G[i].h}.`;
    if (sub4 === 2) return `<b>F${sb(i)}G${sb(i)}x${sb(i)}</b>: tekrar büyüt (EXPAND): araya sıfır ekle ve süz. Boyut yine ${g.w}×${g.h}, ama küçültmede kaybolan ince ayrıntılar geri gelmez; görüntü bulanıktır.`;
    return `<b>L${sb(i)} = (I − F${sb(i)}G${sb(i)})x${sb(i)}</b>: girdi ile bulanık kopyasının farkı. Yalnızca küçültmede kaybolan yüksek frekanslar (kenarlar, ince doku) kalır. Gri = 0, açık = pozitif, koyu = negatif.`;
  }
  function buildLapFlow() {
    const wrap = $('lap-flow');
    wrap.innerHTML = '';
    lapCanvases = [];
    const K = S.K;
    for (let l = 0; l < K; l++) {
      const i = l + 1, s0 = 4 * l;
      const wpx = Math.max(150 / 2 ** l, 44);
      const blk = el('div', 'lap-block');
      const cell = (step, label, below, width) => {
        const f = el('div', '');
        f.dataset.step = step;
        const box = el('div', 'canvas-box');
        const c = el('canvas');
        box.style.width = width + 'px';
        box.appendChild(c);
        if (!below) f.appendChild(el('div', 'lbl-m math', label));
        f.appendChild(box);
        if (below) f.appendChild(el('div', 'lbl-m math below', label));
        return { f, c };
      };
      const sym = (step, ch, cls = 'sym') => { const e = el('div', cls, ch); e.dataset.step = step; return e; };
      const x = cell(s0 + 1, l === 0 ? 'x₁' : `x${sb(i)}`, false, wpx);
      const gx = cell(s0 + 2, `G${sb(i)}x${sb(i)}`, false, Math.max(wpx / 2, 24));
      const fgx = cell(s0 + 3, `F${sb(i)}G${sb(i)}x${sb(i)}`, true, wpx);
      const L = cell(s0 + 4, `L${sb(i)} = (I − F${sb(i)}G${sb(i)})x${sb(i)}`, true, wpx);
      const items = [
        x.f, sym(s0 + 2, '→'), gx.f,
        sym(s0 + 4, '↓'), el('div'), sym(s0 + 3, '↓'),
        sym(s0 + 4, '−', 'minus'), sym(s0 + 4, '←'), fgx.f,
        sym(s0 + 4, '↓'), el('div'), el('div'),
        L.f, el('div'), el('div'),
      ];
      items.forEach((e) => blk.appendChild(e));
      wrap.appendChild(blk);
      lapCanvases.push({ x: x.c, gx: gx.c, fgx: fgx.c, L: L.c });
    }
    const last = el('div', 'lap-block');
    const f = el('div', '');
    f.dataset.step = 4 * K + 1;
    const box = el('div', 'canvas-box');
    box.style.width = Math.max(150 / 2 ** K, 44) + 'px';
    const c = el('canvas');
    box.appendChild(c);
    f.append(el('div', 'lbl-m math', `x${sb(K + 1)} = g${sb(K)}`), box);
    last.appendChild(f);
    wrap.appendChild(last);
    lapCanvases.push({ last: c });
    lapStepper.update();
  }
  function renderLapFlow() {
    const K = S.K;
    for (let l = 0; l < K; l++) {
      const cv = lapCanvases[l];
      if (!cv) return;
      render(cv.x, S.G[l]);
      render(cv.gx, S.G[l + 1]);
      render(cv.fgx, expand(S.G[l + 1], S.G[l].w, S.G[l].h));
      render(cv.L, S.L[l], 'lap');
    }
    if (lapCanvases[K]) render(lapCanvases[K].last, S.G[K]);
  }

  // ===========================================================================
  // 6. Yukarı örnekleme
  // ===========================================================================
  function buildUpSelect() {
    const sel = $('up-level');
    const prev = +sel.value || 3;
    sel.innerHTML = '';
    for (let l = 1; l <= S.K; l++) sel.appendChild(new Option(`g${sb(l)} (${S.N >> l}×${S.N >> l}) → ${S.N >> (l - 1)}×${S.N >> (l - 1)}`, l));
    sel.value = Math.min(prev, S.K);
  }
  function renderUp() {
    const l = +$('up-level').value || 1;
    const g = S.G[l];
    if (!g) return;
    render($('up-small'), g);
    $('up-small-cap').innerHTML = `g<sub>${l}</sub> (${g.w}×${g.h})`;
    render($('up-zeros'), zeroInsert(g), 'scale', { k: 4 });
    render($('up-result'), expand(g));
  }

  // ===========================================================================
  // 7. Tam çözünürlük, spektrum, radyal grafik
  // ===========================================================================
  let fullUpL = [];
  function renderFull() {
    const K = S.K, N = S.N;
    const grid = $('full-grid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${K + 1}, 140px)`;
    const upG = S.G.map((g) => upTo(g, N));
    fullUpL = S.L.map((L, l) => (l < K ? sub(upG[l], upG[l + 1]) : upG[K]));
    upG.forEach((g, l) => {
      const { f, c } = figure(`↑g<sub>${l}</sub>${l ? ` (${S.G[l].w}×${S.G[l].h}’ten)` : ''}`, 'fg-cell');
      render(c, g);
      grid.appendChild(f);
    });
    fullUpL.forEach((L, l) => {
      const { f, c } = figure(l < K ? `L<sub>${l + 1}</sub> = ↑g<sub>${l}</sub> − ↑g<sub>${l + 1}</sub> (${S.L[l].w}×${S.L[l].h})` : `x<sub>${K + 1}</sub> = g<sub>${K}</sub> (artık)`, 'fg-cell');
      render(c, L, l < K ? 'lap' : 'img');
      grid.appendChild(f);
    });
    drawLayout($('lap-layout'), S.L, (l) => (l < K ? 'lap' : 'img'));
  }

  let radialData = null;
  let radialNames = [];
  function renderSpectra() {
    const K = S.K, N = S.N;
    const wrap = $('full-spectra');
    wrap.innerHTML = '';
    const bins = N / 2;
    const prof = [];
    radialNames = [];
    fullUpL.forEach((L, l) => {
      const mag = fftMag(L.c[0], N);
      // Radyal ortalama (DC hariç)
      const sum = new Float64Array(bins + 1), cnt = new Float64Array(bins + 1);
      const lg = new Float32Array(N * N);
      let mx = 0;
      for (let y = 0; y < N; y++) {
        const fy = y < N / 2 ? y : y - N;
        for (let x = 0; x < N; x++) {
          const fx = x < N / 2 ? x : x - N;
          const v = mag[y * N + x];
          const r = Math.round(Math.hypot(fx, fy));
          if (r <= bins) { sum[r] += v; cnt[r]++; }
          // fftshift ile ekrana
          const sy = (y + N / 2) % N, sx = (x + N / 2) % N;
          const lv = Math.log1p(v);
          lg[sy * N + sx] = lv;
          if (lv > mx) mx = lv;
        }
      }
      const pr = Array.from(sum, (s, r) => (cnt[r] ? s / cnt[r] : 0));
      let pm = 0;
      for (let r = 1; r < pr.length; r++) if (pr[r] > pm) pm = pr[r];
      prof.push(pr.map((v) => v / (pm || 1)));
      const { f, c } = figure(l < K ? `|F{L<sub>${l + 1}</sub>}|` : `|F{x<sub>${K + 1}</sub>}|`);
      render(c, fromCh(N, N, [lg]), 'scale', { k: 255 / (mx || 1) });
      wrap.appendChild(f);
    });
    // En fazla 8 eğri: 8'den fazla seviye varsa en kaba seviyeler tek eğride toplanır.
    const names = fullUpL.map((_, l) => (l < K ? `L${sb(l + 1)}` : `x${sb(K + 1)}`));
    if (prof.length > 8) {
      const sum = fullUpL.slice(7).reduce((a, b) => add(a, b));
      const mag = fftMag(sum.c[0], N);
      const s2 = new Float64Array(bins + 1), c2 = new Float64Array(bins + 1);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const r = Math.round(Math.hypot(x < N / 2 ? x : x - N, y < N / 2 ? y : y - N));
        if (r <= bins) { s2[r] += mag[y * N + x]; c2[r]++; }
      }
      const pr = Array.from(s2, (v, r) => (c2[r] ? v / c2[r] : 0));
      const pm = Math.max(...pr.slice(1)) || 1;
      prof.splice(7, prof.length - 7, pr.map((v) => v / pm));
      names.splice(7, names.length - 7, `L${sb(8)}…x${sb(K + 1)}`);
    }
    radialNames = names;
    radialData = prof;
    drawRadial();
  }
  const levelName = (l) => radialNames[l] || '';
  function drawRadial(hoverR) {
    if (!radialData) return;
    const svg = $('radial');
    const colors = SERIES();
    const N = S.N, bins = N / 2;
    const m = { l: 44, r: 12, t: 10, b: 34 }, Wd = 520, Ht = 280;
    const pw = Wd - m.l - m.r, ph = Ht - m.t - m.b;
    const ymax = 1;
    const X = (r) => m.l + (Math.log2(r) / Math.log2(bins)) * pw;
    const Y = (v) => m.t + ph - Math.min(1.08, v / ymax) * ph / 1.08;
    let h = '';
    for (let p = 0; (1 << p) <= bins; p++) {
      const x = X(1 << p);
      h += `<line class="gridl" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/>`;
      h += `<text x="${x}" y="${Ht - 16}" text-anchor="middle">${1 << p}</text>`;
    }
    h += `<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
    h += `<text x="${m.l + pw / 2}" y="${Ht - 2}" text-anchor="middle">frekans (devir / görüntü)</text>`;
    h += `<text x="12" y="${m.t + ph / 2}" transform="rotate(-90 12 ${m.t + ph / 2})" text-anchor="middle">ortalama |F| (normalize)</text>`;
    radialData.forEach((p, l) => {
      let d = '';
      for (let r = 1; r <= bins; r++) d += (r === 1 ? 'M' : 'L') + X(r).toFixed(1) + ',' + Y(p[r]).toFixed(1);
      h += `<path class="series" d="${d}" stroke="${colors[l]}"/>`;
    });
    if (hoverR) {
      const x = X(hoverR);
      h += `<line class="cross" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/>`;
      radialData.forEach((p, l) => {
        h += `<circle cx="${x}" cy="${Y(p[hoverR])}" r="4" fill="${colors[l]}" stroke="var(--surface)" stroke-width="2"/>`;
      });
    }
    svg.innerHTML = h;
    $('radial-legend').innerHTML = radialData.map((_, l) => `<span><span class="sw" style="background:${colors[l]}"></span>${levelName(l)}</span>`).join('');
    svg._geom = { m, pw, bins, Wd };
  }
  {
    const svg = $('radial'), tip = $('radial-tip');
    svg.addEventListener('pointermove', (e) => {
      if (!radialData || !svg._geom) return;
      const { m, pw, bins, Wd } = svg._geom;
      const rect = svg.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * Wd / rect.width;
      const t = (sx - m.l) / pw;
      if (t < 0 || t > 1) { tip.hidden = true; drawRadial(); return; }
      const r = Math.max(1, Math.min(bins, Math.round(2 ** (t * Math.log2(bins)))));
      drawRadial(r);
      const colors = SERIES();
      const mx = Math.max(...radialData.map((p) => p[r])) || 1;
      tip.innerHTML = `<b>frekans ${r}</b><br>` + radialData.map((p, l) => `<span class="sw" style="background:${colors[l]}"></span>${levelName(l)}: ${p[r].toFixed(2)}${p[r] === mx ? ' ◀ en güçlü' : ''}`).join('<br>');
      tip.hidden = false;
      const px = e.clientX - rect.left, wrapW = rect.width;
      tip.style.left = (px > wrapW / 2 ? px - tip.offsetWidth - 12 : px + 12) + 'px';
      tip.style.top = '8px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; drawRadial(); });
  }

  // ===========================================================================
  // 8. Geri dönüşüm
  // ===========================================================================
  let recCanvases = [];
  const recTotal = () => S.K + 1;
  const recStepper = makeStepper('rec', recTotal, (s) => {
    applySteps($('rec-flow'), s);
    applySteps($('rec-verify'), s);
    $('rec-caption').innerHTML = recCaption(s);
    renderReconText(s);
  });
  function recCaption(s) {
    const K = S.K;
    if (s === 1) return `Başlangıç: en kaba seviye <b>x${sb(K + 1)}</b> (${S.G[K].w}×${S.G[K].h}) ve Laplacian seviyeleri <b>L₁…L${sb(K)}</b> elimizde.`;
    const k = K - (s - 2);
    const done = s === K + 1;
    return `<b>x${sb(k)} = L${sb(k)} + F${sb(k)}x${sb(k + 1)}</b>: x${sb(k + 1)}’i büyüt (EXPAND) ve L${sb(k)}’yi ekle. Büyütmede eksik kalan ince ayrıntılar tam olarak L${sb(k)}’de saklıydı.` + (done ? ' <b>Bitti: x₁ elde edildi.</b>' : '');
  }
  function renderReconText(step) {
    const K = S.K;
    const sel = step ?? recStepper.step;
    let a = '';
    for (let i = 1; i <= K; i++) a += `L${i} = (I − F${i} G${i}) x${i}\n`;
    for (let i = 1; i <= K; i++) a += `x${i + 1} = G${i} x${i}\n`;
    $('recon-elems').textContent = a.trim();
    let b = '';
    for (let k = K, s = 2; k >= 1; k--, s++) b += `<span class="${s === sel ? 'hl' : ''}">x${k} = L${k} + F${k} x${k + 1}</span>\n`;
    $('recon-steps').innerHTML = b.trim();
  }
  function buildRecon() {
    const K = S.K;
    const wrap = $('rec-flow');
    wrap.innerHTML = '';
    recCanvases = [];
    const start = el('div', 'rec-row');
    start.dataset.step = 1;
    const s0 = figure(`<span class="tag gold">x${sb(K + 1)}</span> = g<sub>${K}</sub> (${S.G[K].w}×${S.G[K].h})`);
    start.appendChild(s0.f);
    start.appendChild(el('div', 'hint', 'Piramidin tepesi: buradan başlanır.'));
    wrap.appendChild(start);
    recCanvases.push({ start: s0.c });
    for (let k = K, s = 2; k >= 1; k--, s++) {
      const row = el('div', 'rec-row');
      row.dataset.step = s;
      const a = figure(`x<sub>${k + 1}</sub> (${S.G[k].w}×${S.G[k].h})`);
      const b = figure(`F<sub>${k}</sub>x<sub>${k + 1}</sub> (büyütülmüş)`);
      const c = figure(`<span class="tag blue">L${sb(k)}</span>`);
      const d = figure(`<b>x<sub>${k}</sub></b> (${S.G[k - 1].w}×${S.G[k - 1].h})`);
      row.append(a.f, el('div', 'op', '→'), b.f, el('div', 'op', '+'), c.f, el('div', 'op', '='), d.f);
      wrap.appendChild(row);
      recCanvases.push({ a: a.c, b: b.c, c: c.c, d: d.c });
    }
    const v = $('rec-verify');
    v.innerHTML = '';
    const o = figure('Orijinal x₁'), r = figure('Geri çatılan x̂₁'), df = figure('Fark |x₁ − x̂₁| (×10⁶ büyütülmüş)');
    const wrapV = el('div', '');
    wrapV.dataset.step = K + 1;
    wrapV.style.display = 'flex'; wrapV.style.flexWrap = 'wrap'; wrapV.style.gap = '14px'; wrapV.style.alignItems = 'flex-end';
    const badge = el('div', 'badge');
    badge.id = 'rec-badge';
    wrapV.append(o.f, r.f, df.f, badge);
    v.appendChild(wrapV);
    recCanvases.verify = { o: o.c, r: r.c, d: df.c };
    recStepper.update();
  }
  function renderRecon() {
    const K = S.K;
    if (!recCanvases.length) return;
    let x = S.L[K];
    render(recCanvases[0].start, x);
    for (let k = K, i = 1; k >= 1; k--, i++) {
      const cv = recCanvases[i];
      const L = S.L[k - 1];
      const up = expand(x, L.w, L.h);
      const nx = add(L, up);
      render(cv.a, x); render(cv.b, up); render(cv.c, L, 'lap'); render(cv.d, nx);
      x = nx;
    }
    const diff = binop(S.img, x, (p, q) => Math.abs(p - q));
    let mx = 0;
    for (const v of diff.c[0]) if (v > mx) mx = v;
    render(recCanvases.verify.o, S.img);
    render(recCanvases.verify.r, x);
    render(recCanvases.verify.d, diff, 'scale', { k: 1e6 });
    $('rec-badge').innerHTML = `En büyük hata: <b>${mx.toExponential(1)}</b> gri seviye<br>(Float32 yuvarlama hatası; 0–255 aralığında görünmez)<br><b>Mükemmel geri çatma ✓</b>`;
  }

  // ===========================================================================
  // 9. Uygulamalar
  // ===========================================================================
  let gains = [];
  function buildGains() {
    const K = S.K;
    const wrap = $('app-gains');
    wrap.innerHTML = '';
    gains = Array.from({ length: K + 1 }, (_, i) => gains[i] ?? 1);
    gains.length = K + 1;
    for (let i = 0; i <= K; i++) {
      const row = el('div', 'row');
      row.appendChild(el('span', 'lbl', i < K ? `L${sb(i + 1)} kazancı` : `x${sb(K + 1)} (artık)`));
      const r = el('input');
      r.type = 'range'; r.min = 0; r.max = 3; r.step = 0.05; r.value = gains[i];
      const o = el('output', '', '×' + (+gains[i]).toFixed(2));
      r.oninput = () => { gains[i] = +r.value; o.textContent = '×' + gains[i].toFixed(2); renderApps(); };
      row.append(r, o);
      row.dataset.i = i;
      wrap.appendChild(row);
    }
  }
  function setGains(arr, q) {
    gains = Array.from({ length: S.K + 1 }, (_, i) => arr(i));
    $('app-q').value = q;
    buildGains();
    updateQLabel();
    renderApps();
  }
  function updateQLabel() {
    const q = +$('app-q').value;
    $('app-q-o').textContent = q ? 'q = ' + q : 'kapalı';
  }
  function renderApps() {
    const K = S.K;
    const q = +$('app-q').value;
    let zeros = 0, total = 0;
    const mod = S.L.map((L, l) => {
      const g = gains[l] ?? 1;
      if (l < K) {
        return mapImg(L, (v) => {
          let t = v * g;
          if (q > 0) t = Math.round(t / q) * q;
          total++; if (t === 0) zeros++;
          return t;
        });
      }
      return mapImg(L, (v) => v * g);
    });
    const out = collapse(mod);
    const residualOff = (gains[K] ?? 1) === 0;
    render($('app-result'), out, residualOff ? 'lap' : 'img');
    const diff = sub(out, S.img);
    render($('app-diff'), diff, 'lap', { k: 2 });
    let se = 0, mx = 0;
    const o = out.c[0], s = S.img.c[0];
    for (let i = 0; i < o.length; i++) {
      const e = Math.min(255, Math.max(0, o[i])) - s[i];
      se += e * e; if (Math.abs(e) > mx) mx = Math.abs(e);
    }
    const mse = se / o.length;
    const psnr = mse < 1e-10 ? '∞' : (10 * Math.log10(255 * 255 / mse)).toFixed(1);
    const coeff = S.L.reduce((a, L) => a + L.w * L.h, 0);
    $('app-stats').innerHTML =
      `<span>PSNR (girişe göre): <b>${psnr} dB</b></span>` +
      `<span>En büyük hata: <b>${mx.toFixed(1)}</b></span>` +
      `<span>Laplacian katsayısı: <b>${coeff.toLocaleString('tr-TR')}</b> (N² = ${(S.N * S.N).toLocaleString('tr-TR')}, oran ${(coeff / (S.N * S.N)).toFixed(3)})</span>` +
      (q > 0 ? `<span>Sıfır olan katsayılar: <b>%${(100 * zeros / total).toFixed(1)}</b></span>` : '');
  }

  // ===========================================================================
  // 10. Harmanlama
  // ===========================================================================
  const BL = { up: { A: null, B: null }, mask: null, maskN: 0, lastGeo: 'v', painting: false };
  const genCanvasCache = new Map();
  function sourceDrawable(which) {
    const v = $(which === 'A' ? 'bl-a' : 'bl-b').value;
    const N = S.N;
    if (v === 'upload') return BL.up[which];
    if (v === 'main') return offscreen(S.img);
    if (v.startsWith('ph-')) {
      const im = photoNow(v);
      if (!im) photoPromise(v).then(() => renderBlend()).catch((e) => { $('bl-msg').textContent = e.message; });
      return im;
    }
    const key = v + '@' + N;
    if (!genCanvasCache.has(key)) {
      const ex = PYR.color.find((e) => e.id === v) || PYR.color[0];
      genCanvasCache.set(key, offscreen(fromCh(N, N, ex.gen(N))));
    }
    return genCanvasCache.get(key);
  }
  function blendSource(which) {
    const d = sourceDrawable(which);
    if (!d) return null;
    const tf = which === 'B' ? { s: +$('bl-bs').value, dx: +$('bl-bx').value, dy: +$('bl-by').value } : null;
    const ch = safeChannels(d, S.N, false, tf && (tf.s !== 1 || tf.dx || tf.dy) ? tf : null);
    return ch && fromCh(S.N, S.N, ch);
  }
  function geoMask(N, t) {
    const d = new Float32Array(N * N);
    const cx = +$('bl-cx').value, cy = +$('bl-cy').value, cr = +$('bl-cr').value;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const X = (x + 0.5) / N, Y = (y + 0.5) / N;
      let v;
      if (t === 'v') v = X < 0.5;
      else if (t === 'h') v = Y < 0.5;
      else if (t === 'c') v = Math.hypot(X - cx, Y - cy) < cr;
      else v = X + Y < 1;
      d[y * N + x] = v ? 1 : 0;
    }
    return d;
  }
  function ensureMask() {
    const N = S.N;
    if (BL.mask && BL.maskN === N) return;
    if (BL.mask) { // en yakın komşu ile yeniden örnekle
      const o = BL.maskN, src = BL.mask, d = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d[y * N + x] = src[Math.floor(y * o / N) * o + Math.floor(x * o / N)];
      BL.mask = d;
    } else BL.mask = geoMask(N, BL.lastGeo);
    BL.maskN = N;
  }
  function blendMask() {
    const t = $('bl-mask').value;
    if (t === 'draw' || t === 'upload') { ensureMask(); return fromCh(S.N, S.N, [BL.mask]); }
    return fromCh(S.N, S.N, [geoMask(S.N, t)]);
  }
  function updateMaskUI() {
    const t = $('bl-mask').value;
    $('bl-circle').style.display = t === 'c' ? '' : 'none';
    $('bl-brush').style.display = t === 'draw' ? '' : 'none';
    $('bl-M').classList.toggle('on', t === 'draw');
  }
  function placeholder(canvas, text) {
    canvas.width = canvas.height = S.N;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, S.N, S.N);
    ctx.fillStyle = '#bbb'; ctx.font = `${S.N / 16}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(text, S.N / 2, S.N / 2);
  }
  let blendCache = null;
  function renderBlend(withTable = true) {
    W = kernel(S.a);
    const N = S.N;
    const Kb = Math.min(+$('bl-levels').value, Math.log2(N));
    const A = blendSource('A'), B = blendSource('B'), M = blendMask();
    updateMaskUI();
    render($('bl-M'), M, 'scale', { k: 255 });
    if (!A) placeholder($('bl-A'), $('bl-a').value === 'upload' ? 'Görsel yükleyin' : 'Yükleniyor…'); else render($('bl-A'), A);
    if (!B) placeholder($('bl-B'), $('bl-b').value === 'upload' ? 'Görsel yükleyin' : 'Yükleniyor…'); else render($('bl-B'), B);
    if (!A || !B) return;
    const mix = (m) => binop(binop(A, m, (a, w) => a * w), binop(B, m, (b, w) => b * (1 - w)), (p, q) => p + q);
    render($('bl-cut'), mix(M));
    const f = +$('bl-feather').value;
    const Mf = f ? upTo(gaussPyr(M, f)[f], N) : M;
    render($('bl-feath'), mix(Mf));
    $('bl-feath-cap').innerHTML = `<b>2. Tek Gauss ile yumuşak geçiş</b> (maske ${f ? `↑G<sub>${f}</sub>, geçiş ≈ ${(2 ** f) * 2} px` : 'yumuşatılmadı'}): dar geçişte dikiş, geniş geçişte hayalet (iki görüntü üst üste) oluşur.`;
    const GA = gaussPyr(A, Kb), GB = gaussPyr(B, Kb), GM = gaussPyr(M, Kb);
    const LA = lapPyr(GA), LB = lapPyr(GB);
    const pa = [], pb = [], LS = [];
    for (let l = 0; l <= Kb; l++) {
      const a = binop(LA[l], GM[l], (v, m) => v * m);
      const b = binop(LB[l], GM[l], (v, m) => v * (1 - m));
      pa.push(a); pb.push(b); LS.push(add(a, b));
    }
    render($('bl-out'), collapse(LS));
    blendCache = { pa, pb, LS, GM, Kb };
    if (withTable) renderBlendTable();
  }
  const BLEND_PRESETS = {
    'apple-orange': { A: 'ph-apple', B: 'ph-orange', mask: 'v', levels: 6 },
    'coffee-hubble': { A: 'ph-hubble', B: 'ph-coffee', mask: 'c', cx: 0.47, cy: 0.38, cr: 0.145, levels: 4 },
    'starry-cat': { A: 'ph-starry', B: 'ph-chelsea', mask: 'h', levels: 6 },
    'astro-starry': { A: 'ph-astronaut', B: 'ph-starry', mask: 'c', cx: 0.4, cy: 0.3, cr: 0.2, levels: 5 },
    'brick-grass': { A: 'ph-brick', B: 'ph-grass', mask: 'd', levels: 6 },
  };
  function applyBlendPreset(name) {
    const p = BLEND_PRESETS[name];
    $('bl-a').value = p.A; $('bl-b').value = p.B; $('bl-mask').value = p.mask;
    if (p.mask !== 'draw' && p.mask !== 'upload') BL.lastGeo = p.mask;
    if (p.cx !== undefined) { $('bl-cx').value = p.cx; $('bl-cy').value = p.cy; $('bl-cr').value = p.cr; }
    $('bl-levels').value = Math.min(p.levels, maxK()); $('bl-levels-o').textContent = $('bl-levels').value;
    $('bl-bs').value = 1; $('bl-bx').value = 0; $('bl-by').value = 0; $('bl-bs-o').textContent = '1.00';
    Promise.all([p.A, p.B].map(photoPromise)).then(() => renderBlend()).catch(() => {});
    renderBlend();
  }
  function paintMask(e, last) {
    const c = $('bl-M');
    const [x, y] = canvasPos(c, e);
    const N = S.N, r = +$('bl-bsize').value * N / 512;
    const v = +document.querySelector('input[name="bl-bv"]:checked').value;
    const [ax, ay] = last || [x, y];
    const steps = Math.max(1, Math.ceil(Math.hypot(x - ax, y - ay) / Math.max(1, r / 2)));
    for (let s = 0; s <= steps; s++) {
      const cx = ax + (x - ax) * s / steps, cy = ay + (y - ay) * s / steps;
      for (let py = Math.max(0, Math.floor(cy - r)); py <= Math.min(N - 1, Math.ceil(cy + r)); py++) {
        for (let px = Math.max(0, Math.floor(cx - r)); px <= Math.min(N - 1, Math.ceil(cx + r)); px++) {
          if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r) BL.mask[py * N + px] = v;
        }
      }
    }
    return [x, y];
  }
  let blendRaf = false;
  function blendSoon(table) {
    if (blendRaf) return;
    blendRaf = true;
    requestAnimationFrame(() => { blendRaf = false; renderBlend(table); });
  }
  function renderBlendTable() {
    if (!blendCache) return;
    const { pa, pb, LS, GM, Kb } = blendCache;
    const N = S.N;
    const wrap = $('bl-table');
    wrap.innerHTML = '';
    const head = el('div', 'bt-row');
    ['Seviye', 'G·LA', '(1 − G)·LB', 'Birleşik L = toplam', 'Maske G(j)'].forEach((t) => head.appendChild(el('div', 'bt-h', t)));
    wrap.appendChild(head);
    for (let l = 0; l <= Kb; l++) {
      const row = el('div', 'bt-row');
      const res = l === Kb;
      row.appendChild(el('div', 'bt-h', res ? `artık (g${sb(l)})` : `L${sb(l + 1)} (${pa[l].w}×${pa[l].h})`));
      const cell = (img, mode, o) => {
        const box = el('div', 'canvas-box');
        const c = el('canvas');
        box.appendChild(c);
        render(c, upTo(img, N), mode, o);
        row.appendChild(box);
      };
      const mode = res ? 'img' : 'lap';
      // Laplacian sütunlarında aynı ölçek: toplamınkini kullan
      const k = res ? undefined : lapScale(LS[l]);
      cell(pa[l], mode, { k });
      cell(pb[l], mode, { k });
      cell(LS[l], mode, { k });
      cell(GM[l], 'scale', { k: 255 });
      wrap.appendChild(row);
    }
  }

  // ===========================================================================
  // Kurulum
  // ===========================================================================
  function fillExampleSelect() {
    const sel = $('g-example');
    const groups = new Map();
    for (const e of allGray) {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e);
    }
    let first = true;
    for (const [g, items] of groups) {
      const og = document.createElement('optgroup');
      og.label = g === 'Piramit örnekleri' ? g : `Fourier Paint: ${g}`;
      for (const e of items) og.appendChild(new Option(e.name, e.id));
      sel.appendChild(og);
      if (first) {
        first = false;
        const ph = document.createElement('optgroup');
        ph.label = 'Gerçek fotoğraflar (gri seviyeye çevrilir)';
        for (const p of PHOTOS) ph.appendChild(new Option(p.name, p.id));
        sel.appendChild(ph);
      }
    }
    sel.appendChild(new Option('Yüklenen görüntü', 'upload'));
    for (const id of ['bl-a', 'bl-b']) {
      const s = $(id);
      const og = document.createElement('optgroup');
      og.label = 'Fotoğraflar';
      for (const p of PHOTOS) og.appendChild(new Option(p.name.replace(' (fotoğraf)', ''), p.id));
      s.appendChild(og);
      const og2 = document.createElement('optgroup');
      og2.label = 'Diğer';
      for (const e of PYR.color) og2.appendChild(new Option(e.name + ' (sentetik)', e.id));
      og2.appendChild(new Option('Ana görüntü (gri)', 'main'));
      og2.appendChild(new Option('Yüklenen görsel', 'upload'));
      s.appendChild(og2);
    }
    $('bl-a').value = 'ph-apple';
    $('bl-b').value = 'ph-orange';
  }
  function fileToImage(file, cb) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { cb(im); URL.revokeObjectURL(url); };
    im.src = url;
  }
  function setMainUpload(im, name) {
    S.src = { kind: 'upload', img: im };
    $('ex-info').innerHTML = `<b>${name || 'Yüklenen görüntü'}.</b> Gri seviyeye çevrildi ve kare olacak biçimde ortadan kırpıldı.`;
    reloadImage().then(fullRefresh);
  }
  function setBlendUpload(which, im) {
    if (which === 'M') {
      const ch = safeChannels(im, S.N, true);
      if (!ch) return;
      BL.mask = ch[0].map((v) => v / 255); BL.maskN = S.N;
      $('bl-mask').value = 'upload';
    } else {
      BL.up[which] = im;
      $(which === 'A' ? 'bl-a' : 'bl-b').value = 'upload';
    }
    renderBlend();
  }

  // Piramidin tepesi (en küçük seviye) ayarı
  function syncKControls() {
    const m = maxK();
    for (const id of ['g-levels', 'bl-levels', 'bl-feather']) $(id).max = m;
    $('g-levels').value = S.K;
    const top = S.N >> S.K;
    $('g-levels-o').textContent = `K = ${S.K} · ${top}×${top}`;
    $('g-kdown').disabled = S.K <= 1;
    $('g-kup').disabled = S.K >= m;
  }
  function setK(k) {
    k = Math.max(1, Math.min(maxK(), k));
    if (k === S.K) { syncKControls(); return; }
    S.K = k;
    syncKControls();
    recompute();
    buildLapFlow(); buildRecon(); buildGains(); buildUpSelect();
    renderAll();
    renderStatic();
  }

  function wire() {
    $('g-example').onchange = (e) => {
      if (e.target.value === 'upload') {
        if (S.src.kind !== 'upload') $('g-file').click();
        return;
      }
      selectMain(e.target.value);
    };
    $('g-file').onchange = (e) => readFile(e.target, (im) => setMainUpload(im));
    $('g-size').onchange = (e) => {
      S.N = +e.target.value;
      S.K = Math.min(S.K, maxK());
      syncKControls();
      reloadImage().then(fullRefresh);
    };
    $('g-levels').oninput = (e) => setK(+e.target.value);
    $('g-kdown').onclick = () => setK(S.K - 1);
    $('g-kup').onclick = () => setK(S.K + 1);
    $('g-a').oninput = (e) => {
      S.a = +e.target.value;
      $('g-a-o').textContent = S.a.toFixed(3);
      recompute();
      renderAll();
      renderStatic();
      renderBlend();
    };
    $('g-lapgain').onchange = (e) => { S.lapGain = e.target.value; renderAll(); renderBlendTable(); };

    $('pen-size').oninput = (e) => { $('pen-size-o').textContent = e.target.value + ' px'; };
    $('pen-value').oninput = (e) => { $('pen-value-o').textContent = e.target.value; };
    document.querySelectorAll('[data-pen]').forEach((b) => {
      b.onclick = () => { $('pen-value').value = b.dataset.pen; $('pen-value-o').textContent = b.dataset.pen; };
    });
    $('src-reset').onclick = () => { reloadImage().then(fullRefresh); };
    $('src-clear').onclick = () => { S.img.c[0].fill(128); schedule(); setTimeout(() => { renderMatch(); renderSpectra(); }, 50); };

    $('tm-src').onchange = renderMatch;
    $('tm-method').onchange = renderMatch;
    $('tm-thr').oninput = (e) => { $('tm-thr-o').textContent = (+e.target.value).toFixed(2); renderMatch(); };

    $('smp-factor').onchange = renderSampling;
    $('smp-zone').onclick = () => selectMain('zone');
    $('full-noise').onclick = () => selectMain('white-noise');
    $('up-level').onchange = renderUp;

    $('app-q').oninput = () => { updateQLabel(); renderApps(); };
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => {
        const K = S.K;
        const p = b.dataset.preset;
        if (p === 'identity') setGains(() => 1, 0);
        else if (p === 'denoise') setGains((i) => (i === 0 ? 0 : 1), 0);
        else if (p === 'sharpen') setGains((i) => (i === 0 ? 2 : i === 1 ? 1.5 : 1), 0);
        else if (p === 'coarse') setGains((i) => (i === K ? 1 : 0), 0);
        else if (p === 'detail') setGains((i) => (i <= 1 ? 1 : 0), 0);
        else if (p === 'compress') setGains(() => 1, 12);
      };
    });

    ['bl-a', 'bl-b'].forEach((id) => { $(id).onchange = (e) => {
      const w = id === 'bl-a' ? 'A' : 'B';
      if (e.target.value === 'upload' && !BL.up[w]) { $(id + '-file').click(); return; }
      renderBlend();
    }; });
    $('bl-mask').onchange = (e) => {
      const t = e.target.value;
      if (t === 'draw') {
        // Çizime son geometrik maskeyle başla
        if (!BL.mask || BL.maskN !== S.N) { BL.mask = geoMask(S.N, BL.lastGeo); BL.maskN = S.N; }
      } else if (t === 'upload') {
        $('bl-m-file').click();
        if (!BL.mask) { BL.mask = geoMask(S.N, BL.lastGeo); BL.maskN = S.N; }
      } else {
        BL.lastGeo = t;
        BL.mask = geoMask(S.N, t); BL.maskN = S.N;
      }
      renderBlend();
    };
    for (const id of ['bl-cx', 'bl-cy', 'bl-cr']) $(id).oninput = () => blendSoon(false);
    for (const id of ['bl-cx', 'bl-cy', 'bl-cr']) $(id).onchange = () => renderBlend();
    for (const id of ['bl-bs', 'bl-bx', 'bl-by']) {
      $(id).oninput = () => { $('bl-bs-o').textContent = (+$('bl-bs').value).toFixed(2); blendSoon(false); };
      $(id).onchange = () => renderBlend();
    }
    $('bl-levels').oninput = (e) => { $('bl-levels-o').textContent = e.target.value; renderBlend(); };
    $('bl-feather').oninput = (e) => { $('bl-feather-o').textContent = e.target.value; renderBlend(false); };
    $('bl-a-file').onchange = (e) => readFile(e.target, (im) => setBlendUpload('A', im));
    $('bl-b-file').onchange = (e) => readFile(e.target, (im) => setBlendUpload('B', im));
    $('bl-m-file').onchange = (e) => readFile(e.target, (im) => setBlendUpload('M', im));
    document.querySelectorAll('[data-blend]').forEach((b) => { b.onclick = () => applyBlendPreset(b.dataset.blend); });
    $('bl-mclear').onclick = () => {
      const v = +document.querySelector('input[name="bl-bv"]:checked').value;
      ensureMask(); BL.mask.fill(1 - v); renderBlend();
    };
    $('bl-minv').onclick = () => { ensureMask(); BL.mask = BL.mask.map((v) => 1 - v); renderBlend(); };
    $('bl-download').onclick = () => {
      const a = document.createElement('a');
      a.download = 'laplacian-harmanlama.png';
      try { a.href = $('bl-out').toDataURL('image/png'); a.click(); } catch (err) { $('bl-msg').innerHTML = TAINT_MSG; }
    };
    {
      const mc = $('bl-M');
      let last = null;
      mc.addEventListener('pointerdown', (e) => {
        if ($('bl-mask').value !== 'draw') return;
        e.preventDefault();
        mc.setPointerCapture(e.pointerId);
        ensureMask();
        last = paintMask(e, null);
        blendSoon(false);
      });
      mc.addEventListener('pointermove', (e) => {
        if (!last) return;
        last = paintMask(e, last);
        blendSoon(false);
      });
      const end = () => { if (last) { last = null; renderBlend(); } };
      mc.addEventListener('pointerup', end);
      mc.addEventListener('pointercancel', end);
    }
    // Sürükle-bırak: A, B, maske ve ana görüntü
    const dropTargets = [...document.querySelectorAll('[data-drop]'), srcCanvas.parentElement];
    srcCanvas.parentElement.dataset.drop = 'main';
    srcCanvas.parentElement.classList.add('drop');
    for (const t of dropTargets) {
      t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('over'); });
      t.addEventListener('dragleave', () => t.classList.remove('over'));
      t.addEventListener('drop', (e) => {
        e.preventDefault();
        t.classList.remove('over');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        const w = t.dataset.drop;
        fileToImage(f, (im) => (w === 'main' ? setMainUpload(im, f.name) : setBlendUpload(w, im)));
      });
    }

    // İçindekiler: görünen bölümü vurgula
    const links = [...document.querySelectorAll('.toc a')];
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
        }
      }
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.sec').forEach((s) => obs.observe(s));
  }

  fillExampleSelect();
  wire();
  S.tpl = { ...PYR.gray.find((e) => e.id === 'eyes').template };
  syncKControls();
  setMain('zebra').then(fullRefresh);
  // Harmanlamanın varsayılan fotoğraflarını önceden yükle
  Promise.all(['ph-apple', 'ph-orange'].map(photoPromise)).then(() => renderBlend()).catch(() => {});
})();
