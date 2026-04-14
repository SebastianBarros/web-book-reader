# web-book-reader

A drag-and-drop e-book reader that runs entirely in your browser. Open MOBI, EPUB, AZW3, FB2, or CBZ files, keep them in a local library, and pick up where you left off.

**Live:** https://sebastianbarros.github.io/web-book-reader/

## Features

- **Drag-and-drop library.** Drop books anywhere on the page; they're added to a grid with cover, title, author, and format.
- **Multiple formats.** MOBI, EPUB, AZW3, AZW, FB2, FBZ, and CBZ.
- **Persistent everything, zero backend.** Books, reading position, layout, and theme are stored in your browser (IndexedDB + localStorage). Nothing is uploaded.
- **Chapter navigation.** Table-of-contents side sheet with the current chapter highlighted — built for the "I was reading on my Kindle, jump to that chapter" workflow.
- **Three reading flows.** Single page, two-page spread, or continuous scroll.
- **Typography controls.** Font family (Literata by default, plus Merriweather, Lora, Source Serif, Inter, Georgia, System sans), font size, line height, horizontal margin, and column width.
- **Three themes.** Light, sepia, and dark.
- **Time-remaining estimates.** Once you've read for ~60 cumulative seconds the top bar shows minutes remaining in the current chapter and in the whole book, calibrated to your own measured reading speed. Your reading speed persists across books and sessions, so reopening a book uses your calibrated rate immediately.
- **Hide estimates on demand.** Toggle them off in Settings when progress indicators feel spoilery or anxiety-inducing; the rate keeps measuring silently so the estimate is ready the moment you flip it back on.
- **Keyboard + click navigation.** Arrow keys, Space, PgUp/PgDn, or left/right click zones.
- **Progress per book.** Every book remembers its own position; your reading-speed estimate is shared across the library.

## DRM

**DRM-protected files cannot be opened** — no browser app can decrypt Amazon or Adobe DRM. Books purchased on Kindle must have DRM removed before they'll work here. Free EPUBs, public-domain works, and side-loaded MOBI/AZW3 files are fine.

## Privacy

Everything lives in your browser's own storage, scoped to the origin. Other browsers, other profiles, other devices, and other people all get their own separate empty library. There is no server, no account, no sync. Clearing site data wipes your library.

If you want cross-device sync or a shared family library, that's a future feature that would require a backend.

## Running it locally

```bash
npm install
npm run dev          # dev server on http://localhost:5173
npm run build        # production build into dist/
npm run preview      # preview the production build
```

Node 20+ recommended.

## Stack

- **Vite + React 18 + TypeScript** — app shell
- **Tailwind CSS v3 + shadcn/ui** — styling and primitives
- **foliate-js** (vendored under [src/vendor/foliate-js/](src/vendor/foliate-js/)) — book parsing and pagination for all formats
- **idb** — typed IndexedDB wrapper
- **react-router-dom** (HashRouter) — client-side routing

## Deployment

Any push to `master` triggers the GitHub Actions workflow at [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which builds and publishes to GitHub Pages. See [doc.md](doc.md) for details on the deploy setup and how to reuse it under a different repo name or with a custom domain.

## Attribution

All book parsing and rendering is done by [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), by John Factotum, vendored into the repo under [src/vendor/foliate-js/](src/vendor/foliate-js/).

## License

MIT (for the code in this repo). foliate-js retains its own MIT license under [src/vendor/foliate-js/LICENSE](src/vendor/foliate-js/LICENSE).
