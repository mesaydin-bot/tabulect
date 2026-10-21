import type { TableLocale } from "../types/document";

type Props = {
  locale: TableLocale;
  onChange: (locale: TableLocale) => void;
};

export function LocaleSwitcher({ locale, onChange }: Props) {
  return (
    <div className="locale-switch" role="group" aria-label="TR | EN">
      <button
        type="button"
        className={locale === "tr" ? "is-on" : undefined}
        aria-pressed={locale === "tr"}
        onClick={() => onChange("tr")}
      >
        TR
      </button>
      <button
        type="button"
        className={locale === "en" ? "is-on" : undefined}
        aria-pressed={locale === "en"}
        onClick={() => onChange("en")}
      >
        EN
      </button>
    </div>
  );
}
