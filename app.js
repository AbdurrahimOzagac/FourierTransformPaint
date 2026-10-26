'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // FFT (radix-2, yerinde)
  // ---------------------------------------------------------------------------
  function makeFFT(n) {
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    // inverse=true -> e^{+j...}; 1/N ölçeklemesi çağırana bırakılır.
    return function fft(re, im, inverse) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      const sgn = inverse ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const wr = cos[k];
            const wi = sgn * sin[k];
            const l = j + half;
            const tr = re[l] * wr - im[l] * wi;
            const ti = re[l] * wi + im[l] * wr;
            re[l] = re[j] - tr; im[l] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Durum
  // ---------------------------------------------------------------------------
  let N = 256;
  let mask = N - 1;
  let half = N >> 1;
  let s;          // uzamsal görüntü (Float64, kırpılmamış)
  let re, im;     // spektrum F(u,v), merkezlenmemiş (DC indeks 0'da)
  let tmpRe, tmpIm, colRe, colIm, logMag;
  let fft;
  let Lfixed;     // sabit log ölçeği: log(1 + N²·255)
  let lastL;      // son çizimde kullanılan ölçek
  let frozenL = null; // spektrumda çizim sürerken ölçek sabitlenir

  const canvasL = $('L-canvas');
  const canvasR = $('R-canvas');
  const ctxL = canvasL.getContext('2d');
  const ctxR = canvasR.getContext('2d');
  let imgL, imgR;

  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 30;

  function alloc(n) {
    N = n; mask = n - 1; half = n >> 1;
    const len = n * n;
    s = new Float64Array(len);
    re = new Float64Array(len);
    im = new Float64Array(len);
    tmpRe = new Float64Array(len);
    tmpIm = new Float64Array(len);
    logMag = new Float64Array(len);
    colRe = new Float64Array(n);
    colIm = new Float64Array(n);
    fft = makeFFT(n);
    Lfixed = Math.log1p(len * 255);
    lastL = Lfixed;
    for (const c of [canvasL, canvasR]) { c.width = n; c.height = n; }
    imgL = ctxL.createImageData(n, n);
    imgR = ctxR.createImageData(n, n);
    for (const img of [imgL, imgR]) {
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    }
  }

  function fft2(R, I, inverse) {
    for (let y = 0; y < N; y++) {
      fft(R.subarray(y * N, (y + 1) * N), I.subarray(y * N, (y + 1) * N), inverse);
    }
    for (let x = 0; x < N; x++) {
      for (let y = 0, k = x; y < N; y++, k += N) { colRe[y] = R[k]; colIm[y] = I[k]; }
      fft(colRe, colIm, inverse);
      for (let y = 0, k = x; y < N; y++, k += N) { R[k] = colRe[y]; I[k] = colIm[y]; }
    }
  }

  function forward() {
    re.set(s);
    im.fill(0);
    fft2(re, im, false);
  }

  function inverse() {
    tmpRe.set(re);
    tmpIm.set(im);
    fft2(tmpRe, tmpIm, true);
    const k = 1 / (N * N);
    for (let i = 0; i < s.length; i++) s[i] = tmpRe[i] * k;
  }

  // ---------------------------------------------------------------------------
  // Çizim (render)
  // ---------------------------------------------------------------------------
  const opts = { normalize: false, autoContrast: false };

  function renderSpatial() {
    const d = imgL.data;
    let lo = 0, hi = 255;
    if (opts.normalize) {
      lo = Infinity; hi = -Infinity;
      for (let i = 0; i < s.length; i++) {
        const v = s[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo < 1e-9) { hi = lo + 255; }
    }
    const k = 255 / (hi - lo);
    for (let i = 0, o = 0; i < s.length; i++, o += 4) {
      const v = (s[i] - lo) * k;
      d[o] = d[o + 1] = d[o + 2] = v; // Uint8ClampedArray kırpar ve yuvarlar
    }
    ctxL.putImageData(imgL, 0, 0);
  }

  function renderSpectrum() {
    let mx = 0;
    for (let i = 0; i < re.length; i++) {
      const v = Math.log1p(Math.sqrt(re[i] * re[i] + im[i] * im[i]));
      logMag[i] = v;
      if (v > mx) mx = v;
    }
    let L;
    if (frozenL !== null) L = frozenL;
    else if (opts.autoContrast && mx > 1e-6) L = mx;
    else L = Lfixed;
    lastL = L;
    const k = 255 / L;
    const d = imgR.data;
    // fftshift: ekrandaki (x,y) -> frekans indeksi ((x+N/2) mod N, (y+N/2) mod N)
    for (let y = 0, o = 0; y < N; y++) {
      const row = ((y + half) & mask) * N;
      for (let x = 0; x < N; x++, o += 4) {
        d[o] = d[o + 1] = d[o + 2] = logMag[row + ((x + half) & mask)] * k;
      }
    }
    ctxR.putImageData(imgR, 0, 0);
  }

  function renderAll() {
    renderSpatial();
    renderSpectrum();
  }

  // Aynı karede birden çok değişiklik olursa tek hesap yapılır.
  let pending = null;
  function schedule(source) {
    const first = pending === null;
    if (first || source !== 'none') pending = source;
    if (first) {
      requestAnimationFrame(() => {
        if (pending === 'spatial') forward();
        else if (pending === 'spectral') inverse();
        pending = null;
        renderAll();
      });
    }
  }

  function commit(source) {
    if (source === 'spatial') forward();
    else if (source === 'spectral') inverse();
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Geçmiş (geri al / yinele)
  // ---------------------------------------------------------------------------
  function snapshot() {
    return { s: s.slice(), re: re.slice(), im: im.slice() };
  }
  function restore(snap) {
    s.set(snap.s); re.set(snap.re); im.set(snap.im);
    renderAll();
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    updateHistoryButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    updateHistoryButtons();
  }
  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
  }

  // ---------------------------------------------------------------------------
  // Fırça yardımcıları
  // ---------------------------------------------------------------------------
  // Tek kalınlıkta merkez piksel ortasına, çift kalınlıkta piksel köşesine oturur.
  function snap(p, size) {
    return size % 2 ? Math.floor(p) + 0.5 : Math.round(p);
  }

  function stamp(cx, cy, size, put) {
    const r = size / 2;
    const r2 = r * r + 1e-6;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(N - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(N - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) put(x, y);
      }
    }
  }

  function segment(ax, ay, bx, by, size, put) {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, size / 4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(snap(ax + (bx - ax) * t, size), snap(ay + (by - ay) * t, size), size, put);
    }
  }

  // Spektrumda (ku,kv) frekansının genliğini M yapar; fazı korur ve
  // F(−u,−v) = F*(u,v) eşleniği simetrisini sağlar (ters dönüşüm gerçel kalsın).
  function setMagPair(ku, kv, M) {
    const k = kv * N + ku;
    const km = ((N - kv) & mask) * N + ((N - ku) & mask);
    let r = re[k], i = im[k];
    const m = Math.sqrt(r * r + i * i);
    if (m > 1e-9) { const f = M / m; r *= f; i *= f; } else { r = M; i = 0; }
    if (km === k) { re[k] = r < 0 ? -M : M; im[k] = 0; return; }
    re[k] = r; im[k] = i;
    re[km] = r; im[km] = -i;
  }

  function valueToMag(v, L) {
    return Math.expm1((v / 255) * L);
  }

  // Panelin piksel yazıcısı: ekran koordinatı (x,y) -> değer v
  function makePutter(panel, v) {
    if (panel.kind === 'spatial') {
      return (x, y) => { s[y * N + x] = v; };
    }
    const M = valueToMag(v, frozenL !== null ? frozenL : lastL);
    return (x, y) => setMagPair((x + half) & mask, (y + half) & mask, M);
  }

  // ---------------------------------------------------------------------------
  // Paneller
  // ---------------------------------------------------------------------------
  const panels = {
    L: { kind: 'spatial', canvas: canvasL, ring: $('L-ring'), readout: $('L-readout') },
    R: { kind: 'spectral', canvas: canvasR, ring: $('R-ring'), readout: $('R-readout') },
  };

  function linkRange(rangeId, numId, onChange) {
    const range = $(rangeId);
    const num = $(numId);
    const set = (raw) => {
      const v = Math.round(Math.min(+range.max, Math.max(+range.min, +raw || 0)));
      range.value = num.value = v;
      onChange(v);
    };
    range.addEventListener('input', () => set(range.value));
    num.addEventListener('change', () => set(num.value));
    set(range.value);
    return set;
  }

  function eventPos(panel, e) {
    const rect = panel.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * N,
      y: ((e.clientY - rect.top) / rect.height) * N,
    };
  }

  function updateRing(panel, e) {
    const rect = panel.canvas.getBoundingClientRect();
    const scale = rect.width / N;
    const d = Math.max(panel.size * scale, 4);
    const p = eventPos(panel, e);
    const cx = snap(p.x, panel.size) * scale;
    const cy = snap(p.y, panel.size) * scale;
    const ring = panel.ring;
    ring.style.display = 'block';
    ring.style.width = ring.style.height = d + 'px';
    ring.style.transform = `translate(${cx - d / 2}px, ${cy - d / 2}px)`;
  }

  function updateReadout(panel, e) {
    const p = eventPos(panel, e);
    const x = Math.min(N - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(N - 1, Math.max(0, Math.floor(p.y)));
    if (panel.kind === 'spatial') {
      const v = s[y * N + x];
      panel.readout.textContent = `x=${x}  y=${y}  f=${v.toFixed(1)}`;
    } else {
      const u = x - half, v = y - half;
      const k = ((y + half) & mask) * N + ((x + half) & mask);
      const mag = Math.hypot(re[k], im[k]);
      const ph = (Math.atan2(im[k], re[k]) * 180) / Math.PI;
      const g = Math.min(255, (Math.log1p(mag) * 255) / lastL);
      panel.readout.textContent =
        `u=${u}  v=${v}  |F|=${fmt(mag)}  faz=${mag > 1e-9 ? ph.toFixed(1) + '°' : '—'}  gösterim=${g.toFixed(0)}`;
    }
  }

  function fmt(x) {
    if (x === 0) return '0';
    if (x >= 1e5 || x < 1e-2) return x.toExponential(2);
    return x.toFixed(2);
  }

  function snapAngle(start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
  }

  function bindPanel(id) {
    const panel = panels[id];
    const root = $(id);
    panel.tool = 'pen';
    panel.drawing = false;

    linkRange(`${id}-size`, `${id}-size-n`, (v) => { panel.size = v; });
    const setValue = linkRange(`${id}-value`, `${id}-value-n`, (v) => {
      panel.value = v;
      $(`${id}-swatch`).style.background = `rgb(${v},${v},${v})`;
    });
    linkRange(`${id}-period`, `${id}-period-n`, (v) => { panel.period = v; });

    root.querySelectorAll(`input[name="${id}-tool"]`).forEach((r) => {
      r.addEventListener('change', () => { if (r.checked) panel.tool = r.value; });
    });
    root.querySelectorAll('[data-set-value]').forEach((b) => {
      b.addEventListener('click', () => setValue(b.dataset.setValue));
    });
    root.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'fill') fillPanel(panel, +b.dataset.v);
        else if (a === 'stripes') stripes(panel, b.dataset.dir);
        else if (a === 'filter') applyFilter();
        else if (a === 'png') downloadPNG(panel);
      });
    });

    const c = panel.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      pushUndo();
      panel.drawing = true;
      if (panel.kind === 'spectral') frozenL = lastL;
      panel.put = makePutter(panel, panel.value);
      const p = eventPos(panel, e);
      panel.start = panel.last = p;
      if (panel.tool === 'line') panel.base = snapshot();
      segment(p.x, p.y, p.x, p.y, panel.size, panel.put);
      schedule(panel.kind);
    });
    c.addEventListener('pointermove', (e) => {
      updateRing(panel, e);
      updateReadout(panel, e);
      if (!panel.drawing) return;
      const p = eventPos(panel, e);
      if (panel.tool === 'pen') {
        segment(panel.last.x, panel.last.y, p.x, p.y, panel.size, panel.put);
        panel.last = p;
      } else {
        // Düz çizgi: başlangıç durumuna dön ve çizgiyi yeniden çiz (canlı önizleme).
        s.set(panel.base.s); re.set(panel.base.re); im.set(panel.base.im);
        const end = e.shiftKey ? snapAngle(panel.start, p) : p;
        segment(panel.start.x, panel.start.y, end.x, end.y, panel.size, panel.put);
      }
      schedule(panel.kind);
    });
    const finish = () => {
      if (!panel.drawing) return;
      panel.drawing = false;
      panel.base = null;
      if (panel.kind === 'spectral') {
        frozenL = null;
        schedule('none'); // yeni ölçekle yeniden çiz
      }
    };
    c.addEventListener('pointerup', finish);
    c.addEventListener('pointercancel', finish);
    c.addEventListener('pointerleave', () => {
      panel.ring.style.display = 'none';
      panel.readout.innerHTML = '&nbsp;';
    });
  }

  // ---------------------------------------------------------------------------
  // Hazır işlemler
  // ---------------------------------------------------------------------------
  function fillPanel(panel, v) {
    pushUndo();
    if (panel.kind === 'spatial') {
      s.fill(v);
      commit('spatial');
    } else {
      const M = valueToMag(v, lastL);
      for (let kv = 0; kv < N; kv++) for (let ku = 0; ku < N; ku++) setMagPair(ku, kv, M);
      commit('spectral');
    }
  }

  // Merkezden başlayarak her `period` pikselde bir, kalem kalınlığında çizgi.
  function stripes(panel, dir) {
    pushUndo();
    const P = panel.period;
    const t = panel.size;
    const off = Math.floor(t / 2);
    const put = makePutter(panel, panel.value);
    for (let a = 0; a < N; a++) {
      if ((((a - half + off) % P) + P) % P >= t) continue;
      for (let b = 0; b < N; b++) {
        if (dir === 'h') put(b, a); else put(a, b);
      }
    }
    commit(panel.kind);
  }

  function applyFilter() {
    pushUndo();
    const type = $('R-ftype').value;
    const hp = $('R-fmode').value === 'hp';
    const D0 = +$('R-d0').value;
    for (let kv = 0; kv < N; kv++) {
      const v = kv < half ? kv : kv - N;
      for (let ku = 0; ku < N; ku++) {
        const u = ku < half ? ku : ku - N;
        const D = Math.sqrt(u * u + v * v);
        let H;
        if (type === 'ideal') H = D <= D0 ? 1 : 0;
        else if (type === 'gauss') H = Math.exp(-(D * D) / (2 * D0 * D0));
        else H = 1 / (1 + Math.pow(D / D0, 4));
        if (hp) H = 1 - H;
        const k = kv * N + ku;
        re[k] *= H; im[k] *= H;
      }
    }
    commit('spectral');
  }

  function loadExample(name) {
    pushUndo();
    const c = half;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c;
        let v = 0;
        switch (name) {
          case 'rect': v = Math.abs(dx) < N / 24 && Math.abs(dy) < N / 12 ? 255 : 0; break;
          case 'circle': v = dx * dx + dy * dy <= (N / 8) ** 2 ? 255 : 0; break;
          case 'impulse': v = x === c && y === c ? 255 : 0; break;
          case 'sinh': v = 127.5 + 127.5 * Math.cos((2 * Math.PI * 8 * x) / N); break;
          case 'sinv': v = 127.5 + 127.5 * Math.cos((2 * Math.PI * 8 * y) / N); break;
          case 'sind': v = 127.5 + 127.5 * Math.cos((2 * Math.PI * (6 * x + 10 * y)) / N); break;
          case 'checker': v = ((x >> 4) + (y >> 4)) & 1 ? 255 : 0; break;
          case 'gauss': v = 255 * Math.exp(-(dx * dx + dy * dy) / (2 * (N / 32) ** 2)); break;
        }
        s[y * N + x] = v;
      }
    }
    commit('spatial');
  }

  function imageToSpatial(source, sw, sh) {
    // Kareye "cover" kırpma ile ölçekle, gri seviyeye çevir.
    const off = document.createElement('canvas');
    off.width = off.height = N;
    const octx = off.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, N, N);
    const side = Math.min(sw, sh);
    octx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
    const d = octx.getImageData(0, 0, N, N).data;
    for (let i = 0, o = 0; i < s.length; i++, o += 4) {
      s[i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    }
  }

  function loadFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      pushUndo();
      imageToSpatial(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      commit('spatial');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  function changeResolution(n) {
    // Mevcut sol görüntüyü yeni çözünürlüğe yeniden örnekle.
    const old = document.createElement('canvas');
    old.width = old.height = N;
    old.getContext('2d').drawImage(canvasL, 0, 0);
    const oldN = N;
    alloc(n);
    imageToSpatial(old, oldN, oldN);
    clearHistory();
    commit('spatial');
  }

  function downloadPNG(panel) {
    const a = document.createElement('a');
    a.download = panel.kind === 'spatial' ? 'goruntu.png' : 'spektrum.png';
    a.href = panel.canvas.toDataURL('image/png');
    a.click();
  }

  // ---------------------------------------------------------------------------
  // Başlatma
  // ---------------------------------------------------------------------------
  alloc(N);
  bindPanel('L');
  bindPanel('R');
  linkRange('R-d0', 'R-d0-n', () => {});

  $('L-normalize').addEventListener('change', (e) => { opts.normalize = e.target.checked; renderSpatial(); });
  $('R-auto').addEventListener('change', (e) => { opts.autoContrast = e.target.checked; renderSpectrum(); });
  $('L-example').addEventListener('change', (e) => {
    if (e.target.value) loadExample(e.target.value);
    e.target.value = '';
  });
  $('L-file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });
  $('resolution').addEventListener('change', (e) => changeResolution(+e.target.value));
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.matches('input[type="number"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  loadExample('rect');
  clearHistory();
})();
