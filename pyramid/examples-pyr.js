'use strict';

// Piramit sayfası için sentetik örnek görüntüler.
// Gri örnekler: gen(N) -> Float32Array (N×N, 0–255).
// Renkli örnekler: gen(N) -> [R, G, B] Float32Array dizisi.
// Tüm çizimler 256 birimlik koordinatta yapılır ve N'ye ölçeklenir.
window.PYR_EXAMPLES = (() => {
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Yumuşak değer gürültüsü (bilineer, birkaç oktav).
  function valueNoise(seed, cells) {
    const rnd = rng(seed);
    const g = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
    return (u, v) => { // u, v ∈ [0, 1)
      const x = u * cells, y = v * cells;
      const x0 = Math.min(cells - 1, Math.floor(x)), y0 = Math.min(cells - 1, Math.floor(y));
      let fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const i = y0 * (cells + 1) + x0;
      const a = g[i] + (g[i + 1] - g[i]) * fx;
      const b = g[i + cells + 1] + (g[i + cells + 2] - g[i + cells + 1]) * fx;
      return a + (b - a) * fy;
    };
  }
  function fbm(seed, base, oct) {
    const ns = [];
    for (let o = 0; o < oct; o++) ns.push(valueNoise(seed + o * 17, base << o));
    return (u, v) => {
      let s = 0, amp = 1, tot = 0;
      for (const n of ns) { s += amp * n(u, v); tot += amp; amp *= 0.5; }
      return s / tot;
    };
  }

  function field(N, f) {
    const a = new Float32Array(N * N);
    const k = 256 / N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) a[y * N + x] = f((x + 0.5) * k, (y + 0.5) * k);
    }
    return a;
  }

  // Tuvalde çizip RGB kanallarına çevirir.
  function paintRGB(N, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(N / 256, N / 256);
    draw(ctx);
    ctx.restore();
    const d = ctx.getImageData(0, 0, N, N).data;
    const ch = [0, 1, 2].map(() => new Float32Array(N * N));
    for (let i = 0, o = 0; i < N * N; i++, o += 4) {
      ch[0][i] = d[o]; ch[1][i] = d[o + 1]; ch[2][i] = d[o + 2];
    }
    return ch;
  }
  const toGray = (ch) => {
    const a = new Float32Array(ch[0].length);
    for (let i = 0; i < a.length; i++) a[i] = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
    return a;
  };

  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  // ---------------------------------------------------------------- Zebra benzeri
  function zebra(N) {
    const bg = fbm(3, 3, 4);
    const hair = fbm(5, 40, 2);
    const warp = fbm(7, 3, 3);
    return field(N, (X, Y) => {
      const u = X / 256, v = Y / 256;
      let val = 205 + 25 * bg(u, v);
      // Burun: döndürülmüş elips. Boyun: sağ üste uzanan bant.
      const ex = (X - 105), ey = (Y - 175);
      const c = Math.cos(-0.5), s = Math.sin(-0.5);
      const rx = ex * c - ey * s, ry = ex * s + ey * c;
      const muzzle = (rx * rx) / (90 * 90) + (ry * ry) / (68 * 68);
      // Boyun bandına uzaklık
      const ax = 105, ay = 175, bx = 250, by = -30;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy)));
      const dist = Math.hypot(X - (ax + t * dx), Y - (ay + t * dy));
      const inHead = Math.max(1 - smooth(0.92, 1.02, muzzle), 1 - smooth(70, 76, dist));
      if (inHead > 0) {
        const w = 18 * warp(u, v);
        const phase = (X * 0.55 - Y * 0.85 + w + 14 * Math.sin(Y / 37) + 9 * Math.sin(X / 29)) / 15;
        const stripe = 0.5 + 0.5 * Math.tanh(4 * Math.sin(Math.PI * phase));
        let z = 25 + 215 * stripe + 18 * hair(u, v);
        // Burnun alt-sol kısmı koyu
        const nose = 1 - smooth(0.25, 0.55, (rx + 40) * (rx + 40) / (60 * 60) + (ry - 15) * (ry - 15) / (45 * 45));
        z = z * (1 - nose) + (45 + 20 * hair(u * 0.5, v * 0.5)) * nose;
        // Burun deliği
        const nh = ((rx + 45) ** 2) / 100 + ((ry - 12) ** 2) / 30;
        if (nh < 1) z = 15;
        val = val * (1 - inHead) + z * inHead;
      }
      return Math.max(0, Math.min(255, val));
    });
  }

  // ---------------------------------------------------------------- Göz sahnesi
  // Aynı göz üç farklı ölçekte: şablon eşlemeyi piramitle denemek için.
  const EYE = { x: 52, y: 54, w: 26, h: 16 };
  function drawEye(ctx, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    // Kaş
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-11, -7.5); ctx.quadraticCurveTo(0, -11, 11, -7); ctx.stroke();
    // Badem biçimli göz akı
    ctx.fillStyle = '#eeeeee';
    ctx.beginPath();
    ctx.moveTo(-11, 0); ctx.quadraticCurveTo(0, -9, 11, 0); ctx.quadraticCurveTo(0, 7, -11, 0);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
    // İris ve göz bebeği
    ctx.fillStyle = '#6b6b6b';
    ctx.beginPath(); ctx.arc(0, -0.5, 4.2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(0, -0.5, 2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(1.2, -1.8, 0.8, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }
  function eyes(N) {
    const bg = fbm(11, 4, 4);
    const ch = paintRGB(N, (ctx) => {
      const img = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const v = 140 + 35 * bg(x / 256, y / 256);
          const o = (y * 256 + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
        }
      }
      // putImageData dönüşümü yok sayar; geçici tuvalden çiz.
      const t = document.createElement('canvas'); t.width = t.height = 256;
      t.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(t, 0, 0);
      // Dikkat dağıtıcı şekiller
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath(); ctx.arc(200, 30, 14, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(20, 120, 40, 22);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(150, 120); ctx.lineTo(240, 100); ctx.stroke();
      ctx.fillStyle = '#e6e6e6';
      ctx.beginPath(); ctx.ellipse(225, 230, 18, 9, 0.3, 0, 2 * Math.PI); ctx.fill();
      // Gözler: 1×, 2×, 4×
      drawEye(ctx, EYE.x, EYE.y + 1, 1);
      drawEye(ctx, 160, 62, 2);
      drawEye(ctx, 110, 196, 4);
    });
    return toGray(ch);
  }

  // ---------------------------------------------------------------- Sahne
  function scene(N) {
    const ch = paintRGB(N, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#8fa3b8'); g.addColorStop(1, '#2d3540');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath(); ctx.arc(190, 70, 34, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#1b1f24';
      ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(60, 120); ctx.lineTo(110, 175); ctx.lineTo(160, 110);
      ctx.lineTo(256, 210); ctx.lineTo(256, 256); ctx.lineTo(0, 256); ctx.fill();
      ctx.fillStyle = '#c9c9c9';
      ctx.fillRect(28, 190, 70, 46);
      ctx.fillStyle = '#5a5a5a';
      for (let i = 0; i < 4; i++) ctx.fillRect(34 + i * 16, 198, 9, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('CMP473', 120, 238);
      ctx.font = '9px sans-serif';
      ctx.fillText('Image Pyramids · Laplacian', 122, 250);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(14 + i * 4, 20); ctx.lineTo(14 + i * 4, 80); ctx.stroke();
      }
    });
    return toGray(ch);
  }

  // ---------------------------------------------------------------- Gürültülü sahne
  function noisyScene(N) {
    const a = scene(N);
    const rnd = rng(9);
    for (let i = 0; i < a.length; i++) {
      const g = (rnd() + rnd() + rnd() + rnd() - 2) * 1.73 * 18; // ~N(0, 18²)
      a[i] = Math.max(0, Math.min(255, a[i] + g));
    }
    return a;
  }

  // ---------------------------------------------------------------- Renkli: elma / portakal
  function backdrop(ctx, seed) {
    const n = fbm(seed, 4, 5);
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const o = (y * 256 + x) * 4;
        const v = n(x / 256, y / 256);
        const table = y > 212;
        if (table) {
          img.data[o] = 60 + 20 * v; img.data[o + 1] = 110 + 25 * v; img.data[o + 2] = 105 + 20 * v;
        } else {
          const sh = 1 - 0.35 * (y / 212);
          img.data[o] = (95 + 30 * v) * sh; img.data[o + 1] = (130 + 35 * v) * sh; img.data[o + 2] = (90 + 25 * v) * sh;
        }
        img.data[o + 3] = 255;
      }
    }
    const t = document.createElement('canvas'); t.width = t.height = 256;
    t.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(t, 0, 0);
    // Gölge
    const sg = ctx.createRadialGradient(140, 222, 4, 140, 222, 85);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(140, 222, 92, 16, 0, 0, 2 * Math.PI); ctx.fill();
  }

  function apple(N) {
    return paintRGB(N, (ctx) => {
      backdrop(ctx, 21);
      // İki loblu elma gövdesi
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(128, 70);
      ctx.bezierCurveTo(165, 50, 215, 70, 210, 140);
      ctx.bezierCurveTo(206, 190, 175, 222, 150, 218);
      ctx.bezierCurveTo(138, 216, 132, 210, 128, 210);
      ctx.bezierCurveTo(124, 210, 118, 216, 106, 218);
      ctx.bezierCurveTo(81, 222, 50, 190, 46, 140);
      ctx.bezierCurveTo(41, 70, 91, 50, 128, 70);
      ctx.closePath();
      const g = ctx.createRadialGradient(100, 105, 8, 128, 140, 105);
      g.addColorStop(0, '#e8483a'); g.addColorStop(0.55, '#b81f1a'); g.addColorStop(1, '#4e0806');
      ctx.fillStyle = g; ctx.fill();
      ctx.clip();
      // Hafif dikey çizgiler (elma dokusu)
      ctx.globalAlpha = 0.12; ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath(); ctx.moveTo(60 + i * 11, 80); ctx.quadraticCurveTo(128, 150, 60 + i * 11, 215); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Parlama
      const h = ctx.createRadialGradient(92, 100, 1, 92, 100, 22);
      h.addColorStop(0, 'rgba(255,255,255,0.95)'); h.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = h; ctx.beginPath(); ctx.ellipse(92, 100, 16, 22, -0.4, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
      // Sap
      ctx.strokeStyle = '#4a2e14'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(128, 76); ctx.quadraticCurveTo(126, 55, 134, 40); ctx.stroke();
    });
  }

  function orange(N) {
    const bump = fbm(31, 48, 2);
    const ch = paintRGB(N, (ctx) => {
      backdrop(ctx, 22);
      ctx.beginPath(); ctx.arc(128, 142, 80, 0, 2 * Math.PI);
      const g = ctx.createRadialGradient(108, 112, 6, 128, 142, 82);
      g.addColorStop(0, '#ffc95a'); g.addColorStop(0.5, '#f29a12'); g.addColorStop(0.85, '#c25f00'); g.addColorStop(1, '#6a3000');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = '#5a4a1a';
      ctx.beginPath(); ctx.arc(126, 64, 3, 0, 2 * Math.PI); ctx.fill();
    });
    // Kabuk gözenekleri: yalnızca portakalın içinde yüksek frekanslı doku
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const X = (x + 0.5) * 256 / N, Y = (y + 0.5) * 256 / N;
        const r = Math.hypot(X - 128, Y - 142);
        if (r < 79) {
          const b = bump(X / 256, Y / 256);
          const k = 1 + 0.22 * b;
          const i = y * N + x;
          for (let c = 0; c < 3; c++) ch[c][i] = Math.max(0, Math.min(255, ch[c][i] * k));
        }
      }
    }
    return ch;
  }

  const gray = [
    { id: 'zebra', name: 'Zebra benzeri desen', group: 'Piramit örnekleri',
      info: 'Slayt 18 ve 40–41’deki zebraya benzeyen sentetik desen: hem ince (çizgiler, kıl dokusu) hem kaba (baş, arka plan) yapı içerir.',
      gen: zebra },
    { id: 'eyes', name: 'Üç ölçekte göz', group: 'Piramit örnekleri',
      info: 'Aynı göz 1×, 2× ve 4× boyutta. Şablon eşleme bölümünde küçük göz şablonuyla piramidin her seviyesinde arama yapılır (slayt 10, 25–26).',
      gen: eyes, template: { x: EYE.x - EYE.w / 2, y: EYE.y - EYE.h / 2 - 2, w: EYE.w, h: EYE.h + 2 } },
    { id: 'scene', name: 'Sahne ve metin', group: 'Piramit örnekleri',
      info: 'Keskin kenarlar ve küçük metin: ince ayrıntılar Laplacian piramidinin ilk seviyelerinde toplanır.',
      gen: scene },
    { id: 'noisy', name: 'Gürültülü sahne', group: 'Piramit örnekleri',
      info: 'Gauss gürültüsü eklenmiş sahne. Gürültü çoğunlukla L₁’de (en ince seviye) toplanır; geri çatmada L₁’i kısarak gürültüyü azaltmayı deneyin (slayt 43).',
      gen: noisyScene },
  ];

  const color = [
    { id: 'apple', name: 'Elma', gen: apple },
    { id: 'orange', name: 'Portakal', gen: orange },
  ];

  // Gerçek fotoğraflar (img/ klasöründe, 512×512). Kaynak ve lisanslar sayfa altında.
  const photos = [
    { id: 'ph-apple', file: 'img/apple.jpg', name: 'Elma (fotoğraf)', credit: 'OpenCV örnek verisi',
      info: 'Burt & Adelson’un klasik harmanlama örneğindeki elma. Portakalla aynı konumda çekilmiştir.' },
    { id: 'ph-orange', file: 'img/orange.jpg', name: 'Portakal (fotoğraf)', credit: 'OpenCV örnek verisi',
      info: 'Klasik elma–portakal çiftinin portakalı: kabuktaki gözenekler ince ölçekli dokudur.' },
    { id: 'ph-camera', file: 'img/camera.jpg', name: 'Kameraman', credit: 'scikit-image, CC0',
      info: 'Görüntü işlemede klasik test görüntüsü: düz gökyüzü, ince tripod bacakları, çim dokusu.' },
    { id: 'ph-chelsea', file: 'img/chelsea.jpg', name: 'Kedi (Chelsea)', credit: 'scikit-image, CC0',
      info: 'Bıyıklar ve tüyler ince ölçekte, gözler ve kafa biçimi kaba ölçektedir.' },
    { id: 'ph-coffee', file: 'img/coffee.jpg', name: 'Kahve fincanı', credit: 'scikit-image, CC0',
      info: 'Elips biçimleri, pürüzsüz porselen ve kaba ahşap dokusu bir arada.' },
    { id: 'ph-astronaut', file: 'img/astronaut.jpg', name: 'Astronot', credit: 'NASA, kamu malı',
      info: 'Eileen Collins: yüz, bayrak çizgileri, kask ve arka plandaki mekik farklı ölçeklerde ayrıntı içerir.' },
    { id: 'ph-rocket', file: 'img/rocket.jpg', name: 'Roket fırlatma', credit: 'SpaceX, CC0',
      info: 'Gece fırlatma: karanlık arka plan üzerinde parlak, küçük ayrıntılar.' },
    { id: 'ph-coins', file: 'img/coins.jpg', name: 'Sikkeler', credit: 'kamu malı',
      info: 'Pompeii’den Yunan sikkeleri. Şablon eşleme için iyi: bir sikkeyi şablon olarak seçip benzerlerini arayın.' },
    { id: 'ph-hubble', file: 'img/hubble.jpg', name: 'Hubble Derin Alan', credit: 'NASA/ESA, kamu malı',
      info: 'Hubble eXtreme Deep Field: farklı boyutlarda galaksiler; çok ölçekli tespit için klasik örnek.' },
    { id: 'ph-starry', file: 'img/starry-night.jpg', name: 'Yıldızlı Gece (Van Gogh)', credit: 'kamu malı',
      info: 'Fırça darbeleri ince ölçekte, girdaplar ve servi ağacı kaba ölçekte.' },
    { id: 'ph-brick', file: 'img/brick.jpg', name: 'Tuğla duvar', credit: 'scikit-image, CC0',
      info: 'Düzenli doku: tuğla aralıkları belirli bir frekans bandında yoğunlaşır.' },
    { id: 'ph-grass', file: 'img/grass.jpg', name: 'Çim', credit: 'scikit-image, CC0',
      info: 'Yönlü, ince doku.' },
    { id: 'ph-gravel', file: 'img/gravel.jpg', name: 'Çakıl', credit: 'scikit-image, CC0',
      info: 'İzotropik doku: enerji her yönde benzer.' },
  ];

  return { gray, color, photos };
})();
