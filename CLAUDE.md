# Book Reader Web App

A personal, mobile-first reader for the Bibek Debroy English translation
of the Mahabharata (Penguin 10-volume edition). Hosted as a static site
on GitHub Pages. Built for reading on a phone.

## Goal

Replace generic PDF readers with a custom reader that has:

1. Comfortable dark theme by default, with a light/dark toggle.
1. Font-size control that actually changes the body text.
1. Two-level sidebar navigation: 10 parts (volumes) → multiple parvas
   (sections) inside each part.
1. Last-read position remembered per parva.
1. **Dictionary lookup** popup when the user selects a word.
1. **Reference lookup** popup when the user selects an in-book reference
   (a marker like `12` whose definition lives in the parva’s footnotes).

The reader is for one person on one phone. No accounts, no sync, no analytics.

-----

## Hard constraints (do not violate)

- **Static site only.** Must work as plain files served by GitHub Pages.
- **No frameworks.** No React, Vue, Svelte, jQuery, Tailwind, etc.
- **No build step.** No `package.json`, no bundler, no transpiler.
- **No backend.** The only network call allowed is the free public
  dictionary API at `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`.
- **No tracking, analytics, telemetry, or third-party scripts.**
- **Vanilla HTML / CSS / JS only.** Modern (ES2020+) is fine; no IE support.
- **Mobile-first.** Design at 375 px width, scale up gracefully.

-----

## Repo layout

```
/index.html                         Reader shell
/css/styles.css                     All styles
/js/reader.js                       All logic
/parts/
  index.json                        Top-level manifest of the 10 parts
  part-01/
    index.json                      Manifest of parvas inside Part 1
    section-01.html                 Anukramanika Parva
    section-02.html                 Parvasamgraha Parva
    ...
    section-15.html
  part-02/
    index.json
    section-01.html
    ...
  refs/
    part-01/
      section-01.json               Footnote map for Part 1's Anukramanika Parva
      section-02.json
      ...
/assets/                            Icons, any images
/CLAUDE.md
/README.md
```

A part’s `index.json` looks like:

```json
{
  "part": 1,
  "sections": [
    {
      "number": 1,
      "name": "Section One",
      "parva": "Anukramanika Parva",
      "chapters": [1],
      "html": "part-01/section-01.html",
      "refs": "refs/part-01/section-01.json",
      "footnote_count": 86
    },
    ...
  ]
}
```

A footnote-refs JSON file is a flat map keyed by inline marker:

```json
{
  "fn1": "The word 'jaya' means victory and was also the title of...",
  "fn2": "Nara and Narayana were ancient sages...",
  ...
}
```

Inline markers in the HTML look like:

```html
<sup class="ref" data-ref="fn12">12</sup>
```

The reader looks up `data-ref` against the **currently loaded parva’s**
refs file. Each parva is a self-contained footnote namespace — numbers
restart at 1 inside each section file, matching the source book’s
footnote numbering exactly.

If `parts/part-NN/` is missing or a specific section is missing, the
reader must show “Not yet available” — never a broken page.

-----

## Features in build order

### Phase 1 — Reader shell

- Header bar: title, light/dark toggle, font-size slider (range 14–28 px).
- Two-level sidebar:
  - Top level: 10 parts. Tap to expand and see that part’s parvas.
  - Inner level: parvas, listed by parva name from the part’s `index.json`.
  - Tap a parva to load its HTML into the main pane via `fetch()`.
- Main pane renders the loaded HTML. Reading area max-width ~700 px,
  generous line-height (1.6–1.8), comfortable side padding on mobile.
- localStorage keys (all prefixed `reader_`):
  - `reader_theme` — `"dark"` or `"light"` (default `"dark"`)
  - `reader_fontSize` — integer px (default 18)
  - `reader_lastParva` — `"01/05"` (part 1, section 5) — reopen on launch
  - `reader_pos_01_05` — scroll position (0–1 fraction) per parva

### Phase 2 — Dictionary lookup

- On text selection (drag-select or mobile long-press), if the selection
  is a single word (1–2 words, alphabetic), show a small floating popup
  near the selection.
- Popup fetches `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
  and displays: word, part of speech, first 1–2 definitions. Tiny loading
  state while fetching.
- Tap outside, ESC, or scroll dismisses it.
- Cache responses in-memory for the session.
- 404 from the API → “No definition found.” Don’t crash.

### Phase 3 — Reference lookup

- If the selected text matches the reference pattern (digits only, e.g.
  `12`, `345`), look it up in the **currently loaded parva’s** refs JSON
  (already fetched and cached when the parva was loaded). Same popup UI.
- Tapping a `<sup class="ref">` element directly should also trigger the
  popup — selection on a small superscript is fiddly on mobile.
- Reference pattern configurable at the top of `reader.js`.

-----

## Style / UX

- **Dark palette:** background `#1a1a1a`, body text `#d4d4d4`, popup
  surface `#2a2a2a`, accent `#7aa2f7`. Avoid pure black/white.
- **Light palette:** background `#fafaf7`, body text `#1a1a1a`, accent `#3563b8`.
- **Typography:** serif body (Georgia / “Iowan Old Style” / serif),
  system sans for UI chrome.
- **Popup:** ~280 px max width, rounded, subtle shadow, fade-in,
  flips above the selection if near bottom of viewport.
- Reader text itself does not animate.

-----

## Accessibility

- `aria-label` on every icon-only button.
- Popup focusable; ESC closes; focus returns.
- Sidebar toggle has visible focus ring.
- Body text passes WCAG AA contrast on both themes.

-----

## Things to remember every session

- I am working from a phone via Claude Code on the web. Push directly
  to `main`. GitHub Pages auto-deploys from `main`.
- Keep commits small and descriptive.
- Verify deployed paths are relative (no `localhost`, no leading `/`
  that would break under `/repo-name/` Pages hosting).
- If a feature would require breaking a hard constraint above, stop
  and ask instead of working around it.
