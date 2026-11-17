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
  // Durum ve görüntü yükleme
  // ===========================================================================
  const S = { N: 256, K: 4, a: 0.375, lapGain: 'auto', img: null, src: { kind: 'photo', id: 'ph-chelsea' }, G: [], L: [] };
  const PYR = window.PYR_EXAMPLES;
  const PHOTOS = PYR.photos;
  const SYNTH = PYR.gray.filter((e) => e.id !== 'eyes');
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


  // Ana görüntüyü seç (fotoğraf ya da sentetik). Başarılıysa true döner.
  async function setMain(id) {
    if (id.startsWith('ph-')) {
      const ph = PHOTOS.find((p) => p.id === id);
      S.src = { kind: 'photo', id };
      $('ex-info').innerHTML = `<span class="status">${ph.name} yükleniyor…</span>`;
      let im;
      try { im = await photoPromise(id); } catch (err) { $('ex-info').textContent = err.message; return false; }
      if (S.src.id !== id) return false;
      const ch = safeChannels(im, S.N, false);
      if (!ch) return false;
      S.img = fromCh(S.N, S.N, ch);
      $('g-example').value = id;
      $('ex-info').innerHTML = `<b>${ph.name}.</b> ${ph.info}`;
      return true;
    }
    const ex = SYNTH.find((e) => e.id === id) || SYNTH[0];
    S.src = { kind: 'gen', id: ex.id };
    S.img = fromCh(S.N, S.N, [Float32Array.from(ex.gen(S.N))]);
    $('g-example').value = ex.id;
    $('ex-info').innerHTML = `<b>${ex.name}.</b> ${ex.info || ''}`;
    return true;
  }
  function selectMain(id) { return setMain(id).then((ok) => { if (ok) fullRefresh(); }); }
  async function reloadImage() {
    if (S.src.kind === 'upload') {
      const ch = safeChannels(S.src.img, S.N, false);
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

  function canvasPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  }

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


  // ===========================================================================
  // 1. Aşağı inme: Gauss ve Laplacian seviyeleri
  // ===========================================================================
  const size = (img) => `${img.w}×${img.h}`;
  function recompute() {
    W = kernel(S.a);
    S.G = gaussPyr(S.img, S.K);
    S.L = lapPyr(S.G);
  }
  function cell(img, mode, caption) {
    const { f, c } = figure(caption, 'pcell');
    render(c, img, mode);
    return f;
  }
  function renderDown() {
    const K = S.K, wrap = $('down');
    wrap.innerHTML = '';
    const head = el('div', 'drow dhead');
    ['Seviye', 'Gauss seviyesi g', '', 'Bir küçüğü büyütülmüş ↑g', '', 'Laplacian L = g − ↑g'].forEach((t) => head.appendChild(el('div', '', t)));
    wrap.appendChild(head);
    for (let l = 0; l < K; l++) {
      const row = el('div', 'drow');
      row.appendChild(el('div', 'dlbl', `<b>${l}</b><br>${size(S.G[l])}`));
      row.appendChild(cell(S.G[l], 'img', `g${sb(l)}`));
      row.appendChild(el('div', 'op', '−'));
      row.appendChild(cell(expand(S.G[l + 1], S.G[l].w, S.G[l].h), 'img', `↑g${sb(l + 1)} (${size(S.G[l + 1])} → ${size(S.G[l])})`));
      row.appendChild(el('div', 'op', '='));
      row.appendChild(cell(S.L[l], 'lap', `L${sb(l)}: küçültmede kaybolan ayrıntı`));
      wrap.appendChild(row);
    }
    const top = el('div', 'drow dtop');
    top.appendChild(el('div', 'dlbl', `<b>${K}</b><br>${size(S.G[K])}`));
    top.appendChild(cell(S.G[K], 'img', `g${sb(K)}: en küçük seviye (tepe)`));
    top.appendChild(el('div', 'dnote', `Daha aşağı inilmez. Bu küçük görüntü olduğu gibi saklanır. Laplacian piramidi = { L₀ … L${sb(K - 1)} } + g${sb(K)}.`));
    wrap.appendChild(top);
  }

  // ===========================================================================
  // 2. Geri inşa: büyüt + ayrıntıyı ekle
  // ===========================================================================
  let recon = [];
  const recTotal = () => S.K + 1;
  const recStepper = makeStepper('rec', recTotal, () => renderRecon());
  function computeRecon() {
    const K = S.K;
    recon = [S.G[K]];
    let x = S.G[K];
    for (let k = K - 1; k >= 0; k--) {
      const up = expand(x, S.L[k].w, S.L[k].h);
      x = add(up, S.L[k]);
      recon.push({ k, up, x });
    }
  }
  function renderRecon() {
    const K = S.K, s = recStepper.step;
    const cur = s === 1 ? recon[0] : recon[s - 1].x;
    render($('rec-cur'), cur);
    $('rec-cur-cap').innerHTML = `Şu anki görüntü: <b>${size(cur)}</b>`;
    if (s === 1) {
      $('rec-caption').innerHTML = `Başlangıç: en küçük seviye <b>g${sb(K)}</b> (${size(cur)}). Elimizde bir de L${sb(K - 1)} … L₀ ayrıntı görüntüleri var.`;
    } else {
      const { k } = recon[s - 1];
      $('rec-caption').innerHTML = `Görüntüyü 2 kat büyüt (${size(recon[s - 1].up)}), sonra <b>L${sb(k)}</b> ayrıntısını ekle.` + (s === recTotal() ? ' <b>Bitti: orijinal boyuta ulaşıldı.</b>' : '');
    }
    const wrap = $('rec-flow');
    wrap.innerHTML = '';
    for (let i = 1; i < s; i++) {
      const { k, up, x } = recon[i];
      const prev = i === 1 ? recon[0] : recon[i - 1].x;
      const row = el('div', 'rrow' + (i === s - 1 ? ' fresh' : ''));
      row.append(
        cell(prev, 'img', `${size(prev)}`), el('div', 'op', '→ büyüt →'),
        cell(up, 'img', `↑ (${size(up)}, bulanık)`), el('div', 'op', '+'),
        cell(S.L[k], 'lap', `L${sb(k)}`), el('div', 'op', '='),
        cell(x, 'img', `<b>${size(x)}</b>`),
      );
      wrap.appendChild(row);
    }
    const done = s === recTotal();
    $('rec-verify').hidden = !done;
    if (done) {
      const final = recon[recon.length - 1].x;
      let mx = 0;
      final.c.forEach((c, ch) => { const o = S.img.c[ch]; for (let i = 0; i < c.length; i++) mx = Math.max(mx, Math.abs(c[i] - o[i])); });
      render($('rec-orig'), S.img);
      render($('rec-final'), final);
      render($('rec-blur'), upTo(S.G[K], S.N));
      $('rec-err').innerHTML = `Orijinal ile en büyük fark: <b>${mx < 1e-3 ? mx.toExponential(1) : mx.toFixed(3)}</b> gri seviye → <b>birebir aynı</b>.`;
    }
  }

  function fullRefresh() {
    if (!S.img) return;
    recompute();
    renderDown();
    computeRecon();
    recStepper.update();
    if ($('bl-a').value === 'main' || $('bl-b').value === 'main') renderBlend();
  }

  // Piramidin tepesi (en küçük seviye) ayarı
  function syncKControls() {
    const m = maxK();
    for (const id of ['g-levels', 'bl-levels', 'bl-feather']) $(id).max = m;
    $('g-levels').value = S.K;
    const top = S.N >> S.K;
    $('g-levels-o').textContent = `${S.K} adım · ${top}×${top}`;
    $('g-kdown').disabled = S.K <= 1;
    $('g-kup').disabled = S.K >= m;
  }
  function setK(k) {
    k = Math.max(1, Math.min(maxK(), k));
    if (k !== S.K) { S.K = k; recStepper.step = 1; }
    syncKControls();
    fullRefresh();
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

  // ===========================================================================
  // Kurulum
  // ===========================================================================
  function fillExampleSelect() {
    const sel = $('g-example');
    const og = document.createElement('optgroup');
    og.label = 'Fotoğraflar';
    for (const p of PHOTOS) og.appendChild(new Option(p.name.replace(' (fotoğraf)', ''), p.id));
    sel.appendChild(og);
    const og2 = document.createElement('optgroup');
    og2.label = 'Sentetik';
    for (const e of SYNTH) og2.appendChild(new Option(e.name, e.id));
    sel.appendChild(og2);
    sel.appendChild(new Option('Yüklenen görsel', 'upload'));
    for (const id of ['bl-a', 'bl-b']) {
      const s = $(id);
      const a = document.createElement('optgroup');
      a.label = 'Fotoğraflar';
      for (const p of PHOTOS) a.appendChild(new Option(p.name.replace(' (fotoğraf)', ''), p.id));
      s.appendChild(a);
      const b = document.createElement('optgroup');
      b.label = 'Diğer';
      for (const e of PYR.color) b.appendChild(new Option(e.name + ' (sentetik)', e.id));
      b.appendChild(new Option('Üstteki görüntü', 'main'));
      b.appendChild(new Option('Yüklenen görsel', 'upload'));
      s.appendChild(b);
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
    $('ex-info').innerHTML = `<b>${name || 'Yüklenen görüntü'}.</b> Kare olacak biçimde ortadan kırpıldı.`;
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


  function wire() {
    $('g-example').onchange = (e) => {
      if (e.target.value === 'upload') { if (S.src.kind !== 'upload') $('g-file').click(); return; }
      recStepper.step = 1;
      selectMain(e.target.value);
    };
    $('g-file').onchange = (e) => readFile(e.target, (im) => { recStepper.step = 1; setMainUpload(im); });
    $('g-size').onchange = (e) => {
      S.N = +e.target.value;
      S.K = Math.min(S.K, maxK());
      syncKControls();
      reloadImage().then(fullRefresh);
    };
    $('g-levels').oninput = (e) => setK(+e.target.value);
    $('g-kdown').onclick = () => setK(S.K - 1);
    $('g-kup').onclick = () => setK(S.K + 1);

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
    const dropTargets = [...document.querySelectorAll('[data-drop]')];
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

  }

  fillExampleSelect();
  wire();
  syncKControls();
  setMain('ph-chelsea').then(fullRefresh);
  Promise.all(['ph-apple', 'ph-orange'].map(photoPromise)).then(() => renderBlend()).catch(() => {});
})();
