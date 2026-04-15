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
        ReaderTopbar.tsx            # title, progress, time estimates, mic + play/pause, toc/settings buttons
        ReaderNav.tsx               # keyboard + click zones for page turns
        TocSheet.tsx                # chapter navigation (flat TOC, current highlighted)
        SettingsSheet.tsx           # flow, font, size, line-height, margins, theme, voice, rate, pitch
      hooks/
        useFoliateView.ts           # mounts/tears down <foliate-view>
        useReadingProgress.ts       # listens to relocate, debounced progress save
        useLayoutSettings.ts        # loads/applies/saves layout preferences
        useReadingSpeed.ts          # measures reading rate, produces time estimates
        useToc.ts                   # flattens book.toc into a renderable list
        useVoiceNav.ts              # "next" / "back" voice commands (SpeechRecognition)
        useTTS.ts                   # audiobook playback (SpeechSynthesis + foliate TTS)
        useSpeechVoices.ts          # reactive list of browser TTS voices
  components/
    DropZone.tsx                    # shared drag-drop surface (used only by Library today)
    ui/                             # shadcn primitives: button, card, sheet, slider, toggle-group, tooltip
  lib/
    db.ts                           # idb schema, stores: books, progress, settings, stats
    book.ts                         # foliate-js wrapper: extractMetadata, buildContentCSS, detectFormat
    fonts.ts                        # font registry + Google Fonts loader helper
    storage.ts                      # last-opened book id in localStorage
    utils.ts                        # cn() class-merge helper
    ttsWorker.ts                    # Cloudflare Worker client (synthesize, listCloudVoices)
    cloudVoices.ts                  # curated Google voice shortlist shown in the cloud picker
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
7. **`useVoiceNav(view, enabled)`** — see §6a.

### Navigation input

[ReaderNav.tsx](src/routes/reader/components/ReaderNav.tsx) binds keyboard shortcuts (ArrowLeft/PageUp → `view.goLeft()`, ArrowRight/PageDown/Space → `view.goRight()`) and renders two absolutely-positioned transparent buttons on the left and right 15% of the reader surface for click/tap navigation. The book content itself lives inside foliate's iframe, which has its own click handlers for link navigation — we don't interfere with those.

Voice commands plug into the same `view.goLeft()` / `view.goRight()` calls — see §6a.

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
  voiceNavEnabled: boolean,
  ttsProvider: 'browser' | 'cloud',
  ttsVoiceURI: string | null,   // used when ttsProvider === 'browser'
  ttsCloudVoice: string,         // used when ttsProvider === 'cloud' (Google voice name)
  ttsRate: number,
  ttsPitch: number,              // only applied to the browser provider
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

## 6a. Voice navigation

Located in [src/routes/reader/hooks/useVoiceNav.ts](src/routes/reader/hooks/useVoiceNav.ts). Lets the user say **"next"** or **"back"** to turn pages — primarily for hands-free reading on a VR headset (Meta Quest Browser is Chromium-based and supports the API). Free, no backend.

### How

- Uses the browser's **Web Speech Recognition API** (`window.SpeechRecognition` / `webkitSpeechRecognition`). Type declarations live in [src/types/speech-recognition.d.ts](src/types/speech-recognition.d.ts) since these APIs aren't in `lib.dom.d.ts` yet.
- Configured with `continuous: true`, `interimResults: true`, `maxAlternatives: 3`. Interim results matter for latency: a single-word command lands within ~100–200 ms instead of waiting ~1 s for end-of-utterance silence. Multiple alternatives mean a slightly-mumbled word still triggers if the right keyword shows up in the recognizer's secondary guesses.
- On each result event we iterate from `ev.resultIndex` and check every alternative for the keyword set — `next` → `view.goRight()`, `back` → `view.goLeft()`.
- Browsers auto-terminate continuous recognition periodically; the `onend` handler restarts it as long as the user-visible toggle is still on.

### The dedupe trick

Interim results re-fire for the same utterance over its lifetime (multiple interim updates → final). A naive time-based debounce produced **2–3 page turns per "next"** because the recognizer kept re-emitting the matched transcript past the debounce window.

The fix is to dedupe by **utterance index** rather than time. Each `i` in `SpeechRecognitionResultList` corresponds to one utterance; updates to that utterance (interim → final) keep the same `i`. The hook keeps `handledResultIndexRef` and skips any `i ≤ handled`. New utterances at higher indices still trigger normally. Reset on `onstart` so a recognition restart begins fresh.

### Permissions and capability

- The mic button in [ReaderTopbar.tsx](src/routes/reader/components/ReaderTopbar.tsx) is **only rendered if `SpeechRecognition` exists** on `window` — Firefox doesn't have it, so the toggle simply doesn't show there.
- First toggle prompts the browser permission dialog. If the user denies, `onerror` fires with `not-allowed`; we toast and force-flip `voiceNavEnabled` back off so the icon state matches reality.
- `LayoutSettings.voiceNavEnabled` (default `false`) persists the user's choice in IDB.

### Privacy note

Chromium routes recognition audio through Google's cloud — "free + no backend we run" is not the same as "fully offline." For two short keywords this is a reasonable tradeoff, but worth knowing.

## 6b. Audiobook mode (TTS)

Located in [src/routes/reader/hooks/useTTS.ts](src/routes/reader/hooks/useTTS.ts) plus helpers [useSpeechVoices.ts](src/routes/reader/hooks/useSpeechVoices.ts), [src/lib/ttsWorker.ts](src/lib/ttsWorker.ts) (Cloudflare Worker client), and [src/lib/cloudVoices.ts](src/lib/cloudVoices.ts) (curated voice shortlist).

Two **providers** live behind the same play/pause button. `LayoutSettings.ttsProvider` picks which is active; both drive the same foliate `TTS` class so the upstream plumbing (segmentation, click-to-jump, section-advance, cancel-on-user-nav) is shared.

- **Cloud (default)** — uses Google Cloud Text-to-Speech Neural2 / Chirp-HD / Studio voices fetched through our own Cloudflare Worker at `https://web-book-reader-tts.sebastianbarros1995.workers.dev`. The Worker is a separate repo ([web-book-reader-tts](https://github.com/SebastianBarros/web-book-reader-tts)), proxies Google's API with the secret key held server-side, and gates access via an `ALLOWED_ORIGINS` check. Full setup + reference in [cloudflare-google-tts.md](cloudflare-google-tts.md). Free within 1M chars/month for the reader's typical use.
- **Browser** — uses `window.speechSynthesis` with the OS's built-in voices. No network, but quality varies by OS. Good fallback when offline.

### What foliate gives us

foliate-js ships a `TTS` class at [src/vendor/foliate-js/tts.js](src/vendor/foliate-js/tts.js) that does the hard work: `Intl.Segmenter`-based sentence/word segmentation, invisible `<foliate-mark>` elements inserted into a cloned fragment for position tracking, and a `highlight(range)` callback we pass to `view.initTTS(granularity, highlight)`. It emits **SSML strings** rather than audio, so it's synthesizer-agnostic. The API we drive: `start()`, `next()`, `resume()`, `from(range)`, `setMark(name)`.

### Shared parsing layer

Both providers go through `parseSsml(ssml)` which returns `{ text, marks[] }`, where `marks[i] = { name, offset }` gives the character offset in the plain text at which each `<foliate-mark>` appears. Text nodes are concatenated, `<break>` elements emit `". "` to preserve pause prosody, and everything else is traversed for children. Modern neural voices infer prosody from punctuation well enough that dropping richer SSML is imperceptible.

### Browser provider — serial

1. **Play** — `tts.from(view.lastLocation.range)` for the first block (start at user's current visible position), or `tts.resume()` for a resume-from-pause.
2. **Speak** — create a `SpeechSynthesisUtterance(text)`, set voice / rate / pitch from the current options ref (so mid-playback setting changes take effect at the next block). Wire:
   - `onstart` → `tts.setMark(marks[0].name)` (foliate scrolls to the first word).
   - `onboundary` (word-level events) → `findMarkAt(marks, ev.charIndex)` → `tts.setMark(name)` (drives auto-page-turn as words cross page boundaries).
   - `onend` → `tts.next()` + speak, or advance to the next spine section if the iterator is exhausted.
   - `onerror` → ignore `'interrupted'`/`'canceled'` (our pause path), surface anything else.
3. **Pause** — `speechSynthesis.cancel()` because Chromium's native `pause()`/`resume()` is unreliable; resume calls `tts.resume()` which re-emits the current block from the last mark.

### Cloud provider — prefetch queue

Cloud synthesis has network latency, so the cloud path keeps a sliding window of **5 blocks ahead**. Each queue item ([src/routes/reader/hooks/useTTS.ts](src/routes/reader/hooks/useTTS.ts) — `CloudQueueItem`) carries:

```ts
{
  parsed,             // { text, marks[] }
  aborter,            // AbortController for its fetch
  fetchPromise,       // resolves to Blob | null
  url,                // blob URL once fetch succeeds
  disposed,           // true when the item is consumed / evicted
  failed,             // true after retries exhausted
  failureMessage,
  firstRange,         // DOM Range of the block's first word (see "Highlight trick")
}
```

**Flow:**

1. **Play** clears any stale queue, calls `tts.from(currentRange)` (or `tts.start()` at section boundary) to get block 0's SSML, pushes it as `queue[0]` with a fetch started. `topUpCloudQueue()` then pulls blocks 1–4 via `tts.next()` and kicks their fetches in parallel.
2. **`playCloudHead()`** awaits `queue[0].fetchPromise` (usually resolved — we started it ≥1 block ago), then plays its blob via a single persistent `<audio>` element.
3. **`audio.onended`** shifts the head, revokes its blob URL, calls `topUpCloudQueue()` (which pulls block 5 and starts its fetch), then calls `playCloudHead()` again. The next block's audio is already fetched, so there's **zero gap**.
4. **Section boundary** — when `tts.next()` returns `undefined`, `cloudSectionExhaustedRef` is set. Queue drains, `playCloudHead()` sees it, calls `advanceSection()` (shared with the browser path), re-inits TTS, primes from `tts.start()`.

### The highlight trick

The cloud path can't use foliate's `tts.setMark()` during playback. Reason: each call to `tts.next()` overwrites the TTS class's private `#ranges` map (it's a single shared Map — see [tts.js:214](src/vendor/foliate-js/tts.js#L214)). By the time block 0 actually starts playing, we've already prefetched blocks 1–4 and `#ranges` holds block 4's word positions. A `setMark('0')` call would then highlight block 4's first word instead of block 0's.

The fix is to **capture each block's first-word Range at pull-time** while foliate's map still matches it. Right after `tts.next()` returns block N's SSML, we install a capture closure in `captureRangeRef`, fire `tts.setMark(marks[0].name)`, and intercept the range our custom highlight callback receives. We stash that Range on the queue item and use it later when block N actually plays — `view.renderer.scrollToAnchor(item.firstRange, true)` turns the page at the right moment.

The custom highlight callback passed into `view.initTTS('sentence', highlight)` dispatches on whether a capture closure is currently installed: if yes, capture silently without scrolling; otherwise fall back to the default scroll. That keeps the browser provider (which relies on the default scroll via `setMark` on boundary events) working unchanged.

### Retry and fail-stop

Transient network errors are common. Each block's fetch goes through `synthesizeWithRetry` — up to **4 attempts** total with backoffs of **0.5 s, 2 s, 5 s**. The abort signal short-circuits the retry loop instantly on pause or navigation.

If all retries fail, the queue item's `.failed` flag is set, and its `fetchPromise` resolves to `null` (we don't throw to the queue — that would kill the whole pipeline). The queue keeps fetching ahead: a failed block N does **not** stop prefetches for blocks N+1, N+2… because they might be unrelated to whatever broke.

When `playCloudHead()` eventually reaches the failed head, it **stops playback** with `status = 'error'` and an error message that references the underlying failure. Reader surfaces this via a sonner toast. The user hits play again to retry — that path calls `tts.from(currentRange)` and rebuilds the queue from scratch.

### Pause vs cancel

- **Pause** (`pauseAudioOnly`) pauses the audio element only. The queue stays hot, in-flight fetches keep completing in the background, blob URLs stay alive. Resume is instant — `audio.play()` picks up from the same `currentTime`.
- **Cancel** (`cancelEverything`) is used by stop, manual page-turn, and click-to-jump. Aborts every in-flight fetch, revokes every blob URL, clears the queue, resets the audio element.

### Loading indicator

`useTTS` exposes `loading: boolean`, flipped true whenever we're about to play a head whose audio hasn't landed yet. [Reader.tsx](src/routes/reader/Reader.tsx) renders a **floating pill** at the bottom-center of the reader viewport when that's true for ≥250 ms (so fast fetches don't flash it): spinner + "Waiting for next paragraph…". The top-bar play/pause button also swaps to a spinner in-place so the control feedback matches. Delay prevents UI flash on the common case where block N's audio is already queued before block N−1 finishes.

### Click-to-jump

A click listener on the loaded section doc watches for clicks on block-level elements (`p, li, blockquote, h1–h6, dd, dt, pre, figcaption`), skips link clicks (foliate handles those), builds a `Range` over the clicked block, cancels the current queue, and primes a fresh queue from `tts.from(range)`. Works for both providers.

### Voice / rate / pitch settings

- `ttsCloudVoice` picks from a curated shortlist in [cloudVoices.ts](src/lib/cloudVoices.ts) — four Google voices chosen by ear for Spanish audiobook quality: `es-US-Chirp-HD-F` (default), `es-US-Chirp-HD-D`, `es-ES-Chirp-HD-F`, `es-ES-Neural2-G`. The worker exposes `GET /voices?languageCode=…` if we ever want to show the full catalog.
- `ttsVoiceURI` is the browser provider's selected voice; [useSpeechVoices.ts](src/routes/reader/hooks/useSpeechVoices.ts) lists voices reactively (listens for the `voiceschanged` event since `getVoices()` often returns `[]` on first call). Grouped by language, user's locale first.
- `ttsRate` (0.5–2.0) applies to both providers — for cloud it's sent to Google as `speakingRate`; for browser it's set on the utterance.
- `ttsPitch` (0.5–2.0) only applies to the browser provider (Google uses a different pitch scale; we don't expose it to keep the UI simple).
- Options are read from a ref on every new utterance / block, so changes take effect at the next block boundary rather than mid-sentence.

### Known quirks

- **Chrome pauses `speechSynthesis` when the tab is backgrounded** on some platforms (browser provider only). Not fought.
- **First block always has some latency** (fetch time, ~200–700 ms) — unavoidable, we can't prefetch what we don't have yet. Subsequent blocks should feel instant.
- **Voices load asynchronously** for browser provider; picker may show "Loading…" briefly.
- **Quest 3 Browser.** Chromium-based; cloud provider and click-to-jump both work. Browser provider quality depends on the headset OS's bundled voice.

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
| `view.initTTS(granularity, highlight)`           | Constructs a foliate `TTS` instance over the current section's DOM (see §6b). We pass a custom highlight callback that supports a capture mode used at prefetch-time |
| `view.tts.from(range)` / `start()` / `next()` / `resume()` / `setMark(name)` | Drive audiobook playback (see §6b)                                                     |
| `view.lastLocation.range`                        | Current visible range — fed to `tts.from()` so TTS starts at the reader's position                       |
| `view.renderer.scrollToAnchor(range, smooth)`    | Turn the paginator to a given Range. Cloud provider calls it directly with per-block `firstRange` captured at prefetch (see §6b "Highlight trick") |
| `load` event                                     | Fires with `{ doc, index }` each time foliate mounts a section DOM; we use it to attach the click-to-jump handler |
| `relocate` event                                 | Fires on every page turn; payload drives progress saves, time estimates, and TTS cancel-on-user-nav      |

### Cloudflare Worker endpoints

Hosted at `https://web-book-reader-tts.sebastianbarros1995.workers.dev` ([repo](https://github.com/SebastianBarros/web-book-reader-tts)):

| Endpoint                                    | Purpose                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /tts` `{ text, voice?, rate?, pitch? }` | Returns `audio/mpeg`. Max 5000 chars per call. Rate/pitch clamped server-side. |
| `GET /voices?languageCode=es-ES`            | Proxies Google's voice catalog, filtered by language code if provided.          |
| `GET /`                                     | Plain-text liveness check.                                                      |

The Worker holds the Google API key as an encrypted secret and gates requests via an `ALLOWED_ORIGINS` check. Full setup/architecture lives in [cloudflare-google-tts.md](cloudflare-google-tts.md).

### Browser APIs

- **IndexedDB** (via `idb`) — primary persistence.
- **localStorage** — last-opened book id only.
- **FileReader / Blob / File** — drag-drop, cover images via `URL.createObjectURL`.
- **Shadow DOM / custom elements** — foliate-js uses a closed shadow root to host its iframe and paginator element.
- **Web Speech Recognition API** — voice page-turn commands (see §6a). Capability-detected; absent in Firefox.
- **Web Speech Synthesis API** (`window.speechSynthesis`, `SpeechSynthesisUtterance`) — audiobook playback (see §6b). Word-boundary events (`onboundary`) drive auto-page-turn; `voiceschanged` event drives the async voice picker.

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
- **Voice nav is Chromium-only.** Firefox has no `SpeechRecognition`. The mic button hides itself when unsupported. Audio is routed through Google's cloud by Chromium for recognition.
- **Audiobook browser-provider quality is OS-dependent.** When using the Browser TTS provider, quality depends on the OS's built-in voices. This is why the default provider is Cloud (Google).
- **Cloud TTS requires internet.** Obvious but worth noting: the default audiobook provider is the Cloudflare + Google TTS pipeline. Offline sessions need the Browser provider toggled on in Settings.
- **Google TTS free tier.** 1M chars/month Neural2 covers ~2.5 novels. A single personal user won't hit this; if the worker were ever opened to more users, the $1 budget alert would warn first.
- **No per-word highlight in cloud mode.** Google returns a single MP3 per block without time-points by default; we scroll per block, not per word. Fine for paragraph-sized blocks.
- **Chromium pauses `speechSynthesis` when the tab is backgrounded** on some platforms — not something we fight. Browser provider only; cloud provider's `<audio>` element keeps playing.

## 12. Future work (not yet started)

- Per-book reading-speed profile (detect reading mode switches).
- Full-text search (foliate's `search.js` is already vendored).
- Bookmarks, highlights, and notes.
- Reading stats page (time-per-day, books-per-month).
- Cloud sync (requires a backend; would also unlock cross-device).
- Swipe gestures on touch.
