# Clover_TH frontend

React 19 + TypeScript + Vite. It talks to the Fastify backend in `../backend` through `/api/v1` (same origin: the Vite dev server proxies `/api` to `http://localhost:3000`, so the session cookie is first-party and there is no CORS).

## Commands

```
npm ci              # install
npm run dev         # Vite dev server on http://localhost:5173
npm run lint
npm test            # Vitest + MSW (jsdom)
npm run test:tz     # Bangkok date helpers under TZ=UTC, Asia/Bangkok and America/Los_Angeles
npm run build       # tsc -b && vite build
npm run api:types   # copy ../backend/openapi/schema.d.ts to src/api/schema.d.ts (run after the API changes)
npm run api:types:check  # fails when the copy is out of date (CI)
```

## Running the whole stack locally

1. Database (throwaway Postgres 16 on host port 55432; set `DB_PORT` to use another):
   `cd backend && docker compose up -d db`
2. Backend env: `cp .env.example .env` in `backend/` and set `SESSION_SECRET` (`openssl rand -base64 48`). Keep `FRONTEND_URL=http://localhost:5173` (the CSRF check compares the browser `Origin` with it). Discord values are only needed for real login (below).
3. Schema and demo data: `npm ci && npm run db:migrate` then `npm run db:seed -- --dev` (dev seed: an admin with Discord id `900000000000000000`, sample members, jobs and events).
4. Backend: `npm run dev` (port 3000).
5. Frontend: `cd frontend && npm ci && npm run dev`, open http://localhost:5173.

## Run everything from the backend

For a demo or a single-host deployment no Vite server is needed: build the frontend and let the backend serve it next to the API on one origin.

```
cd frontend && npm ci && npm run build      # writes frontend/dist
cd ../backend && npm run start              # site and API on http://localhost:3000
```

Set `FRONTEND_URL=http://localhost:3000` in `backend/.env` (the CSRF check compares the browser `Origin` with it). The backend finds `../frontend/dist` by itself (`FRONTEND_DIST_DIR` overrides it, `SERVE_FRONTEND=off` disables it); without a build it just serves the API. Restart it after rebuilding. Details: `docs/deploy.md`, section 3a.

## Signing in

The Sign-in button goes to `/api/v1/auth/discord/login`. Two ways to get a session in development:

- **Real Discord app.** Create an application in the Discord developer portal, add the redirect `http://localhost:5173/api/v1/auth/discord/callback`, and put `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_REDIRECT_URI` in `backend/.env`. Only members registered through the bot (and active) can sign in; anyone else lands on a clear "not registered" / "deactivated" screen.
- **Dev login cookie (no Discord).** In `backend/` run `npm run dev-login -- 900000000000000000` (see `docs/postman.md`). It prints a session cookie for a seeded member; in the browser console on http://localhost:5173 run `document.cookie = "session=<value>; path=/"` and reload. The cookie is a live login: do not paste it into files, chat or logs.

`?authError=` (set by the backend after a failed login) shows a separate screen for `AUTH_NOT_REGISTERED`, `AUTH_MEMBER_INACTIVE`, `AUTH_STATE_INVALID` and `AUTH_OAUTH_FAILED`. A 401 while using the app shows "session expired".

## Code layout

- `src/api/` is the only place that talks HTTP: `client.ts` (fetch with `credentials: 'include'`, `X-Requested-With` on writes, error envelope to `ApiError`), `errors.ts` (error code to TH/EN text), `enums.ts` (wire enums such as `JOINED` to UI names, only here), `serverClock.ts` and `usePolling.ts` (server clock offset from `serverTime` / `X-Server-Time`), `adapters.ts` and `endpoints.ts`. `schema.d.ts` is generated (do not edit; `npm run api:types`).
- `src/lib/bangkok.ts`: date keys (`YYYY-MM-DD`) and week maths in Asia/Bangkok, identical in any browser time zone.
- `src/data/guild.ts`: UI types and helpers only (no member or job data).
- Members are keyed by `memberId` everywhere and shown by `ign`.
