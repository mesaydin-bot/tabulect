export type FontFamilyId = "system" | "serif" | "sans" | "mono";
export type FontSizeId = "small" | "medium" | "large";
export type TableThemeId = "plain" | "contrast" | "soft";
export type GridWidthId = "thin" | "medium" | "thick";
export type RowDensityId = "compact" | "comfortable" | "roomy";

export const FONT_FAMILY_IDS: FontFamilyId[] = ["system", "serif", "sans", "mono"];
export const FONT_SIZE_IDS: FontSizeId[] = ["small", "medium", "large"];
export const TABLE_THEME_IDS: TableThemeId[] = ["plain", "contrast", "soft"];
export const GRID_WIDTH_IDS: GridWidthId[] = ["thin", "medium", "thick"];
export const ROW_DENSITY_IDS: RowDensityId[] = ["compact", "comfortable", "roomy"];

export { FONT_STACKS } from "./appearance";

export const FONT_SIZE_PX: Record<FontSizeId, number> = {
  small: 15,
  medium: 18,
  large: 21,
};

export const GRID_WIDTH_PX: Record<GridWidthId, number> = {
  thin: 1,
  medium: 2,
  thick: 3,
};

export const STORAGE = {
  fontFamily: "tabulect:fontFamily",
  fontSize: "tabulect:fontSize",
  tableTheme: "tabulect:tableTheme",
  gridColor: "tabulect:tableGridColor",
  gridWidth: "tabulect:tableGridWidth",
  columnWidths: "tabulect:columnWidths",
  columnVisibility: "tabulect:columnVisibility",
  lastDocumentId: "tabulect:lastDocumentId",
  rowDensity: "tabulect:rowDensity",
} as const;

/** One-shot: drop wrap-era column widths that collapse the table. */
export const COLUMN_WIDTHS_RESET = "tabulect:columnWidths:reset-wrap-1";

export function clearStaleColumnWidthsOnce() {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(COLUMN_WIDTHS_RESET) === "1") return;
    localStorage.removeItem(STORAGE.columnWidths);
    localStorage.setItem(COLUMN_WIDTHS_RESET, "1");
  } catch {
    /* ignore */
  }
}

export const DEFAULT_FONT_FAMILY: FontFamilyId = "serif";
export const DEFAULT_FONT_SIZE: FontSizeId = "medium";
export const DEFAULT_TABLE_THEME: TableThemeId = "plain";
export const DEFAULT_GRID_WIDTH: GridWidthId = "thin";
export const DEFAULT_ROW_DENSITY: RowDensityId = "comfortable";

export const ROW_DENSITY_MIN_PX: Record<RowDensityId, number> = {
  compact: 44,
  comfortable: 72,
  roomy: 110,
};

/** Seed widths when the user has never resized (px). */
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  claim: 260,
  warrant: 240,
  fact: 220,
  example: 220,
  definition: 200,
  exception: 200,
  openQuestion: 200,
  citation: 220,
  practicalSuggestion: 240,
  objection: 200,
};
