'use strict';

// Örnek görüntü üreteçleri. Her `gen(N)` N×N boyutlu, 0–255 aralığında bir
// Float64Array döndürür. Frekanslar "görüntü başına devir" cinsindendir, böylece
// örnekler her çözünürlükte aynı görünür. Çizimler 256 birimlik bir koordinat
// sisteminde yapılır ve N'ye ölçeklenir.
window.FOURIER_EXAMPLES = (() => {
  const TAU = 2 * Math.PI;

  // Tekrarlanabilir rastgele sayılar (mulberry32).
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // f(x, y, X, Y): x,y piksel; X,Y merkeze göre 256 birimlik koordinat.
  function field(N, f) {
    const a = new Float64Array(N * N);
    const k = 256 / N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        a[y * N + x] = f(x, y, (x + 0.5) * k - 128, (y + 0.5) * k - 128);
      }
    }
    return a;
  }

  function wave(N, kx, ky, x, y) {
    return 127.5 + 127.5 * Math.cos((TAU * (kx * x + ky * y)) / N);
  }

  // Tuval üzerinde 256×256 birimle çizip gri seviyeye çevirir.
  function paint(N, draw, bg = '#000') {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, N, N);
    ctx.save();
    ctx.scale(N / 256, N / 256);
    draw(ctx);
    ctx.restore();
    const d = ctx.getImageData(0, 0, N, N).data;
    const a = new Float64Array(N * N);
    for (let i = 0, o = 0; i < a.length; i++, o += 4) {
      a[i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    }
    return a;
  }

  const gray = (v) => `rgb(${v},${v},${v})`;

  // Ayrılabilir, dairesel sınırlı kutu bulanıklığı (yerinde).
  function boxBlur(a, N, rx, ry) {
    const tmp = new Float64Array(N);
    const pass = (r, horizontal) => {
      if (r < 1) return;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          let sum = 0;
          for (let d = -r; d <= r; d++) {
            const ii = (i + d + N) % N;
            sum += horizontal ? a[j * N + ii] : a[ii * N + j];
          }
          tmp[i] = sum / (2 * r + 1);
        }
        for (let i = 0; i < N; i++) {
          if (horizontal) a[j * N + i] = tmp[i]; else a[i * N + j] = tmp[i];
        }
      }
    };
    pass(rx, true);
    pass(ry, false);
    return a;
  }

  function stretch(a, lo = 0, hi = 255) {
    let mn = Infinity, mx = -Infinity;
    for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = (hi - lo) / (mx - mn || 1);
    for (let i = 0; i < a.length; i++) a[i] = lo + (a[i] - mn) * k;
    return a;
  }

  // Shepp–Logan fantomu (değiştirilmiş, Toft): [yoğunluk, a, b, x0, y0, açı°]
  const SHEPP = [
    [1, 0.69, 0.92, 0, 0, 0],
    [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
    [-0.2, 0.11, 0.31, 0.22, 0, -18],
    [-0.2, 0.16, 0.41, -0.22, 0, 18],
    [0.1, 0.21, 0.25, 0, 0.35, 0],
    [0.1, 0.046, 0.046, 0, 0.1, 0],
    [0.1, 0.046, 0.046, 0, -0.1, 0],
    [0.1, 0.046, 0.023, -0.08, -0.605, 0],
    [0.1, 0.023, 0.023, 0, -0.606, 0],
    [0.1, 0.023, 0.046, 0.06, -0.605, 0],
  ];
  function phantom(N) {
    const E = SHEPP.map(([v, a, b, x0, y0, deg]) => {
      const t = (deg * Math.PI) / 180;
      return { v, a2: a * a, b2: b * b, x0, y0, c: Math.cos(t), s: Math.sin(t) };
    });
    return field(N, (x, y, X, Y) => {
      const px = X / 128, py = -Y / 128;
      let v = 0;
      for (const e of E) {
        const dx = px - e.x0, dy = py - e.y0;
        const xr = dx * e.c + dy * e.s;
        const yr = -dx * e.s + dy * e.c;
        if ((xr * xr) / e.a2 + (yr * yr) / e.b2 <= 1) v += e.v;
      }
      return Math.max(0, v) * 255;
    });
  }

  // Gonzalez & Woods tarzı test deseni (ideal alçak geçiren filtre slaytları).
  function testPattern(N) {
    const a = paint(N, (ctx) => {
      ctx.fillStyle = '#000';
      // Boyutu artan kareler
      let x = 22;
      for (const sz of [2, 4, 6, 9, 13, 18, 24]) {
        ctx.fillRect(x, 34 - sz / 2, sz, sz);
        x += sz + 14;
      }
      // Farklı gri seviyelerinde daireler
      const grays = [[170, 130, 90], [60, 30, 0]];
      grays.forEach((row, r) => row.forEach((g, c) => {
        ctx.fillStyle = gray(g);
        ctx.beginPath();
        ctx.arc(30 + c * 22, 84 + r * 24, 8, 0, TAU);
        ctx.fill();
      }));
      // Büyük "a"
      ctx.fillStyle = '#000';
      ctx.font = 'bold 120px Georgia, "Times New Roman", serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('a', 96, 140);
      // Dikey çubuklar
      for (let i = 0; i < 9; i++) ctx.fillRect(20 + i * 10, 150, 5, 52);
      // Alt sırada büyüyen "a" harfleri
      let ax = 14;
      for (const fs of [10, 13, 16, 19, 22, 26, 30, 34]) {
        ctx.font = `${fs}px Georgia, "Times New Roman", serif`;
        ctx.fillText('a', ax, 244);
        ax += fs * 0.62 + 8;
      }
    }, gray(205));
    // Sağ sütunda gürültü seviyesi artan dikdörtgenler
    const rnd = rng(7);
    const k = N / 256;
    const boxes = [[172, 82, 236, 112, 20], [172, 118, 236, 148, 50], [172, 154, 236, 184, 90], [172, 190, 236, 220, 140]];
    for (const [bx0, by0, bx1, by1, amp] of boxes) {
      for (let y = Math.round(by0 * k); y < Math.round(by1 * k); y++) {
        for (let x = Math.round(bx0 * k); x < Math.round(bx1 * k); x++) {
          a[y * N + x] = Math.min(255, Math.max(0, 150 + (rnd() * 2 - 1) * amp));
        }
      }
    }
    return a;
  }

  function columnsBuilding(N) {
    return paint(N, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, 140);
      sky.addColorStop(0, gray(235));
      sky.addColorStop(1, gray(190));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 256, 256);
      // Kubbe
      ctx.fillStyle = gray(150);
      ctx.beginPath();
      ctx.ellipse(128, 100, 70, 58, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = gray(175);
      ctx.fillRect(52, 92, 152, 16);
      // Gövde ve saçak
      ctx.fillStyle = gray(120);
      ctx.fillRect(14, 108, 228, 14);
      ctx.fillStyle = gray(45);
      ctx.fillRect(14, 122, 228, 92);
      // Periyodik sütunlar
      ctx.fillStyle = gray(225);
      for (let x = 18; x < 238; x += 12) ctx.fillRect(x, 124, 6, 88);
      // Basamaklar ve zemin
      ctx.fillStyle = gray(160);
      ctx.fillRect(8, 212, 240, 8);
      ctx.fillStyle = gray(90);
      ctx.fillRect(0, 220, 256, 36);
      // Ağaç
      ctx.fillStyle = gray(30);
      ctx.beginPath();
      ctx.arc(236, 196, 26, 0, TAU);
      ctx.fill();
    });
  }

  function bricks(N) {
    const rnd = rng(11);
    const shade = Array.from({ length: 512 }, () => 95 + rnd() * 50);
    const noise = rng(12);
    return field(N, (x, y) => {
      const u = (x * 256) / N, v = (y * 256) / N;
      const row = Math.floor(v / 16);
      const uu = u + (row % 2 ? 16 : 0);
      const col = Math.floor(uu / 32);
      if (v % 16 < 2.5 || uu % 32 < 2.5) return 205 + noise() * 15;
      return shade[(row * 17 + col) & 511] + (noise() - 0.5) * 20;
    });
  }

  function textLines(N) {
    const words = 'Fourier dönüşümü bir görüntüyü farklı frekanstaki sinüslerin toplamı olarak ifade eder ve her frekansın genliğini ve fazını saklar.';
    return paint(N, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.font = '11px Arial, Helvetica, sans-serif';
      ctx.textBaseline = 'top';
      let off = 0;
      for (let y = 6; y < 250; y += 16) {
        ctx.fillText(words.slice(off) + ' ' + words, 6, y);
        off = (off + 23) % 60;
      }
    }, '#fff');
  }

  function buildings(N) {
    const rnd = rng(5);
    return paint(N, (ctx) => {
      ctx.fillStyle = '#000';
      for (let gy = 10; gy < 256; gy += 30) {
        for (let gx = 8; gx < 256; gx += 26) {
          if (rnd() < 0.15) continue;
          const w = 12 + rnd() * 8, h = 14 + rnd() * 9;
          ctx.save();
          ctx.translate(gx + w / 2 + rnd() * 3, gy + h / 2 + rnd() * 3);
          ctx.rotate((rnd() - 0.5) * 0.15);
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.restore();
        }
      }
    }, '#fff');
  }

  function pebbles(N) {
    const rnd = rng(3);
    return paint(N, (ctx) => {
      for (let i = 0; i < 420; i++) {
        const r = 5 + rnd() * 10;
        ctx.fillStyle = gray(Math.round(70 + rnd() * 150));
        ctx.strokeStyle = gray(25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, rnd() * 256, r, r * (0.7 + rnd() * 0.3), rnd() * Math.PI, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }, gray(40));
  }

  function bark(N) {
    const rnd = rng(9);
    const a = new Float64Array(N * N);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    boxBlur(a, N, Math.max(1, Math.round(N / 256)), Math.round(N / 8));
    return stretch(a, 20, 235);
  }

  function noise(N, blur) {
    const rnd = rng(1);
    const a = new Float64Array(N * N);
    for (let i = 0; i < a.length; i++) a[i] = rnd() * 255;
    if (blur) { boxBlur(a, N, blur, blur); boxBlur(a, N, blur, blur); stretch(a); }
    return a;
  }

  const shape = (draw) => (N) => paint(N, (ctx) => { ctx.fillStyle = '#fff'; draw(ctx); });

  return [
    // ---------------------------------------------------------------- Temel
    { group: 'Temel şekiller', id: 'rect', name: 'Dikdörtgen',
      info: 'Dikdörtgenin spektrumu iki yönde sinc fonksiyonudur. Uzun kenar yönünde spektrum daha dardır.',
      gen: shape((c) => c.fillRect(117, 107, 22, 42)) },
    { group: 'Temel şekiller', id: 'small-rect', name: 'Küçük yatay dikdörtgen',
      info: '“DFT & Images” slaytındaki örnek: küçük, yatay bir dikdörtgen geniş ve dikey uzanan bir sinc ızgarası verir.',
      gen: shape((c) => c.fillRect(116, 124, 24, 8)) },
    { group: 'Temel şekiller', id: 'square', name: 'Kare',
      info: 'Karenin spektrumu her iki eksende aynı genişlikte bir sinc ızgarasıdır.',
      gen: shape((c) => c.fillRect(112, 112, 32, 32)) },
    { group: 'Temel şekiller', id: 'circle', name: 'Daire',
      info: 'Dairenin spektrumu dairesel simetrik halkalardır (Airy deseni).',
      gen: shape((c) => { c.beginPath(); c.arc(128, 128, 32, 0, TAU); c.fill(); }) },
    { group: 'Temel şekiller', id: 'ring', name: 'Halka',
      info: 'İnce halkanın spektrumu da halkalardan oluşur ama yüksek frekanslara kadar uzanır.',
      gen: shape((c) => { c.beginPath(); c.arc(128, 128, 36, 0, TAU); c.arc(128, 128, 28, 0, TAU, true); c.fill(); }) },
    { group: 'Temel şekiller', id: 'rot-rect', name: 'Döndürülmüş dikdörtgen (30°)',
      info: 'Döndürme özelliği: görüntü döndüğünde spektrum da aynı açıyla döner.',
      gen: shape((c) => { c.translate(128, 128); c.rotate(Math.PI / 6); c.fillRect(-40, -12, 80, 24); }) },
    { group: 'Temel şekiller', id: 'triangle', name: 'Üçgen',
      info: 'Her kenar, kendisine dik doğrultuda spektrumda bir “ışın” oluşturur.',
      gen: shape((c) => { c.beginPath(); c.moveTo(128, 80); c.lineTo(178, 168); c.lineTo(78, 168); c.closePath(); c.fill(); }) },
    { group: 'Temel şekiller', id: 'cross', name: 'Artı',
      info: 'İki dikdörtgenin toplamı: spektrum, iki sinc deseninin toplamıdır (doğrusallık).',
      gen: shape((c) => { c.fillRect(120, 88, 16, 80); c.fillRect(88, 120, 80, 16); }) },
    { group: 'Temel şekiller', id: 'gauss', name: 'Gauss',
      info: 'Gauss fonksiyonunun Fourier dönüşümü yine Gauss’tur. Uzayda dar olan Gauss, frekansta geniş olur.',
      gen: (N) => field(N, (x, y, X, Y) => 255 * Math.exp(-(X * X + Y * Y) / (2 * 8 * 8))) },
    { group: 'Temel şekiller', id: 'impulse', name: 'Tek nokta (dürtü)',
      info: 'Dürtünün spektrumu düzdür: tüm frekanslar eşit genlikte (slayttaki gri kare).',
      gen: (N) => { const a = new Float64Array(N * N); a[(N / 2) * N + N / 2] = 255; return a; } },
    { group: 'Temel şekiller', id: 'two-impulses', name: 'İki nokta',
      info: 'İki dürtünün spektrumu kosinüs saçaklarıdır. Noktalar uzaklaştıkça saçaklar sıklaşır.',
      gen: (N) => { const a = new Float64Array(N * N); const d = N / 16; a[(N / 2) * N + N / 2 - d] = 255; a[(N / 2) * N + N / 2 + d] = 255; return a; } },
    { group: 'Temel şekiller', id: 'hline', name: 'Yatay çizgi',
      info: 'Görüntüdeki yatay bir çizgi, spektrumda dikey bir çizgiye dönüşür.',
      gen: (N) => field(N, (x, y) => (y === N / 2 ? 255 : 0)) },
    { group: 'Temel şekiller', id: 'vline', name: 'Dikey çizgi',
      info: 'Görüntüdeki dikey bir çizgi, spektrumda yatay bir çizgiye dönüşür.',
      gen: (N) => field(N, (x) => (x === N / 2 ? 255 : 0)) },
    { group: 'Temel şekiller', id: 'const', name: 'Sabit gri (Kx=0, Ky=0)',
      info: 'Sabit görüntünün yalnızca DC bileşeni vardır: spektrumda tek bir nokta, ortada.',
      gen: (N) => new Float64Array(N * N).fill(128) },

    // ---------------------------------------------------------------- Sinüsler
    { group: 'Sinüsler (düzlem dalgalar)', id: 'k20', name: 'Kx=2, Ky=0',
      info: 'cos(2π·2x/N): spektrumda DC ve u=±2’de iki nokta.',
      gen: (N) => field(N, (x, y) => wave(N, 2, 0, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'k23', name: 'Kx=2, Ky=3',
      info: 'Eğik düzlem dalga: noktalar (±2, ±3) konumunda, dalganın yönüne dik doğrultuda.',
      gen: (N) => field(N, (x, y) => wave(N, 2, 3, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'k3264', name: 'Kx=32, Ky=64',
      info: 'Yüksek frekanslı düzlem dalga: noktalar merkezden uzakta.',
      gen: (N) => field(N, (x, y) => wave(N, 32, 64, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'h2', name: 'Yatay şeritler, düşük frekans',
      info: 'Düşük frekanslı yatay şeritler: spektrumda dikey eksende merkeze yakın noktalar.',
      gen: (N) => field(N, (x, y) => wave(N, 0, 2, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'h8', name: 'Yatay şeritler, frekans 8',
      info: 'Frekans arttıkça noktalar merkezden uzaklaşır.',
      gen: (N) => field(N, (x, y) => wave(N, 0, 8, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'h15', name: 'Yatay şeritler, frekans 15',
      info: 'Slayttaki “frekansı 15 olan sinüs ve FFT’si”.',
      gen: (N) => field(N, (x, y) => wave(N, 0, 15, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'h40', name: 'Yatay şeritler, frekans 40',
      info: 'Yüksek frekans: noktalar spektrumun kenarlarına yaklaşır.',
      gen: (N) => field(N, (x, y) => wave(N, 0, 40, x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'chirp', name: 'Frekansı değişen sinüs',
      info: 'Frekans aşağı doğru artıyor: spektrumda noktalar yerine dikey bir çizgi oluşur.',
      gen: (N) => field(N, (x, y) => {
        const t = y / N;
        return 127.5 + 127.5 * Math.cos(TAU * (t + 24 * t * t));
      }) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'rot30', name: 'Sinüs, 30° döndürülmüş',
      info: 'Döndürülmüş sinüs: noktalar aynı açıyla döner. Frekans tam sayı olmadığı için hafif sızıntı görülür.',
      gen: (N) => field(N, (x, y) => wave(N, 24 * Math.cos(Math.PI / 6), 24 * Math.sin(Math.PI / 6), x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'rot60', name: 'Sinüs, 60° döndürülmüş',
      info: 'Daha büyük dönme açısı: noktalar spektrumda o açıyla yer değiştirir.',
      gen: (N) => field(N, (x, y) => wave(N, 20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3), x, y)) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'sum', name: 'İki sinüsün toplamı',
      info: '“Signals can be composed”: toplam görüntünün spektrumu, iki spektrumun toplamıdır.',
      gen: (N) => field(N, (x, y) => (wave(N, 4, 0, x, y) + wave(N, 8, 8, x, y)) / 2) },
    { group: 'Sinüsler (düzlem dalgalar)', id: 'sum3', name: 'Üç yönlü sinüs toplamı',
      info: 'Üç farklı yöndeki sinüsün toplamı: spektrumda altı nokta ve DC.',
      gen: (N) => field(N, (x, y) => (wave(N, 12, 0, x, y) + wave(N, -6, 10, x, y) + wave(N, 6, 10, x, y)) / 3) },

    // ---------------------------------------------------------------- Periyodik
    { group: 'Periyodik desenler', id: 'square-wave', name: 'Kare dalga (dikey çubuklar)',
      info: 'Kare dalga = temel frekans + tek harmonikler (1, 1/3, 1/5…). Spektrumda yatay eksende azalan noktalar.',
      gen: (N) => field(N, (x) => ((x * 8) / N) % 1 < 0.5 ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'harmonics', name: 'Kare dalga: ilk 3 harmonik',
      info: 'sin(f) + sin(3f)/3 + sin(5f)/5 ile kare dalgaya yaklaşan Fourier serisi. Spektrumda üç nokta çifti.',
      gen: (N) => field(N, (x) => {
        let v = 0;
        for (const k of [1, 3, 5]) v += Math.sin((TAU * 8 * k * x) / N) / k;
        return 127.5 + 127.5 * 0.85 * v * (4 / Math.PI);
      }) },
    { group: 'Periyodik desenler', id: 'hbars', name: 'Yatay çubuklar',
      info: 'Yatay kare dalga: harmonikler dikey eksende dizilir.',
      gen: (N) => field(N, (x, y) => ((y * 16) / N) % 1 < 0.5 ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'hatch', name: 'Çapraz çizgiler (45°)',
      info: 'Çapraz kare dalga: harmonikler 45° doğrultusunda dizilir.',
      gen: (N) => field(N, (x, y) => (((x + y) * 16) / N) % 1 < 0.5 ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'checker', name: 'Dama tahtası',
      info: 'İki yönlü kare dalga çarpımı: harmonikler çapraz doğrultularda.',
      gen: (N) => field(N, (x, y) => (Math.floor((x * 16) / N) + Math.floor((y * 16) / N)) % 2 ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'grid', name: 'Izgara çizgileri',
      info: 'Yatay ve dikey çizgilerin toplamı: spektrumda eksenler üzerinde noktalar.',
      gen: (N) => field(N, (x, y) => (x % (N / 16) < Math.max(1, N / 128) || y % (N / 16) < Math.max(1, N / 128)) ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'dots', name: 'Nokta ızgarası',
      info: 'Uzayda aralığı d olan dürtü ızgarası, frekansta aralığı N/d olan dürtü ızgarasıdır.',
      gen: (N) => field(N, (x, y) => (x % (N / 16) === 0 && y % (N / 16) === 0) ? 255 : 0) },
    { group: 'Periyodik desenler', id: 'zone', name: 'Bölge plakası (zone plate)',
      info: 'Merkezden uzaklaştıkça frekansı artan halkalar: spektrumu da kendine benzer.',
      gen: (N) => field(N, (x, y) => {
        const dx = x - N / 2, dy = y - N / 2;
        return 127.5 + 127.5 * Math.cos((Math.PI * (dx * dx + dy * dy)) / N);
      }) },
    { group: 'Periyodik desenler', id: 'rings', name: 'Eş merkezli halkalar',
      info: 'Dairesel periyodik desen: spektrumda halkalar halinde harmonikler.',
      gen: (N) => field(N, (x, y, X, Y) => Math.floor(Math.hypot(X, Y) / 8) % 2 ? 0 : 255) },
    { group: 'Periyodik desenler', id: 'bricks', name: 'Tuğla duvar',
      info: 'Tuğlaların periyodik yerleşimi spektrumda düzenli noktalar ve eksenlerde parlak çizgiler üretir.',
      gen: bricks },
    { group: 'Periyodik desenler', id: 'text', name: 'Metin satırları',
      info: 'Satır aralığının periyodikliği spektrumda dikey eksen boyunca noktalar olarak görünür.',
      gen: textLines },

    // ---------------------------------------------------------------- Doku
    { group: 'Doku ve gürültü', id: 'white-noise', name: 'Beyaz gürültü',
      info: 'Beyaz gürültünün spektrumu her frekansta yaklaşık eşit genliktedir.',
      gen: (N) => noise(N, 0) },
    { group: 'Doku ve gürültü', id: 'blur-noise', name: 'Bulanık gürültü',
      info: 'Bulanıklaştırma yüksek frekansları bastırır: enerji merkezde toplanır.',
      gen: (N) => noise(N, Math.max(1, Math.round(N / 64))) },
    { group: 'Doku ve gürültü', id: 'pebbles', name: 'Çakıl taşları',
      info: 'Yönü olmayan doku: spektrum dairesel simetriktir.',
      gen: pebbles },
    { group: 'Doku ve gürültü', id: 'bark', name: 'Ağaç kabuğu (dikey doku)',
      info: 'Dikey uzanan doku: enerji spektrumun yatay ekseninde toplanır.',
      gen: bark },
    { group: 'Doku ve gürültü', id: 'buildings', name: 'Uydu görüntüsü: binalar',
      info: '“Example building patterns”: binaların düzenli dizilişi spektrumda periyodik noktalar üretir.',
      gen: buildings },

    // ---------------------------------------------------------------- Test
    { group: 'Test görüntüleri', id: 'test-pattern', name: 'Test deseni',
      info: 'İdeal alçak geçiren filtre slaytlarındaki desen. Filtre ile D₀ = 5, 15, 30, 80 deneyin; halkalanmayı (ringing) gözleyin.',
      gen: testPattern },
    { group: 'Test görüntüleri', id: 'phantom', name: 'Shepp–Logan fantomu',
      info: 'MRI/k-uzayı slaytları için sentetik kafa kesiti. Spektrum maskeleri (bant, kare) ile deneyin.',
      gen: phantom },
    { group: 'Test görüntüleri', id: 'phantom-noise', name: 'Fantom + periyodik gürültü',
      info: 'Spektrumda merkez dışında iki parlak nokta var. Siyah kalemle bu noktaları silin, gürültü kaybolsun.',
      gen: (N) => {
        const a = phantom(N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          a[y * N + x] = 0.8 * a[y * N + x] + 25 + 25 * Math.cos((TAU * (20 * x + 12 * y)) / N);
        }
        return a;
      } },
    { group: 'Test görüntüleri', id: 'columns', name: 'Sütunlu bina',
      info: '“Masking out the fundamental and harmonics”: sütunlar spektrumda yatay eksende noktalar oluşturur. Bu noktaları silip sütunları kaldırmayı deneyin.',
      gen: columnsBuilding },
  ];
})();
