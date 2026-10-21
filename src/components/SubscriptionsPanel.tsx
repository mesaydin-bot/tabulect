import { useCallback, useEffect, useState } from "react";
import { listProviders, openProviderLogin, type ProviderStatus, type SubscriptionState } from "../api/client";
import { CHROME, type ChromeKey } from "../locale/ui";
import type { UiLang } from "../locale/i18n";

type Props = {
  locale: UiLang;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChanged?: (providers: ProviderStatus[]) => void;
};

const STATE_KEY: Record<SubscriptionState, ChromeKey> = {
  connected: "subConnected",
  login_required: "subLoginRequired",
  api_key: "subApiKey",
  unknown: "subUnknown",
  missing: "subMissing",
};

function stateOf(p: ProviderStatus): SubscriptionState {
  if (p.status) return p.status;
  if (!p.available) return "missing";
  return p.loggedIn ? "connected" : "login_required";
}

/**
 * Abonelikler / Subscriptions: each user connects their OWN CLI account.
 * Detects each CLI, opens its official login command, and re-checks the real status.
 */
export function SubscriptionsPanel({ locale, open, onOpen, onClose, onChanged }: Props) {
  const chrome = CHROME[locale];
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(
    async (force: boolean) => {
      setBusy(true);
      try {
        const next = await listProviders(force);
        setProviders(next);
        onChanged?.(next);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  useEffect(() => {
    if (open) void refresh(true);
  }, [open, refresh]);

  const signIn = async (p: ProviderStatus) => {
    setNotice(null);
    try {
      const result = await openProviderLogin(p.id);
      setNotice(result.opened ? chrome.subOpened : `${chrome.subRunYourself} ${result.command}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="tool-wrap">
      <button
        type="button"
        className={open ? "chip is-on" : "chip"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? onClose() : onOpen())}
      >
        {chrome.subscriptions}
      </button>
      {open ? (
        <div className="tool-pop subscriptions-pop" role="dialog" aria-label={chrome.subscriptionsTitle}>
          <div className="subscription-head">
            <p className="tool-label">{chrome.subscriptionsTitle}</p>
            <button type="button" className="text-btn" onClick={onClose} aria-label={chrome.notesClose}>
              ×
            </button>
          </div>
          <p className="subscriptions-intro">{chrome.subscriptionsIntro}</p>
          <ul className="subscriptions-list">
            {providers.map((p) => {
              const state = stateOf(p);
              return (
                <li key={p.id} className={`subscription subscription-${state}`}>
                  <div className="subscription-head">
                    <strong>{p.label}</strong>
                    <span className="subscription-state">{chrome[STATE_KEY[state]]}</span>
                  </div>
                  {state === "missing" && p.install ? (
                    <div className="subscription-install">
                      {chrome.subInstall}: <code>{p.install}</code>
                    </div>
                  ) : null}
                  <div className="subscription-actions">
                    {state !== "missing" && state !== "connected" ? (
                      <button type="button" className="chip" onClick={() => void signIn(p)}>
                        {chrome.subSignIn}
                        {p.loginCommand ? <code> {p.loginCommand}</code> : null}
                      </button>
                    ) : null}
                    {p.docs ? (
                      <a href={p.docs} target="_blank" rel="noreferrer noopener">
                        {chrome.subDocs}
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="subscription-footer">
            <button type="button" className="chip" disabled={busy} onClick={() => void refresh(true)}>
              {busy ? chrome.subChecking : chrome.subRecheck}
            </button>
            {notice ? <span className="subscription-notice" role="status">{notice}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
