import type { TableLocale } from "../types/document";
import type { ProviderId } from "../api/client";

export const COLUMN_LABELS: Record<TableLocale, Record<string, string>> = {
  tr: {
    rowNumber: "#",
    page: "Sayfa",
    claim: "Ana iddia",
    warrant: "Gerekçe",
    fact: "Olgu",
    example: "Örnek",
    definition: "Tanım",
    exception: "İstisna / çekince",
    openQuestion: "Açık soru",
    citation: "Alıntı / kaynak",
    practicalSuggestion: "Pratik öneriler",
    objection: "İtiraz",
  },
  en: {
    rowNumber: "#",
    page: "Page",
    claim: "Claim",
    warrant: "Warrant",
    fact: "Fact",
    example: "Example",
    definition: "Definition",
    exception: "Exception / caveat",
    openQuestion: "Open question",
    citation: "Citation",
    practicalSuggestion: "Practical tips",
    objection: "Objection",
  },
};

export function columnHeaderLabel(locale: TableLocale | null | undefined, key: string): string {
  const pack = COLUMN_LABELS[locale === "en" ? "en" : "tr"];
  return Object.prototype.hasOwnProperty.call(pack, key) ? pack[key] : "";
}

export const PROVIDER_LABELS: Record<TableLocale, Record<ProviderId, string>> = {
  tr: {
    codex: "Codex / ChatGPT",
    kimi: "Kimi",
    antigravity: "Antigravity",
    cursor: "Cursor CLI",
    claude: "Claude Code",
  },
  en: {
    codex: "Codex / ChatGPT",
    kimi: "Kimi",
    antigravity: "Antigravity",
    cursor: "Cursor CLI",
    claude: "Claude Code",
  },
};

export type ChromeKey =
  | "fixtureBadge"
  | "backendOffline"
  | "themeToggle"
  | "noChunks"
  | "sourceLabel"
  | "outputLabel"
  | "page"
  | "splitterAria"
  | "openFile"
  | "dropActive"
  | "providerLabel"
  | "modelLabel"
  | "modelPlaceholder"
  | "modelDefault"
  | "ingestIdle"
  | "ingestError"
  | "unsupportedFile"
  | "backendNeeded"
  | "reloadFixture"
  | "openFormats"
  | "instructLabel"
  | "instructPlaceholder"
  | "searchPlaceholder"
  | "instructApply"
  | "instructPending"
  | "tableAi"
  | "tableAiPending"
  | "tableAiWarnTitle"
  | "tableAiWarnBody"
  | "tableAiWarnYes"
  | "tableAiWarnNo"
  | "templates"
  | "templateNone"
  | "templateAdd"
  | "templateName"
  | "templateBody"
  | "templateSave"
  | "templateDelete"
  | "stepLabel"
  | "stepParagraph"
  | "library"
  | "libraryOpen"
  | "libraryClose"
  | "libraryEmpty"
  | "libraryLoading"
  | "libraryError"
  | "libraryDelete"
  | "libraryDeleteConfirm"
  | "libraryDeleteYes"
  | "libraryDeleteNo"
  | "libraryRename"
  | "libraryRenameSave"
  | "libraryRenameCancel"
  | "libraryChunks"
  | "libraryBookmarks"
  | "libraryUpdated"
  | "libraryCurrent"
  | "libraryDemo"
  | "libraryTabDocs"
  | "libraryTabBookmarks"
  | "folderUnfiled"
  | "folderAll"
  | "folderNew"
  | "folderName"
  | "folderCreate"
  | "folderRename"
  | "folderDelete"
  | "folderDeleteConfirm"
  | "folderMove"
  | "sourceAdd"
  | "sourceScopeOpen"
  | "sourceScopeExtra"
  | "bookmarkSearch"
  | "bookmarkEmpty"
  | "bookmarkDelete"
  | "bookmarkJump"
  | "bookmarkUp"
  | "bookmarkDown"
  | "outputEmpty"
  | "outputLoading"
  | "outputError"
  | "outputEdit"
  | "outputPreview"
  | "outputHtml"
  | "outputSave"
  | "outputExport"
  | "outputNewChat"
  | "outputMode"
  | "outputAppend"
  | "outputNew"
  | "outputAppending"
  | "outputSaved"
  | "appearance"
  | "themeLabel"
  | "colorInk"
  | "colorPaper"
  | "colorMark"
  | "lineHeight"
  | "paragraphGap"
  | "fontFamily"
  | "fontSystem"
  | "fontSerif"
  | "fontSans"
  | "fontMono"
  | "fontSize"
  | "paneSource"
  | "paneOutput"
  | "paneBoth"
  | "searchHits"
  | "exportDir"
  | "notes"
  | "notesOpen"
  | "notesClose"
  | "notesEmpty"
  | "notesLoading"
  | "notesNew"
  | "notesFolders"
  | "notesOutline"
  | "notesEditor"
  | "notesEditorHint"
  | "notesAutosave"
  | "notesSaving"
  | "notesSaved"
  | "notesSaveError"
  | "notesDeleteConfirm"
  | "notesNoOutline"
  | "notesExport"
  | "notesSearch"
  | "notesUntitled"
  | "uiLanguage"
  | "tableAiShortcut"
  | "templateReset"
  | "templateResetHint"
  | "tableLanguage"
  | "subscriptions"
  | "subscriptionsTitle"
  | "subscriptionsIntro"
  | "subConnected"
  | "subLoginRequired"
  | "subApiKey"
  | "subUnknown"
  | "subMissing"
  | "subSignIn"
  | "subRecheck"
  | "subInstall"
  | "subDocs"
  | "subOpened"
  | "subRunYourself"
  | "subChecking";

export const CHROME: Record<TableLocale, Record<ChromeKey, string>> = {
  tr: {
    fixtureBadge: "örnek metin",
    backendOffline: "backend kapalı",
    themeToggle: "Tema",
    noChunks: "Kaynak henüz yok. PDF, EPUB, HTML, MD veya DOCX bırakın.",
    sourceLabel: "Kaynak",
    outputLabel: "Çıktı",
    page: "Sayfa",
    splitterAria: "Bölme oranını ayarla",
    openFile: "Belge aç",
    dropActive: "Bırakın — yerel olarak okunacak",
    providerLabel: "Sağlayıcı",
    modelLabel: "Model",
    modelPlaceholder: "model kimliği",
    modelDefault: "CLI varsayılanı",
    ingestIdle: "Yerel çıkarım · seçimle Tabulect",
    ingestError: "İşlem başarısız",
    unsupportedFile: "Desteklenmeyen dosya. PDF, EPUB, HTML, MD veya DOCX kullanın.",
    backendNeeded: "Yüklemek için yerel backend açık olmalı (127.0.0.1:8755).",
    reloadFixture: "Örnek metne dön",
    openFormats: "PDF, EPUB, HTML, MD, DOCX — tıklayın veya bırakın",
    instructLabel: "Yönerge",
    instructPlaceholder: "/ ile yönerge, yoksa kaynakta ara",
    searchPlaceholder: "Kaynakta ara",
    instructApply: "Uygula",
    instructPending: "Uygulanıyor",
    tableAi: "Tabulect",
    tableAiPending: "CLI çalışıyor",
    tableAiWarnTitle: "Tüm yer imleri gönderilecek",
    tableAiWarnBody:
      "Seçim yok. Bu belgedeki bütün yer imleri seçili şablonla CLI’ye gidecek. Metin uzunsa kota ve süre artar. Devam edilsin mi?",
    tableAiWarnYes: "Gönder",
    tableAiWarnNo: "Vazgeç",
    templates: "Şablonlar",
    templateNone: "Özgür",
    templateAdd: "Şablon ekle",
    templateName: "Ad",
    templateBody: "Metin",
    templateSave: "Kaydet",
    templateDelete: "Sil",
    stepLabel: "Adım",
    stepParagraph: "Paragraf",
    library: "Kitaplık",
    libraryOpen: "Kitaplığı aç",
    libraryClose: "Kapat",
    libraryEmpty: "Kayıtlı belge yok. Yeni bir dosya açın.",
    libraryLoading: "Kitaplık yükleniyor",
    libraryError: "Kitaplık okunamadı",
    libraryDelete: "Sil",
    libraryDeleteConfirm: "Bu belge kitaplıktan ve diskten silinecek. Emin misiniz?",
    libraryDeleteYes: "Sil",
    libraryDeleteNo: "Vazgeç",
    libraryRename: "Yeniden adlandır",
    libraryRenameSave: "Kaydet",
    libraryRenameCancel: "Vazgeç",
    libraryChunks: "parça",
    libraryBookmarks: "yer imi",
    libraryUpdated: "Güncellendi",
    libraryCurrent: "açık",
    libraryDemo: "Örnek metni göster",
    libraryTabDocs: "Belgeler",
    libraryTabBookmarks: "Yer imleri",
    folderUnfiled: "Klasörsüz",
    folderAll: "Tümü",
    folderNew: "Klasör",
    folderName: "Klasör adı",
    folderCreate: "Oluştur",
    folderRename: "Klasörü adlandır",
    folderDelete: "Klasörü sil",
    folderDeleteConfirm: "Klasör silinecek; belgeler klasörsüz kalır.",
    folderMove: "Klasöre taşı",
    sourceAdd: "Kaynak ekle",
    sourceScopeOpen: "Kapsam: açık belge",
    sourceScopeExtra: "Kapsam: açık belge +",
    bookmarkSearch: "Yer imlerinde ara",
    bookmarkEmpty: "Bu belgede yer imi yok. Sarı seçimi Enter ile kaydedin.",
    bookmarkDelete: "Sil",
    bookmarkJump: "Atla",
    bookmarkUp: "Yukarı",
    bookmarkDown: "Aşağı",
    outputEmpty:
      "Sağ panel CLI çıktısı içindir. Bir pasaj seçip Tabulect deyin, veya yer imlerini gönderin. Çıktıyı Markdown, HTML, PDF, DOCX veya Excel olarak dışa aktarın.",
    outputLoading: "Sağlayıcı yazıyor…",
    outputError: "Çıktı alınamadı",
    outputEdit: "Kaynak",
    outputPreview: "Önizleme",
    outputHtml: "HTML",
    outputSave: "Kaydet",
    outputExport: "Dışa aktar",
    outputNewChat: "Yeni sohbet",
    outputMode: "Çıktı yerleşimi",
    outputAppend: "Ekle",
    outputNew: "Yeni",
    outputAppending: "Yeni yanıt ekleniyor…",
    outputSaved: "Kaydedildi",
    appearance: "Görünüm",
    themeLabel: "Tema",
    colorInk: "Metin rengi",
    colorPaper: "Zemin",
    colorMark: "Vurgu",
    lineHeight: "Satır aralığı",
    paragraphGap: "Paragraf aralığı",
    fontFamily: "Yazı tipi",
    fontSystem: "Sistem",
    fontSerif: "Serif",
    fontSans: "Sans",
    fontMono: "Mono",
    fontSize: "Punto",
    paneSource: "Kaynak",
    paneOutput: "Çıktı",
    paneBoth: "İkisi",
    searchHits: "eşleşme",
    exportDir: "Kayıt klasörü",
    notes: "Notlar",
    notesOpen: "Notları aç",
    notesClose: "Kapat",
    notesEmpty: "Henüz not yok. Yeni not ile başlayın.",
    notesLoading: "Notlar yükleniyor",
    notesNew: "Yeni not",
    notesFolders: "Not klasörleri",
    notesOutline: "Anahat",
    notesEditor: "Düzenle",
    notesEditorHint: "Markdown yazın. Başlıklar (#) anahatta görünür; kayıt otomatiktir.",
    notesAutosave: "Otomatik kayıt",
    notesSaving: "Kaydediliyor…",
    notesSaved: "Kaydedildi",
    notesSaveError: "Kayıt başarısız",
    notesDeleteConfirm: "Bu not silinecek. Emin misiniz?",
    notesNoOutline: "Başlık yok. Satır başına # ekleyin.",
    notesExport: "Dışa aktar",
    notesSearch: "Notlarda ara",
    notesUntitled: "Adsız not",
    uiLanguage: "Arayüz dili",
    templateReset: "Varsayılana dön",
    templateResetHint: "Düzenlenmiş yerleşik şablonu varsayılan metne döndür",
    tableAiShortcut: "Tabulect: seçimi veya yer imlerini seçili AI CLI ile tabloya dönüştür (kısayol: T)",
    tableLanguage: "Tablo dili",
    subscriptions: "Abonelikler",
    subscriptionsTitle: "Abonelikler — kendi AI hesabınızı bağlayın",
    subscriptionsIntro: "Tabulect, bilgisayarınızda kurulu resmî CLI'ları kendi abonelik girişinizle kullanır. Parola, token veya API anahtarı görmez ve saklamaz.",
    subConnected: "Bağlı",
    subLoginRequired: "Giriş gerekli",
    subApiKey: "API anahtarıyla giriş yapılmış — abonelik girişi gerekli",
    subUnknown: "Durum doğrulanamadı",
    subMissing: "Kurulu değil",
    subSignIn: "Giriş yap",
    subRecheck: "Yeniden denetle",
    subInstall: "Kurulum",
    subDocs: "Resmî belgeler",
    subOpened: "Giriş Terminal'de açıldı. Bitirince Yeniden denetle'ye basın.",
    subRunYourself: "Terminal açılamadı. Şu komutu kendiniz çalıştırın:",
    subChecking: "Denetleniyor…",
  },
  en: {
    fixtureBadge: "sample text",
    backendOffline: "backend offline",
    themeToggle: "Theme",
    noChunks: "No source yet. Drop a PDF, EPUB, HTML, MD, or DOCX.",
    sourceLabel: "Source",
    outputLabel: "Output",
    page: "Page",
    splitterAria: "Resize split",
    openFile: "Open document",
    dropActive: "Drop — it will be read locally",
    providerLabel: "Provider",
    modelLabel: "Model",
    modelPlaceholder: "model id",
    modelDefault: "CLI default",
    ingestIdle: "Local extract · Tabulect on a selection",
    ingestError: "Ingest failed",
    unsupportedFile: "Unsupported file. Use PDF, EPUB, HTML, MD, or DOCX.",
    backendNeeded: "The local backend must be online (127.0.0.1:8755) to ingest.",
    reloadFixture: "Reload sample",
    openFormats: "PDF, EPUB, HTML, MD, DOCX — click or drop",
    instructLabel: "Instruction",
    instructPlaceholder: "Start with / for AI, otherwise search the source",
    searchPlaceholder: "Search source",
    instructApply: "Apply",
    instructPending: "Applying",
    tableAi: "Tabulect",
    tableAiPending: "CLI running",
    tableAiWarnTitle: "All bookmarks will be sent",
    tableAiWarnBody:
      "Nothing is selected. Every bookmark on this document will go to the CLI with the active template. Long text costs more. Continue?",
    tableAiWarnYes: "Send",
    tableAiWarnNo: "Cancel",
    templates: "Templates",
    templateNone: "Free",
    templateAdd: "Add template",
    templateName: "Name",
    templateBody: "Body",
    templateSave: "Save",
    templateDelete: "Delete",
    stepLabel: "Step",
    stepParagraph: "Paragraph",
    library: "Library",
    libraryOpen: "Open library",
    libraryClose: "Close",
    libraryEmpty: "No saved documents. Open a file.",
    libraryLoading: "Loading library",
    libraryError: "Could not read the library",
    libraryDelete: "Delete",
    libraryDeleteConfirm: "This document will be removed from the library and disk. Continue?",
    libraryDeleteYes: "Delete",
    libraryDeleteNo: "Cancel",
    libraryRename: "Rename",
    libraryRenameSave: "Save",
    libraryRenameCancel: "Cancel",
    libraryChunks: "chunks",
    libraryBookmarks: "bookmarks",
    libraryUpdated: "Updated",
    libraryCurrent: "open",
    libraryDemo: "Show sample",
    libraryTabDocs: "Documents",
    libraryTabBookmarks: "Bookmarks",
    folderUnfiled: "Unfiled",
    folderAll: "All",
    folderNew: "Folder",
    folderName: "Folder name",
    folderCreate: "Create",
    folderRename: "Rename folder",
    folderDelete: "Delete folder",
    folderDeleteConfirm: "Delete this folder? Documents become unfiled.",
    folderMove: "Move to folder",
    sourceAdd: "Add source",
    sourceScopeOpen: "Scope: open document",
    sourceScopeExtra: "Scope: open document +",
    bookmarkSearch: "Search bookmarks",
    bookmarkEmpty: "No bookmarks yet. Press Enter on the yellow selection.",
    bookmarkDelete: "Delete",
    bookmarkJump: "Jump",
    bookmarkUp: "Up",
    bookmarkDown: "Down",
    outputEmpty:
      "The right pane shows CLI output. Select a passage and run Tabulect, or send all bookmarks. Export as Markdown, HTML, PDF, DOCX, or Excel.",
    outputLoading: "Provider is writing…",
    outputError: "Could not get output",
    outputEdit: "Source",
    outputPreview: "Preview",
    outputHtml: "HTML",
    outputSave: "Save",
    outputExport: "Export",
    outputNewChat: "New chat",
    outputMode: "Output placement",
    outputAppend: "Append",
    outputNew: "New",
    outputAppending: "Appending the next answer…",
    outputSaved: "Saved",
    appearance: "Appearance",
    themeLabel: "Theme",
    colorInk: "Text color",
    colorPaper: "Background",
    colorMark: "Highlight",
    lineHeight: "Line spacing",
    paragraphGap: "Paragraph spacing",
    fontFamily: "Font",
    fontSystem: "System",
    fontSerif: "Serif",
    fontSans: "Sans",
    fontMono: "Mono",
    fontSize: "Size",
    paneSource: "Source",
    paneOutput: "Output",
    paneBoth: "Both",
    searchHits: "matches",
    exportDir: "Save folder",
    notes: "Notes",
    notesOpen: "Open notes",
    notesClose: "Close",
    notesEmpty: "No notes yet. Start with a new note.",
    notesLoading: "Loading notes",
    notesNew: "New note",
    notesFolders: "Note folders",
    notesOutline: "Outline",
    notesEditor: "Edit",
    notesEditorHint: "Write markdown. Headings (#) fill the outline; saving is automatic.",
    notesAutosave: "Autosave",
    notesSaving: "Saving…",
    notesSaved: "Saved",
    notesSaveError: "Save failed",
    notesDeleteConfirm: "This note will be deleted. Continue?",
    notesNoOutline: "No headings yet. Start a line with #.",
    notesExport: "Export",
    notesSearch: "Search notes",
    notesUntitled: "Untitled note",
    uiLanguage: "Interface language",
    templateReset: "Reset to default",
    templateResetHint: "Restore the edited built-in template to its default text",
    tableAiShortcut: "Tabulect: turn the selection or bookmarks into a table with the chosen AI CLI (shortcut: T)",
    tableLanguage: "Table language",
    subscriptions: "Subscriptions",
    subscriptionsTitle: "Subscriptions — connect your own AI account",
    subscriptionsIntro: "Tabulect uses the official CLIs installed on your computer with your own subscription login. It never sees or stores passwords, tokens or API keys.",
    subConnected: "Connected",
    subLoginRequired: "Sign-in required",
    subApiKey: "Signed in with an API key — subscription login required",
    subUnknown: "Status could not be confirmed",
    subMissing: "Not installed",
    subSignIn: "Sign in",
    subRecheck: "Re-check",
    subInstall: "Install",
    subDocs: "Official docs",
    subOpened: "Sign-in opened in Terminal. When done, press Re-check.",
    subRunYourself: "Could not open a terminal. Run this command yourself:",
    subChecking: "Checking…",
  },
};
