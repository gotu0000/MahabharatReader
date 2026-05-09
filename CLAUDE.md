# Book Reader Web App

A personal, mobile-first reader for a 2,773-page book that has been split into
10 parts. Hosted as a static site on GitHub Pages. Built for reading on a phone.

## Goal

Replace generic PDF readers with a custom reader that has:

1. Comfortable dark theme by default, with a light/dark toggle.
1. Font-size control that actually changes the body text.
1. Sidebar navigation between the 10 parts.
1. Last-read position remembered per part.
1. **Dictionary lookup** popup when the user selects a word.
1. **Reference lookup** popup when the user selects an in-book reference
   (a marker like `[12]` whose definition lives in the part’s footnotes).

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
/index.html              Reader shell (sidebar + main pane + header controls)
/css/styles.css          All styles. Use CSS variables for theme tokens.
/js/reader.js            All logic. Single file is fine.
/parts/                  Converted book content (added separately, may be empty at first)
  part-01.html
  part-02.html
  ...
  part-10.html
/parts/refs/             Per-part reference lookup tables
  part-01.json           { "[12]": "Referenced footnote text...", ... }
  ...
/assets/                 Icons, any images
/CLAUDE.md               This file
/README.md               Short human-readable description
```

If `/parts/` is empty or a specific part is missing, the reader must show a
graceful “Part not yet available” message — never a broken page.

-----

## Features in build order

### Phase 1 — Reader shell (build first)

- Header bar with: title, light/dark toggle, font-size slider (range 14–28 px).
- Collapsible sidebar listing Part 1 through Part 10. Tap loads that part’s
  HTML into the main pane via `fetch()`.
- Main pane renders the loaded HTML. Reading area max-width ~700 px, generous
  line-height (1.6–1.8), comfortable side padding on mobile.
- Persist these to localStorage (keys prefixed `reader_`):
  - `reader_theme` — `"dark"` or `"light"` (default `"dark"`)
  - `reader_fontSize` — integer px (default 18)
  - `reader_lastPart` — last-opened part id
  - `reader_pos_part_NN` — scroll position per part (number, 0–1 fraction)

### Phase 2 — Dictionary lookup

- On text selection (works for both desktop drag-select and mobile long-press
  selection), if the selection is a single word (1–2 words, alphabetic),
  show a small floating popup near the selection.
- Popup fetches `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` and
  displays: word, part of speech, first 1–2 definitions. Show a tiny loading
  state while fetching.
- Tap outside the popup, press ESC, or scroll dismisses it.
- Cache responses in-memory for the session to avoid refetching the same word.
- If the API returns 404 (no entry), show “No definition found” — don’t crash.

### Phase 3 — Reference lookup

- If the selected text matches a reference pattern (configurable; default
  patterns: `[\d+]` like `[12]`, `[\d+a-z]` like `[12a]`), look it up in the
  current part’s `/parts/refs/part-NN.json` instead of hitting the dictionary.
- Same popup UI; show the referenced text. If not found, show “Reference not
  found in this part.”
- The reference patterns and the JSON file format must be configurable in one
  place at the top of `reader.js` so I can adjust them once the actual book’s
  pattern is known.

-----

## Style / UX

- **Dark theme palette:** background `#1a1a1a`, body text `#d4d4d4`,
  popup surface `#2a2a2a`, accent `#7aa2f7`. Don’t use pure black or pure white.
- **Light theme palette:** background `#fafaf7`, body text `#1a1a1a`, accent
  `#3563b8`.
- **Typography:** serif for body (Georgia / “Iowan Old Style” / serif fallback),
  system sans for UI chrome.
- **Popup:** small (~280 px max width), rounded corners, subtle shadow, fades
  in. Positioned to stay on screen (flip above selection if near bottom).
- **No animations on text.** Only the popup fades; the reader itself is still.

-----

## Accessibility

- Proper `aria-label` on every icon-only button.
- Popup is focusable; ESC closes; focus returns to where it was.
- Sidebar toggle button has visible focus ring.
- Body text passes WCAG AA contrast on both themes.

-----

## Things to remember every session

- I am working from a phone via Claude Code on the web. Push directly to `main`
  unless the change is risky enough to deserve a PR. GitHub Pages auto-deploys
  from `main`.
- Keep commits small and descriptive.
- Before finishing a task, sanity-check the deployed URL would work (no broken
  relative paths, no `localhost` references, no console errors expected).
- If a feature would require breaking a hard constraint above, stop and ask
  instead of working around it.
