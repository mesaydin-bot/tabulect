import { useState, type FormEvent } from "react";
import { CHROME } from "../locale/ui";
import type { TableLocale } from "../types/document";

type Props = {
  locale: TableLocale;
  pending: boolean;
  error?: string | null;
  onApply: (instruction: string) => Promise<boolean>;
};

export function InstructionBar({ locale, pending, error, onApply }: Props) {
  const chrome = CHROME[locale];
  const [value, setValue] = useState("");
  const armed = value.trim().length > 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const instruction = value.trim();
    if (!instruction || pending) return;
    const ok = await onApply(instruction);
    if (ok) setValue("");
  };

  return (
    <form
      className={armed ? "instruct-row is-armed" : "instruct-row"}
      onSubmit={submit}
    >
      <input
        className="instruct-input"
        type="text"
        value={value}
        placeholder={chrome.instructPlaceholder}
        aria-label={chrome.instructPlaceholder}
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="instruct-go" disabled={!armed || pending}>
        {pending ? chrome.instructPending : chrome.instructApply}
      </button>
      {error ? (
        <p className="instruct-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
