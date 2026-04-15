# Kickoff guide: Cloudflare + Google TTS

> **Status:** not started. Read this first when you're ready to pick up the project. The full technical reference is in [cloudflare-google-tts.md](cloudflare-google-tts.md); this document is the practical "what does it take to actually start."

## Accounts you need to create (both free, ~15 min total)

1. **Cloudflare** — [dash.cloudflare.com](https://dash.cloudflare.com/). Free, **no credit card required**. You get an account ID and a subdomain like `<username>.workers.dev` which becomes the Worker's URL.
2. **Google Cloud** — [console.cloud.google.com](https://console.cloud.google.com/). Free account but **requires a credit card on file**. Google uses it for abuse prevention only; it won't charge as long as you stay within the free quota. Set a **$1 budget alert** for peace of mind.

No other services. No other signups.

## Costs (realistic)

- **Cloudflare Workers:** free forever at this scale. Ceiling is 100,000 requests/day — a heavy book-listening day uses maybe a few thousand.
- **Google Cloud TTS:** free forever at **1,000,000 characters / month** for Neural2 voices (the sensible default tier). A typical novel is ~400,000 characters, so you can listen to **~2.5 books/month for free**.
- **Studio voices** (the top audiobook tier) count 4× toward quota — ~0.6 books/month free. Neural2 is indistinguishable from Studio for most listening, so start there.
- **Overshoot rate:** $16 per additional million characters. The $1 budget alert catches any surprise before it hurts.

## Who does what

### Only you can do (needs your browser, credit card, or identity)

- [ ] Create the Cloudflare account.
- [ ] Create the Google Cloud account, add billing, enable the Text-to-Speech API, set the $1 budget alert.
- [ ] Generate the Google API key in the Cloud Console (under APIs & Services → Credentials). Restrict it to the Text-to-Speech API only, and to HTTP referrers matching the Worker URL.
- [ ] Create the new `web-book-reader-tts` repo on GitHub (public or private — doesn't matter).
- [ ] Run `wrangler login` once on your machine (opens a browser for Cloudflare OAuth).
- [ ] Paste the Google API key over to me so we can save it as a Worker secret.

### I can do

- Scaffold the Worker repo structure, write the Worker code, `wrangler.toml`, a GitHub Actions workflow for deploys.
- Run `npm install -g wrangler` on your machine.
- Run `wrangler secret put GOOGLE_API_KEY` with the key you paste.
- Run `wrangler deploy` and verify the endpoint with `curl`.
- Wire the frontend: swap `SpeechSynthesisUtterance` for an `<audio>` element fed by the Worker, add a voice picker populated from Google's voice list, add a "Voice provider" toggle in Settings so the cloud path is opt-in with the existing browser-speech as the fallback.
- Handle CORS, caching headers, per-language default voice selection.

Rough time budget: **~30 min of your time** (mostly waiting for Google to provision the project and enable the API), then I handle the rest in one sitting.

## Deploy targets

| Component | Lives on | Free tier status |
| --- | --- | --- |
| Worker | Cloudflare edge network | Free forever |
| Frontend | GitHub Pages (current setup, unchanged) | Free forever |
| Audio generation | Google Cloud TTS API | 1M chars/month free forever |

Global edge = sub-50 ms round-trip from anywhere, including the Quest 3.

## Sequencing when you're ready

1. **You:** create the two accounts + Google project + API key + empty `web-book-reader-tts` GitHub repo.
2. **Me:** scaffold the Worker code into that repo and commit.
3. **You:** run `wrangler login` (one-time OAuth) and paste the Google API key.
4. **Me:** `wrangler secret put GOOGLE_API_KEY`, `wrangler deploy`, verify the endpoint with `curl`.
5. **Me:** wire the frontend in the reader repo behind a "Cloud voice" toggle in Settings, off by default so nothing existing changes for regular users.
6. **You:** flip the toggle on, open a Spanish book, listen on the Quest. If quality is there, leave the toggle on; if not, disable and we reassess.

## Rollback

If you decide to pull the plug at any point:

- `wrangler delete` removes the Worker.
- Disable the Google API key in the Cloud Console.
- The frontend already has browser-speech as the default; removing the cloud path doesn't break the app — users just lose the "Cloud voice" toggle option.

## Open questions for future-you

- Whether to use Neural2 (cheaper, very good) or Studio (genuinely audiobook-quality, quota-heavy) as the default. Probably Neural2.
- Whether to add a per-book voice override (different book, different voice) or a single global voice setting.
- Whether to prefetch block N+1's audio while block N plays, to close any mid-section gap. Nice-to-have; foliate's block sizes are small enough that gap-free playback might not need prefetch.

## References

- Full technical implementation doc: [cloudflare-google-tts.md](cloudflare-google-tts.md)
- Original feasibility analysis: [audiobook-analysis.md](audiobook-analysis.md)
