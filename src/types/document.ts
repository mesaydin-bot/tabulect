import { initialUiLang } from "../locale/i18n";
export type SourceType = "pdf" | "epub" | "html" | "md" | "docx";

export type TableLocale = "tr" | "en";

export type Chunk = {
  id: string;
  text: string;
  page: number | null;
  start: number;
  end: number;
};

export type QuoteAnchor = {
  chunkId: string;
  start: number;
  end: number;
  page: number | null;
  bbox: [number, number, number, number] | null;
};

export type BookmarkSpan = {
  chunkId: string;
  start: number;
  end: number;
  page: number | null;
};

export type Bookmark = {
  id: string;
  text: string;
  chunkId: string;
  start: number;
  end: number;
  page: number | null;
  createdAt: string;
  note: string;
  spans: BookmarkSpan[];
};

export type OutputArtifact = {
  id: string;
  title: string;
  format: "markdown" | "html" | "text";
  content: string;
  createdAt: string;
  source: "selection" | "bookmarks" | "instruction";
  templateId: string;
};

export type Row = {
  id: string;
  chunkId: string;
  quoteAnchor: QuoteAnchor;
  claim: string;
  warrant: string;
  fact: string;
  example: string;
  definition: string;
  exception: string;
  openQuestion: string;
  citation: string;
  practicalSuggestion: string;
  objection: string | null;
};

export type Document = {
  id: string;
  title: string;
  sourceType: SourceType;
  tableLocale: TableLocale;
  lastProvider?: string | null;
  lastModel?: string | null;
  chunks: Chunk[];
  rows: Row[];
  bookmarks: Bookmark[];
  outputs: OutputArtifact[];
};

export type HighlightRange = {
  start: number;
  end: number;
  empty?: boolean;
};

export type StepSize = "1" | "2" | "3" | "4" | "5" | "paragraph";

export type PromptTemplate = {
  id: string;
  name: string;
  nameEn?: string;
  scope: "selection" | "bookmarks" | "custom";
  builtin?: boolean;
  /** A built-in template the user edited; can be reset to the default. */
  customized?: boolean;
  body: string;
};

export function emptyDocument(partial: Partial<Document> & Pick<Document, "id" | "title">): Document {
  return {
    sourceType: "md",
    // New documents build their tables in the interface language unless the user picks another.
    tableLocale: initialUiLang(),
    chunks: [],
    rows: [],
    bookmarks: [],
    outputs: [],
    ...partial,
  };
}

export function migrateDocument(doc: Document): Document {
  return {
    ...doc,
    rows: Array.isArray(doc.rows) ? doc.rows : [],
    bookmarks: Array.isArray(doc.bookmarks) ? doc.bookmarks : [],
    outputs: Array.isArray(doc.outputs) ? doc.outputs : [],
  };
}

export function isHardFillError(message: string | null | undefined): boolean {
  if (!message) return false;
  if (
    /empty output|empty response|timed out|timeout|rate limit|quota|workspace trust|--trust|non-tty|not a tty|TERM=dumb|fabricated|kısmi tablo|partial table|no valid rows|refusing to invent data|SIGKILL|fill worker killed/i.test(
      message,
    )
  ) {
    return false;
  }
  return /not logged|is unavailable|was not found \(|Unknown provider|unauthoriz|unauthenticated|sign in to the subscription|does not accept API keys/i.test(
    message,
  );
}
