# Fourier Paint

Tarayıcıda çalışan, 2B Fourier dönüşümünü etkileşimli olarak keşfetmeye yarayan bir çizim uygulaması (CMP473 frekans alanında filtreleme konusu için).

- **Sol panel:** gri seviye görüntü `f(x, y)` (0–255). Üzerine çizdiğinizde 2B FFT anlık hesaplanır.
- **Sağ panel:** merkezlenmiş genlik spektrumu `log(1 + |F(u, v)|)`. Üzerine çizdiğinizde ters FFT anlık hesaplanıp solda gösterilir.

## Özellikler

- Her panel için ayrı kalem: kalınlık (1–64 px) ve gri renk (0–255)
- Kalem ya da **düz çizgi** aracı (Shift ile yatay/dikey/45°'ye kilitlenir)
- Tümü siyah / tümü beyaz doldurma
- Ayarlanabilir aralıkla yatay veya dikey çizgi deseni
- Hazır örnekler: dikdörtgen, daire, dürtü, sinüsler, dama tahtası, Gauss
- Kendi görüntünüzü yükleme (gri seviyeye çevrilir)
- Spektruma ideal / Gauss / Butterworth alçak veya yüksek geçiren filtre uygulama
- 128 / 256 / 512 çözünürlük, geri al / yinele (Ctrl+Z / Ctrl+Y), PNG indirme

## Spektruma çizim nasıl yorumlanır?

Spektrum panelinde gösterilen değer `g = 255 · log(1 + |F|) / L` biçimindedir. Varsayılan olarak `L = log(1 + N²·255)` sabittir; “Otomatik kontrast” açıkken `L` spektrumdaki en büyük değerdir.
Spektruma `g` değeriyle çizmek, o frekansın genliğini `|F| = e^(g·L/255) − 1` yapar:

- **Faz korunur.** Genliği sıfır olan bir noktaya çizilirse faz 0 alınır.
- **Simetri korunur.** `(u, v)` noktasına çizim yapıldığında `(−u, −v)` noktası da eşleniği olacak şekilde güncellenir, böylece ters dönüşüm gerçel bir görüntü verir.
- Ters dönüşümün sonucu 0–255 aralığı dışına çıkabilir. Sol panel bu değerleri kırparak gösterir. Tümünü görmek için “normalize et” seçeneğini açın.

## GitHub Pages'te yayınlama

Derleme adımı yoktur; uygulama yalnızca `index.html`, `style.css` ve `app.js` dosyalarından oluşur.

1. Depoda **Settings → Pages** sayfasına gidin.
2. **Source** olarak “Deploy from a branch” seçin, dalı (ör. `main`) ve `/ (root)` klasörünü seçip kaydedin.
3. Birkaç dakika içinde uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde yayında olur.

Yerelde denemek için `index.html` dosyasını tarayıcıda açmanız yeterlidir.
