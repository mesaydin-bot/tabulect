type Props = {
  whiteLabel: string;
  sepiaLabel: string;
  darkLabel: string;
  toggleLabel: string;
  theme: "white" | "sepia" | "dark";
  onCycle: () => void;
};

export function ThemeToggle({
  whiteLabel,
  sepiaLabel,
  darkLabel,
  toggleLabel,
  theme,
  onCycle,
}: Props) {
  const title =
    theme === "white" ? whiteLabel : theme === "sepia" ? sepiaLabel : darkLabel;
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onCycle}
      aria-label={toggleLabel}
      title={title}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 15a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-6a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1ZM5 12a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm12.66-5.66a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.42l.71-.7a1 1 0 0 1 1.41 0ZM8.46 15.54a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.42l.71-.7a1 1 0 0 1 1.41 0Zm9.9 1.41a1 1 0 0 1-1.41 0l-.71-.7a1 1 0 1 1 1.42-1.42l.7.71a1 1 0 0 1 0 1.41ZM8.46 8.46a1 1 0 0 1-1.41 0l-.71-.7A1 1 0 0 1 7.76 6.34l.7.71a1 1 0 0 1 0 1.41ZM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
          />
        </svg>
      ) : theme === "sepia" ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 5h16v14H4zM7 8h10v2H7zm0 4h10v2H7z"
            opacity="0.85"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16.2 12.05A6.2 6.2 0 0 1 11 17.9 6.2 6.2 0 0 1 8.3 6.3a8 8 0 1 0 7.9 5.75Z"
          />
        </svg>
      )}
    </button>
  );
}
