# Postly

One-click AI marketing content generation & multi-platform social publishing.

Enter a theme or product name, pick your connected accounts, and Postly:

1. Generates marketing copy (caption, hashtags, CTA) with a free LLM
2. Generates the visuals — one image, a story carousel, or a narrated video
3. Publishes to your connected platforms
4. Logs every attempt (platform, status, post ID, errors) for tracking

## Formats

| Format             | What it makes                                                        |
|--------------------|----------------------------------------------------------------------|
| **Single image**   | One scroll-stopping image + caption                                   |
| **Story carousel** | 3–4 slides telling one story, one character throughout                |
| **Narrated video** | A vertical short: AI script, generated artwork, Piper voice, FFmpeg cut |

Carousel slides are all rendered at one exact size, which is what lets them
publish as a real carousel on Instagram, Facebook **and** Pinterest — Pinterest
rejects a set whose slides differ in aspect ratio.

## Architecture

Postly runs as a single **Next.js** app — frontend, API, OAuth, and the
generation pipeline — backed by **Postgres**. No Docker, no separate
orchestrator, deployable free to Vercel + Neon.

```
 Browser (dashboard + create form)
        │
        ▼
 Next.js API routes
   ├── /api/auth/*  ·  /api/signup             sign up / sign in (Auth.js)
   ├── /api/oauth/<platform>/{start,callback}   one-click account connect
   ├── /api/connections                        list / disconnect / pick board
   ├── /api/generate ──► copy + artwork ──► review queue (drafts)
   ├── /api/queue/<id>/publish ──► publish or schedule, then verify
   ├── /api/render/jobs        ◄── the local video worker polls here
   └── /api/history                            past posts + errors
        │
        ▼
 Postgres  ·  users  ·  social_connections  ·  queued_posts  ·  post_logs
        ▲
        │  MP4 + duration
 worker/ (your machine)  ·  Piper TTS  ·  FFmpeg  ·  APScheduler
```

**Multi-tenant:** every connection and post row is owned by a `user_id`. All
queries are scoped to the signed-in user, so accounts and history are private
per user. Auth is Auth.js with email/password (bcrypt) and JWT sessions.

| Concern          | Choice                                                  |
|------------------|---------------------------------------------------------|
| App + API        | Next.js 14 (App Router)                                 |
| Text generation  | Groq (primary) → OpenRouter (fallback)                   |
| Image generation | Pollinations.ai (`flux` → `turbo` fallback), no API key  |
| Voiceover        | Piper TTS, offline, `en_US-ryan-medium` (free)          |
| Video editing    | FFmpeg — Ken Burns motion, crossfades, burned captions   |
| Database         | Postgres — Neon free tier in prod                        |
| Hosting          | Vercel (free) + Neon (free)                             |
| Secrets          | `.env.local` locally, Vercel env vars in prod            |

No single model makes a video: the LLM writes the script, the image model draws
each scene, Piper speaks it, FFmpeg assembles it. All of it free, and the heavy
parts run locally.

Tokens are stored server-side and **never sent to the browser**.

## Local setup

```bash
cd frontend
npm install
cp .env.example .env.local     # then fill in the values
npm run db:setup               # creates tables in DATABASE_URL
npm run dev                    # http://localhost:3000
```

Required in `.env.local`:

- `DATABASE_URL` — a free [Neon](https://neon.com) project's **pooled** connection string
- `AUTH_SECRET` — signs sessions; generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `GROQ_API_KEY` — free key from [console.groq.com/keys](https://console.groq.com/keys)
- `APP_BASE_URL` — `http://localhost:3000` locally (auto-detected on Vercel)
- `CRON_SECRET` — authorises the scheduler tick; without it automations never run
- Per platform: `<PLATFORM>_CLIENT_ID` / `_CLIENT_SECRET`

## Connecting a platform

> **Who registers what:** *you*, the operator of this app, register one developer
> app per platform — once, ever. Your **users never register anything**: they sign
> up, click Connect, approve on the platform, and they're done. That is exactly how
> Metricool/Buffer work.
>
> Note that platforms restrict new apps to the owner plus invited testers. Letting
> the general public connect requires the platform's app review (Pinterest:
> standard access; Meta: App Review + Business Verification; LinkedIn/TikTok
> similar). Reviews expect a live app, a privacy policy, and a demo of the flow.

Each platform needs a developer app registered **once**, with this redirect URI:

```
{APP_BASE_URL}/api/oauth/<platform>/callback
```

Paste its client ID/secret into `.env.local`, restart, and the platform's card
on the dashboard becomes a live **Connect** button — OAuth popup, done.

| Platform  | Status      | Formats                  | Notes |
|-----------|-------------|--------------------------|-------|
| Pinterest | ✅ wired    | image · carousel · video | Business account + board. **App secret is withheld until Pinterest grants trial access** |
| Instagram | ✅ wired    | image · carousel · reel  | Business/Creator account **linked to a Facebook Page**; two-step container publish |
| Facebook  | ✅ wired    | image · carousel · video | Publishes a photo + caption to a Page |
| TikTok    | 🔜 planned  | video                    | Connects through the aggregator; direct app review is stricter |
| X         | 🔜 planned  | —                        | Requires HTTPS redirect |
| LinkedIn  | 🔜 planned  | —                        | Company Page needs review |

**Facebook and Instagram share one Meta app** — one client ID/secret
(`META_CLIENT_ID` / `META_CLIENT_SECRET`) and one OAuth flow. Connecting either
retrieves your Page token; Instagram publishing uses that same Page token via
the linked Business account. A Meta app in **Development mode** can publish to
accounts you own without app review.

> Platforms other than Pinterest generally reject `http://localhost` redirect
> URIs — deploy first (below) and use the Vercel HTTPS URL for those.

## Deploying free (Vercel + Neon)

1. Create a **Neon** project → copy the pooled connection string.
2. Push this repo to GitHub, then import it in **Vercel** with **root
   directory = `frontend`**.
3. Add the env vars from `.env.example` in Vercel, setting
   `APP_BASE_URL` to your deployed URL (e.g. `https://postly.vercel.app`).
4. Run `npm run db:setup` once against the Neon URL to create the tables.
5. Update each platform app's redirect URI to the deployed URL.

## Automations and the scheduler

An automation is a recurring rule: what kind of post, in which format, to which
platforms, at which hours. Times are **local wall-clock in the automation's own
timezone** — "10:00" means ten where you are, and it stays at ten across
daylight saving, because the times are stored as wall-clock plus an IANA zone
rather than as instants.

Everything is driven by one endpoint that should run every few minutes:

```
GET|POST /api/cron/autopilot        Authorization: Bearer $CRON_SECRET
```

Each tick does five things, all of them safe to repeat:

1. **Sweeps** slot claims abandoned by a run that was killed mid-generation
2. **Generates** posts whose slots are due, catching up ones that were missed
3. **Delivers** posts Postly is holding for a specific minute
4. **Retries** transient failures on a growing backoff (~2m, 8m, 25m, 1h, 3h)
5. **Reconciles** what the platforms actually did with what we assumed

Two things make it safe to run often, late, twice, or by hand:

- every post is claimed under a unique **slot key** (`date + time + platform`),
  so a duplicated tick cannot produce a duplicate post — the database refuses it
- a **watermark** per automation records how far the schedule has been read, so
  no slot is replayed and none is skipped

### Driving the tick

**Vercel's Hobby plan only accepts a daily cron expression** — a sub-daily one
does not degrade, it fails the whole deployment. `vercel.json` therefore asks
for `0 6 * * *`, which on Hobby is a once-a-day backstop and nothing more.

The real cadence comes from **`.github/workflows/scheduler.yml`**, which pings
the tick every 5 minutes for free. Set it up once:

> Settings → Secrets and variables → Actions
> - secret **`CRON_SECRET`** — the same value as the Vercel env var
> - variable **`POSTLY_URL`** — your deployed URL (optional; defaults to the current one)

GitHub delays scheduled workflows under load, sometimes by 10–20 minutes. That
is survivable because the tick catches up missed slots instead of losing them —
it is not survivable with a once-a-day cron, which is the whole point.

| Driver | Cadence | Notes |
|--------|---------|-------|
| **GitHub Actions** (set up above) | ~5 min | Free. Disabled automatically after 60 days of repo inactivity |
| **Vercel cron** | daily | Backstop. Becomes a real 5-min cron on Pro (`*/5 * * * *`) |
| [cron-job.org](https://cron-job.org) | 1 min | Free alternative if GitHub's delays annoy you |
| An open tab | ~4 min | The app pings the scheduler itself — a safety net, not a plan |

The secret is accepted as an `Authorization: Bearer` header, an `x-cron-secret`
header, or a `?key=` query parameter, so any scheduler can drive it. Prefer a
header: query strings end up in logs.

**Automations → the health bar** shows when the tick last ran. If that number
grows past a few minutes, posts are going out late and the cron is the reason.

### Delivery: who holds the post

| Connection | Who waits for the minute |
|------------|--------------------------|
| Aggregator (Zernio, SocialAPI) | The aggregator — handed the post with its time |
| Direct OAuth (Pinterest, Meta) | **Postly** — the post is held here and published by the tick |

Direct platform APIs publish on receipt and cannot be given a future time. Those
posts are simply held, which is why an automation on a directly connected
account schedules normally instead of failing.

## Video posts

Piper and FFmpeg cannot run on a serverless function, so video rendering lives
in a small worker you run yourself — see [`worker/README.md`](worker/README.md)
for setup. In short:

```bash
sudo apt install ffmpeg
cd worker && pip install -r requirements.txt
# download the Piper voice, cp .env.example .env, fill it in
python render_worker.py
```

Pick **Narrated video** on the Create page and the draft appears under Review
as *Rendering…*; once the worker returns the MP4 it becomes a playable draft
you can approve, schedule or delete like any other post.

Without the worker running, the other two formats work exactly as before —
video drafts simply sit and wait.

## Repository layout

```
.
├── frontend/                 # the app (UI + API + generation pipeline)
│   ├── app/                  # pages and API routes
│   ├── lib/pipeline.js       # copy + artwork generation, publishers, logging
│   ├── lib/platforms.js      # platform registry (OAuth + display metadata)
│   ├── lib/schema.sql        # database schema
│   └── scripts/db-setup.mjs  # applies the schema
└── worker/                   # local video renderer (Piper + FFmpeg)
    ├── render_worker.py      # polls the app for jobs
    ├── renderer.py           # voice, Ken Burns, crossfades, captions
    └── hosting.py            # puts the MP4 somewhere platforms can fetch it
```

## Roadmap

- [x] Generation pipeline (Groq + Pollinations, with fallbacks)
- [x] Postgres logging of every publish attempt
- [x] Connections dashboard with one-click OAuth
- [x] Create-post form with image/copy preview
- [x] Post history view
- [x] Pinterest, Instagram and Facebook publishing
- [x] Multi-user accounts with per-user data scoping
- [x] Scheduling and a review queue
- [x] Story carousels (Instagram, Facebook, Pinterest)
- [x] Narrated video for Reels / TikTok (Piper + FFmpeg)
- [x] Publish verification so a timeout is never reported as a failure
- [x] Automations in the user's own timezone, DST-stable
- [x] Idempotent scheduler with catch-up, retries and a run log
- [ ] X, LinkedIn connectors
- [ ] Branding overlay (logo/text on generated images)
- [ ] TikTok
