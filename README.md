# Postly

One-click AI marketing content generation & multi-platform social publishing.

Enter a theme or product name, pick your connected accounts, and Postly:

1. Generates marketing copy (caption, hashtags, CTA) with a free LLM
2. Generates a matching promotional image with a free image model
3. Publishes to your connected platforms
4. Logs every attempt (platform, status, post ID, errors) for tracking

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
   ├── /api/publish  ──► pipeline:
   │                       Groq  ──(fallback)──► OpenRouter      copy
   │                       Pollinations (flux → turbo)           image
   │                       platform publish API                  post
   │                       post_logs insert                       log
   └── /api/history                            past posts + errors
        │
        ▼
 Postgres  ·  users  ·  social_connections (tokens)  ·  post_logs (audit)
```

**Multi-tenant:** every connection and post row is owned by a `user_id`. All
queries are scoped to the signed-in user, so accounts and history are private
per user. Auth is Auth.js with email/password (bcrypt) and JWT sessions.

| Concern          | Choice                                                  |
|------------------|---------------------------------------------------------|
| App + API        | Next.js 14 (App Router)                                 |
| Text generation  | Groq (primary) → OpenRouter (fallback)                   |
| Image generation | Pollinations.ai (`flux` → `turbo` fallback), no API key  |
| Database         | Postgres — Neon free tier in prod                        |
| Hosting          | Vercel (free) + Neon (free)                             |
| Secrets          | `.env.local` locally, Vercel env vars in prod            |

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

| Platform  | Status      | Notes |
|-----------|-------------|-------|
| Pinterest | ✅ wired    | Business account + board. **App secret is withheld until Pinterest grants trial access** |
| Instagram | ✅ wired    | Business/Creator account **linked to a Facebook Page**; two-step container publish |
| Facebook  | ✅ wired    | Publishes a photo + caption to a Page |
| X         | 🔜 planned  | Requires HTTPS redirect |
| LinkedIn  | 🔜 planned  | Company Page needs review |
| TikTok    | 🔜 planned  | Stricter app review |

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

## Repository layout

```
.
├── frontend/                 # the entire app (UI + API + pipeline)
│   ├── app/                  # pages and API routes
│   ├── lib/pipeline.js       # copy + image generation, publishers, logging
│   ├── lib/platforms.js      # platform registry (OAuth + display metadata)
│   ├── lib/schema.sql        # database schema
│   └── scripts/db-setup.mjs  # applies the schema
├── n8n/workflows/            # legacy: earlier n8n implementation (reference)
├── db/init/                  # legacy: Postgres init for the Docker setup
├── docker-compose.yml        # legacy: n8n + Postgres stack
└── services/assembly/        # planned: sharp branding-overlay service
```

The `n8n` + Docker setup was the original backend and still works
(`docker compose up -d`), but the Next.js pipeline supersedes it — keeping the
app deployable for free with no server to maintain.

## Roadmap

- [x] Generation pipeline (Groq + Pollinations, with fallbacks)
- [x] Postgres logging of every publish attempt
- [x] Connections dashboard with one-click OAuth
- [x] Create-post form with image/copy preview
- [x] Post history view
- [x] Pinterest publishing
- [x] Multi-user accounts with per-user data scoping
- [ ] Facebook, Instagram, X, LinkedIn connectors
- [ ] Branding overlay (logo/text on generated images)
- [ ] Scheduling (queue posts for later)
- [ ] TikTok
