# Testing the Clover_TH API with Postman (no Discord app needed)

This is for **local development only**. It uses the break-glass script `scripts/dev-login.ts`, which creates a session for a seeded member. It refuses to run when `NODE_ENV=production`. It has no HTTP route of its own; the only HTTP way in without Discord is the local demo login (`LOCAL_DEMO_ENABLED=true`, loopback only, refused in production), so neither can be used against a real deployment. The cookie it prints is a live login: keep it in your terminal and in Postman, never in chat, tickets or shared logs.

## 1. Start the database

```bash
cd backend
docker compose up -d          # Postgres 16 on localhost:55432 (user/password/db: clover)
```

## 2. Configure and migrate

```bash
cp .env.example .env
```

Edit `.env` (all values below are fine for local use):

```
NODE_ENV=development
DATABASE_URL=postgresql://clover:clover@localhost:55432/clover?connection_limit=25&pool_timeout=10
SESSION_SECRET=any-random-string-of-at-least-32-characters
DISCORD_CLIENT_ID=dummy
DISCORD_CLIENT_SECRET=dummy
DISCORD_REDIRECT_URI=http://localhost:5173/api/v1/auth/discord/callback
FRONTEND_URL=http://localhost:5173
BOT_API_KEYS=<filled in at step 4>
```

The server and scripts read the process environment, so load the file into your shell (repeat this in every new terminal):

```bash
set -a; source .env; set +a
npx prisma migrate deploy
npm run db:seed -- --dev      # jobs, activities, 16 events, layouts and 5 fake members (the first is an admin)
```

The seeded members have Discord ids `900000000000000000` (admin) to `900000000000000004`.

## 3. Optional: make someone else an admin

A member must exist first (register through the bot endpoint in step 6), then:

```bash
npm run grant-admin -- <discordId>
```

## 4. Generate a bot key

```bash
npm run hash-bot-key -- --generate
```

It prints `bot key ...` (use it in Postman as `X-Bot-Key`) and `BOT_API_KEYS digest: ...` (put that digest into `.env` as `BOT_API_KEYS`, then reload the env with `set -a; source .env; set +a`).

## 5. Run the server and get a session cookie

```bash
npm run dev                   # http://localhost:3000, restarts on file changes
```

In a second terminal (with the env loaded):

```bash
npm run dev-login -- 900000000000000000
```

Output looks like:

```
Signed in as แมวกระเป๋า (admin) for 8 hour(s).

Send these headers on every request:
  Cookie: session=<long token>
For POST/PUT/PATCH/DELETE also send (CSRF protection):
  X-Requested-With: dev-login
  Origin: http://localhost:5173        (optional; if present it must equal this)
```

For a non-admin member use one of the other ids. `--hours N` changes the lifetime (1 to 24, default 8). If the script says `refused:` read the message (production mode, remote database, unknown or deactivated member).

## 6. Postman setup

1. Create an environment with `baseUrl = http://localhost:3000`, `cookie = session=<token>` and `botKey = <the bot key>`.
2. In the collection, add these headers: `Cookie: {{cookie}}`. For POST, PUT, PATCH and DELETE also `X-Requested-With: dev-login` (any non-empty value works) and, if you send `Origin`, it must be exactly `http://localhost:5173`. Set `Content-Type: application/json` for bodies.
3. Postman's cookie jar will not store the cookie (it is flagged `Secure` and the server is plain HTTP), which is why you send it as an ordinary header.

Try, in this order:

| Request | Notes |
|---|---|
| `GET {{baseUrl}}/healthz` | no headers needed |
| `GET {{baseUrl}}/api/v1/me` | your profile: `memberId, discordId, ign, nickname, job, isAdmin, isIncomplete, serverTime` |
| `GET {{baseUrl}}/api/v1/events`, `/activities`, `/members`, `/jobs` | schedule, settings, roster, jobs |
| `PUT {{baseUrl}}/api/v1/events/polarity-zone/occurrences/YYYY-MM-DD/registrations/me` body `{"status":"JOINED"}` | pick a Sunday within 8 weeks |
| `GET {{baseUrl}}/api/v1/events/polarity-zone/occurrences/YYYY-MM-DD/plan` | plan, reserves, version |
| `PUT .../plan/placements/<memberId>` body `{"teamId":<id>,"expectedVersion":0}` | admin only; use `version` from the plan as `expectedVersion` |
| `POST {{baseUrl}}/api/v1/admin/auctions/rounds` body `{"type":"LIVE_CLAIM","name":"Test","items":[{"name":"Sword","category":"GEAR"}]}` | admin only; then `POST /api/v1/admin/auctions/rounds/<id>/start` and `POST /api/v1/auctions/rounds/<id>/items/<itemId>/claim` |
| `GET {{baseUrl}}/api/v1/admin/audit-log` | admin only |
| `GET {{baseUrl}}/docs/json` | the OpenAPI document (import it into Postman: Import, Link/Raw text). Available in development; disabled in production |

Bot endpoints use the bot key instead of the cookie, and need **no** CSRF headers:

```
PUT {{baseUrl}}/api/v1/bot/members/700000000000000001
X-Bot-Key: {{botKey}}
Content-Type: application/json

{"ign":"TestPlayer","job":"Knight","nickname":"Tester"}
```

`201` creates the member, `200` repeats it; `POST /api/v1/bot/members/<discordId>/deactivate` deactivates. A session cookie is **not** accepted on bot routes and the bot key is **not** accepted on member routes.

## 7. Errors you will see

Every error is `{ "error": { "code": "...", "message": "...", "details": {} } }`. The common ones while testing: `AUTH_REQUIRED` (missing or expired cookie; run `dev-login` again), `CSRF_REJECTED` (missing `X-Requested-With` on a write, or a wrong `Origin`), `ADMIN_REQUIRED` (log in as an admin), `RATE_LIMITED` (wait for `Retry-After`), `VALIDATION_ERROR` (unknown or misspelled body fields are rejected on purpose).

## 8. Cleaning up

```bash
docker compose down           # the local database lives in memory, so this also wipes it
```
