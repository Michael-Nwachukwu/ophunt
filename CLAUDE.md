# OpHunt — CLAUDE.md

## What OpHunt Is

OpHunt is a pay-per-report idea-discovery tool for solo founders. Users paste a URL or topic and get a
list of candidate startup ideas for free. Each full structured report is blurred until the user pays $1
via LemonSqueezy checkout to unlock it. The app also has a curated "idea feed" — a background worker
that pulls signals from Hacker News, Reddit, Product Hunt, and Google Trends/tech news, runs each
through the analysis engine (scoring for feasibility, timing, novelty, market fit, etc.), and drops
category-tagged ideas into the DB so the app has value before any user input. Every unlocked report
ends with a "Copy build brief for Claude / Codex" button as the handoff to building.

**Target user**: solo founders, software engineers, side-project builders looking for buildable startup ideas.

---

## Architecture

```
ophunt/                         ← monorepo root
├── backend/
│   └── src/
│       ├── server.ts           ← Express API, LibSQL/Turso DB init, routes, LemonSqueezy webhook
│       ├── argens.ts           ← Argens marketplace client (AI/scrape calls)
│       ├── analyze.ts          ← shared analysis engine (used by /api/analyze + feed worker)
│       └── feed/
│           ├── sources.ts      ← per-source fetchers (HN, Reddit, Product Hunt, Google Trends/RSS)
│           └── worker.ts       ← pipeline: gather → dedupe → analyze → persist, scheduler
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Landing.tsx     ← hero, URL input, how it works, pricing
│       │   ├── Explore.tsx     ← idea grid with category filter + sort
│       │   └── Report.tsx      ← full idea report with tabs, blur/unlock UX
│       ├── components/
│       │   ├── Nav.tsx
│       │   ├── Footer.tsx
│       │   └── ScoreRing.tsx   ← SVG animated ring (value 0-100), reused for all score rings
│       └── lib/api.ts          ← apiFetch() helper with VITE_API_URL
├── CLAUDE.md                   ← this file
├── .env.example
├── Dockerfile
└── vite.config.ts              ← monorepo dev: spawns backend plugin at port 4100, proxies /api
```

**Deploy**: single Docker container — frontend built to `./public`, Express serves static + `/api/*`.

**Request/data flow**:
```
User URL → POST /api/analyze
  → argens.scrapeUrl(url)           [Argens marketplace: firecrawl_scrape]
  → argens.llmComplete(prompt)      [Argens marketplace: ARGENS_LLM_SERVICE_ID]
  → parse JSON → persistIdea()      [LibSQL/Turso ideas table]
  → GET /report/:id                 [free preview visible]
  → "Unlock for $1" → LemonSqueezy checkout
  → webhook POST /api/webhooks/lemonsqueezy → is_unlocked=1
  → frontend polls /api/ideas/:id/unlock-status → reveals full report
  → "Copy build brief" button → copies enriched prompt to clipboard
```

**Feed flow**:
```
worker.runFeedOnce()
  → sources: HN Firebase API, Reddit public JSON, Product Hunt GraphQL, tech RSS
  → dedupe against existing ideas.url
  → analyzeContent({ rawContent }) for each
  → persistIdea({ source, category, isUnlocked: false })
  → available on GET /api/feed and GET /api/ideas?category=&sort=
```

---

## Locked Decisions

| Decision | Choice | Why |
|---|---|---|
| AI/scraping API | **Argens marketplace** | User migrating from Locus to Argens |
| Consumer checkout ($1 unlock) | **LemonSqueezy** (stays) | Already integrated + working |
| Build handoff | **Copy-prompt only** ("Copy build brief for Claude / Codex") | No external builder link |
| Report depth | **Full pitch spec** | Matches the product pitch document |
| Feed sources | HN, Reddit, Product Hunt, Google Trends/RSS | All four enabled |
| DB | **LibSQL/Turso** | Already in place; keep |
| Locus | **Fully removed** — zero references allowed | Migrating away |

---

## Argens Integration — Exact Facts (do not invent or deviate)

**Base URL**: `https://api.argens.xyz/v1` (confirmed — not `api.argens.io`)

**Auth**: `Authorization: Bearer <ARGENS_API_KEY>` (key format: `argns_live_…`)

**All AI and scraping calls** go through one endpoint:
```
POST https://api.argens.xyz/v1/marketplace/call
Authorization: Bearer <ARGENS_API_KEY>
Content-Type: application/json

{
  "service_id": "<endpoint-id>",   // endpoint id from endpoints[].id, NOT the provider id
  "payload": { ... }               // provider-specific body
}
```

**Response envelope** (always):
```json
// Success
{ "data": { "status": "success", "result": { ...upstream response... }, ... } }

// Policy blocked — DO NOT RETRY
{ "error": "...", "code": "POLICY_BLOCKED", "details": { "reason": "..." } }  // HTTP 402

// Pending approval — poll /v1/transactions/{id}
{ "data": { "status": "pending_approval", "transaction_id": "...", "poll_url": "..." } }  // HTTP 202
```

**Known service IDs** (confirmed from Argens docs):
- Firecrawl scrape: `firecrawl_scrape` (payload: `{ url, formats: ['markdown'] }`)
- LLM: discovered at runtime via `GET /marketplace/services?category=llm`; set via `ARGENS_LLM_SERVICE_ID`

**Provider skill files** (source of truth for payload shape per provider):
```
https://argens.xyz/SKILL/{provider_id}.md
```
Always fetch the skill file before constructing payloads — never invent field names.

**Error handling rules**:
- `402 POLICY_BLOCKED`: surface the error to the user; **never retry**.
- `202 pending_approval`: poll `GET /v1/transactions/{id}` until `status === "SUCCESS"`.
- `SERVICE_DISABLED`: tell user to enable the provider at `https://argens.xyz/dashboard/marketplace`.
- `MARKETPLACE_NOT_MPP`: upstream rejected before payment; no charge; fix the request.
- `MARKETPLACE_UPSTREAM_FAILED`: payment sent, upstream errored; log; do not retry blindly.

**Health check / balance**:
```
GET https://api.argens.xyz/v1/agent/status
→ { data: { wallet_status, wallet_balance, policies: { allowance_remaining, max_transaction_limit }, ... } }
```
Called on server boot; feed worker checks `allowance_remaining` before running.

**Amount format**: strings with 7 decimals (`"1.0000000"`), never raw numbers. (Relevant for `/pay` — not used for marketplace calls, but keep in mind.)

---

## Anti-Hallucination Rules

1. **Never invent Argens service IDs, endpoint names, or field names.** Discover via
   `GET /marketplace/services` or read the provider's skill file. If unsure, grep/confirm first.
2. **Never invent DB column names.** Read `server.ts` or run `PRAGMA table_info(ideas)` before adding queries.
3. **Never invent API routes.** Check `server.ts` routes section before referencing an endpoint.
4. **Keep `formatIdea()` and frontend field names in sync.** Snake_case in DB → camelCase in formatIdea → camelCase props in frontend.
5. **LemonSqueezy is consumer checkout; Argens is the spend side.** Never route the $1 unlock through Argens.
6. **No Locus references may appear anywhere** in code, UI, comments, or config. `grep -ri locus` must return nothing.
7. **The `ARGENS_LLM_SERVICE_ID` env var holds the endpoint id** (from `endpoints[].id`), not the provider id.

---

## Full Report Schema (v2 — expanded)

All fields in the `ideas` DB table:

```
id, url, source_title, title, summary, pain_points (JSON[]),
target_audience, competitor_gap, mvp_concept, gtm_strategy,
score_opportunity, score_feasibility, score_novelty,
tags (JSON[]), is_unlocked, created_at,
-- New in v2:
opportunity, problem, market_fit, business_model, value_prop,
why_now, community_signal, timing, source, category,
proof_signals (JSON[]), keywords (JSON[]),
score_timing, score_market_fit
```

**Free preview** (visible without unlock): title, summary, category, tags, keywords, target_audience,
score rings (all 5), source badge.

**Locked (blurred)**: problem, opportunity, competitor_gap, market_fit, business_model, value_prop,
why_now, proof_signals, community_signal, mvp_concept, gtm_strategy.

**Categories** (fixed enum): `AI tools | dev tools | consumer apps | B2B SaaS | fintech | productivity | other`

---

## Environment Variables Reference

Env vars are split by service. See `backend/.env.example` and `frontend/.env.example`.

### Backend only (`backend/.env.example`) — never expose these to the frontend
```bash
ARGENS_API_KEY=argns_live_...       # Argens API key — backend only, never in frontend
ARGENS_API_BASE_URL=https://api.argens.xyz/v1  # confirmed; do not change
ARGENS_LLM_SERVICE_ID=              # endpoint id from /marketplace/services; set after provider discovery
ARGENS_SCRAPE_SERVICE_ID=firecrawl_scrape  # Firecrawl endpoint id — confirmed
ARGENS_MOCK=                        # set to "1" for offline dev (no Argens calls)
TURSO_DATABASE_URL=file:./data.db   # libsql://... for Turso remote; file: for local
TURSO_AUTH_TOKEN=                   # Turso auth token (not needed for local file:)
LEMONSQUEEZY_WEBHOOK_SECRET=ophunt  # HMAC-SHA256 secret for LemonSqueezy webhook
FEED_ENABLED=1                      # set to "1" to run the curated feed worker
FEED_INTERVAL_HOURS=24              # feed run interval in hours (default 24)
FEED_MAX_ITEMS_PER_RUN=15           # bounds Argens spend per run
PRODUCT_HUNT_TOKEN=                 # Product Hunt API token (optional)
PORT=8080                           # server port
ALLOWED_ORIGINS=                    # comma-separated extra CORS origins (e.g. Vercel URL)
ADMIN_TOKEN=                        # guards /api/admin/* endpoints
```

### Frontend only (`frontend/.env.example`) — safe, no secrets
```bash
VITE_API_URL=                       # backend URL for production (empty = Vite proxy in dev)
                                    # Example: https://api.ophunt.io
```

### Deploy model notes
- **Single container (Railway/VPS Dockerfile)**: all backend vars, `ALLOWED_ORIGINS` not needed (same origin). Frontend builds into `./public` inside the container.
- **Split deploy (Vercel frontend + Railway/VPS backend)**: set `VITE_API_URL` in Vercel to your backend URL; set `ALLOWED_ORIGINS=https://your-app.vercel.app` on the backend.
- **DB in production**: `file:./data.db` is wiped on every redeploy without a persistent volume. Use Turso remote (`libsql://...`) for any non-ephemeral deploy.

---

## Dev & Verify Commands

```bash
# Install all deps (root + backend + frontend)
npm install

# Run in dev (Vite on :5173, backend on :4100, proxied)
npm run dev

# Check Argens connection + discover LLM providers (needs ADMIN_TOKEN)
curl -H "X-Admin-Token: $ADMIN_TOKEN" http://localhost:4100/api/admin/argens/llm-providers

# Check env + Argens base URL
curl http://localhost:4100/api/debug-env

# Test analyze (with ARGENS_MOCK=1 for offline)
curl -X POST http://localhost:4100/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"https://news.ycombinator.com"}'

# Manual unlock (bypass for testing)
curl -X POST http://localhost:4100/api/webhooks/lemonsqueezy/bypass \
  -H "Content-Type: application/json" \
  -d '{"idea_id":"<id>"}'

# Trigger feed run manually
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" http://localhost:4100/api/admin/refresh-feed

# Check no Locus references remain
grep -ri locus . --include="*.ts" --include="*.tsx" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude="package-lock.json"

# Docker build
docker build -t ophunt .
docker run -p 8080:8080 \
  -e ARGENS_API_KEY=... \
  -e TURSO_DATABASE_URL=... \
  -e TURSO_AUTH_TOKEN=... \
  -e LEMONSQUEEZY_WEBHOOK_SECRET=... \
  ophunt
```
