# NoteBouncer

Detects AI notetaker bots in your Zoom meetings and auto-removes them when the
sidebar app is open. Split into a thin **frontend** (Next.js — landing,
dashboard, sidebar UI) and a **backend** (Node + Express — OAuth, webhook
receiver, detection engine, all DB access).

## Architecture

```
                   Zoom platform
                   /            \
         webhooks  /              \  Apps SDK (in-meeting)
                  /                \
                 v                  v
       ┌────────────────┐    ┌──────────────────┐
       │  BACKEND       │    │   FRONTEND       │
       │  /webhook/zoom │    │   /zoom-home     │
       │                │    │   (sidebar)      │
       │  HMAC verify   │    │                  │
       │  → detect()    │    │  POST            │
       │  → audit_log   │←───│  /api/detect     │
       │                │    │  POST            │
       │                │←───│  /api/sidebar/.. │
       └────────────────┘    └──────────────────┘
                 ▲                    │
                 │                    │ /removeParticipant
                 │                    v
            DB / Prisma          Zoom client
```

Two detection paths share **one** engine (`backend/src/domain/detection.ts`):

1. **Webhook path** — Zoom hits `POST /webhook/zoom`. Backend verifies HMAC,
   dedupes via `webhook_events`, runs detection inline, writes `audit_log`.
   Logs only — REST can't kick participants.
2. **Sidebar path** — Sidebar runs inside Zoom's in-client browser. For each
   participant it POSTs to the backend's `POST /api/detect`. If `match:true`,
   it calls `removeParticipant({participantUUID})` via the Zoom Apps SDK,
   then POSTs the result to `POST /api/sidebar/event` for the audit log.

The Zoom Apps SDK must run in the browser — that's the only place
`removeParticipant` works. Everything else (detection logic, DB writes, OAuth,
HMAC verification) lives on the backend.

## Repo layout

```
notebouncer-dev/
├── package.json              # npm workspaces
├── frontend/                 # Next.js — landing, dashboard, sidebar UI
│   ├── app/
│   │   ├── (marketing)/page.tsx        Landing page
│   │   ├── (app)/dashboard/page.tsx    RSC: fetches /api/dashboard
│   │   ├── (app)/zoom-home/page.tsx    Sidebar — calls /api/detect, /event
│   │   └── install/route.ts            Bounces to backend /oauth/install
│   ├── components/                     Pure UI
│   └── lib/
│       ├── api.ts                      Typed backend client
│       ├── copy.ts                     UI strings
│       └── types.ts                    Wire-shape mirrors of backend
└── backend/                  # Node + Express — API, OAuth, webhook, DB
    ├── prisma/schema.prisma            6 tables: users, oauth_tokens,
    │                                   configs, meetings, audit_log,
    │                                   webhook_events
    └── src/
        ├── index.ts                    Express bootstrap
        ├── env.ts                      Zod-validated env
        ├── api/                        Route handlers
        ├── domain/                     Pure logic (detect, dedup, insights)
        └── infra/                      Prisma, crypto, Zoom helpers
```

## Backend API surface

| Method | Path | Purpose |
|---|---|---|
| GET  | `/oauth/install`      | Start install: set state cookie, redirect to Zoom |
| GET  | `/oauth/callback`     | Exchange code, upsert user/config, bounce to frontend |
| POST | `/webhook/zoom`       | Zoom webhook receiver (HMAC-verified, deduped) |
| POST | `/api/detect`         | `{name,email?,isGuest?}` → `DetectionResult` |
| GET  | `/api/sidebar/config` | Per-host config (enabled, dryRun, detection rules) |
| POST | `/api/sidebar/event`  | Sidebar reports detection/removal → audit log |
| GET  | `/api/dashboard`      | Pre-computed dashboard payload (hosts, rows, stats, insight) |
| GET  | `/health`             | Liveness probe |

## Setup

You'll need a Zoom Developer account, a Postgres database (Neon works well),
and Node 20+.

### 1. Configure environment

Copy and fill in both env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

`backend/.env`:

| Key | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 — see below |
| `ZOOM_CLIENT_ID` | from Zoom Marketplace |
| `ZOOM_CLIENT_SECRET` | from Zoom Marketplace |
| `ZOOM_WEBHOOK_SECRET` | from Zoom Marketplace |
| `ZOOM_REDIRECT_URI` | `http://localhost:4000/oauth/callback` |
| `FRONTEND_URL` | `http://localhost:3000` |
| `PORT` | `4000` |

`frontend/.env.local`:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:4000` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` (optional) |

Generate the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. Install dependencies and push the schema

From the repo root:

```bash
npm install
npm run db:push   # forwards to backend workspace
```

### 3. Configure the Zoom Marketplace app

In `marketplace.zoom.us/develop/created`:

- **App type:** General App, User-managed
- **Scopes:** `user:read:user`, `meeting:read:meeting`, `meeting:read:participant`, `zoomapp:inmeeting`
- **OAuth Redirect URL:** `https://api.YOUR-DOMAIN/oauth/callback`  *(backend)*
- **OAuth Allow List:** `https://api.YOUR-DOMAIN`
- **Surface tab:** tick *Meetings*. Home URL: `https://YOUR-DOMAIN/zoom-home`  *(frontend)*. Domain Allow List: `https://YOUR-DOMAIN`
- **Zoom App SDK APIs:** `removeParticipant`, `putParticipantToWaitingRoom`, `getMeetingParticipants`, `getRunningContext`, `getMeetingContext`, `getWaitingRoomState`, `showNotification`
- **Zoom App SDK Events:** `onParticipantChange`
- **Event subscriptions:**
  - Endpoint URL: `https://api.YOUR-DOMAIN/webhook/zoom`  *(backend)*
  - Events: `Meeting → Participant/Host joined meeting`, `App Marketplace → App Deauthorized`
  - Copy the Secret Token into `ZOOM_WEBHOOK_SECRET`, save, then click **Validate**.

For local development: tunnel the backend with ngrok and point all four
URLs (redirect, allow list, webhook, allow list) at the ngrok URL.

### 4. Run

```bash
npm run dev
```

Starts the frontend on `:3000` and the backend on `:4000` in parallel.

Visit `http://localhost:3000` → click **Install on Zoom** → land on
`/dashboard?installed=1`.

### 5. Test the sidebar

1. Open Zoom desktop client signed into the host account
2. Start a meeting
3. Click **Apps** → **NoteBouncer**
4. Have a guest join named "Otter.ai Notetaker"
5. Activity log in the sidebar should show:
   - `join: Otter.ai Notetaker`
   - `Bot detected: Otter.ai Notetaker (name:otter)`
   - `Removed: Otter.ai Notetaker (XYZms)`
6. Refresh `/dashboard` — new row with `source: sidebar`.

## Data model

| Table | Purpose |
|---|---|
| `users` | One row per installed Zoom user. |
| `oauth_tokens` | AES-256-GCM-encrypted access/refresh tokens. |
| `configs` | Per-user detection settings (enabled, dryRun, allowlist, custom blocklist). Auto-seeded on install. |
| `meetings` | Per (user, meeting_uuid). Written on first webhook for a meeting. `mode_override` allows per-meeting policy. |
| `audit_log` | Every detection or removal. `action ∈ {detected, removed, moved_to_waiting_room, remove_failed, dry_run}`, `source ∈ {webhook, sidebar}`. |
| `webhook_events` | Dedup table for Zoom event IDs. Outlasts Zoom's retry window. |

## What's intentionally not in this build

These were called out as deferred during the FE/BE split:

- **BullMQ + Redis queue.** Webhook events process inline. The queue interface
  can be added later in `backend/src/api/webhook.ts` without changing public
  surfaces.
- **Envelope encryption (KEK + DEK).** Tokens use a single AES-256-GCM key
  from `TOKEN_ENCRYPTION_KEY` (see `backend/src/infra/crypto.ts`). Swap to KMS
  envelope encryption before going multi-tenant.
- **Sidebar context-token verification** (Zoom spec §4.8) — sidebar event
  reports still rely on the most-recently-installed-user fallback for host
  identity.
- **Per-host config UI.** The `configs` table is populated with defaults; no
  dashboard UI writes to it yet.
- **Stripe billing, Marketplace public submission.**

## License

See [LICENSE](LICENSE).
