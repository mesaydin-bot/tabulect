# Search in the document

Text typed into the top bar without a leading `/` is searched across the whole open document. Results are listed on the left with two lines of context and their source position. Typing does not move the reading position; clicking a result brings that match into view.

- `⌘F` / `Ctrl+F`: jump to the search field and select its text.
- `Enter` / `Shift+Enter` in the search field: next / previous match.
- `⌘G` / `Ctrl+G`, `F3`: next match; with Shift, previous.
- Up/Down, Home/End in the result list: move between results.
- `Esc` or × in the panel: clear and close the search.
- Match-case and whole-word filters are optional.

Search is plain text; regex characters are not interpreted as instructions. Whitespace, line breaks, Unicode combining characters and words hyphenated at line ends are normalized. A phrase may span two source chunks. The UTF-16 positions of results in the real text are preserved. There is no semantic/fuzzy search for words that OCR misrecognized.

Search does not depend on the reading step or the screen width. The match count counts individual occurrences, not lines. If a result is chosen while the source pane is hidden, the source pane opens. Long result lists are virtualized; results are not capped. Text is not duplicated when search, reading selection and bookmark highlights overlap.

## Reference designs reviewed

- [Word Navigation pane](https://support.microsoft.com/en-us/word/use-the-navigation-pane-in-word): result list, click to jump, previous/next.
- [Acrobat PDF search](https://helpx.adobe.com/acrobat/using/searching-pdfs.html): context around the match, jump to position, case and whole-word filters.
- [Obsidian Search](https://obsidian.md/help/plugins/search): showing the context around a match inside the result.

## Verification

`node --experimental-strip-types --test sidecar/tests/document-search.test.mjs sidecar/tests/source-pane.test.mjs sidecar/tests/selection.test.mjs`

The tests cover repeated matches, line/chunk boundaries, Turkish letters, Unicode positions, hyphens, whole words, overlapping highlights and 4,000 results in a 2,000-chunk text.

On a real long English book, multi-word and whole-word searches returned the expected counts. Clicking a result, previous/next, wrap-around, phrase search, no-result search, Escape, the `/` instruction distinction and opening a hidden source pane were checked in the browser. There was no horizontal overflow in an 800×600 window. In the macOS app, ⌘F search and Enter to move to the first/second match were observed.
