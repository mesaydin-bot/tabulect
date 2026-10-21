# Word, meaningful-phrase and automatic speed reading

The **← → Word / Meaningful phrase (Instant) / Meaningful phrase (AI + Hybrid)** choice in the source pane sets the unit that the horizontal arrows move by. Up/Down keep the line/paragraph movement of the current **Step** setting. Shift extends the selection; Enter creates a bookmark from the current selection.

## Horizontal reading modes and word count

1. **Word (`word`)**: fully local. The **Word count** menu highlights **1, 2, 3, 4 or 5 words** per step. A group closes naturally at sentence ends (`.`, `!`, `?`) and does not spill into the next sentence.
2. **Meaningful phrase — Instant (`grammar`)**: a local grammatical/syntactic chunker (`grammarRanges`) that works offline with zero delay (0 ms). It does not use a fixed word count; it splits at natural boundaries such as article + adjective + noun groups (`the largest object`), tightly bound `of` phrases (`the art of discussion`, `a useful piece of advice`), auxiliary and infinitive chains (`What I had taken to be`, `I had ever seen`), phrasal verbs (`came up with`) and Turkish postpositional/converb groups (`Her şeye rağmen`, `sabırla dinleyerek`).
3. **Meaningful phrase — AI + Hybrid (`phrase`)**:
   - **Paragraph-based proactive prefetch**: when a document opens, or when `↑` / `↓` reach a new line/paragraph, the active passage and the next one are prepared in the background (120 ms debounce).
   - **Zero wait (hybrid fallback)**: if the AI reply is not ready when Right/Left is pressed or while automatic speed reading runs, the reader does not wait; it advances with local grammar phrases (`grammarRanges`) and updates the cache when the AI boundaries arrive.

## Automatic speed reading (flow mode)

The speed-reading controls in the source toolbar advance automatically without clicking:

- **▶ Play / ⏸ Pause (`Space`)**: starts or stops automatic reading. When paused, the yellow highlight waits **on the exact word, phrase or line**; playing again continues from there without resetting. Clicking another paragraph or moving with the arrow keys continues from the new position.
- **Direction (`→ Right` / `↓ Down`)**:
  - `→ Right (Word / Phrase)`: advances by words (`1–5 words`) or meaningful phrases (`Instant` / `AI + Hybrid`), depending on the horizontal mode.
  - `↓ Down (Line / Paragraph)`: advances downward according to the **Step** setting in the top bar (`1–5 lines` or `Paragraph`).
- **Speed (`60–900 WPM`)**: set the words-per-minute rate with the `−` / `+` buttons or the slider. The delay is not a fixed number of milliseconds; it is computed from the **word count** of the highlighted phrase, word group or line and from punctuation (a natural pause at commas and sentence ends).
