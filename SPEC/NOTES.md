# Notes panel

A first-class notebook inside Tabulect. The reading panes (source / output) and the Tabulect templates stay separate; the default AI scope is still the **open document**.

## Features

- Folders: create, rename, delete. Move notes between folders.
- Note CRUD: create, rename, delete. The body is written to disk as Markdown.
- Outline: built from `#` … `######` headings; clicking a heading jumps to that line in the editor.
- Markdown editor with an optional preview.
- Autosave (~600 ms debounce). Ordinary edits need no Save.
- Export: `.md`, HTML, PDF, DOCX, Excel — through the existing `rich-export` / Chrome PDF path.

## Persistence

`TABULECT_DATA` (default `~/.local/share/tabulect`):

- `notes/<id>.json` — `{ id, title, body, folderId, createdAt, updatedAt }`
- `notes-meta.json` — folder list and membership

## Corpus

On save, a note's **title + body** is written to the local `corpus.sqlite` as `kind=note`. Bookmarks stay as `kind=bookmark`.

- `/` and Tabulect **default to the open document**; notes are not consulted.
- `@library` and `@all` open the local corpus; note text comes along with bookmarks. No other alias opens the library.
- The corpus is local only; there is no bridge to other apps and no remote endpoint.

## HTTP

| Path | |
| --- | --- |
| `GET/POST /notes` | list / create |
| `GET/PATCH/DELETE /notes/:id` | read / title-body / delete |
| `POST /notes/:id/folder` | move to folder |
| `POST /notes/:id/export` | `{ format }` md/html/pdf/docx/xlsx |
| `GET/POST /note-folders` | folder list / create |
| `PATCH/DELETE /note-folders/:id` | rename / delete |

## UI

**Notes** in the top bar. An overlay like the Library; the source/output panes and the command bar (`/` free instruction, Tabulect templates, Add/New) stay in place.
