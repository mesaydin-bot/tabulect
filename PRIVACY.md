# Privacy / Gizlilik

## English

- Tabulect runs on your computer. There is no Tabulect account, server, analytics or telemetry.
- Your data (documents you open, bookmarks, notes, templates and exports; by default under `~/.local/share/tabulect` and your chosen save folder) stays in local files on your computer.
- AI features send the text you choose (for example a selection, an article or a draft) to the AI provider whose CLI you selected, under your own subscription and that provider's terms and privacy policy. Nothing is sent to any AI provider unless you run an AI action.
- Tabulect never stores AI passwords, tokens or API keys; each provider's official CLI keeps its own login.
- Tabulect makes no network requests of its own; document extraction and OCR run locally.
- The local HTTP interface (if any) listens only on 127.0.0.1, checks the Host and Origin headers and requires a random per-launch token, so web pages you visit cannot use it.

## Türkçe

- Tabulect bilgisayarınızda çalışır. Tabulect hesabı, sunucusu, analitiği veya telemetrisi yoktur.
- Verileriniz (açtığınız belgeler, yer imleri, notlar, şablonlar ve dışa aktarımlar; varsayılan olarak `~/.local/share/tabulect` ve seçtiğiniz kayıt klasörü) bilgisayarınızdaki yerel dosyalarda kalır.
- AI özellikleri seçtiğiniz metni (ör. seçim, makale veya taslak) yalnızca sizin seçtiğiniz sağlayıcının CLI'sine, kendi aboneliğinizle ve o sağlayıcının koşullarıyla gönderir. Bir AI işlemi başlatmadıkça hiçbir şey gönderilmez.
- Tabulect AI parolası, token veya API anahtarı saklamaz; giriş her sağlayıcının resmî CLI'sinde kalır.
- Tabulect kendi başına ağ isteği yapmaz; metin çıkarma ve OCR yereldir.
- Yerel HTTP arayüzü yalnızca 127.0.0.1 üzerinde dinler, Host ve Origin başlıklarını denetler ve her açılışta üretilen rastgele bir token ister; ziyaret ettiğiniz web sayfaları onu kullanamaz.
