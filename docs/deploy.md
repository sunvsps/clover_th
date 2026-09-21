# Clover_TH backend: deployment notes

Audience: whoever deploys and runs the backend. Everything here was run end to end against a fresh Postgres 16 (see "Verified walkthrough" at the end). Design references are to `docs/backend-design.md`.

## 1. What runs where

- **One Node.js 22 process** (Fastify) plus **one PostgreSQL 16 database**. The notification worker and the auction sweeper run inside the API process.
- **Run exactly one API instance.** Locks and `SKIP LOCKED` keep a second instance correct, but the in-memory pieces (rate-limit counters, the OAuth state single-use guard, the bot-key failure counters) are per process, so a second instance only weakens them. Scale the database, not the API.
- **One origin.** A reverse proxy serves the frontend and forwards `/api` (and `/healthz`) to the API on the same host over HTTPS. There is no CORS configuration; the browser must see one origin. In production the session cookie is `__Host-session` (`Secure; HttpOnly; SameSite=Lax; Path=/`), which only works over HTTPS on that exact host.
- Frontend dev: the Vite dev proxy makes `http://localhost:5173` the single origin (`FRONTEND_URL`).

## 2. Environment variables

The server reads the process environment only (it does not load `.env` by itself). `backend/.env.example` lists every variable. For a shell: `set -a; source .env; set +a`. For a service manager (systemd `EnvironmentFile=`, Docker `--env-file`) use its own mechanism. **Never commit real values.**

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes in prod | `production` enables `__Host-session`, hides `/docs/json`, and makes `dev-login` refuse to run |
| `PORT` | no (3000) | listen port (binds `0.0.0.0`) |
| `LOG_LEVEL` | no (info) | pino level. Logs never contain the bot key, cookies, the OAuth `code`/`state` or request bodies |
| `DATABASE_URL` | yes | must contain `connection_limit` and `pool_timeout`, for example `postgresql://user:pass@host:5432/clover?connection_limit=25&pool_timeout=10`. Keep `connection_limit` well below Postgres `max_connections` |
| `PRISMA_TX_MAX_WAIT_MS`, `PRISMA_TX_TIMEOUT_MS` | no (10000, 5000) | interactive transaction wait/timeout. A pool that is exhausted answers 503 `SERVICE_BUSY` |
| `SESSION_SECRET` | yes | signs the OAuth state cookie. Generate: `openssl rand -base64 48`. `.env.example` ships it empty on purpose. **In production the server refuses to start** with a placeholder (for example `change-me...`), fewer than 43 characters, or very low entropy |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | yes | Discord OAuth (section 4) |
| `DISCORD_API_BASE` | no | only for tests against a mock Discord |
| `FRONTEND_URL` | yes | the public origin. Post-login redirect target and the allowed `Origin` for cookie writes |
| `BOT_API_KEYS` | yes | one or two sha256 hex digests of inbound bot keys (section 5) |
| `NOTIFICATIONS_PROVIDER` | no (off) | `off`, `fake` (dev), `bot` (section 9) |
| `DISCORD_BOT_NOTIFY_URL`, `DISCORD_BOT_NOTIFY_SECRET` | if provider is `bot` | where and how the API pushes promotion messages |
| `TRUST_PROXY_HOPS` | no (0) | **number of trusted reverse proxies in front of the API, usually `1`** (section 7). `0` ignores `X-Forwarded-For` |
| `TRUST_PROXY_CIDRS` | no | comma-separated proxy addresses/CIDRs to trust instead of a hop count. The old `TRUST_PROXY=true` is refused at startup |
| `PREAUTH_LIMIT_PER_MIN` | no (6000) | cheap per-IP budget applied before the session database lookup (anonymous flood guard); `/healthz` is exempt |
| `SESSION_SLIDING_DAYS` | no (30) | session lifetime, refreshed at most hourly while used |
| `SESSION_ABSOLUTE_DAYS` | no (90) | hard cap from login: a session never lives longer, however often it is used. Expired and over-age sessions are purged daily by the in-process sweeper |
| `DOCS_ACCESS` | no (auto) | who may read `/docs/json` (section 8) |
| `RATE_LIMIT_AUTH_PER_MIN` | no (600) | default budget per signed-in member |
| `RATE_LIMIT_ANON_PER_MIN` | no (120) | default budget per IP for public routes |
| `CLAIM_RATE_MAX` | no (5) | claim/release requests per member per second |
| `BOT_KEY_FAILS_PER_MIN` | no (20) | wrong bot keys per IP per minute before 429 |

Rate limits, in one place (all answer `429 RATE_LIMITED` with `Retry-After`): every route has the default budget per member (or per IP when anonymous); `/healthz` is exempt; `/auth/discord/login` and `/auth/discord/callback` are 30 per minute per IP; claim/release is `CLAIM_RATE_MAX` per second per member; invalid bot keys are counted per IP (a valid key always passes, so nobody can lock the bot out); a cheap per-IP budget (`PREAUTH_LIMIT_PER_MIN`) runs before the session lookup.

## 3. First deployment, step by step

```bash
cd backend
npm ci
npx prisma generate
npm run build                      # compiles to dist/
set -a; source .env; set +a        # or your service manager's env file
npx prisma migrate deploy          # applies every migration; safe to repeat
npm run db:seed                    # 8 jobs, 14 activities, 16 events, layouts. Idempotent, create-only
node dist/src/server.js            # or: npm start (runs through tsx)
curl -s http://localhost:3000/healthz
```

- `migrate deploy` is the only migration command to use in production (never `migrate dev`). The migrations include raw SQL (partial unique indexes, CHECK constraints); do not edit or regenerate them. CI checks them (`scripts/check-raw-migrations.sh`, `prisma migrate diff --exit-code`).
- The seed never overwrites admin edits (capacity, job colours, layouts), so it is safe to run on every release. `npm run db:seed -- --dev` also creates fake members and is for development only.
- The database must be UTF8 (the case-insensitive unique IGN and job-label indexes use `normalize()`).
- Run the service under a supervisor (systemd, Docker restart policy). Send `SIGTERM` for a clean stop.

### Members and the first admin

Members are created only by the Discord bot (`PUT /api/v1/bot/members/:discordId`). There is no API or UI to grant admin.

1. Register the existing roster once: prepare a JSON array `[{"discordId":"...","ign":"...","job":"Knight","nickname":"..."}]` and run `npx tsx scripts/bulk-import-members.ts members.json --dry-run`, then again without `--dry-run`. The dry run reports duplicate IGNs and unknown jobs without saving anything.
2. Make the first admin: the person must already be a member, then `npm run grant-admin -- <discordId>` on the server. Repeating it is harmless.

## 4. Discord OAuth application

1. https://discord.com/developers/applications, New Application.
2. OAuth2: copy the **Client ID** and **Client Secret** into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
3. OAuth2, Redirects: add exactly `https://<your host>/api/v1/auth/discord/callback` and set `DISCORD_REDIRECT_URI` to the same string. A mismatch blocks every login; if login breaks after a change, check this first.
4. Scope used: `identify` only. Nothing else is requested and Discord tokens are discarded after the profile call.
5. Login flow: `GET /api/v1/auth/discord/login` redirects to Discord, the callback sets the session cookie and redirects to `FRONTEND_URL`. Failures redirect to `FRONTEND_URL/?authError=AUTH_NOT_REGISTERED` (not registered by the bot), `AUTH_MEMBER_INACTIVE` or `AUTH_OAUTH_FAILED`. The profile JSON is `GET /api/v1/me`.

## 5. Bot API key (inbound) and rotation

The key is configuration, never stored in the database.

```bash
npm run hash-bot-key -- --generate          # prints a NEW key (give it to the bot, shown once) and its digest
echo -n "an existing key" | npm run hash-bot-key   # digest of a key you already have
```

Put the digest in `BOT_API_KEYS`. The bot sends it as header `X-Bot-Key`. **Rotation without downtime:** generate a second key, set `BOT_API_KEYS=<old digest>,<new digest>`, restart, switch the bot to the new key, then remove the old digest and restart. At most two digests are accepted. Wrong keys are rate limited per IP.

## 6. Reverse proxy

- Terminate TLS at the proxy and forward `/api/` and `/healthz` to `127.0.0.1:3000`; serve the built frontend for everything else, on the same host.
- Set `X-Forwarded-For` from the connection and set `TRUST_PROXY_HOPS=1` (section 7).
- Do not cache `/api/` responses (the API sends `Cache-Control: no-store`; the polling endpoint uses `no-cache` plus an ETag).
- Request body limit: the API rejects bodies over Fastify's 1 MB default.

## 7. Trusted proxies (TRUST_PROXY_HOPS)

Default `0`: the client IP is the socket peer and `X-Forwarded-For` is ignored. Behind a reverse proxy every user then appears to come from the proxy's IP, so per-IP limits (login 30 per minute, anonymous budget, invalid bot keys) become **global** and the 31st login in a minute anywhere gets 429.

Set `TRUST_PROXY_HOPS=1` for one proxy in front of the API (or `TRUST_PROXY_CIDRS` with the proxies' addresses). The client is then the address the proxy appended, counted from the right of `X-Forwarded-For`, so a client cannot choose its own identity by sending its own header. **Your proxy must set the header from the connection, not append to a client-supplied one**, and the API must be reachable only through it:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

(`$proxy_add_x_forwarded_for` keeps the client's own value on the left; with one hop that is harmless, but two proxies need `TRUST_PROXY_HOPS=2`.) The former `TRUST_PROXY=true` trusted the whole chain and is refused at startup.

## 8. OpenAPI document exposure

`GET /docs/json` is the generated OpenAPI 3 document. `DOCS_ACCESS`:

- `auto` (default): public in development and tests, **not served (404) when `NODE_ENV=production`**;
- `admin`: served to signed-in admins only;
- `public`: served to everyone;
- `off`: never served.

The frontend types are generated at build time by `npm run openapi` (which writes `backend/openapi/openapi.json` and `schema.d.ts` without the server running), so production never needs the route.

## 9. Notifications (Discord messages on reserve promotion)

`NOTIFICATIONS_PROVIDER`:

- `off`: nothing is queued.
- `fake`: keeps messages in memory (development).
- `bot`: the API pushes each message to the bot over HTTP: `POST {DISCORD_BOT_NOTIFY_URL}/v1/notifications` with headers `X-Notify-Timestamp` (unix seconds), `X-Notify-Signature` = hex HMAC-SHA256 of `timestamp + "." + rawBody` using `DISCORD_BOT_NOTIFY_SECRET`, and `Idempotency-Key`. The bot must reject timestamps older than 5 minutes and de-duplicate on the key. Permanent errors it may answer: `DM_CLOSED`, `USER_NOT_FOUND`, `CHANNEL_NOT_FOUND`. This secret is separate from `BOT_API_KEYS`.

Messages are written in the same transaction as the promotion, so a Discord outage never blocks a promotion: rows stay `PENDING` and are retried with backoff (up to 8 attempts, then `DEAD` plus an audit row `notification.dead`). Admins see the outbox at `GET /api/v1/admin/notifications` and can retry with `POST /api/v1/admin/notifications/:id/retry`. The channel id for channel posts is per activity (`PATCH /api/v1/admin/activities/:id`, `notifyChannelId`); with none set only the private message is sent.

## 10. Health, monitoring, logs

- `GET /healthz` returns 200 `{status:"ok",db:"ok"}` when the database answers, 503 `DB_UNAVAILABLE` otherwise. Use it for the load balancer and uptime checks. It is exempt from rate limiting.
- Logs are JSON (pino) on stdout, one line per request with a request id (`X-Request-Id` is echoed on every response). Alert on `level >= 50`, on `SERVICE_BUSY` 503s, and on audit rows `notification.dead`.
- The audit log is in the database (`GET /api/v1/admin/audit-log`); it has no retention job, at this scale it grows by hundreds of rows a week.

## 11. Backups and recovery

- Take **daily logical backups** and, for production, **continuous WAL archiving / point-in-time recovery** from the managed Postgres provider (or `pg_basebackup` plus archived WAL). Recommended targets: RPO 15 minutes, RTO 1 hour. Keep 14 daily and 8 weekly backups; keep at least one copy off the provider.
- Logical backup: `pg_dump --format=custom --no-owner "$DATABASE_URL" > clover-$(date +%F).dump` (drop the `?connection_limit=...` query string for `pg_dump`).
- Restore into an empty database: `createdb clover_restore && pg_restore --no-owner -d clover_restore clover-YYYY-MM-DD.dump`, then point `DATABASE_URL` at it. The dump includes `_prisma_migrations`, so `migrate deploy` afterwards only applies newer migrations.
- **Test a restore** after the first deployment and then every quarter. Sessions, the outbox and the audit log are in the same database and come back with it. Pending notifications restored from an older backup may be re-sent; the bot de-duplicates on the idempotency key.
- Secrets are not in the database. Keep `SESSION_SECRET`, the Discord client secret and the bot secrets in your secret manager. If `SESSION_SECRET` changes, only in-flight logins are affected (sessions are database rows).

## 12. Releases and rollback

1. Take a backup. 2. Deploy the new build. 3. `npx prisma migrate deploy`. 4. `npm run db:seed` (optional, idempotent). 5. Restart the single instance and check `/healthz`.
Migrations are forward-only. To roll back the application, redeploy the previous build (it ignores newer columns it does not know); restoring the database is a last resort.

## 13. Break-glass login for development (never production)

`npm run dev-login -- <discordId>` creates a session for an existing member and prints the cookie and the CSRF header. It is a script only (there is no HTTP route), it **refuses to run when `NODE_ENV=production`** and refuses a non-local `DATABASE_URL` unless `DEV_LOGIN_ALLOW_REMOTE_DB=1`, and the output stays in your terminal: treat it like a password. See `docs/postman.md`.

## 14. Load and soak tests

`npm run test:load` (about 1 minute) and `SOAK_SECONDS=300 npm run test:load` (5 minute soak) run the 80-member scenarios against a local Postgres: 80 members polling every 1 to 2 seconds while claiming, 80 concurrent claims on one item, an 80-member registration burst, and a full-size type-2 allocation. They print p50/p95/p99 and fail on any 5xx or a p95 over 200 ms for polls and claims. They are separate from `npm test` on purpose.

## Verified walkthrough

The following was executed on a clean machine state with a throwaway `postgres:16` container (`docker compose up -d` in `backend/`, port 55432): `npm ci`, `npx prisma generate`, `npm run build`, `migrate deploy`, `db:seed`, `hash-bot-key --generate`, start with `NODE_ENV=production`, then `GET /healthz` (200), bot `PUT /api/v1/bot/members/<id>` (201), `grant-admin`, `GET /docs/json` (404 in production), and `dev-login` refusing under `NODE_ENV=production`.
