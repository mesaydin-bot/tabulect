# Persistent AI conversations

Tabulect and the `/` instructions in the top bar send a new message to the selected
provider's open process. For Kimi, Codex / ChatGPT and Antigravity the CLI is not
started for every question. The connection opens on the first question and is kept
until the app quits.

Each provider has its own conversation. Changing the document, switching the
Add / New output choice, or switching to another provider and back does not reset
the conversation. "New conversation" only closes the selected provider's connection
and clears its conversation id; the next question opens a new conversation. Reset is
blocked while a reply is running. Earlier output stays in the documents.

## Connections

| Provider | Long-lived protocol | Reconnect |
| --- | --- | --- |
| Codex / ChatGPT | `codex app-server`, JSONL RPC | `thread/resume` |
| Kimi | `kimi acp`, ACP JSON-RPC | `session/load` |
| Antigravity | `agy --input-format stream-json --output-format stream-json` | `--conversation <id>` |
| Claude Code | one `claude -p --output-format json` call per question | `--resume <session id>` |

Antigravity takes the model as a start-up argument, so a model change restarts the
process with the same conversation id. In Kimi, going back to the CLI's default
model also reloads the same conversation. Ordinary consecutive questions do not
trigger these restarts.

Session ids are written atomically to `TABULECT_DATA/ai-sessions.json`.
The default data directory is `~/.local/share/tabulect`. This file contains no
messages or credentials; the provider's CLI keeps the history (Claude Code keeps
its transcripts under `~/.claude`). The same conversation is restored after the app
is reopened. A deleted or unreachable conversation shows an error; a new conversation
is never opened silently. An interrupted request is not resent automatically. The
next user request loads the same conversation.

Questions to one provider run in order; different providers are independent.
`GET /sessions` returns connection and process details for diagnostics. The interface
only shows "Conversation retained" or "New conversation ready".

Cursor and Claude Code use a one-call-per-question connection bound to the document;
for both, the silent conversation reset after a failed resume has been removed.
The older schema fill / import workers are separate from this free conversation
connection and keep their existing one-call modes.

## Verification

- Full test suite: green (see the audit report for the current count).
- Two messages on each of three real CLIs: a test word from the first message was
  remembered in the second; the process id and conversation id did not change.
- The three real CLIs were closed and reconnected from a new Node process; the test
  word was remembered again with the same conversation ids.
- Automated tests: ordering, reset while busy, process crash, timeout, empty reply,
  missing conversation, explicit new conversation, Antigravity model change.
- In the UI, provider / document switching, the conversation status and two
  consecutive Codex instructions were checked against the installed backend.
- After quitting and reopening the installed app, Codex answered correctly from the
  same conversation.

The start-up cost disappears for later questions; the model's generation, network
and long-text processing times remain. No speed-up ratio was measured.

## Protocol sources

- [OpenAI Codex app-server](https://developers.openai.com/codex/app-server/)
- [Kimi ACP](https://moonshotai.github.io/kimi-cli/en/reference/kimi-acp.html)
- [Antigravity headless and streaming input](https://antigravity.google/docs/cli/headless)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)

The protocol fields were also checked against the installed Codex 0.153.4 schema,
the installed Kimi ACP source and real Antigravity CLI output.
