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

CMP473 Hafta 8 “Image Pyramids” slaytlarıyla eş zamanlı ilerleyen ikinci sayfa. Her bölümün başında ilgili slayt numaraları yazar:

1. **Şablon eşleme** (slayt 3–10, 25–26): SSD ve NCC; sabit boyutlu şablonla piramidin her seviyesinde arama, farklı boyuttaki gözleri bulma
2. **Örnekleme** (slayt 14): Gauss ile süzüp seyreltme ve süzmeden seyreltmenin yol açtığı örtüşme
3. **Gauss piramidi** (slayt 13–18): REDUCE, 1B düğüm diyagramı, seviyeler aynı boyutta ve gerçek boyutta
4. **Matris gösterimi** (slayt 19–25): `G₁`, `G₂`, `G₂G₁` matrisleri, eşdeğer ağırlık fonksiyonları, 1B piramit matrisi
5. **Laplacian piramidi adım adım** (slayt 27–35): `x₁ → G₁x₁ → F₁G₁x₁ → L₁ = (I − F₁G₁)x₁ …` animasyonu
6. **Yukarı örnekleme** (slayt 36): araya sıfır ekleme ve süzme, `F₃` matrisi
7. **Frekans bantları** (slayt 37, 40–42): seviyeler tam çözünürlükte, her seviyenin Fourier spektrumu ve radyal genlik grafiği
8. **Geri dönüşüm** (slayt 38–39): `x_k = L_k + F_k x_{k+1}` adım adım; hata ölçümü (mükemmel geri çatma)
9. **Uygulamalar** (slayt 43): seviye kazançları, gürültü giderme, keskinleştirme, nicemleme ile sıkıştırma
10. **Görüntü harmanlama** (slayt 44–47): gerçek elma/portakal fotoğrafları ve hazır çiftler; A, B ve maske için görsel yükleme ya da sürükle-bırak; fırçayla maske çizme; B'yi ölçekleme/kaydırma; doğrudan kesme, tek Gauss ile yumuşatma ve Laplacian harmanlama karşılaştırması; seviye seviye katkılar; sonucu PNG indirme

Hazır fotoğraflar (`pyramid/img/`, 512×512): elma ve portakal (OpenCV örnek verisi), kameraman, kedi, kahve, tuğla, çim, çakıl (scikit-image, CC0), astronot, Hubble Derin Alan, sikkeler (kamu malı), roket (SpaceX, CC0), Yıldızlı Gece (Van Gogh, kamu malı). Ana görüntü listesinde gri seviyeye çevrilerek de kullanılabilirler.

Ortak ayarlar: görüntü seçimi ya da yükleme, 256/512 boyut, seviye sayısı K, Burt–Adelson çekirdek parametresi `a` (0.375 → [1 4 6 4 1]/16), Laplacian kontrastı. Giriş görüntüsüne çizim yapılabilir; tüm bölümler anında güncellenir.

## GitHub Pages'te yayınlama

Derleme adımı yoktur; uygulama statik dosyalardan oluşur (`index.html`, `style.css`, `app.js`, `examples.js` ve `pyramid/` klasörü).

1. Depoda **Settings → Pages** sayfasına gidin.
2. **Source** olarak “Deploy from a branch” seçin, dalı (ör. `main`) ve `/ (root)` klasörünü seçip kaydedin.
3. Birkaç dakika içinde uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde yayında olur.

Yerelde denemek için `index.html` dosyasını tarayıcıda açmanız yeterlidir. Piramit sayfasındaki fotoğrafların piksellerine erişebilmek için ise sayfayı bir web sunucusundan açın (ör. depo klasöründe `python3 -m http.server`, sonra `http://localhost:8000/pyramid/`).
