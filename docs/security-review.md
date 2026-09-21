# Clover_TH backend: security, quality and usability review (Warden)

Scope: `backend/` WP1-WP10 at branch `feature/init-backend` (HEAD `1939639`), plus `docs/deploy.md`, `.github/workflows/backend-ci.yml`, `backend/docker-compose.yml`, `.env.example`. Frontend out of scope except where the API contract matters.

Method: full read of `backend/src`, `prisma/`, `scripts/`, tests; full suite run against a throwaway Postgres 16 (668 tests in 41 files, all pass); 9 exploit/behaviour probes in `backend/test/security/warden-probes.test.ts` (documentation probes, they print observations and do not gate CI); `npm audit --omit=dev`. No production code, existing tests or docs were changed. Findings marked "reproduced" were observed in a probe; "code review" means reasoned from the source only.

## Verdict: APPROVE WITH CHANGES

No Critical finding: there is no unauthenticated path to data, no privilege escalation, no SQL injection, and the auction fairness core (cap, winner uniqueness, late claims, allocation determinism) held under attack. There are 3 High findings, all in the abuse-resistance / availability layer and cheap to fix. Fix the High items before go-live; the rest can follow.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 6 |
| Low | 13 |
| Info | 6 |

## Findings

### High

| ID | Location | Description | Repro / evidence | Recommended fix |
|---|---|---|---|---|
| H-1 | `src/plugins/botAuth.ts:14-27`; `src/app.ts:51`; `docs/deploy.md` s.7 | The wrong-key guard locks out the **correct** key for the same IP (`entry.count >= max` returns 429 before the key is even checked). So any anonymous caller can lock the real bot out: (a) `TRUST_PROXY=false` behind the proxy (the default, and what deploy.md warns about): the attacker and the bot share the proxy IP, so 20 bad keys per minute blocks the bot continuously; (b) `TRUST_PROXY=true` (`trustProxy: true` trusts every hop): the attacker pre-seeds `X-Forwarded-For` with the bot's IP, the proxy appends the real client, Fastify takes the leftmost. While locked, member registration and **deactivation of leavers** (the only path that revokes access) silently stop. | Reproduced (P1b): 4 wrong keys with `X-Forwarded-For: 198.51.100.7, <real>`, then the correct key from 198.51.100.7 gets `429 RATE_LIMITED`. Existing test `limits.test.ts` asserts this lockout as intended behaviour. | Verify the key first; a valid key always passes. Throttle only invalid attempts (429 or an artificial delay). Keys are 256-bit, so the lockout adds nothing; enforce >=128-bit keys instead (see L-6). Separately fix H-2. |
| H-2 | `src/app.ts:51`, `src/config/env.ts:50-53` | `TRUST_PROXY=true` becomes Fastify `trustProxy: true` = trust the whole X-Forwarded-For chain. If the proxy appends (nginx `$proxy_add_x_forwarded_for`, the common default) the client controls `req.ip`. This defeats every per-IP control: anonymous budget, login/callback 30/min, bot 300/min, failed-key guard. deploy.md only says "set X-Forwarded-For". | Reproduced (P1a): 30 anonymous requests with a rotating leftmost XFF against an anon limit of 5: 0 of 30 got 429. | Replace the boolean with a hop count or CIDR list (`TRUST_PROXY_HOPS=1` -> `trustProxy: 1`), and document `proxy_set_header X-Forwarded-For $remote_addr;`. Add a test with `TRUST_PROXY` set and a forged header. |
| H-3 | `src/modules/auctions/routes.ts:82-88, 217, 262, 346, 388` | `lazyFinalize` runs `finalizeRound` (including type-2 allocation) inside the GET handlers for ordinary members, with no error isolation. If allocation ever throws or times out (5 s tx timeout, a data anomaly, a lock wait) the round stays OPEN and **every poll from every member returns 500** for that round and for `GET /auctions/rounds`, while the sweeper logs the same error every second. Members cannot even see the round to claim items. | Code review (no failing input found; the risk is the blast radius of any future bug or slow allocation). | Wrap `lazyFinalize` in try/catch: log and continue serving the read (the round is still OPEN or closable). Keep a single owner (the sweeper) for finalization and use lazy finalize only as a best effort. Add a test that a throwing `allocateRound` does not break `GET /rounds/:id`. |

### Medium

| ID | Location | Description | Repro / evidence | Recommended fix |
|---|---|---|---|---|
| M-1 | `src/plugins/session.ts:67-79` vs `src/app.ts:94-101` | The session lookup (a DB query) runs in `onRequest`, the rate limiter runs in `preHandler`. A request carrying any cookie of up to 200 chars costs one DB query and is **never counted**: the auth guards throw before the limiter runs, and unknown routes are not limited either. An anonymous attacker can generate unmetered DB load. | Reproduced (P2): 400 requests to `/api/v1/me` with random cookies and an anonymous budget of 5: 400 x 401, zero 429. Unknown-route flood: 20 x 404. | Register the rate limiter at `onRequest` before the session hook (keyed by IP first, then by member is unnecessary for the pre-auth cost), or add a cheap in-memory per-IP counter ahead of the session query. Cache negative lookups briefly. |
| M-2 | `src/modules/auctions/rounds.ts:127-160` (`roundFingerprint`), `routes.ts:262-280` | The polling ETag covers status, window, item count, win count, newest `wonAt`, own win count. It does not cover round name, `winCap`, `durationSec`, `startDelaySec`, or item names/categories/ids. With browser revalidation an admin who edits a draft (rename, cap, replace items with the same count) gets `304` and keeps seeing the old data. | Reproduced (P3, P3b): after `PATCH {name, winCap}` and after an item replace, a conditional GET returns 304. | Add `name`, `winCap`, `durationSec`, `startDelaySec` and a hash/max id of the items (or a `version`/`updatedAt` column bumped by `updateDraft`) to the fingerprint. Add a test. |
| M-3 | `src/modules/members/deactivate.ts:46`, `src/modules/auctions/finalizer.ts:72-86`, `queue.ts:57-73` | Deactivation deletes the member's `QueueEntry` rows without taking the category advisory lock that finalize/join/leave use. If it commits between allocation's snapshot read and its re-queue step, allocation re-inserts a queue entry (and may have awarded an item) for a now-inactive member. Nothing filters inactive members out of a queue afterwards, so the ghost entry occupies a place and can win items in later rounds. `joinQueue` also does not re-check `isActive` after the session lookup. | Code review; narrow race, not reproduced. | In `deactivateMember`, take `categoryLocks` for the three categories (after the activity locks, per the documented order) before deleting entries. In `allocate`/snapshot queries join `Member.isActive`. Re-check `isActive` inside `joinQueue`. |
| M-4 | `.env.example:11`, `src/config/env.ts:21` | The example `SESSION_SECRET` (38 chars) passes the `min(32)` check, and nothing rejects a placeholder in production. A copied `.env` yields a publicly known signing key for the OAuth state cookie. | Code review. Impact is bounded (it signs only the state cookie, so at worst login CSRF), hence Medium not High. | Refuse known placeholders and, when `NODE_ENV=production`, require >=43 chars of entropy (or reject values containing `change-me`). Ship the example with an empty value like the other secrets. |
| M-5 | `src/plugins/session.ts`, whole repo | Sessions are never purged (no cleanup for `Session.expiresAt`, verified by grep), and expiry is sliding with **no absolute lifetime**: a stolen cookie that is used at least hourly lives forever, until deactivation. There is no "sign out everywhere" and no audit row for login/logout. | Code review. | Add a daily `DELETE FROM "Session" WHERE "expiresAt" < now()` in the sweeper, a hard cap (e.g. 90 days from `createdAt`) in the validity check, and audit rows `auth.login` / `auth.logout` (member id, request id; no token). |
| M-6 | `src/modules/auth/routes.ts:80-88` | An invalid, expired or replayed OAuth state answers with a JSON `400` on a top-level browser navigation, so the user is left on a raw JSON page. Only the later failures redirect to `FRONTEND_URL/?authError=...`. Slow login (>10 min), a second tab, or a back-button replay hits this. | Reproduced (P5): callback without state cookie returns `400 application/json`. | Redirect with `authError=AUTH_STATE_INVALID` for every callback failure that comes from a browser; keep JSON only for programmatic clients. |

### Low

| ID | Location | Description | Recommended fix |
|---|---|---|---|
| L-1 | `backend/docker-compose.yml:12-13` | Publishes Postgres on all host interfaces with `clover/clover` and `fsync=off`. Anyone on the same network (café wifi) can log in to the dev DB. | Bind `127.0.0.1:${DB_PORT:-55432}:5432`. Keep a comment that this file is dev-only. |
| L-2 | `.github/workflows/backend-ci.yml` | No `permissions:` block (token gets repository defaults), actions pinned to tags (`@v4`), no dependency audit step. | `permissions: contents: read`; pin actions to commit SHAs (Dependabot to update); add `npm audit --omit=dev --audit-level=high` as a non-blocking job. |
| L-3 | `src/lib/devLogin.ts:4-30` | Guard is `NODE_ENV !== 'production'` plus a host allow-list that includes `db` and `host.docker.internal`. An operator shell on a production host without `NODE_ENV` set and a compose-style `db` hostname passes. Mitigation already present and verified: the printed cookie is `session=`, while a production server reads only `__Host-session`, so the token is useless against a production API instance. | Also refuse when `FRONTEND_URL` is https, or require an explicit `DEV_LOGIN_ENABLE=1`; drop `db` from the allow-list. |
| L-4 | `prisma/seed.ts:159` | `SEED_DEV_MEMBERS=1` creates an admin member with the fixed Discord id `900000000000000000` with no production guard. | Refuse `--dev` when `NODE_ENV=production`. |
| L-5 | `src/modules/auctions/routes.ts:315-345` vs `preferences.ts` | Existence oracle: as a member, `PUT /rounds/:id/preferences/me` on a DRAFT round returns 409 `ROUND_NOT_OPEN`, a nonexistent id returns 404, while `GET` correctly hides drafts (P4). Leaks that a draft exists. | Use the same `visible()` check (404 for drafts) in the write paths, or map DRAFT to 404 in `openWindow` for non-admins. |
| L-6 | `scripts/hash-bot-key.ts:14-20`, `src/lib/botKey.ts` | The stdin mode hashes any string, so a low-entropy key becomes an unsalted sha256 in the environment (offline-crackable if env leaks). | Reject keys shorter than 32 chars in stdin mode and print a warning; document "generate only". |
| L-7 | `src/modules/auctions/routes.ts:34` | `imageUrl` allows `http://` and URLs with credentials (`http://u:p@host`). Admin-supplied, but the frontend renders it for all members (tracking pixel, mixed content). | Require `https:`, reject userinfo, and have the frontend render with `referrerpolicy="no-referrer"`. |
| L-8 | `src/modules/auctions/preferences.ts:58-63`, `finalizer.ts:57-86` | Row-by-row INSERT/UPDATE/DELETE loops (up to 500 preference rows, snapshot rows, requeue statements) inside transactions with a 5 s timeout. Fine at 80 members (allocation measured at 84 ms) but a member can repeat 500-row submits at 600 req/min. | Use one `INSERT ... SELECT unnest($1::int[], generate_series(...))` for preferences and snapshot; add a lower per-member limit on the preference and queue routes. |
| L-8b | `src/modules/registrations/service.ts` | Every registration toggle writes an audit row and, for a placed member, triggers a backfill and Discord DM/channel message. One member can toggle 600/min: audit growth (P6: 100 toggles = 100 rows) and, with a colluding reserve, notification churn. | Per-member limit of e.g. 20/min on the registration PUT; skip the audit row for exact no-ops (already done) and consider debouncing LEAVE/JOINED flips. |
| L-9 | `src/modules/members/routes.ts:106-135` | Admin PATCH reads `before` without a lock then writes: two concurrent admin edits give an audit diff that does not match the final row. | `SELECT ... FOR UPDATE` on the member row inside the transaction. |
| L-10 | `src/modules/notifications/providers/bot.ts:60`, `src/modules/auth/discord.ts` | Outbound `fetch` follows redirects (a redirected POST would carry the HMAC headers) and reads unbounded response bodies. URL comes only from env, so this is hardening. | `redirect: 'error'` on the bot call; cap body size / use `res.text()` with a length check. |
| L-11 | `package.json` `start` script, `docs/deploy.md:49` | `npm start` runs `tsx`, a devDependency: `npm ci --omit=dev` breaks it, and tsx-in-production adds a compile step and larger surface. | Make `start` run `node dist/src/server.js`; keep `tsx` only for `dev`. |
| L-12 | `test/` | Test gaps for security behaviour: no test with `TRUST_PROXY=true` and a forged header (H-2), no deactivate-vs-finalize race test (M-3), no ETag test for draft edits (M-2), no test that a failing allocation leaves reads working (H-3), no test that session cleanup exists (M-5). | Add the listed tests; `test/security/warden-probes.test.ts` can seed them. |

### Info

| ID | Location | Note |
|---|---|---|
| I-1 | `npm audit --omit=dev` | 3 high advisories, one root cause: `deepmerge-ts < 8` (GHSA-ggr8-5vv4-36mx, stack exhaustion on recursive object graphs) via `@prisma/config` -> `prisma`. It sits in the Prisma CLI's config merge, not in any request path; the suggested `npm audit fix --force` would downgrade Prisma, so **do not apply it**. Re-check on the next Prisma 6.x release. Nothing else vulnerable in the runtime tree (nothing upgraded, per instructions). |
| I-2 | `src/modules/auctions/routes.ts:335-345` | Admins can read every member's preference list before the round closes (`/admin/auctions/rounds/:id/preferences`, and `audit-log` meta stores the `itemIds`). An admin who is also a bidder can see rivals' rankings and adjust their own list. Decide as policy: either admins abstain from queue rounds, or hide lists until close. |
| I-3 | `src/modules/auctions/liveClaim.ts` | Live-claim fairness is race-to-first: item ids and `opensAt` are visible during the start delay (up to 60 s), so a script polling the round can win every contested item at t0. Inherent to the design; a small server-side jitter or hiding item ids until `opensAt` narrows it. |
| I-4 | `src/modules/health/routes.ts` | `/healthz` is unauthenticated and unlimited, and pings the DB on every call. Fine behind a proxy; do not expose it publicly. |
| I-5 | `src/server.ts:30` | Binds `0.0.0.0`; deploy.md says "reachable only through the proxy". Consider `HOST` env defaulting to `127.0.0.1` in production. |
| I-6 | `src/modules/notifications/templates/index.ts` | `escapeDiscord` covers markdown and `@`; `#channel` and `:emoji:` in IGNs can still render. `allowedMentions.parse=[]` makes this cosmetic. |

## Verified sound

Auth and sessions
- OAuth state: 128-bit nonce, signed HttpOnly Secure Lax cookie scoped to `/api/v1/auth/discord`, 10 min TTL, timing-safe compare, single-use consumption, cleared on every callback. Scope is `identify` only; Discord tokens live in one function and are dropped; failures do not echo Discord bodies.
- Redirect targets are built from `FRONTEND_URL` plus fixed query keys, never from request data: no open redirect. `Host`/`X-Forwarded-Host` are not used anywhere.
- Session token is 256 bits (`randomBytes(32)`), only its sha256 is stored, a fresh token per login (no fixation), 30-day sliding expiry, cookie `__Host-` prefixed in production, `Secure; HttpOnly; SameSite=Lax`. Every request re-reads the member row, so deactivation and admin demotion apply on the next request, and deactivation also deletes sessions.
- CSRF: SameSite=Lax plus required `X-Requested-With` plus Origin equality for every cookie-bearing write; bot routes never read cookies and the session and CSRF plugins use the same `isBotPath`. Probed (P5): no header -> 403, foreign origin -> 403; `__proto__` bodies are rejected by the JSON parser; `text/plain` cannot reach a handler.
- Bot key: sha256 digests only in env, `timingSafeEqual`, all digests compared without early exit, length cap 256, two-key rotation, key and `X-Bot-Key` are redacted from logs (checked serializer, redact paths, and a log-capture test).

Authorization and injection
- Every route is in the authz matrix with a completeness test (route registered without an entry fails CI). Admin routes use `requireAdmin` in `onRequest`, before body validation. No IDOR found: registration writes for another member need admin (`FORBIDDEN_OTHER_MEMBER`); preferences and `results/me` are keyed by the session member, never by a path member id; the roster hides `discordId` and `isAdmin`; `notifyChannelId` is admin-only.
- Mass assignment: every body schema is `.strict()`; `isAdmin`, `source`, `discordId` cannot be written through any route (admin is script-only, by design).
- SQL: all `$queryRaw`/`$executeRaw` are tagged templates (parameterized). The only `$executeRawUnsafe` calls are constant strings (`SAVEPOINT import_row`) and test helpers. Hostile filter values (quotes, NUL, lone surrogates, 5 kB strings) never 500 (P8). Text sanitizers reject control characters and strip zero-width/bidi format characters before the uniqueness index.
- No ReDoS-prone regex (all anchored, bounded, linear). No SSRF: outbound URLs come from env only; the notification call is HMAC-signed with a 5-minute replay window and idempotency key.
- Errors: unknown failures return `INTERNAL_ERROR` with no detail; validation errors expose only path and message; `/docs/json` is 404 in production (P9); helmet is on; API responses are `no-store`.

Auctions, planner, registration
- Claim cap: 24 parallel claims by one member on a cap-3 round produced exactly 3 wins (P7); cap is checked under a per-member advisory lock after the round `FOR SHARE`. Winner is decided by a single conditional `UPDATE ... WHERE winnerId IS NULL`. Idempotent retry precedes the cap check. Late claims are impossible: window compared with `clock_timestamp()` after the lock wait, and close/finalize take `FOR UPDATE`.
- Type 2: eligibility uses a per-round cutoff id, so queue joins during the window do not count and leave/rejoin loses the place; allocation is a pure function over a persisted snapshot with a replay script and golden tests; preferences are visible only to their owner (and admins); results appear only at close; re-queue order is deterministic; leftovers become a DRAFT round.
- Lock order (Activity, Round, advisory, rows) is documented in one module and used consistently; waitlist promotion is one statement under the Activity lock; backfill only runs on a real withdrawal, respects `started`, and plan writes use optimistic `expectedVersion`.
- Notification outbox is written in the business transaction with a dedupe key; worker uses `SKIP LOCKED`, leases, backoff, and DEAD state with audit.
- Load result on file: 80 members, poll p95 43 ms, claim p95 63 ms, allocation 84 ms.

Repo, CI, ops
- No secrets in git (`.env` ignored; only `.env.example`); CI uses throwaway credentials and no repository secrets. Env validation refuses to boot without `connection_limit`, `pool_timeout`, and valid bot digests. dev-login is a script only, refuses `NODE_ENV=production`, and audits itself. Backups, restore, rotation and rollback are documented and were walked through.

## Code quality notes (none blocking)

- Nine `as never` casts on audit `meta` (`record` takes `Prisma.InputJsonValue`; callers pass `Record<string, unknown>`) plus four `as unknown as` (`routes.ts` 304 reply, `roundOut` in the round list). Widen `AuditInput.meta` to `Record<string, unknown>` and cast once inside `record`.
- Duplication: `dateStr` regex in `registrations/routes.ts` and `planner/routes.ts`; the `member`/`profile`/`memberOut` shapes; FK-violation-to-`INVALID_JOB` mapping in `bot/routes.ts` next to the generic mapping in `errorHandler.ts`; `bulkImport.ts` rebuilds the `Tx` type that `lib/tx.ts` already exports; the rounds list applies the status filter both in `where` and in `.filter`.
- Transaction boundaries: admin member PATCH is read-modify-write without a lock (L-9); lazy finalize opens one transaction per round inside a GET (H-3).
- Indexes: `AuditLog.actorId` (filterable in the API) has no index; `Session.expiresAt` needs one once purging exists. All hot query paths (registration, placement, queue, outbox, claims) are covered by unique or composite indexes.
- Observability: the error handler logs `err` objects; keep an eye on Prisma error text if statements ever include user data.

## Usability and workflow

- **Auction rounds have no admin correction path.** There is no way to release or reassign an awarded item (member left, wrong winner), extend an open window, or reopen a closed round; the only fix is SQL. Add `POST /admin/auctions/rounds/:id/items/:itemId/release` (audited) and `POST .../extend`. Wins of a deactivated member also stay attached; show them in the admin view so leftovers can be redistributed.
- **Leftover round defaults are hard-coded** (`300 s`, cap 5, delay 3 in `finalizer.ts`). Admins must PATCH before starting; inherit the source round's settings or show them in the response.
- **Early close of a type-2 round allocates immediately** with no confirmation contract; return the affected member/item counts or require `?confirm=true` so a mis-click cannot end a ranking window.
- **ETag staleness (M-2)** will look like "my edit did not save" for admins.
- **Login failure UX (M-6)**: raw JSON on state errors.
- **Error codes for the frontend**: statuses are mostly consistent, but three codes are worth aligning: `NOT_ELIGIBLE_FOR_CATEGORY` (409) and `INVALID_PREFERENCE_LIST` (422) both mean "your list is wrong" - return the offending item ids in `details`; `NOT_YOUR_CLAIM` (403) is really a conflict (409) - a 403 may trigger the frontend's "session expired" handling; `RATE_LIMITED` should carry `retryAfterSec` in `details` (only the header has it today).
- **Admin tasks**: no revoke-admin script/route (only `grant-admin`), no admin list; add `scripts/revoke-admin.ts` and show `isAdmin` in the admin member list (it is already returned). Bulk import is good (dry run included).
- **Reserves**: `reserveOrder` and `placed` in the registration range read make the reserve queue visible to everyone; the plan read gives admins the same. Consider returning `registeredAt` with `reserveOrder` in the range read so the UI can explain ties.
- **Operations**: single-instance design is documented and consistent (in-memory limits, OAuth single-use, bot guard). Missing: worker and sweeper liveness are not visible (`/healthz` says only "db ok"; a stuck worker or growing DEAD count is discoverable only through logs). Add counts (`pendingNotifications`, `deadNotifications`, `lastSweepAt`) to an admin-only health endpoint and alert on them. Expired-session and old-outbox purging (M-5) belong in the same sweeper. Graceful shutdown handles in-flight ticks; SIGTERM during allocation relies on the 5 s transaction timeout.

## Prioritized fix list

1. H-1 + H-2: bot guard verifies the key first; `trustProxy` by hop count; document the proxy header; add tests.
2. H-3: isolate `lazyFinalize` failures (log, keep serving reads).
3. M-1: move the rate limiter ahead of the session lookup (or add a pre-auth IP counter).
4. M-2: complete the polling fingerprint (name, cap, timing, item content).
5. M-3: category locks in deactivation; filter inactive members in the allocation snapshot.
6. M-5 + M-4: session purge, absolute session lifetime, login/logout audit; reject placeholder `SESSION_SECRET` in production.
7. M-6 and L-5: redirect state failures to the frontend; hide draft rounds on write paths.
8. Ops/CI hygiene: L-1, L-2, L-3, L-4, L-11, I-5 (compose binding, workflow permissions and pinned SHAs, dev-login/seed guards, `node dist` start, loopback bind).
9. Admin workflow gaps: item release/reassign, window extend, revoke-admin, admin health counts.
10. Quality clean-ups: audit `meta` typing, duplicate schemas, `FOR UPDATE` on member PATCH, batch inserts, missing tests (L-12).

## Cleanup and artifacts

- Throwaway container `warden-pg16-review` (host port 55977) was used and removed; `hourpool-postgres` was not touched.
- Added only `backend/test/security/warden-probes.test.ts` (prettier/eslint/tsc clean). It passes today and can be deleted, or promoted into real regression tests once the fixes land. Nothing was committed or pushed.
