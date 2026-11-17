# Fourier Paint

Tarayıcıda çalışan, 2B Fourier dönüşümünü etkileşimli olarak keşfetmeye yarayan bir çizim uygulaması (CMP473 frekans alanında filtreleme konusu için).

- **Sol panel:** gri seviye görüntü `f(x, y)` (0–255). Üzerine çizdiğinizde 2B FFT anlık hesaplanır.
- **Sağ panel:** merkezlenmiş genlik spektrumu `log(1 + |F(u, v)|)`. Üzerine çizdiğinizde ters FFT anlık hesaplanıp solda gösterilir.

## Özellikler

- Her panel için ayrı kalem: kalınlık (1–64 px) ve gri renk (0–255)
- Kalem ya da **düz çizgi** aracı (Shift ile yatay/dikey/45°'ye kilitlenir)
- Tümü siyah / tümü beyaz doldurma
- Ayarlanabilir aralıkla yatay veya dikey çizgi deseni
- Ders slaytlarındaki örneklere benzer 46 sentetik örnek içeren küçük resimli galeri:
  - **Temel şekiller:** dikdörtgen, kare, daire, halka, döndürülmüş dikdörtgen, üçgen, Gauss, dürtü, çizgiler
  - **Sinüsler:** Kx/Ky düzlem dalgaları, farklı frekanslar, frekansı değişen sinüs, döndürülmüş ve toplanmış sinüsler
  - **Periyodik desenler:** kare dalga ve harmonikleri, dama tahtası, ızgara, bölge plakası, tuğla duvar, metin
  - **Doku ve gürültü:** beyaz/bulanık gürültü, çakıl, ağaç kabuğu, uydu görüntüsü
  - **Test görüntüleri:** ideal alçak geçiren filtre test deseni, Shepp–Logan fantomu (MRI benzeri), periyodik gürültülü fantom, sütunlu bina
- Sağ panel için 23 spektrum örneği (küçük resimler spektrumu gösterir): nokta çiftleri, harmonikler, disk (ideal alçak geçiren), kare, Gauss, halka, bant, çizgiler, rastgele fazlı 1/f ve 1/f² gürültü
- Kendi görüntünüzü yükleme (gri seviyeye çevrilir)
- Spektruma ideal / Gauss / Butterworth alçak veya yüksek geçiren filtre ve k-uzayı maskeleri (kare, yatay/dikey bant, halka) uygulama
- 128 / 256 / 512 çözünürlük, geri al / yinele (Ctrl+Z / Ctrl+Y), PNG indirme

## Spektruma çizim nasıl yorumlanır?

Spektrum panelinde gösterilen değer `g = 255 · log(1 + |F|) / L` biçimindedir. Varsayılan olarak `L = log(1 + N²·255)` sabittir; “Otomatik kontrast” açıkken `L` spektrumdaki en büyük değerdir.
Spektruma `g` değeriyle çizmek, o frekansın genliğini `|F| = e^(g·L/255) − 1` yapar:

- **Faz korunur.** Genliği sıfır olan bir noktaya çizilirse faz 0 alınır.
- **Simetri korunur.** `(u, v)` noktasına çizim yapıldığında `(−u, −v)` noktası da eşleniği olacak şekilde güncellenir, böylece ters dönüşüm gerçel bir görüntü verir.
- Ters dönüşümün sonucu 0–255 aralığı dışına çıkabilir. Sol panel bu değerleri kırparak gösterir. Tümünü görmek için “normalize et” seçeneğini açın.

## Laplacian Piramidi sayfası (`pyramid/`)

1. **Aşağı inme:** görüntü seviye seviye bulanıklaştırılıp yarıya küçültülür. Her seviyede Gauss görüntüsü, bir küçüğünün büyütülmüş hâli ve aradaki fark (Laplacian) yan yana görünür. Ne kadar aşağı inileceği üstteki “En küçük seviye” ayarıyla seçilir (1×1'e kadar).
2. **Geri inşa:** en küçük seviyeden başlayıp adım adım büyütülür ve saklanan ayrıntı eklenir. Sonunda orijinalle karşılaştırılır (birebir aynı).
3. **Görüntü harmanlama:** elma/portakal ve diğer hazır fotoğraflar, görsel yükleme ve sürükle-bırak, fırçayla maske çizme, doğrudan kesme / tek Gauss / Laplacian karşılaştırması, sonucu PNG indirme.

Hazır fotoğraflar `pyramid/img/` klasöründedir (OpenCV ve scikit-image örnek verileri, NASA, Van Gogh; CC0 ya da kamu malı).

## GitHub Pages'te yayınlama

Derleme adımı yoktur; uygulama statik dosyalardan oluşur (`index.html`, `style.css`, `app.js`, `examples.js` ve `pyramid/` klasörü).

1. Depoda **Settings → Pages** sayfasına gidin.
2. **Source** olarak “Deploy from a branch” seçin, dalı (ör. `main`) ve `/ (root)` klasörünü seçip kaydedin.
3. Birkaç dakika içinde uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde yayında olur.

Yerelde denemek için `index.html` dosyasını tarayıcıda açmanız yeterlidir. Piramit sayfasındaki fotoğrafların piksellerine erişebilmek için ise sayfayı bir web sunucusundan açın (ör. depo klasöründe `python3 -m http.server`, sonra `http://localhost:8000/pyramid/`).
