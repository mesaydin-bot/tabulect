# Tabulect

Tabulect is a desktop reading shell: the source document on the left, AI-generated tables and notes on the right. Open a local PDF, EPUB, HTML, Markdown or DOCX, step through it with a keyboard highlight, bookmark passages, and turn a selection or your bookmarks into a reading table (Main idea | Reasoning | Example | Practical tip) with the AI subscription you already have.

- Desktop app: Tauri 2 + React/Vite/TypeScript, with a local Node sidecar on `127.0.0.1:8755`
- Bundle id: `org.thinkingtoolslab.tabulect`
- License: MIT (see `LICENSE`)

## Install

Requirements: Node.js 22+, Rust (stable, via `rustup`), and for desktop builds the Tauri 2 prerequisites (macOS: Xcode Command Line Tools; Linux: `libwebkit2gtk-4.1-dev` and friends). Optional for scanned PDFs: `tesseract`, `pdftoppm` (poppler). Optional for PDF export: Chrome or Chromium.

```bash
npm install
npx tauri dev            # native window
```

Browser preview (no native window):

```bash
npm run sidecar          # 127.0.0.1:8755
npm run dev              # 127.0.0.1:8760
```

macOS (Apple Silicon) app + install into `/Applications`:

```bash
npm run macos:build      # or double-click "Install Tabulect.command"
npm run macos:install
```

## Bring your own AI subscription

Tabulect does not include, bundle or log in to any AI service. Every user connects **their own** subscription through the provider's official command-line tool (CLI). Tabulect only runs the CLI you installed, under your own operating-system account.

1. Install the CLI(s) you want to use:

| Provider | Install (official) | Sign in | Status check Tabulect runs |
| --- | --- | --- | --- |
| ChatGPT (Codex CLI) | `npm install -g @openai/codex` | `codex login` (choose *Sign in with ChatGPT*) | `codex login status` — API-key logins are rejected |
| Kimi (Kimi Code CLI) | `npm install -g @moonshot-ai/kimi-code` | `kimi login` | `kimi provider list --json` |
| Google Gemini (Antigravity CLI `agy`) | see https://antigravity.google/docs/cli/install/ | run `agy` once and sign in with Google | `agy -p /usage --output-format json` |
| Cursor (Cursor Agent CLI) | `curl https://cursor.com/install -fsS \| bash` | `cursor-agent login` | `cursor-agent status` |
| Claude (Claude Code CLI `claude`) | `curl -fsSL https://claude.ai/install.sh \| bash` (or `brew install --cask claude-code`) | `claude auth login` (sign in with your Claude Pro/Max/Team/Enterprise account) | `claude auth status` — only a claude.ai subscription login counts; API keys, `ANTHROPIC_*` / `CLAUDE_CODE_OAUTH_TOKEN` variables, `apiKeyHelper` and Bedrock/Vertex/Foundry are refused |

2. Open **Subscriptions / Abonelikler** in Tabulect. It detects each CLI, shows whether you are signed in, and its **Sign in** button opens the official login command in a terminal window. Press **Re-check** when done.

Rules Tabulect follows:

- It never reads, copies, stores or logs passwords, OAuth tokens or API keys. Logins stay in each CLI's own store in your home directory or keychain.
- It removes API-key and base-URL environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CURSOR_API_KEY`, `*_BASE_URL`, …) before starting a CLI, so calls always use your subscription login, not a key that happens to be in your shell.
- Codex runs with a read-only sandbox and `forced_login_method="chatgpt"`; Cursor runs in ask mode without force flags.
- Claude Code runs in print mode with every tool disabled (`claude -p --output-format json --tools "" --strict-mcp-config --disable-slash-commands --permission-mode dontAsk`); follow-up questions use `--resume <session id>`. Claude Code keeps its own conversation transcripts under `~/.claude`.
- Release builds run `scripts/check-no-credentials.mjs`, which fails the build if any CLI login folder, token/credential file, private key or bundled AI CLI ends up in the package.

Install commands and URLs belong to the providers and can change; check their docs if a command fails.

## Using Tabulect

On first launch Tabulect shows a sample to try: Francis Bacon's *Of Studies* (1625, public domain) in the English interface, a short Turkish essay in the Turkish one. Tables come out in the interface language by default; change it per document with the table-language switch.

1. **Open** a document or drop a file. Text is extracted and chunked locally (scanned PDFs are OCR'd with local tools).
2. **↑ / ↓** (or `j` / `k`) move the yellow highlight; **← / →** move by word or meaningful phrase; **Shift** extends the range; **Space** toggles auto-advance.
3. **Enter** saves the highlighted range as a bookmark.
4. **Tabulect** (button, or press **`T`**) sends the current selection — or, after a confirmation, all bookmarks — with the selected prompt template to your chosen CLI and shows the result (usually a markdown table) in the right pane.
5. Type `/` followed by a question in the top bar for a free-form instruction; text without `/` searches the document.
6. Export the right pane as Markdown, HTML, PDF, DOCX or Excel. Saves always go to the save folder you chose in settings (Downloads by default).
7. **Notes**, **Library** (folders) and **Aa** (appearance) are in the top bar. AI scope is the open document unless you add sources or mention `@library` / `@all`.

| Key | Action |
| --- | --- |
| `T` | Run Tabulect on the selection / bookmarks |
| `↑` `↓` `j` `k` | Move the highlight |
| `←` `→` | Move by word / phrase |
| `Shift` + arrows | Extend the range |
| `Space` | Auto-advance on/off |
| `Enter` | Save bookmark |
| `Esc` | Close panel / clear highlight |
| `Ctrl/⌘+F` | Search · `Ctrl/⌘+G` / `F3` next hit |

## Language, prompts and your own prompts

- The interface is bilingual (English / Türkçe). The language switch is persisted on your computer; the default follows your OS language.
- All built-in AI prompts are **English by default**. When the interface is Turkish, the Turkish translations of the built-in prompts are used.
- Open **Templates** in the command bar to write your own prompts, edit the built-in ones, or restore a built-in prompt with **Reset to default**. Templates are stored locally in `templates.json` in the Tabulect data folder.

## Security

The sidecar listens on `127.0.0.1` only, accepts only loopback `Host` and `Origin` values, rejects cross-site requests, requires a random per-launch token (`X-Tabulect-Token`) on every non-health route, and accepts JSON bodies only (multipart only for document upload). Output is written only into the user-chosen save folder. See `PRIVACY.md`.

## Tests

```bash
npm test                 # sidecar unit tests
npm run smoke            # end-to-end sidecar smoke test (incl. security checks)
npm run check:credentials
```

## Türkçe

Tabulect bir masaüstü okuma kabuğudur: solda kaynak belge, sağda AI ile üretilen okuma tabloları ve notlar. Yerel PDF, EPUB, HTML, Markdown veya DOCX açın; klavye vurgusuyla ilerleyin, pasajları yer imine ekleyin, seçimi veya yer imlerini kendi AI aboneliğinizle tabloya dönüştürün (**Tabulect** düğmesi veya **`T`** tuşu).

- Kurulum: `npm install` ve `npx tauri dev`; macOS uygulaması için `Install Tabulect.command`.
- AI: Tabulect hiçbir AI hesabı içermez. Kendi CLI'nizi kurun (`codex`, `kimi`, `agy`, `cursor-agent`, `claude`), sonra **Abonelikler** panelinden resmî giriş komutunu açın ve **Yeniden denetle**'ye basın. Token veya API anahtarı saklanmaz.
- Arayüz dili (TR/EN) üst çubuktan değiştirilir ve saklanır. Yerleşik istemler varsayılan olarak İngilizcedir; arayüz Türkçeyken Türkçe çevirileri kullanılır. **Şablonlar** bölümünde kendi istemlerinizi yazabilir, yerleşik olanları düzenleyip **Varsayılana dön** ile sıfırlayabilirsiniz.
- Gizlilik: bkz. `PRIVACY.md`.
