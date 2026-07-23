# Postly

One-click AI marketing content generation & multi-platform social publishing, orchestrated with **n8n**.

Enter a theme or product name (plus a few optional fields) and Postly:

1. Generates marketing copy (caption, hashtags, CTA) with a free LLM
2. Generates a matching promotional image with a free image model
3. Assembles the two into a finished, branded post
4. Publishes to the selected platforms — Instagram, Facebook, X, LinkedIn, TikTok, Pinterest
5. Logs every post (platform, status, timestamp, content, IDs, errors) to Postgres

## Architecture

```
 Web form ──POST──> n8n Webhook
                        │
                 Prompt builder (Code node)
                    │            │
        ┌───────────┘            └────────────┐
   Text: Groq → OpenRouter      Image: Pollinations → Hugging Face
        └───────────┐            ┌────────────┘
                    Merge (wait for both)
                        │
              Assembly service (sharp overlay)
                        │
                 Switch on platforms[]
     ┌────────┬────────┬────────┬────────┬────────┐
    FB       IG        X      LinkedIn Pinterest TikTok
     └────────┴────────┴────────┴────────┴────────┘
                        │
                 Log → Postgres (post_logs)
```

## Tech stack

| Concern            | Choice                                                        |
|--------------------|---------------------------------------------------------------|
| Orchestration      | n8n (Docker Compose, self-hosted)                             |
| Text generation    | Groq (primary) → OpenRouter (fallback)                        |
| Image generation   | Pollinations.ai (primary) → Hugging Face Inference (fallback) |
| Post assembly      | Node.js + `sharp` microservice (HTTP)                         |
| Storage / logs     | Postgres                                                      |
| Frontend           | Single-page web form → n8n webhook                            |
| Secrets            | `.env` + n8n credentials store                                |

## Prerequisites

- Docker & Docker Compose
- Free API keys as you enable each provider/platform (see `.env.example`)

## Phase 0 — Local setup

1. **Clone & enter the repo**, then copy the env template:

   ```bash
   cp .env.example .env
   ```

2. **Generate an n8n encryption key** and paste it into `.env` as `N8N_ENCRYPTION_KEY`:

   ```bash
   openssl rand -hex 32
   ```

   Set a strong `POSTGRES_PASSWORD` too. (Groq/social keys can wait until their phase.)

3. **Start the stack:**

   ```bash
   docker compose up -d
   ```

4. **Open n8n** at http://localhost:5678 and create the owner account (first run only).

5. **Verify Postgres** — the `postly` database and `post_logs` table are created on first boot:

   ```bash
   docker compose exec postgres psql -U postly -d postly -c "\d post_logs"
   ```

### Common commands

```bash
docker compose logs -f n8n      # tail n8n logs
docker compose down             # stop (keeps data)
docker compose down -v          # stop and WIPE data (re-runs db/init on next up)
```

> Changing `db/init/*.sql` only takes effect on a fresh volume. Run `docker compose down -v` to re-seed.

## Repository layout

```
.
├── docker-compose.yml        # n8n + Postgres (+ assembly, enabled in Phase 3)
├── .env.example              # every required key, documented
├── db/init/01-init.sql       # creates `postly` DB + post_logs table
├── n8n/workflows/            # exported workflow JSON (importable)
├── services/assembly/        # Phase 3: sharp overlay microservice
└── frontend/                 # Phase 4: single-input web form
```

## Build roadmap

- [x] **Phase 0** — Scaffolding: Docker Compose, `.env.example`, README
- [x] **Phase 1** — MVP: Webhook → Groq → Pollinations → log → publish to Facebook
      _(pipeline live; needs a Facebook Page token to publish. Workflow: `n8n/workflows/phase1-facebook.json`)_
- [ ] **Phase 2** — Multi-platform fan-out + text/image fallbacks
- [ ] **Phase 3** — sharp assembly microservice
- [ ] **Phase 4** — Frontend form
- [ ] **Phase 5** — Error handling, retries, rate-limit backoff
- [ ] **Phase 6** — TikTok + scheduling

## Security notes

- `.env` is gitignored — keep it that way. Store platform tokens in the n8n
  credentials store where possible; use env values only for bootstrapping.
- `WEBHOOK_URL` must be publicly reachable (e.g. via a tunnel or a real domain)
  for OAuth callbacks and Instagram/Meta publishing to work.
