# Feasibility analysis: audiobook / TTS mode

> **Status:** analysis only, not implemented. Saved for future reference. Decision point: which synthesizer tier to target.

## Context

Adding an audiobook feature to the reader — press play, hear the book read aloud. User's stated quality bar: **"a good voice, respects commas and dots, is nice to listen to."**

## What we already have (the easy part)

foliate-js ships with a `TTS` class at [src/vendor/foliate-js/tts.js](src/vendor/foliate-js/tts.js) that solves the hardest problems for us:

- **Sentence/word segmentation** via `Intl.Segmenter` (granularity configurable), so pauses fall on real clause/sentence boundaries rather than wrapping text at arbitrary column breaks.
- **Position tracking** by inserting invisible `<foliate-mark>` elements into the page DOM, so we can pause/resume and sync a highlight.
- **Highlight callback** — every time the reader advances to a new word/sentence, it calls `highlight(range)` which we can use to draw a live overlay on the rendered page.
- **SSML output** — the class emits SSML strings (not audio). It is **format-agnostic**: plug in whatever synthesizer we want.

The `View` class exposes `view.initTTS(granularity, highlight)` ([view.js:584](src/vendor/foliate-js/view.js#L584)) and a `view.tts` property. The API surface is: `tts.start()`, `tts.next()`, `tts.prev()`, `tts.resume()`, `tts.setMark()`.

**Translation:** we don't need to write a book reader. We need to write a synthesizer driver + a React hook for playback state.

## The real decision: which synthesizer

Three tiers, quality/cost tradeoff dominates.

### Tier A: Web Speech API (`speechSynthesis`) — free, zero backend

- Built into every modern browser. `new SpeechSynthesisUtterance(text)` + `speechSynthesis.speak(u)`.
- **Quality is entirely OS-dependent**:
  - Windows 10/11 with "Microsoft Natural Voices" enabled → **surprisingly good** (Aria, Guy, Emma), respects punctuation.
  - macOS → Siri voices are good.
  - iOS/iPadOS → good.
  - Android Chrome → Google neural voices, good.
  - Desktop Linux Chrome → **bad** (eSpeak-ng fallback, robotic).
- **Cost:** zero. **Offline:** yes (after OS voices are installed). **Backend:** none.
- **SSML:** essentially unsupported — we'd strip SSML from foliate's output and feed plain text. The `<break>` tags for pauses are lost, but modern neural voices infer prosody from punctuation well enough.
- **Verdict:** meets the user's quality bar **for users on a good OS**, fails it on vanilla Linux Chrome. Detect and warn.

### Tier B: Cloud TTS (OpenAI / ElevenLabs / Azure Neural / Google) — paid, needs backend or user-supplied key

- Quality: best available. ElevenLabs and OpenAI `tts-1-hd` are indistinguishable from human narration.
- Cost order of magnitude: OpenAI `tts-1` ≈ $15 per 1M chars (~10 books), `tts-1-hd` ≈ $30. ElevenLabs ≈ 5–10× more. Azure/Google are cheap but require backend auth.
- **Architecture problem:** API keys can't ship in frontend code without leaking. Two ways around:
  1. **User provides their own API key** (stored in IDB). No backend. Users who don't want audiobooks don't pay.
  2. **We run a backend proxy.** Breaks the "zero-backend" promise and creates cost exposure.
- **Latency:** round-trip per sentence/paragraph. Buffering/streaming needed to avoid gaps. Non-trivial.
- **Verdict:** best quality, changes product shape. Option (1) keeps the no-backend promise but asks users to bring their own key.

### Tier C: Local AI models (Kokoro / Piper via WASM/ONNX) — free, big download, heavy

- Kokoro-82M or Piper voices run in the browser via ONNX Runtime Web or transformers.js.
- Quality: **noticeably better than bad Web Speech, not as good as Tier B.** Decent neural prosody.
- **Bundle/download cost:** ~80–150 MB model on first use. Stored in Cache Storage, loads fast afterward.
- **CPU cost:** a few seconds to warm up, then real-time-ish synthesis on desktop; mobile struggles.
- **UX cost:** "Downloading voice model…" progress screen on first play. Worker-based to avoid blocking the reader.
- **Verdict:** good middle ground if Tier A's Linux-Chrome gap is unacceptable and a paid/key-based option is off the table. Real engineering: workers, caching, warmup, memory.

## Other moving parts

Regardless of synthesizer choice:

1. **`useTTS` hook** — playback state (idle/playing/paused), rate, pitch, voice id, current-position CFI. Owns the synthesizer driver. Persist last position per book alongside existing progress.
2. **Playback controls** in top bar — play/pause toggle, rate slider, voice picker. Keyboard shortcut (space turns pages already — pick another, maybe `P`).
3. **Page-turn integration** — when TTS reaches the end of the current rendered page, call `view.next()` and re-init TTS on the new page. Conversely, when the user turns the page manually, TTS should reset to the new page's start (or pause, user preference).
4. **Highlight overlay** — use foliate's existing overlay mechanism (`view.addAnnotation`) to draw the TTS highlight emitted via `highlight(range)`. Trivial.
5. **Background tab handling** — Web Speech pauses when tab is backgrounded on some browsers; Tier B/C keep going. Document, don't fight.
6. **Settings persistence** — voice id, rate, pitch, auto-advance page: extend `LayoutSettings`.

## Effort estimate

| Scope                                               | Time    |
| --------------------------------------------------- | ------- |
| Tier A MVP (Web Speech only, with voice detection)  | ~0.5–1d |
| Tier A production (picker, rate, highlight, page-turn, keyboard, persistence) | ~2d |
| Tier B on top of A (user-supplied key, streaming)   | +1–2d   |
| Tier C (local WASM model with worker and caching)   | +2–3d   |

## Recommendation

**Tier A first, staged rollout.** It's free, meets the quality bar for most users (Windows/Mac/iOS/Android covers ~95% of likely readers), and the hook/controls/highlight/page-turn plumbing it requires are reused by any later tier. Ship A; test on the actual device. If quality isn't there, layer Tier B with user-supplied OpenAI keys — best cost/quality point and keeps the no-backend promise.

Skip Tier C unless offline-after-download privacy is a specific goal. Bundle and warmup cost is real; quality gap over good Tier A is small.

## Files that would change (if built)

- [src/routes/reader/hooks/useTTS.ts](src/routes/reader/hooks/useTTS.ts) — new hook
- [src/routes/reader/components/ReaderTopbar.tsx](src/routes/reader/components/ReaderTopbar.tsx) — play/pause/rate controls
- [src/routes/reader/components/SettingsSheet.tsx](src/routes/reader/components/SettingsSheet.tsx) — voice picker, default rate
- [src/routes/reader/Reader.tsx](src/routes/reader/Reader.tsx) — wire the hook in
- [src/lib/db.ts](src/lib/db.ts) — extend `LayoutSettings` with `ttsVoiceId`, `ttsRate`; optional `ttsPosition` per-book in `progress`
- [src/vendor/foliate-js/view.d.ts](src/vendor/foliate-js/view.d.ts) — extend the shim with `initTTS` and the `tts` property

## Verification plan (if built)

- Open a DRM-free EPUB, click play, confirm natural-sounding speech that pauses at periods/commas.
- Manually turn pages while playing; TTS resets cleanly.
- Let TTS run past the end of the current page; it auto-advances without a gap.
- Pause, close tab, reopen — resumes where it stopped (nice-to-have, not critical for MVP).
- Change voice/rate mid-playback and confirm it takes effect on the next utterance.
- Simulate bad Web Speech (Linux Chrome): app shows a warning and falls back gracefully.
