# Technical documentation

This document explains how the app is put together: what each piece does, which third-party APIs are used, and the non-obvious decisions. See [README.md](README.md) for the user-facing feature list and install instructions.

## 1. What the app does

`web-book-reader` is a single-page React app that runs entirely in the browser. The user drags one or more e-book files onto the page; each file is parsed client-side, stored as a `Blob` in IndexedDB with extracted metadata (title, author, cover), and rendered as a card in the library. Opening a book mounts a `<foliate-view>` custom element that handles the actual rendering and pagination of the book content inside a sandboxed iframe. Reading position, layout preferences, and a global reading-speed estimate are all persisted locally.

There is no backend. Books never leave the browser.

## 2. Stack choices

| Concern              | Choice                                | Why                                                                                                 |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Build tool           | Vite 5                                | Fast dev server, good ESM handling — important because foliate-js is distributed as ESM source.     |
| UI framework         | React 18 + TypeScript                 | Familiar, and types keep the foliate wrapper honest.                                                |
| Styling              | Tailwind v3 + shadcn/ui (hand-copied) | Tailwind for layout; shadcn primitives copied into `src/components/ui/` (no runtime dep).           |
| Book parser/renderer | foliate-js (vendored)                 | Only actively-maintained browser-side library that handles MOBI, KF8/AZW3, and EPUB uniformly.      |
| Persistence          | IndexedDB via `idb`                   | Book blobs can be multiple MB; localStorage is too small and sync-only.                             |
| Routing              | react-router-dom `HashRouter`         | Works under a GitHub Pages subpath with no 404.html fallback needed.                                |
| Icons                | lucide-react                          | Lightweight, tree-shakeable.                                                                        |
| Toasts               | sonner                                | Minimal, composable.                                                                                |

### Why foliate-js (and why vendored)

MOBI is Amazon's proprietary format, with multiple variants (old MOBI / PalmDOC, KF8/AZW3). Most browser-side MOBI parsers on npm are abandoned. foliate-js is the one project that covers MOBI, KF8, EPUB, FB2, and CBZ together, provides a built-in paginator with reflow and a CFI-style locator system for saving reading position, and has a clean ESM custom-element API.

It is not published to npm. The canonical distribution is the source repository. We clone it into [src/vendor/foliate-js/](src/vendor/foliate-js/) and let Vite bundle it alongside our code. This is the approach the foliate-js README itself recommends.

Consequences:

- Dynamic imports like `import('./mobi.js')` are preserved as code-split chunks by Vite, so MOBI parsing code is only downloaded when a MOBI file is opened.
- PDF support was removed: [src/vendor/foliate-js/pdf.js](src/vendor/foliate-js/pdf.js) was replaced with a stub that throws, and the `vendor/pdfjs/` subtree was deleted. This was to sidestep a Vite build error caused by foliate's `import.meta.glob('vendor/pdfjs/**')` call (Vite requires relative globs to start with `./`), and because PDF support is out of scope.
- TypeScript types for foliate-js live in [src/vendor/foliate-js/view.d.ts](src/vendor/foliate-js/view.d.ts) — a hand-written minimal surface covering the methods and events we actually use.

## 3. Directory layout

```
src/
  main.tsx                          # HashRouter + App root
  App.tsx                           # <Routes>: "/" → Library, "/read/:bookId" → Reader
  index.css                         # Tailwind layers + CSS custom properties for light/dark/sepia themes
  routes/
    library/                        # Library screen, colocated components + hooks
      Library.tsx
      components/
        BookCard.tsx
        EmptyLibrary.tsx
      hooks/
        useBookList.ts              # lists, adds, deletes books via idb wrapper
    reader/                         # Reader screen, colocated components + hooks
      Reader.tsx                    # thin shell wiring hooks together
      components/
        ReaderTopbar.tsx            # title, progress, time estimates, toc/settings buttons
        ReaderNav.tsx               # keyboard + click zones for page turns
        TocSheet.tsx                # chapter navigation (flat TOC, current highlighted)
        SettingsSheet.tsx           # flow, font, size, line-height, margins, theme
      hooks/
        useFoliateView.ts           # mounts/tears down <foliate-view>
        useReadingProgress.ts       # listens to relocate, debounced progress save
        useLayoutSettings.ts        # loads/applies/saves layout preferences
        useReadingSpeed.ts          # measures reading rate, produces time estimates
        useToc.ts                   # flattens book.toc into a renderable list
  components/
    DropZone.tsx                    # shared drag-drop surface (used only by Library today)
    ui/                             # shadcn primitives: button, card, sheet, slider, toggle-group, tooltip
  lib/
    db.ts                           # idb schema, stores: books, progress, settings, stats
    book.ts                         # foliate-js wrapper: extractMetadata, buildContentCSS, detectFormat
    fonts.ts                        # font registry + Google Fonts loader helper
    storage.ts                      # last-opened book id in localStorage
    utils.ts                        # cn() class-merge helper
  vendor/
    foliate-js/                     # vendored upstream, PDF stubbed out
```

The **convention**: each route owns its own `components/` and `hooks/` folders. `src/components/` is reserved for shared UI (drop zone, shadcn primitives). Hooks are colocated with the route that uses them so that each screen can be read top-to-bottom without scattering across a flat tree.

## 4. Data flow

### Adding a book

`Library.tsx` renders a full-viewport `DropZone`. On drop:

1. `useBookList.addFiles(files)` runs each file through [src/lib/book.ts](src/lib/book.ts)'s `detectFormat` (extension sniffing) and rejects unknown types with a toast.
2. For accepted files, `extractMetadata(file)` calls foliate-js's `makeBook(file)` once to pull `title`, `author`, and (optionally) a cover `Blob`.
3. A `BookRecord` is written to the `books` store in IndexedDB with a random UUID, the original `File` preserved as a `Blob`, and the metadata.
4. The library list refreshes.

### Opening a book

`/read/:bookId` mounts `Reader.tsx`, which is a thin shell that composes several hooks:

1. **Load phase.** `Reader` reads the `BookRecord` and any existing `ProgressRecord` from IDB. The `blob` is not passed to the foliate hook until the locator is resolved, so the initial `view.init({ lastLocation })` can jump straight to the saved position.
2. **`useFoliateView(containerRef, blob, initialLocator)`** creates a `<foliate-view>` element, appends it to the container, awaits `view.open(blob)`, then calls `view.init({ lastLocation, showTextStart })`. On unmount it calls `view.close()` and removes the element.
3. **`useReadingProgress(view, bookId)`** attaches a listener to foliate's `relocate` event. Each event carries `fraction`, `cfi`, `tocItem`, `pageItem`, and timing info. The hook stores `{ locator: cfi, percent: fraction, updatedAt }` back to the `progress` store, debounced at 400 ms.
4. **`useLayoutSettings(view)`** loads `LayoutSettings` from IDB, applies them via `view.renderer.setStyles(css)`, `renderer.setAttribute('flow', …)`, and `renderer.setAttribute('max-column-count', …)`. It also toggles the `dark`/`sepia` class on `<html>` so the UI chrome follows the theme.
5. **`useReadingSpeed(view)`** — see §6.
6. **`useToc(view)`** flattens `view.book.toc` into a display-friendly list. Clicking a chapter calls `view.goTo(href)`.

### Navigation input

[ReaderNav.tsx](src/routes/reader/components/ReaderNav.tsx) binds keyboard shortcuts (ArrowLeft/PageUp → `view.goLeft()`, ArrowRight/PageDown/Space → `view.goRight()`) and renders two absolutely-positioned transparent buttons on the left and right 15% of the reader surface for click/tap navigation. The book content itself lives inside foliate's iframe, which has its own click handlers for link navigation — we don't interfere with those.

## 5. IndexedDB schema

Database: `online-mobi-reader`, version **2**.

```ts
books: {
  key: string                       // uuid
  value: {
    id, title, author,
    cover?: Blob,
    format: 'mobi' | 'epub' | ...,
    addedAt: number,
    blob: Blob,                     // the original file bytes
    filename: string,
  }
  indexes: { 'by-addedAt': number }
}
progress: {
  key: string                       // bookId
  value: { bookId, locator: string /* CFI */, percent: number, updatedAt }
}
settings: {
  key: string                       // fixed key 'layout'
  value: LayoutSettings
}
stats: {                            // added in v2
  key: string                       // fixed key 'global'
  value: { emaRate, sampleCount, totalActiveMs, updatedAt }
}
```

The schema migration in [src/lib/db.ts](src/lib/db.ts) is guarded by `oldVersion` checks so v1 users get `stats` added without losing their `books`, `progress`, or `settings`.

`LayoutSettings` currently includes:

```ts
{
  fontSize, lineHeight, marginInline, columnWidth,
  theme: 'light' | 'dark' | 'sepia',
  flow: 'paginated' | 'scrolled',
  maxColumns: 1 | 2,
  fontFamily: string,
  showEstimates: boolean,
}
```

The reader UI exposes `flow` and `maxColumns` as a combined three-way toggle (Single / Spread / Scroll) but stores them as independent fields. `showEstimates` gates the whole time-remaining block in the top bar without affecting measurement.

## 6. Reading-speed estimator

Located in [src/routes/reader/hooks/useReadingSpeed.ts](src/routes/reader/hooks/useReadingSpeed.ts). Two independent pieces drive the estimates:

### 6.1 Reading-rate EMA

The foliate-js `relocate` event fires on every page turn and carries `fraction` — the reader's position in the book, `0..1`.

On each event, the hook computes a global exponential moving average of reading rate (fractions-of-book per millisecond):

```
rate_new = α · (Δfraction / Δtime) + (1 − α) · rate_old      (α = 0.2)
```

Samples are **rejected** when:

- `Δtime < 750 ms` (spammed page turns would skew rate high)
- `Δtime > 5 min` (user went AFK)
- `Δfraction ≤ 0` (navigated backwards)

Estimates are gated on **≥ 60 s of cumulative valid active reading** (`totalActiveMs`) to avoid flashing a bogus first-open number. The EMA rate and cumulative active time are persisted to the `stats` store in IndexedDB at 1.5 s debounce, so reopening a book doesn't require re-warming up. The rate is **global**, not per-book — reading dense philosophy and an airport thriller feed the same EMA. Splitting it per-book is a one-line key change if ever wanted.

Once ready: `bookMsRemaining = (1 − fraction) / rate`.

### 6.2 Chapter boundaries

Chapter time needs to know where each chapter ends in book fractions. foliate-js doesn't expose that directly, but it does expose enough primitives to compute it.

On book open, the hook asynchronously builds a sorted list of chapter-start fractions:

1. Flatten `view.book.toc` into a list of hrefs.
2. Group hrefs by the section index they resolve to (via `book.resolveHref(href)`), so each spine section's DOM is parsed at most once.
3. For each section with at least one TOC entry, `await section.createDocument()` to get its DOM.
4. For each chapter anchor in that section, call `anchor(doc)` — returns either the anchor `Element`, a `Range`, or `0` (section-level entry). For an Element, compute a `Range` from `<body>` start to `setEndBefore(element)` and use `range.toString().length / body.textContent.length` as the within-section text-offset fraction.
5. Convert to book fraction: `sectionFractions[i] + within × (sectionFractions[i+1] − sectionFractions[i])`, where `sectionFractions` comes from `view.getSectionFractions()`.
6. Append `1.0` as the terminal boundary so the last chapter has a real end.

This matters because many MOBIs ship the whole book as one spine section with chapter markers (e.g., `<div id="filepos123">`) embedded inside. Without step 4, all chapters collapse to the same boundary.

Once boundaries are ready, on each relocate:

```
nextBoundary = smallest b in boundaries with b > fraction
chapterMsRemaining = (nextBoundary − fraction) / rate
```

Computation is **async and deferred** — there's a brief window on book open where `boundariesRef.current` is still `[]` and the chapter estimate equals the book estimate. In practice this resolves in well under a second for typical books; a 30-chapter book means ~30 DOM parses (deduped by section).

### 6.3 Caveats

- **Text-length vs byte-size mismatch.** `sectionFractions` comes from foliate's size-based accounting (byte range for MOBI, file size for EPUB), while within-section position is measured in visible text characters. These don't compose linearly, so boundaries have some imprecision — usually fine for time estimates (which are coarse anyway) but it's why we explicitly don't try to report "pages remaining in chapter" (that would amplify the error to an obvious ±3–4 page offset).
- **Anchors with no fragment.** EPUBs where a TOC entry points to a whole section file (no `#fragment`) resolve `anchor(doc)` to `0` and collapse to section-start. Same for MOBIs without `filepos` markers.
- **Fixed-layout / PDF.** Fixed-layout books don't use the paginator and don't get per-page section fractions the same way; the estimator gracefully degrades to "book only" in those cases. PDF support is stubbed out anyway.

### 6.4 User-controlled visibility

`LayoutSettings.showEstimates` (default `true`) gates the whole time-remaining block in the top bar. When off, the top bar hides the entire percent + estimates cluster, but the hook keeps measuring silently so the EMA stays calibrated. Flipping it back on is instant.

Formatting is handled by `formatDuration(ms)`: `< 1 min`, `N min`, `Hh Mm`.

## 7. Theming

Three themes: `light`, `dark`, `sepia`. Two places to keep in sync:

- **UI chrome** (top bar, sheets, cards): standard shadcn-style CSS custom properties defined in [src/index.css](src/index.css) under `:root`, `.dark`, and `.sepia`. The `useLayoutSettings` hook adds/removes the class on `<html>`.
- **Book content** (inside the foliate iframe): `buildContentCSS(settings)` in [src/lib/book.ts](src/lib/book.ts) produces a CSS string with `color`, `background`, and link color per theme, and this is injected into the iframe via foliate's `view.renderer.setStyles(css)` API.

Changing a theme in settings both flips the class on `<html>` and re-runs `setStyles`, so the chrome and the book content shift together.

## 8. Fonts

Font registry is in [src/lib/fonts.ts](src/lib/fonts.ts). Each entry has an `id` (persisted in settings), a CSS `stack`, and an optional `googleFontsName`.

Because the book content renders inside a sandboxed iframe, the outer page loading Google Fonts does not help the iframe — each document loads its own fonts. The fix in `buildContentCSS` is to put `@import url('https://fonts.googleapis.com/css2?…')` as the **first rule** of the injected stylesheet. Browsers load it into the iframe; subsequent renders are cached.

Default font is **Literata** because it is the open-source font designed for Google Play Books and is the closest freely-bundleable look-alike to Amazon's proprietary Bookerly, which cannot be legally redistributed.

The `font-family` is applied as `!important` on `body`, `p`, `li`, `blockquote`, `div`, `span` because many EPUBs specify their own inline font stacks and we want the user's choice to win.

## 9. Routing and deployment

### HashRouter, not BrowserRouter

GitHub Pages serves the app under `/web-book-reader/`. Deep links like `/read/:bookId` would 404 on refresh under a subpath unless you either:

1. Use `HashRouter` — URLs become `/web-book-reader/#/read/:id`. Nothing server-side to configure.
2. Use `BrowserRouter` + a `404.html` that redirects back to `index.html` with the path preserved (the "Spandy SPA redirect" trick).

We picked option 1 for simplicity. If we ever move to a custom domain or a user/org site at the root, we can switch to `BrowserRouter` without touching anything else.

### Vite base

[vite.config.ts](vite.config.ts) sets `base: '/web-book-reader/'`. This must match the repo slug on GitHub Pages. Changing the repo name requires updating this line.

### GitHub Actions

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) triggers on push to `master`. It checks out, installs via `npm ci` (so a committed `package-lock.json` is required), runs `npm run build`, and publishes `dist/` through the official `actions/deploy-pages` flow. No secrets; uses the repository's built-in `GITHUB_TOKEN` with `pages: write` permission.

To reuse under a different repo name or branch: edit the `base` in [vite.config.ts](vite.config.ts) and `branches:` in the workflow. For a custom domain, drop a `CNAME` file into `public/` and switch back to `BrowserRouter` in [src/main.tsx](src/main.tsx).

## 10. Third-party APIs used

### foliate-js (the ones we actually call)

| API                                              | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `makeBook(file)`                                 | Format-sniffs a Blob and returns a parsed `FoliateBook` with metadata and TOC                            |
| `<foliate-view>` custom element                  | Renders paginated/scrolled book content inside a sandboxed iframe                                        |
| `view.open(blob)`                                | Opens a book; constructs the renderer                                                                    |
| `view.init({ lastLocation, showTextStart })`     | Seeks to a saved CFI or to the start of the body matter                                                  |
| `view.goTo(href)` / `goLeft()` / `goRight()`     | Navigation                                                                                               |
| `view.book.metadata` / `.toc` / `.getCover()`    | Metadata extraction                                                                                      |
| `view.book.resolveHref(href)`                    | Returns `{ index, anchor(doc) }` for a TOC target — used to compute per-chapter book fractions (see §6.2)|
| `view.getSectionFractions()`                     | Book-level fractions for each spine section start — also used in boundary computation                    |
| `book.sections[i].createDocument()`              | Loads a section's DOM so we can measure a chapter anchor's text offset within it                         |
| `view.renderer.setStyles(css)`                   | Inject user CSS into the content iframe                                                                  |
| `view.renderer.setAttribute('flow', …)`          | Toggle paginated vs scrolled                                                                             |
| `view.renderer.setAttribute('max-column-count')` | Single-page vs two-page spread                                                                           |
| `relocate` event                                 | Fires on every page turn; payload drives progress saves and time estimates                               |

### Browser APIs

- **IndexedDB** (via `idb`) — primary persistence.
- **localStorage** — last-opened book id only.
- **FileReader / Blob / File** — drag-drop, cover images via `URL.createObjectURL`.
- **Shadow DOM / custom elements** — foliate-js uses a closed shadow root to host its iframe and paginator element.

### Google Fonts

Loaded via a single `@import` at the top of the content CSS injected into the foliate iframe (see §8).

## 11. Known limitations

- **DRM.** Any Amazon / Adobe-protected file will fail to parse with a "possibly DRM-protected or unsupported" toast.
- **Per-browser scope.** IndexedDB is scoped to origin + browser profile + device. No sync.
- **Chapter boundary imprecision.** Byte-size sectioning vs text-length within-section measurement don't compose linearly — boundaries are close but not exact. Good enough for minute-level time estimates; explicitly not precise enough for a "pages remaining in chapter" counter (see §6.3).
- **Global reading speed.** One EMA across all books.
- **Chapter-boundary warmup.** On book open, boundary computation runs async; during the first fraction of a second the chapter estimate may equal the book estimate.
- **First-load font flash.** Reader content shows the fallback font briefly while Google Fonts loads inside the iframe; subsequent opens are cached.
- **PDF explicitly disabled.** See §2.
- **Mobile gestures.** Click zones and keyboard work, but no dedicated swipe handling.

## 12. Future work (not yet started)

- Per-book reading-speed profile (detect reading mode switches).
- Full-text search (foliate's `search.js` is already vendored).
- Bookmarks, highlights, and notes.
- Reading stats page (time-per-day, books-per-month).
- Cloud sync (requires a backend; would also unlock cross-device).
- Swipe gestures on touch.
