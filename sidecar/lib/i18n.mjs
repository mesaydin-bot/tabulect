// Sidecar progress and error messages, Turkish and English.
// English is the default; the request's interface language (X-Tabulect-Lang header or ?lang=)
// selects Turkish for that request and for the background jobs it starts.
import { AsyncLocalStorage } from "node:async_hooks";

const STRINGS = {
  operationFailed: ["İşlem başarısız", "Operation failed"],
  partialTableKeptContinuing: ["kısmi tablo korundu, devam", "partial table kept, continuing"],
  cliReturnedNothing: ["CLI boş döndü", "CLI returned nothing"],
  done: ["Tamamlandı", "Done"],
  n0AgentsWorking: ["{0} ajan · çalışıyor", "{0} agents · working"],
  n01Chunks: ["{0}/{1} parça", "{0}/{1} chunks"],
  n0ChunksReadyToRead: ["{0} parça — okumaya hazır", "{0} chunks — ready to read"],
  n0Chunks: ["{0} parça", "{0} chunks"],
  first01ChunksTabulectMax: ["İlk {0}/{1} parça (TABULECT_MAX_CHUNKS)", "First {0}/{1} chunks (TABULECT_MAX_CHUNKS)"],
  splittingIntoChunks: ["Parçalara ayrılıyor", "Splitting into chunks"],
  textLayerIsSufficientOcrSkipped: ["Metin katmanı yeterli, OCR atlandı", "Text layer is sufficient, OCR skipped"],
  extracting0Text: ["{0} metni çıkarılıyor", "Extracting {0} text"],
  queued: ["Kuyruğa alındı / queued", "Queued"],
  document0WasNotFoundIn: ["Belge {0} kitaplıkta bulunamadı.", "Document {0} was not found in the library."],
  theInstructionIsEmpty: ["Yönerge boş.", "The instruction is empty."],
  instructionSentToThe0Cli: ["Yönerge {0} CLI'ye gönderildi", "Instruction sent to the {0} CLI"],
  instructionFailed: ["Yönerge başarısız", "Instruction failed"],
  instructionCompleted: ["Yönerge tamamlandı", "Instruction completed"],
  theCliReturnedNoTableChange: ["CLI tablo değişikliği döndürmedi.", "The CLI returned no table change."],
  instructionQueuedForTheCli: ["Yönerge CLI kuyruğunda / instruction queued for CLI", "Instruction queued for the CLI"],
  instructionQueued: ["Yönerge kuyruğa alındı / instruction queued", "Instruction queued"],
  theCliDidNotReturnA: ["CLI geçerli bir tablo güncellemesi döndürmedi.", "The CLI did not return a valid table update."],
  theCliDidNotReturnA2: ["CLI geçerli bir tablo güncellemesi döndürmedi. {0}", "The CLI did not return a valid table update. {0}"],
  filling0FromSourceChunks: ["{0} kaynak parçalardan dolduruluyor", "Filling {0} from source chunks"],
  column0Added: ["{0} sütunu eklendi", "Column {0} added"],
  column0Shown: ["{0} sütunu gösterildi", "Column {0} shown"],
  column0Hidden: ["{0} sütunu gizlendi", "Column {0} hidden"],
  untitledNote: ["Adsız not", "Untitled note"],
  phrasePreparationIsBusyTryAgain: ["Öbek hazırlama meşgul; biraz sonra tekrar deneyin.", "Phrase preparation is busy; try again shortly."],
  invalidModel: ["Geçersiz model.", "Invalid model."],
  chooseAValidAiProvider: ["Geçerli bir AI sağlayıcısı seçin.", "Choose a valid AI provider."],
  thePassageMustBe116000: ["Pasaj 1–16000 karakter olmalı.", "The passage must be 1–16000 characters."],
  thePhraseResponseDoesNotCover: ["Öbek yanıtı metnin tamamını kapsamıyor.", "The phrase response does not cover the whole text."],
  aPhraseBoundarySplitsAWord: ["Öbek sınırı kelimeyi bölüyor.", "A phrase boundary splits a word."],
  aPhraseDoesNotMatchThe: ["Öbek kaynak metinle eşleşmiyor.", "A phrase does not match the source text."],
  anEmptyPhraseWasReturned: ["Boş öbek döndürüldü.", "An empty phrase was returned."],
  invalidPhraseResponseExpectedAPhrases: ["Öbek yanıtı geçersiz: phrases dizisi bekleniyor.", "Invalid phrase response: expected a phrases array."],
  theConversationCouldNotBeContinued: ["Sohbet sürdürülemedi; yeni sohbet açılmadı. {0}", "The conversation could not be continued; no new conversation was started. {0}"],
  theAiConnectionWasClosed: ["AI bağlantısı kapatıldı.", "The AI connection was closed."],
  theAiReplyTimedOut0: ["AI yanıtı zaman aşımına uğradı ({0}).", "The AI reply timed out ({0})."],
  theAiConnectionIsClosed: ["AI bağlantısı kapalı.", "The AI connection is closed."],
  theAiCliSentAnInvalid: ["AI CLI geçersiz protokol yanıtı gönderdi.", "The AI CLI sent an invalid protocol reply."],
  theAiProtocolReplyExceededThe: ["AI protokol yanıtı boyut sınırını aştı.", "The AI protocol reply exceeded the size limit."],
  theAiConnectionClosed01: ["AI bağlantısı kapandı ({0}). {1}", "The AI connection closed ({0}). {1}"],
  aNewConversationCannotBeOpened: ["Yanıt sürerken yeni sohbet açılamaz. Yanıt tamamlanınca tekrar deneyin.", "A new conversation cannot be opened while a reply is running. Try again when the reply is done."],
  theAiReturnedAnEmptyReply: ["AI boş yanıt döndürdü.", "The AI returned an empty reply."],
  theAntigravityReplyDidNotComplete: ["Antigravity yanıtı tamamlanmadı ({0}).", "The Antigravity reply did not complete ({0})."],
  theCodexReplyDidNotComplete: ["Codex yanıtı tamamlanmadı ({0}).", "The Codex reply did not complete ({0})."],
  theKimiReplyDidNotComplete: ["Kimi yanıtı tamamlanmadı ({0}).", "The Kimi reply did not complete ({0})."],
  theAiConnectionIsClosedThe: ["AI bağlantısı kapalı. Sohbet kimliği korundu.", "The AI connection is closed. The conversation id was kept."],
  theCliOpenedADifferentConversation: ["CLI farklı bir sohbet açtı; işlem durduruldu.", "The CLI opened a different conversation; the operation was stopped."],
  theCliDidNotReportA: ["CLI sohbet kimliğini bildirmedi. Yeni istek gönderilmedi.", "The CLI did not report a conversation id. No new request was sent."],
  tabulectDoesNotSupportThisTool: ["Tabulect bu araç isteğini desteklemiyor.", "Tabulect does not support this tool request."],
  theAiReplyTimedOutThe: ["AI yanıtı zaman aşımına uğradı. Sohbet korundu.", "The AI reply timed out. The conversation was kept."],
  thePhrasePreparationRecordWasNot: ["Öbek hazırlama kaydı bulunamadı; tekrar deneyin.", "The phrase preparation record was not found; try again."],
  theAiConnectionCouldNotBeEstablished: ["AI bağlantısı kurulamadı. {0}", "The AI connection could not be established. {0}"],
  // @generated-keys
};

const store = new AsyncLocalStorage();

export const normalizeLang = (value) => (String(value || "").toLowerCase().startsWith("tr") ? "tr" : "en");

/** Run `fn` with the given interface language for every message built inside it. */
export function withLang(lang, fn) {
  return store.run(normalizeLang(lang), fn);
}

export function currentLang() {
  return store.getStore() || "en";
}

/** Look up a message; `{0}`, `{1}`… are replaced by the extra arguments in a single pass. */
export function t(key, ...args) {
  const pair = STRINGS[key];
  if (!pair) throw new Error(`Missing sidecar string: ${key}`);
  const text = pair[currentLang() === "tr" ? 0 : 1];
  return args.length
    ? text.replace(/\{(\d+)\}/g, (match, index) => (Number(index) < args.length ? String(args[Number(index)]) : match))
    : text;
}

export const sidecarStrings = () => STRINGS;
