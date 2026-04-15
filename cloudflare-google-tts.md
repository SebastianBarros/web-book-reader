# Implementation guide: Cloudflare Worker + Google Cloud TTS

> **Status:** reference document — not implemented. Revisit this when the browser's built-in `speechSynthesis` isn't good enough for the audiobook feature.

## Why this architecture

- **Google Cloud TTS Neural2 / Studio voices** are the best-in-class free option for quality (respect punctuation, natural prosody, pleasant intonation). Studio voices are the highest tier.
- **Free tier is generous and permanent:** 1,000,000 characters per month for Neural2 voices, 4,000,000 for Standard voices. Enough for dozens of books per month.
- **Cloudflare Workers free tier:** 100k requests/day, 10ms CPU/request. A TTS-proxy worker doesn't do heavy CPU work (just signs a request and streams the response), so this fits comfortably.
- **Keeps the "no per-user signup" promise of the current app.** The only account involved is yours, once, to get the Google API key. End users never see it.
- **Keeps the API key off the client.** Only the worker ever touches it.

## Architecture

```
┌───────────────────────┐
│  Browser (useTTS)     │
│                       │
│  Block text from      │
│  foliate's TTS class  │
└───────────┬───────────┘
            │ POST /tts  { text, voice, rate }
            ▼
┌───────────────────────┐
│  Cloudflare Worker    │
│  tts-proxy            │
│  - validates payload  │
│  - calls Google TTS   │
│  - streams MP3 back   │
└───────────┬───────────┘
            │ HTTPS
            ▼
┌───────────────────────┐
│  Google Cloud TTS     │
│  texttospeech.        │
│  googleapis.com       │
└───────────────────────┘
```

## Prerequisites

- A Google Cloud account (free tier, needs billing enabled — Google requires it even for the free tier, but you stay within the free quota).
- A Cloudflare account (free).
- `wrangler` CLI: `npm install -g wrangler`.
- This repo on your laptop.

## Step 1 — Google Cloud setup

1. Open [console.cloud.google.com](https://console.cloud.google.com/), create a project (name it anything, e.g., `web-book-reader-tts`).
2. Enable billing on the project. You will not be charged as long as you stay within the free tier; the enable-billing requirement is there to prevent abuse. Set a **budget alert** at $1 just in case.
3. **Enable the Cloud Text-to-Speech API:** navigate to APIs & Services → Library → search "Text-to-Speech" → Enable.
4. **Create an API key** (simpler than a service account; fine for this use case):
   - APIs & Services → Credentials → Create credentials → API key.
   - Copy the key; we'll put it in the worker's secrets.
5. **Restrict the key** — critical for security:
   - Application restrictions → **HTTP referrers** — add `https://<your-worker-subdomain>.workers.dev/*` (and any custom domain you'll use). That stops anyone else who finds the key in network logs from using it from another origin.
   - API restrictions → **Restrict key** → select only "Cloud Text-to-Speech API".

Alternatively, use a service account with JSON credentials for tighter control. API key is simpler; service account is more auditable. Start with API key.

## Step 2 — Cloudflare Worker

### File layout

```
worker/
  wrangler.toml
  src/
    index.ts
```

### `wrangler.toml`

```toml
name = "web-book-reader-tts"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
# Non-secret config lives here. Example allowed-origin list:
ALLOWED_ORIGINS = "https://sebastianbarros.github.io,http://localhost:5173"

# GOOGLE_API_KEY is a secret; set via: wrangler secret put GOOGLE_API_KEY
```

### `src/index.ts`

```ts
interface Env {
  GOOGLE_API_KEY: string
  ALLOWED_ORIGINS: string
}

interface TTSRequest {
  text: string
  voice?: string   // e.g., "en-US-Neural2-C"
  lang?: string    // e.g., "en-US"
  rate?: number    // 0.25–4.0
  pitch?: number   // -20 to 20 (semitones)
}

const MAX_TEXT_LENGTH = 5000 // Google's hard cap is 5000 chars per request

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    const cors = corsHeaders(origin, allowed)

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: cors })
    if (origin && !allowed.includes(origin))
      return new Response('Forbidden', { status: 403, headers: cors })

    let body: TTSRequest
    try {
      body = await req.json<TTSRequest>()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: cors })
    }

    const text = (body.text ?? '').trim()
    if (!text)                         return new Response('Empty text', { status: 400, headers: cors })
    if (text.length > MAX_TEXT_LENGTH) return new Response('Text too long', { status: 413, headers: cors })

    const voice = body.voice || 'en-US-Neural2-C'
    const lang  = body.lang  || voice.split('-').slice(0, 2).join('-')
    const rate  = Math.min(Math.max(body.rate  ?? 1.0, 0.25), 4.0)
    const pitch = Math.min(Math.max(body.pitch ?? 0.0, -20),  20)

    const googleUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_API_KEY}`
    const googleReq = {
      input: { text },
      voice: { languageCode: lang, name: voice },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: rate,
        pitch: pitch,
      },
    }

    const googleRes = await fetch(googleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(googleReq),
    })

    if (!googleRes.ok) {
      const err = await googleRes.text()
      return new Response(`Upstream error: ${err}`, { status: googleRes.status, headers: cors })
    }

    const { audioContent } = await googleRes.json<{ audioContent: string }>()
    // Google returns base64 MP3; decode to bytes and stream back.
    const bytes = Uint8Array.from(atob(audioContent), c => c.charCodeAt(0))
    return new Response(bytes, {
      headers: {
        ...cors,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  },
}
```

### Deploy

```bash
cd worker/
wrangler login
wrangler secret put GOOGLE_API_KEY   # paste the Google API key
wrangler deploy
```

The deploy outputs a URL like `https://web-book-reader-tts.<your-subdomain>.workers.dev`. Save it.

### Monitor

- **Google Cloud Console → Billing → Budgets & alerts** — keep a $1 alert.
- **Google Cloud Console → APIs & Services → Metrics** — character count per day.
- **Cloudflare dashboard → Workers → Analytics** — request count (should stay way below 100k/day).

## Step 3 — Frontend changes

The existing [useTTS.ts](src/routes/reader/hooks/useTTS.ts) drives foliate's TTS class through `SpeechSynthesisUtterance`. The swap is **replace the utterance with an `<audio>` element fed by the worker**; the rest of the pipeline (block iteration via `tts.next()`, auto-page-turn via `setMark` on boundaries, click-to-jump, section-advance) stays identical.

### New environment var

`.env`:

```
VITE_TTS_WORKER_URL=https://web-book-reader-tts.<your-subdomain>.workers.dev
```

### Shape of the change

```ts
// In useTTS.ts — replace speakSsml's internals:
const audio = new Audio()
audio.src = URL.createObjectURL(await fetchFromWorker(parsed.text))
// or: audio.src = `${WORKER_URL}?...` if we stream-by-URL instead of fetching blobs

audio.onended = () => { /* same as utterance.onend — advance */ }
audio.onerror = (e) => { /* same as utterance.onerror */ }

// onstart equivalent — there's no direct equivalent, fire a setMark on first
// audio.oncanplay or audio.onloadedmetadata.

// onboundary equivalent — Google returns the full MP3, no word timings by default.
// Two options for word-level highlight:
// 1. Skip word-level sync; just fire setMark(firstMark) on canplay, setMark(lastMark) on ended.
// 2. Ask Google for SSML with <mark> tags AND request `enableTimePointing: ['SSML_MARK']`.
//    Response will include `timepoints: [{ markName, timeSeconds }]` which we poll
//    against audio.currentTime via requestAnimationFrame. This is worth the effort
//    if you want per-word highlight.
```

### Voice picker

Google's voice list is ~400 voices across ~40 languages. Filter to the page language on first open, same pattern as the current browser-voice picker in [SettingsSheet.tsx](src/routes/reader/components/SettingsSheet.tsx). Cache the list in IDB (it doesn't change often).

Fetch the list via: `GET https://texttospeech.googleapis.com/v1/voices?key=...&languageCode=en-US`. Add a `/voices` route to the worker that proxies this (keeps the key server-side, adds a cache).

Best-sounding voice families, in order:

1. **Studio voices** (`en-US-Studio-O`, `en-US-Studio-Q`) — highest quality; the audiobook tier. More expensive (counts as 4× in quota) but still within free tier if used sparingly.
2. **Neural2** (`en-US-Neural2-C`, `en-US-Neural2-F`) — the sensible default. Great quality, counts as 1× in quota.
3. **WaveNet** (`en-US-Wavenet-C`) — older generation, still good.
4. **Standard** — avoid, noticeably robotic.

### Settings

Add a "Voice provider" toggle in Settings:

- **Browser (default)** — current `speechSynthesis` path.
- **Cloud (Google)** — uses the worker.

That keeps the browser path as a fallback if the worker is down or the user is offline, and makes the dependency on a paid-ish service opt-in.

## Security checklist

- ☐ Google API key restricted to the TTS API only.
- ☐ Google API key restricted to worker's origin via HTTP referrer.
- ☐ Worker `ALLOWED_ORIGINS` matches only your production and dev hosts.
- ☐ Worker rejects payloads > 5000 chars (Google's cap, prevents abuse).
- ☐ Worker has rate limiting: consider Cloudflare's free [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) — e.g., 30 req/min per IP.
- ☐ Budget alert on the Google project ($1 is plenty).
- ☐ If you ever go multi-user, switch to per-user quota via an auth header (not needed for a personal app).

## Cost reality check

- Neural2 voices: **$16 / 1M chars** over the free tier. A typical novel is ~400k chars. If you blast through the free 1M/month, one extra book costs ~$6.
- Studio voices: 4× that (~$64/M), but you get genuinely podcast-quality reads. Use sparingly — maybe as an "HD" toggle.
- Cloudflare Workers: free tier is 100k req/day. With our block-level requests (one per ~100 words), a book is maybe 20k requests, so you can listen to ~5 books per day before hitting the ceiling.

## Troubleshooting

- **403 from Google:** key not restricted correctly, or TTS API not enabled on this project.
- **CORS error in browser:** `ALLOWED_ORIGINS` in `wrangler.toml` doesn't include the frontend's origin.
- **Long MP3 gaps between blocks:** queue the next block's request before the current one ends (prefetch pattern). Add a small ring buffer: start fetching block N+1's audio as soon as block N starts playing.
- **Voice sounds wrong for non-English books:** the voice's `languageCode` must match the book's language. Read `book.metadata.language` and pick a matching default voice.

## Rollback plan

The Worker is a single file. Delete it via `wrangler delete` if you want to be rid of it. The frontend keeps the browser-speech path as the default, so removing the worker never breaks the app — users just lose the "Cloud" provider option.

## Open questions / future work

- **Per-user bring-your-own-key.** If you ever want to let others use this deployment, either add user-provided keys (BYOK, paste in Settings, stored in IDB) or proxy with per-user quotas — the current single-key setup doesn't scale past personal use.
- **Streaming audio.** Google's `:synthesize` endpoint returns the full MP3 at once; for long blocks you wait for the full byte stream before playback starts. The beta `streamingSynthesize` endpoint streams PCM but is more complex. Not worth it for block-level TTS.
- **OpenAI TTS as an alternative backend.** Same worker architecture; swap the Google call for `https://api.openai.com/v1/audio/speech`. Quality is comparable; cost is similar (~$15/M chars for `tts-1`). No free tier, so slightly worse on that axis.
