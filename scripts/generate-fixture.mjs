/**
 * One-shot generator for the M1 Turkish fixture.
 * Run: node scripts/generate-fixture.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const paragraphs = [
  "Okumak bir hız yarışı değildir. Metin, üzerine eğilince iskeletini gösteren bir yapıdır. Tempo düşünce cümleler birbirine bağlanır; acele edince yalnızca yüzey kalır. Bu deneme, yavaş okumayı bir sav, bir yöntem ve bir etik olarak savunur.",
  "Yavaş okumak, her kelimeyi hecelemek değildir. Daha çok, bir cümlenin neden orada durduğunu sormaktır. Okur, yazarın seçimine tanık olur. Bu tanıklık, metni tüketmekten farklı bir iştir.",
  "Dikkat bir kaynak değil, bir mimaridir. Nereye bakacağımızı önceden kararlaştırırsak metin bize itaat eder gibi görünür. Oysa iyi bir deneme, bakışımızı bozar. Yavaşlık, bu bozulmaya yer açar.",
  "Bir metnin iskeleti iddialardan, gerekçelerden, olgulardan ve çekincelerden kurulur. Bunları ayırt etmeden yapılan özet, metni düzleştirir. Tablo, düzleştirmeye karşı bir alettir. Satırlar, pasajın içinden kanıt ister.",
  "Ana iddia, metnin omurgasıdır. Her paragraf bir şey ileri sürer; ileri sürmüyorsa süslemedir. Okur, iddiayı cümlenin içinden çekip çıkarmayı öğrenmelidir. Bu çıkarım, alıntıya yaslanmadan spekülasyon olur.",
  "Gerekçe, iddiayı ayakta tutan bağdır. Çünkü, zira, bundan ötürü gibi bağlaçlar gerekçenin kapısını aralar. Ama gerekçe her zaman bağlaçla gelmez. Bazen bir sahne, bazen bir karşılaştırma gerekçe işi görür.",
  "Olgu, doğrulanabilir bir tespittir. Yorum ile olguyu karıştırmak, tartışmayı zehirler. Yavaş okur, hangisinin tanık, hangisinin hüküm olduğunu ayırır. Bu ayrım, ahlaki bir nezakettir.",
  "Örnek, iddiayı görünür kılar ama onun yerine geçmez. Tek bir anekdot, evrensel sonuç taşıyamaz. Yine de örneksiz iddia havada kalır. Ölçü, örneğin temsil gücünü sormaktır.",
  "Tanım, tartışmanın zeminini çizer. Aynı kelimeyi farklı anlamda kullanan iki okur, birbirini çürüttüğünü sanır. Yavaş okuma, yazarın kelimeyi nasıl doldurduğunu izler. Tanım yoksa, tartışma kayganlaşır.",
  "İstisna, iddianın dürüstlüğüdür. Hiç çekincesi olmayan metin, çoğu zaman propaganda kokar. Çekince, zayıflık değil, düşüncenin nefes alma yeridir. Okur bunu sütun olarak ayırmayı öğrenince metin daha adil görünür.",
  "Açık soru, metnin bitmediğini hatırlatır. İyi deneme, her şeyi kapatmaz. Bir soruyu açık bırakmak, okuru işe ortak etmektir. Tablodaki boşluk, bazen en doğru kayıttır.",
  "Alıntı, başkasının cümlesine ev sahipliği etmektir. Kaynak göstermeden yapılan parafraz, düşünce hırsızlığına yaklaşır. Yavaş okur, tırnak içini ciddiye alır. Kanıt, sayfa numarasıyla değil, pasajın kendisiyle durur.",
  "İtiraz sütunu, metnin karşısına çıkan sesi kaydeder. Her iddia bir itirazı hak eder. Bu sütun kapalı gelebilir; çünkü her pasaj bir polemik değildir. Yine de itirazı tamamen silmek, okumayı yalıtmak olur.",
  "Tablo, edebiyatı muhasebeye çevirmek için değildir. Amaç, rahat bir okuma kabuğunun yanında tarama düzeni kurmaktır. Sol tarafta kaynak, sağ tarafta çıkarılan yapı durur. İkisi yalnızca seçilen satırla konuşur.",
  "Dijital hız, gözü satırın üstünde kaydırır. Kaydırma, okuma sanılır. Oysa kaydırma, metnin direncini yok eder. Yavaşlık, bu direnci geri çağırmanın yoludur.",
  "Göz gezdirmek ile taramak birbirine karışır. Göz gezdirmek yüzeyde kalır; tarama ise bir soruyla metne girer. Sorusu olmayan okur, her şeyi eşit parlaklıkta görür. Eşit parlaklık, hiçbir şeyin seçilmemesidir.",
  "Bellek, altı çizilen cümlelerle değil, bağlarla kurulur. Neden bu iddianın ardından şu çekince geliyor? Bu neden, hatırlanacak asıl şeydir. Tablo, bağı görünür kılar.",
  "Kenar notu, eski bir teknolojidir. Kalem, düşüncenin yavaşlamasını zorlar. Ekranda işaretlemek ise ucuzlaşır; her cümle sarıya boyanır. Boyanın fazlası, seçimi öldürür.",
  "Alıntı, kanıt olduğu kadar etik bir jesttir. Başkasının ritmini korumak, onu çarpıtmamaktır. Kesik alıntı, bağlamı çalar. Yavaş okur, başlangıç ve bitiş sınırını bilinçle çizer.",
  "Metin parçalara ayrılınca, her parça kendi içinde bir oda olur. Parça, sayfadan daha dürüst bir birimdir. Çünkü sav, çoğu zaman bir sayfanın ortasında doğar. Okuma kabuğu, parçayı kaybetmeden kaydırmalıdır.",
  "Sayfa numarası bir kolaylıktır, pasajın anlamı değildir. Kağıtta sayfa, ekranda kaydırma konumu vardır. Asıl adres, cümlenin kendisidir. Bu yüzden vurgu, parça içindeki aralıkta tutulur.",
  "Öğretmen, öğrenciden özet ister. Özet, çoğu zaman iddiayı siler, süsü bırakır. Yapı çıkarmak, özetten daha zor ve daha adildir. Öğrenci, cümleyi işaret edebilir hale gelmelidir.",
  "Çeviri, yavaş okumanın sert bir sınavıdır. Bir gerekçe, dil değişince bağlacını kaybedebilir. Tanım, kültürle birlikte kayar. Bu yüzden sütunlar, çeviride bile aynı isimlerle durur; içerik dil seçer.",
  "Türkçe deneme geleneği, uzun cümleyi ve çekinceyi sever. Bu, tablo için bir avantajdır. Çünkü çekince zaten metnin içindedir; onu icat etmeye gerek yoktur. Okurun işi, onu yerinden etmeden adlandırmaktır.",
  "Yapıyı çıkarmak, metni indirgeme riski taşır. Şiir, bazen satıra sığmaz. Mizah, gerekçe sütununda ölür. Bu istisna, aracın sınırıdır ve saklanmamalıdır.",
  "Her metin yavaş okunmaz. Tarif, uyarı, saatli bir haber, tempo ister. Deneme, felsefi makale, mahkeme gerekçesi ise yavaşlığa layıktır. Tür, yöntemi seçirir.",
  "Beden okumaya katılır. Sırt, ışık, satır uzunluğu, puntolar. Rahat bir kabuk, lüks değil, dikkat altyapısıdır. Kaynak metin dar bir sütunda, tablo ise taramaya uygun sıkılıkta durmalıdır.",
  "Sessizlik, yavaş okumanın odasıdır. Bildirim, cümlenin belini kırar. Kütüphane, bu yüzden hâlâ bir vaattir. Ekran başında bile, dikkat için bir oda kurulabilir.",
  "Kütüphane, rastgeleliğin mekânıdır. Raf, algoritmanın unutturduğu komşuluğu geri verir. Yavaş okur, yalnızca aradığını değil, yanına düşeni de alır. Bu tesadüf, tablonun dışında kalan bir nimettir.",
  "Ekran, parlaklığıyla metni düzler. Kâğıt, hatayı ve duraksamayı affeder. İkisi de araçtır; kutsal olan taşıyıcı değil, bakıştır. Yazılım, bakışı zorla kaydırmamalıdır.",
  "Vurgu bağımlılığı, her cümleyi işaret etmektir. Her şey önemliyse hiçbir şey önemli değildir. Seçilen satır, bir vaattir: burada dur, şurayı oku. Kaynak panelindeki ışıma, bu vaadin görünür halidir.",
  "Yapı çıkarmak bir zanaattır. Yazılım hüküm vermez; iskeleti taşır. Okur, hangi cümlenin iddia, hangisinin süs olduğuna karar verir. Karar, satırın içinde, alıntının sınırında verilir.",
  "Konforlu bir okuma kabuğu, gösterge panosu değildir. Grafik, rozet, sahte ilerleme çubuğu, dikkati yerinden eder. İhtiyaç duyulan şey, iki bağımsız kaydırma yüzeyi ve aralarında ince bir bağdır. Bağ, seçilen satırdır; piksel değildir.",
  "Kaynak solda, tablo sağda durunca zihin harita kurar. Dar ekranda üst üste yığılma, aynı işi başka bir eksende görür. Oran, okurun elinde kalmalıdır. Çünkü kimse başkasının satır genişliğiyle düşünmez.",
  "Bir satıra basınca kaynak, alıntının olduğu parçaya kayar ve aralığı ışır. Bu, sayfa tuvalini tablonun kaydırmasına kilitlemek değildir. Bağımsız yüzeyler, bağımsız ritimler taşır. Birlikte çalıştıkları tek an, seçim anıdır.",
  "Bu denemenin kendi iskeleti de aynı kurala uyar. Her parça bir iddia taşır, her iddia bir pasaja yaslanır. Çıkarılan satırlar, metni yerine geçmez; onu okunur kılar. Yavaşlık, burada bir nostalji değil, bir okuma sözleşmesidir.",
];

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

function fieldPack(sentence, index, paraIndex, paragraph) {
  const q = sentence.replace(/\s+/g, " ").trim();
  const cycle = (paraIndex + index) % 4;
  const claim = q;
  const warrant =
    cycle === 0
      ? "Cümle, denemenin omurgasına bağlanır; tempo düşünce bu bağ görünür."
      : cycle === 1
        ? "Yavaş okuma, bu cümleyi süs olmaktan çıkarıp yapı unsuru haline getirir."
        : cycle === 2
          ? "Çünkü iddia, gerekçe veya çekince ancak pasajın içinde kanıtlanabilir."
          : "Okur, cümleyi tablonun ilgili sütununa yerleştirerek metni düzleştirmez, ayırır.";
  const fact =
    cycle === 1 || cycle === 0
      ? `Bu cümle, denemenin ${paraIndex + 1}. parçasında geçer.`
      : "";
  const example =
    cycle === 2
      ? "Kaynak panelinde bu aralık ışır; tablo satırı aynı parçaya işaret eder."
      : cycle === 3
        ? "Öğrenci özet yapmak yerine bu cümleyi işaretleyebilir."
        : "";
  const definition =
    index === 0 && paraIndex % 5 === 0
      ? "Yavaş okuma: cümlenin neden orada durduğunu sormak."
      : "";
  const exception =
    cycle === 3
      ? "Her cümle bir ana iddia değildir; bazıları geçiş veya süs olarak kalır."
      : paraIndex === 24
        ? "Şiir ve mizah bu çıkarıma her zaman sığmaz."
        : "";
  const openQuestion =
    cycle === 2
      ? "Bu cümle iddia mıdır, yoksa bir önceki savı mı taşır?"
      : paraIndex === 10
        ? "Boş bırakılan sütun, metnin henüz kapanmadığını mı gösterir?"
        : "";
  const citation = q.length > 40 ? q.slice(0, 40) + "…" : q;
  const practicalSuggestion =
    cycle === 0
      ? `Cümleyi yavaşça yeniden oku: ${q.slice(0, 80)}`
      : cycle === 1
        ? "Bu pasajdaki bağı (iddia–gerekçe) tabloda ayırarak izle."
        : cycle === 2
          ? "Alıntı sınırını cümlenin başı ve sonu olarak işaretle."
          : "";
  const objection =
    paraIndex === 12 && index === 0
      ? "Tablo edebiyatı muhasebeye çeviriyor olabilir; bu itiraz sütuna yazılmalıdır."
      : null;

  // Keep most objections empty/null per schema; only a couple of rows carry text
  // so the OFF-by-default column still has something to show when enabled.
  return {
    claim,
    warrant,
    fact,
    example,
    definition,
    exception,
    openQuestion,
    citation,
    practicalSuggestion,
    objection,
    paragraph,
  };
}

const chunks = [];
const rows = [];
let offset = 0;
let rowN = 0;

paragraphs.forEach((text, i) => {
  const id = `c-${String(i + 1).padStart(3, "0")}`;
  const page = Math.floor(i / 3) + 1;
  chunks.push({
    id,
    text,
    page,
    start: offset,
    end: offset + text.length,
  });
  offset += text.length + 2;

  const sentences = splitSentences(text);
  sentences.forEach((sentence, si) => {
    const start = text.indexOf(sentence);
    if (start < 0) {
      throw new Error(`quote not in chunk ${id}: ${sentence}`);
    }
    const end = start + sentence.length;
    rowN += 1;
    const pack = fieldPack(sentence, si, i, text);
    rows.push({
      id: `r-${String(rowN).padStart(3, "0")}`,
      chunkId: id,
      quoteAnchor: {
        chunkId: id,
        start,
        end,
        page,
        bbox: null,
      },
      claim: pack.claim,
      warrant: pack.warrant,
      fact: pack.fact,
      example: pack.example,
      definition: pack.definition,
      exception: pack.exception,
      openQuestion: pack.openQuestion,
      citation: pack.citation,
      practicalSuggestion: pack.practicalSuggestion,
      objection: pack.objection,
    });
  });
});

if (rows.length < 80 || rows.length > 150) {
  throw new Error(`row count ${rows.length} outside 80–150`);
}

for (const row of rows) {
  const chunk = chunks.find((c) => c.id === row.chunkId);
  if (!chunk) throw new Error(`missing chunk ${row.chunkId}`);
  const { start, end } = row.quoteAnchor;
  if (start < 0 || end > chunk.text.length || start >= end) {
    throw new Error(`bad anchor ${row.id}`);
  }
  if (row.quoteAnchor.chunkId !== row.chunkId) {
    throw new Error(`anchor chunk mismatch ${row.id}`);
  }
}

const document = {
  id: "7c2e1a90-4b3d-4f8e-9c1a-2d6f8b4e0a11",
  title: "Yavaş Okumanın Savunusu",
  sourceType: "md",
  tableLocale: "tr",
  chunks,
  rows,
};

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../src/fixtures/essay.json");
writeFileSync(out, JSON.stringify(document, null, 2) + "\n");
console.log(`wrote ${chunks.length} chunks, ${rows.length} rows → ${out}`);
