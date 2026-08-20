# Postly

**Open-source, self-hosted social media autopilot.** Describe your business
once; Postly writes the posts, makes the artwork, and publishes them on a
schedule — to Pinterest, Instagram, Facebook, LinkedIn, Threads, YouTube and
TikTok.

[![Licence: AGPL v3](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)

It runs free: Vercel's hobby tier, Neon's free Postgres, a free Groq key, and
GitHub Actions for the scheduler and video rendering. No paid dependency is
required to run the whole thing for yourself.

It is **multi-tenant by design** — every connection, post and API key belongs to
a `user_id` — so it works equally as a personal tool or as the basis of a SaaS.

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
| Text generation  | Groq → OpenAI → Gemini → Anthropic, whichever you hold a key for |
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
- **One** AI key: `GROQ_API_KEY` (free, [console.groq.com/keys](https://console.groq.com/keys)),
  or `OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`. Do **not** pin a
  `*_MODEL` variable — Postly asks each provider what it currently serves and
  picks the best available. A pinned id becomes an outage the day it is retired.
- `APP_BASE_URL` — `http://localhost:3000` locally (auto-detected on Vercel)
- `CRON_SECRET` — authorises the scheduler tick; without it automations never run
- `CREDENTIALS_KEY` — encrypts users' stored API keys (falls back to `AUTH_SECRET`)
- `LEGAL_CONTACT_EMAIL` — shown on the Privacy and Terms pages
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
- [x] TikTok (via the aggregator; video only)
- [ ] X, LinkedIn direct connectors
- [ ] Branding overlay (logo/text on generated images)

## Making it your own

Nothing in the prompts is tied to a particular business. Everything that shapes
the writing comes from the user's own profile:

| Where | What it controls |
|-------|------------------|
| **Settings → Business type** | A preset that fills the empty fields — printables, e-commerce, services, SaaS, food, creator, local |
| **Settings → Your own rules** | Instructions applied to *every* post, e.g. "never mention discounts", "always say instant download" |
| **Settings → Language** | Captions, hashtags and titles are written in it |
| **Settings → Words to never use** | A hard ban list |
| **Automations → Extra rules** | Added *on top of* the brand rules for one stream only |

The brand rules and the automation rules are concatenated, not substituted: a
brand-wide rule cannot be silently lost by an automation that sets its own.

Add a preset by editing [`frontend/lib/niches.js`](frontend/lib/niches.js) —
it is a plain object, and `custom_prompt` is where the craft of a trade lives.

## How the scheduling works

The part most likely to surprise you, so it is worth stating plainly.

- Posting times are **local wall-clock** in each automation's own IANA timezone,
  so 09:00 stays 09:00 across daylight saving.
- A **scheduler tick** runs every few minutes. It generates the posts whose
  slots are due (catching up ones that were missed), publishes posts held for a
  specific minute, retries transient failures on a backoff, and reads back what
  the platforms actually did.
- Every unit of work is guarded by a slot key or a status transition, so running
  the tick twice, late, or by hand is safe.

**Vercel's Hobby plan only accepts a daily cron expression** — a sub-daily one
does not degrade, it fails the whole deployment. So `vercel.json` asks for a
daily backstop and the real cadence comes from
[`.github/workflows/scheduler.yml`](.github/workflows/scheduler.yml).

GitHub delays scheduled workflows heavily: measured on this repo, `*/5` produced
**11 runs in 22 hours**. That is survivable only because missed slots are caught
up. For posts that must land on the minute, point a real pinger
([cron-job.org](https://cron-job.org) is free) at `/api/cron/autopilot` with the
`x-cron-secret` header.

## Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/<you>/Postly && cd Postly/frontend
npm install && cp .env.example .env.local   # fill in DATABASE_URL + one AI key
npm run db:setup && npm run dev
```

- `npm run build` must pass before a PR.
- The schema is **idempotent** — add `ALTER TABLE ... IF NOT EXISTS` to
  `lib/schema.sql` rather than writing migration files. `npm run db:setup` is
  safe to re-run.
- Comments here explain *why*, not *what*. If a line exists because something
  broke, say what broke — most of the awkward code in this repo is load-bearing.
- No secrets in commits. `.env`, `.env.local`, `*.pem` and `*.key` are ignored;
  keep it that way.

## Licence

[GNU AGPL v3](LICENSE).

You may use, modify and self-host this freely. If you run a **modified** version
as a network service, the AGPL requires you to publish your changes under the
same licence. Running it unmodified, or using it privately, carries no such
obligation.
