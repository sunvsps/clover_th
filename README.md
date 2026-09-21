# Clover_TH Guild Item Reservation

Frontend for the Clover_TH Ragnarok: The New World guild auction queue.

## Features

- Discord OAuth sign-in through the backend (`/api/v1/auth/discord/login`); the profile comes from `GET /api/v1/me`. Unregistered or deactivated accounts get a clear message from the `?authError=` redirect
- Roster, jobs, activities and weekly events are loaded from the API; every member is keyed by their server id and displayed by IGN
- Weekly schedule on real Bangkok dates: register as playing / leave per occurrence, waitlist positions when an activity has a capacity, registration closes when the occurrence starts, admins can record for other members, per-day roster with copy-for-Discord
- Team planner per event occurrence, driven by the server plan: rooms, teams and slots from the activity layout, a reserves list in registration order, drag-and-drop or tap-to-place (drop on an occupied slot swaps), withdrawn/not-registered flags, auto-backfill badge with Undo, copy-from-previous-week, clear, 5-second polling and version-conflict handling
- Auctions: live-claim rounds (first click by server time, per-member cap, release, server-clock countdown, 1.5 s polling) and queue rounds (Gear/Card/Relic queues with rank, ranked preference list, server-side allocation, leftovers drafted into a new live round), results and copy
- Admin config: member list (incomplete filter, edit IGN/nickname/job, deactivate/reactivate), job manager (draft then `PUT /admin/jobs`), activity settings (capacity, auto-backfill, notification channel), layout editor, round manager (create with items, start, close, cancel, results), notification outbox with retry, audit log
- Admins can preview the user view from the ADMIN badge and switch back
- Responsive layout for desktop, tablet and phone; TH/EN toggle; hash deep links (`#calendar`, `#teams`, `#admin`)

## Run locally

Backend (see `docs/deploy.md` for production):

```bash
cd backend
docker compose up -d                 # Postgres 16 on 127.0.0.1:55432
npm ci && npx prisma generate
cp .env.example .env                 # fill SESSION_SECRET (openssl rand -base64 48) and BOT_API_KEYS (npm run hash-bot-key -- --generate)
set -a; source .env; set +a
npx prisma migrate deploy && npm run db:seed -- --dev
npm run dev                          # http://localhost:3000
```

Frontend:

```bash
cd frontend
npm install
npm run dev                          # http://localhost:5173, proxies /api to :3000
```

Without a Discord OAuth app, create a session for a seeded member with `npm run dev-login -- 900000000000000000` (the dev admin) in `backend/` and set the printed `session` cookie for `localhost` in your browser (DevTools → Application → Cookies). The bot normally registers members; to load the guild roster use `npx tsx scripts/bulk-import-members.ts members.json`.

## Build and lint

```bash
cd frontend
npm run build
npm run lint
npm run api:types                    # refresh src/api/schema.d.ts from backend/openapi after API changes
```

## Frontend structure

- `src/api/` — typed fetch client (`client.ts`), endpoint wrappers (`index.ts`), error-code → TH/EN messages (`errors.ts`), generated OpenAPI types (`schema.d.ts`)
- `src/lib/dates.ts` — Bangkok-time date keys; `src/lib/types.ts` — shared view props
- `src/hooks/usePolling.ts` — polling with visibility pause and server-clock offset
- `src/views/AuctionView.tsx`, `src/views/AdminView.tsx`, `src/components/WeeklySchedule.tsx`, `src/components/TeamPlanner.tsx`

## Deploying the frontend

The API must be same-origin (`/api/...`) because sessions are `__Host-` cookies. On Vercel add a `vercel.json` rewrite from `/api/(.*)` to the backend host and set the backend's `FRONTEND_URL` and `DISCORD_REDIRECT_URI` to the Vercel origin; a reverse proxy (nginx) works the same way, see `docs/deploy.md`.
