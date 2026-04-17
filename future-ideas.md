# Future ideas

A parking lot for features we've discussed but haven't built yet. Organized by effort, not priority — revisit when picking what's next.

> Conventions: **small** ≈ a few hours, **medium** ≈ ~1 day, **big** ≈ 2–5 days, **huge** ≈ week+ / requires architectural changes.

## Tier 1 — Small polish (hours, high value)

- [ ] **Keyboard shortcut for play/pause** — `P` key. Small.
- [ ] **Skip forward / back 15s (or one paragraph)** in audiobook mode. Small.
- [x] **Sleep timer: stop at end of chapter.** (Shipped — moon icon in top bar during playback. Block-based chapter detection via per-doc id-map + DOM-position comparison; see §6b in doc.md for the rabbit hole it turned into.)
- [ ] **Sleep timer: time-based** — "stop after 15 / 30 / 60 minutes". Expand the moon-icon button into a popover with options alongside "end of chapter". The sleepMode state machine in `useTTS` already supports switching modes and clearing on transitions, so this mostly means a new `'timer:<ms>'` variant + a `setTimeout` in the hook. Small.
- [ ] **Speed preset chips** (1× / 1.25× / 1.5× / 1.75× / 2×) as an alternative to the rate slider. Slider is fiddly in VR. Small.
- [ ] **Persist audiobook position per book.** Currently reopen = restart from top-of-page. A second CFI per book for TTS would resume exactly. Small.
- [ ] **Focus mode.** Auto-hide top bar after a few seconds of no interaction; reveal on tap/mouse. Small.
- [ ] **Per-book reading speed.** Currently the EMA is global. Split by `bookId` — prevents dense-philosophy and airport-thriller from contaminating each other's estimates. Small.
- [ ] **TOC search input** — filter the flattened chapter list. For books with 200+ chapters. Small.

## Tier 2 — Meaty, medium effort

- [ ] **Search within book.** Foliate's `search.js` is already vendored. Wire a `Command` dialog, call `view.search(query)`, render hits with `view.goTo(cfi)` on click. Medium.
- [ ] **Bookmarks.** Multi per book, named. New IDB store. Button in top bar + sheet alongside TOC. Medium.
- [ ] **Dictionary lookup (Spanish).** Double-tap or long-press a word → popup with RAE / Wiktionary definition. Genuinely useful even for native speakers (regional / archaic words). Medium.
- [ ] **Translation overlay.** Select a sentence → "translate" button → popup. Could proxy through the existing Cloudflare Worker to Google Translate. Medium.
- [ ] **Per-word highlight during cloud TTS.** Use Google TTS `enableTimePointing: ['SSML_MARK']` with SSML input; poll `audio.currentTime` via rAF and call `setMark` at the right moment. Big visual upgrade for audiobook mode. Medium.
- [ ] **Highlights + notes.** Select text → pick color → saved to IDB. Foliate's `view.addAnnotation` supports drawing them. Needs save/render pipeline, a "my highlights" sheet, maybe markdown export. Big.
- [ ] **Reading stats page.** New `/stats` route with time read, books finished, streak, time-of-day histogram. Data already mostly exists in the `stats` store (after per-book refactor). Medium.
- [ ] **Library search + tags.** Search box + per-book tags / collections. Medium.

## Tier 3 — Ambitious, differentiating

- [ ] **Cross-device sync via the Cloudflare Worker.** Reuse the existing Worker, add a KV namespace for per-user data (positions, bookmarks, stats). Auth via magic-link email or device-pairing code. Books stay local; sync only metadata. Quest picks up where laptop left off. Big.
- [ ] **Offline audiobook export.** Pre-synthesize an entire book's MP3s during one session, store in IDB, play offline. Big IDB footprint (~20 MB/book), ~$6/book if above free tier. Big.
- [ ] **Article / webpage import.** Paste a URL → backend fetches + strips via Mozilla Readability → stored as a pseudo-book. Pocket/Instapaper clone inside the reader. Big.
- [ ] **AI chapter summaries.** Generated on first open via GPT-4-class model, cached. "What's been happening" after a long absence. ~$0.50/book. Big.
- [ ] **VR-specific enhancements via WebXR.** Wrap-around reader, gaze-triggered page turn, spatial audio for TTS, ambient environments. Quest Browser supports WebXR. Huge (2–3 weeks for anything polished).

## Tier 4 — Speculative / contrarian

- [ ] **Book club mode.** Two devices share a live position. Fun with family. Requires backend + auth. Big + niche.
- [ ] **"Who is this again?"** Hover a character name → brief summary of who they are, learned by tracking appearances. LLM-heavy. Big.
- [ ] **Reading level analyzer.** Auto-detect Flesch-Kincaid / CEFR-ish score per book. Small + quirky.
- [ ] **Multi-voice narration.** Dialogue attribution + different TTS voices per character. Overshoot for a personal reader but feasible. Big.

## Deliberately *not* building

- **Full PDF parity.** Wrong shape for this reader — PDF is fixed layout, we're reflow-first. Minimum viable PDF support is doable but full parity is a week to make a format you probably don't read much feel like one you do.
- **Reading achievements / gamification badges.** Gimmicky; this isn't Duolingo.
- **Social features, comments, ratings, feeds.** Scope disaster for one user.
- **Writing / editing interface.** Not what this is.
- **Multi-tenant.** Single-user app. Going multi-user changes everything (auth, per-user quotas, GDPR).
- **Calibre / Kindle library import.** Format hell. Drag-drop is fine.
