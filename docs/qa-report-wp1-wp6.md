# QA Report: Clover_TH backend, work packages WP1 to WP6

Author: Sentinel (QA). Branch `feature/init-backend` (HEAD 79e2bcf, nothing committed by QA). Date: 2026-09-20.
Sources of truth: `docs/requirements.md` v5, `docs/backend-design.md` (section 15 acceptance tests, section 6.8 error codes), `docs/design-review.md`.
Scope: WP1 scaffold, WP2 schema/seed/migrations, WP3 auth/sessions/bot key/authz, WP4 audit/members/jobs/deactivation, WP5 notification outbox and worker, WP6 events/activities/occurrences/registration/waitlist. Planner, backfill, auctions and frontend are OUT OF SCOPE.

## 1. QA Verdict: CONDITIONAL PASS

No Critical or High defect. One MEDIUM defect (D-1, NUL/lone-surrogate input returns HTTP 500) and six LOW findings. Every WP1 to WP6 acceptance criterion and every in-scope FR/AC passed, including under real Postgres concurrency.

Definition of Done check (`.claude/agents/DEFINITION_OF_DONE.md`, items 1 to 12):

| Item | Status |
|---|---|
| Unit tests pass (Nova) | Met: 277/277 baseline, plus 87 QA probes (84 pass, 3 fail on D-1) |
| QA tests pass (Sentinel) | Met for in-scope criteria; D-1 open (MEDIUM) |
| No Critical bugs / no unresolved High bugs | Met (none found) |
| Regression test passes | Met (full existing suite green, `scripts/ci.sh` exit 0) |
| PO approval, AC defined, Atlas review, Forge design review | Not evidenced in this hand-off, assumed by the caller |
| Test Plan approved by user before code (Nova Phase 1) | Not evidenced in this hand-off |
| Forge Code Review approved | Not evidenced in this hand-off |

The verdict is CONDITIONAL because D-1 is unresolved and the last three rows could not be verified by QA. Warden (item 13) is not yet run.

## 2. Environment and evidence

- Throwaway `postgres:16` container `qa-sentinel-pg` on port 56433 (UTF8, C.UTF-8, max_connections 200). Removed after the run. `hourpool-postgres` untouched.
- Node v25.9.0. Vitest 4, per-file databases cloned from a migrated template, pool `connection_limit=25`.
- Baseline `npx vitest run`: 17 files, 277 tests, all pass.
- `bash scripts/ci.sh` (prisma validate, `migrate diff --exit-code`, raw-migration grep, generate, typecheck, eslint, prettier, openapi `--check`, tests): exit 0.
- Fresh DB: `prisma migrate deploy` from empty succeeded, second deploy "No pending migrations"; `db:seed` twice: 8 jobs (Job sequence at 8), 14 activities, 16 events, capacities castle-siege 40, guild-league main 60 and sub 90, mirror-world 40, polarity-zone 50, autoBackfill true only for polarity-zone, no registration capacity anywhere, UTF8.
- Real HTTP smoke test of `tsx src/server.ts` (production mode, provider `fake`): `/healthz` 200 with helmet headers, bot route 401 without key / 201 with key, malformed JSON 400, 3 MB body 413, OAuth login 302 with signed `Secure; HttpOnly; SameSite=Lax` state cookie, server log contained neither the bot key nor the IGN.
- Scripts: `hash-bot-key` (generate, stdin, empty stdin exit 1), `grant-admin` (unknown member exit 1, grant, repeat is idempotent), `bulk-import-members` (dry run, real run, per-row failures INVALID_JOB / DUPLICATE_IGN / bad payload, exit 1 on any failure).
- QA probes added (not committed): `backend/test/qa/qa-auth-authz.test.ts`, `qa-members-jobs.test.ts`, `qa-registration.test.ts`, `qa-notifications.test.ts`, `qa-openapi.test.ts`. They carry `eslint-disable` and `ts-nocheck` headers so `npm run lint`/`typecheck`/`format` stay green. Full suite with QA files: 22 files, 364 tests, 361 pass, 3 fail (all D-1). The registration, notification and concurrency probes were run 4 times in a row with no flake.

## 3. Traceability matrix

Result key: PASS / FAIL / BLOCKED / OUT OF SCOPE. "T:" = existing Nova test, "Q:" = Sentinel probe (file in `backend/test/qa/`). Nothing is NOT TESTED or BLOCKED.

### 3.1 Identity, login, bot (FR-1.x, AC-1, AC-2)

| # | Requirement / criterion | Test case(s) | Result |
|---|---|---|---|
| 1 | FR-1.1 / AC-1 login is Discord OAuth only; registered member gets a session and profile (memberId, discordId, ign, nickname, job, isAdmin) | T: login.test "registered member: callback sets a cookie ... /me returns the profile". Note: delivered as cookie + redirect + `GET /me` (design deviation 12, PO confirmation still pending) | PASS (with note) |
| 2 | FR-1.2 / AC-1 unregistered Discord user rejected, distinct code, no session | T: "unregistered Discord user gets AUTH_NOT_REGISTERED ... no session row"; Q: AC-2 end to end (invalid job then login is AUTH_NOT_REGISTERED) | PASS |
| 3 | Inactive member cannot log in (AUTH_MEMBER_INACTIVE) | T: login.test, deactivate.test | PASS |
| 4 | OAuth state: missing, tampered, reused, expired rejected; PKCE dropped, state kept | T: login.test "reused OAuth state", "missing cookie, tampered cookie and mismatched state" | PASS |
| 5 | OAuth code, state, client secret, session token never logged | T: login.test log test; real-server log grep | PASS |
| 6 | Callback rate limited per IP (design: 30/min) | T: "callback rate limit" | PASS (see L-5 deployment note) |
| 7 | Session cookie `HttpOnly; Secure; SameSite=Lax`, `__Host-` in production, only sha256 stored | T: "stores only a hash of the session token"; real server cookie flags | PASS |
| 8 | Logout kills only that session, cookie not replayable | Q: "logout kills only that session" | PASS |
| 9 | FR-1.3/1.4 bot endpoint own auth via `X-Bot-Key`; missing/wrong key gives 401 and changes nothing | T: bot.test; Q: empty, blank, padded, upper-cased, truncated, 257 B, 100 kB, digest-as-key, duplicated header: all 401 BOT_KEY_INVALID, zero member/audit rows | PASS |
| 10 | FR-1.4 key never logged | T: bot.test; Q: trace-level logs across 201/200/409/422/401/deactivate/empty body contain neither key, digest nor IGN; real-server grep 0 hits; key not echoed in body or headers | PASS |
| 11 | FR-1.4 rotatable: two digests both work, removed one stops at once, three refused, non-hex refused, upper-case digest normalized | T: "bot key rotation"; Q: rotation test, uppercase digest test | PASS |
| 12 | Bot routes reject cookies, member routes reject bot key, bot routes exempt from CSRF headers | Q: admin cookie on bot PUT gives 401 and no row; bot key on /me, /members, /admin/* gives AUTH_REQUIRED; valid key plus garbage cookie works without CSRF headers | PASS |
| 13 | FR-1.5 idempotent upsert by Discord id, no duplicate, no audit on no-op | T: "creates (201), repeats (200)", "10 concurrent identical upserts create exactly one member" | PASS |
| 14 | AC-2 / FR-1.11 invalid or omitted job rejected (INVALID_JOB / VALIDATION_ERROR), no member, cannot log in | T: bot.test; Q: omitted, unknown label, unknown id, then login attempt | PASS |
| 15 | FR-1.6 admin flag server-computed; `isAdmin` (and any unknown field) rejected on every write route; no API grants admin | T: "a body containing isAdmin"; Q: PATCH member, PATCH activity, PUT registration, PUT jobs (entry and root), bot PUT all 422 VALIDATION_ERROR, zero admins created; OpenAPI bodies `additionalProperties:false` and no `isAdmin`; no grant route exists | PASS |
| 16 | FR-1.7 members keyed by immutable uuid; names never keys | Schema review; T: constraints.test FK matrix | PASS |
| 17 | FR-1.9 incomplete = no nickname (or MANUAL); admin filling nickname clears it | T: members.test | PASS |
| 18 | FR-1.10 IGN unique case-insensitively (see 3.3 for variants) | T + Q (below) | PASS |
| 19 | FR-1.8 deactivate: cannot log in, removed from queues, future registrations; past kept | see 3.4 | PASS |
| 20 | FR-1.8 removal from future team placements | Q: placement row deleted and planVersion bumped on deactivation | PASS |
| 21 | FR-1.8 / FR-5.12 backfill of the vacated slot (reason DEACTIVATED) | Not built (WP7b hook present as a marked comment only) | OUT OF SCOPE |

### 3.2 Authorization and CSRF (FR-1.6, AC-14 permission part, design WP3)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 22 | Every admin route: anonymous gives 401 AUTH_REQUIRED, member gives 403 ADMIN_REQUIRED, admin passes | T: authz matrix completeness; Q: all 9 admin routes for anonymous, bot-key-only, member (with a garbage body, guard runs before validation so schema is not leaked), and admin | PASS |
| 23 | Every member route rejects anonymous and accepts a plain member | Q: all member routes | PASS |
| 24 | Admin demotion, promotion and deactivation take effect on the very next request (no cache) | T: session.test; Q: deactivated admin cookie gives 401 | PASS |
| 25 | CSRF: every cookie-authenticated write needs `X-Requested-With` and a matching Origin | T: session.test; Q: all 8+ write routes x 7 variants (no header, empty, blank, foreign origin, prefix-spoof origin `http://localhost:5173.evil.example`, `null`, other port) all 403 CSRF_REJECTED | PASS |
| 26 | CSRF cannot be dodged by disguising a route as a bot route | Q: `/api/v1/bot/../admin/...`, `%2e%2e`, `//api/...`, query and fragment tricks give 403/404/401 and the member stays active | PASS |
| 27 | GET routes never change state | Q: all GET routes with a cookie and no CSRF header: no audit rows, no occurrences | PASS |
| 28 | Session lifecycle: no session write per request, hourly refresh, expired and garbage cookies rejected | T: session.test | PASS |

### 3.3 Members, jobs, IGN, audit (WP4, AC-14, FR-1.10)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 29 | IGN uniqueness variants collide with 409 DUPLICATE_IGN: case, identical Thai, NFC vs NFD Latin, NFD plus case, Thai combining-mark reordering, surrounding whitespace, roster names `เสีEวค่ะXลวงMา` and `-nara-` | T: constraints.test; Q: 8 variant pairs via bot, plus admin PATCH | PASS |
| 30 | IGN reuse after deactivation: free for others; the returning member gets DUPLICATE_IGN on bot re-register and on admin reactivation, state unchanged; free again once the squatter leaves | T: bot.test, members.test; Q: full sequence | PASS |
| 31 | IGN uniqueness under concurrency: 10 racing bot registrations (case variants) give one 201 and nine 409, never 500; two admin renames racing to the same name give 200 and 409 | Q | PASS |
| 32 | IGN length: 64 Thai code points accepted, 65 rejected 422 | Q | PASS |
| 33 | Job in-use delete blocked (active or deactivated user), whole PUT rolls back (no rename/create/audit) | T: jobs.test; Q: mixed rename+create+delete-in-use leaves table and audit untouched | PASS |
| 34 | Atomic `PUT /admin/jobs` under concurrency: two racing full replaces creating the same label give one 200 and one 409, no `~tmp~` labels left, no partial rename | Q | PASS (generic CONFLICT code, see L-3) |
| 35 | A job cannot vanish under a concurrent member registration using it (FK) | Q: delete job 8 racing 10 bot upserts with jobId 8: no 5xx, no orphan member | PASS |
| 36 | Empty job list with members refused, bad colour, 101 entries, duplicate id, duplicate label | T + Q | PASS |
| 37 | Audit: every admin write produces an audit row with actor and time; non-admin cannot read; cursor paging and filters | T: members.test, deactivate.test | PASS |
| 38 | Audit only on create/change for bot upserts, before/after recorded | T: bot.test, "WP4 bot audit before/after" | PASS |
| 39 | Roster hides discordId/isAdmin from non-admins; deactivated members excluded | T: members.test; Q | PASS |
| 40 | Free-text inputs containing NUL (U+0000) or a lone surrogate | Q: bot ign and nickname, admin PATCH ign and nickname, registration path param `eventId`, `PATCH /admin/activities/:id`, audit-log `actor` and `action`, notifications `eventType` | **FAIL (D-1)** |

### 3.4 Deactivation side effects (FR-1.8, WP4)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 41 | Sessions (two devices) die immediately; other members unaffected; reactivation does not resurrect them | Q | PASS |
| 42 | Future registrations (JOINED, WAITLISTED, LEAVE) and placements removed across several activities; already-started and past occurrences kept; queue entries removed | T + Q (5 occurrences, 3 activities) | PASS |
| 43 | Waitlist promoted exactly once per affected occurrence, in `registeredAt` order, audited; 3 admin + 1 bot deactivation fired concurrently give one `member.deactivate` audit row and 2 promotions | Q | PASS |
| 44 | Deactivated member cannot be registered by an admin (422 MEMBER_INACTIVE); reactivation restores nothing | Q | PASS |
| 45 | Registration PUTs racing a deactivation never leave a future registration | Q: 15 PUTs + deactivate | PASS |
| 46 | Lock order: deactivation (all activities), PATCH capacity and registrations across 4 activities, 12 members: no deadlock, no 5xx/409 | Q | PASS |
| 47 | Bot deactivate idempotent | T | PASS |

### 3.5 Registration, capacity, waitlist (FR-4.x, AC-6, AC-9)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 48 | FR-4.3 member changes only own status; admin any; other gets FORBIDDEN_OTHER_MEMBER, nothing written | T | PASS |
| 49 | FR-4.2 / 4.8 state machine: every transition from NONE, JOINED, WAITLISTED, LEAVE for JOINED/LEAVE/NONE; repeats are no-ops (same row, same `registeredAt`, no audit) | Q: sequential walk of all transitions plus response envelope (`promoted`, `backfilled`, `planVersion` stable) | PASS |
| 50 | FR-4.4 capacity null by default on all 14 activities, no waitlist; Polarity Zone accepts more than 50 | Q, T | PASS |
| 51 | FR-4.5 capacity 2, third registrant WAITLISTED with position; unregister promotes oldest waitlisted exactly once | T | PASS |
| 52 | FR-4.5 single promotion under concurrency: 10 concurrent unregisters; 40 members leaving with duplicates (2 requests each) promote exactly 20, in order, joined stays at capacity; 60 concurrent registrations with capacity 20 give exactly 20/40 with distinct positions 1..40 | T + Q | PASS |
| 53 | Chaos: 300 random JOINED/LEAVE/NONE by 30 members plus concurrent capacity PATCHes; no 5xx, one row per member, waitlist non-empty only when cap reached, waitlist positions contiguous | Q | PASS |
| 54 | Same member firing JOINED/LEAVE/NONE concurrently (60 requests) ends consistent, no error | Q | PASS |
| 55 | FR-4.6 leave to joined resets `registeredAt`, member goes to the back of the waitlist and the promotion order; tie-break by id | T + Q | PASS |
| 56 | AC-9 Polarity Zone: 56 registrants, 50 placed, unplaced listed as reserves in registration order; R2 toggling leave to joined moves to the back | Q (placements inserted directly, no planner API yet) | PASS |
| 57 | Capacity change semantics: raise promotes across all future occurrences in order; lower below joined never demotes and blocks promotion until below cap; null removes cap and promotes all; per-occurrence and per-event independence | T + Q | PASS |
| 58 | Activity lock (B1): capacity/backfill PATCH and registration serialize, including for occurrences that do not exist yet | T | PASS |
| 59 | FR-4.7 after start: members blocked (JOINED, LEAVE, NONE all 409 REGISTRATION_CLOSED, nothing written), admins allowed; boundary flips exactly at `startsAt` (occurrence 1.5 s ahead: allowed, then 409 after 1.7 s) | T + Q | PASS |
| 60 | Deviation 3: system promotion keeps `registeredAt` | T (design deviation, PO acknowledgement still pending) | PASS (with note) |
| 61 | Pool pressure (B3): 150 concurrent registration writes on a 25-connection pool across 3 activities: all 200, no P2028/SERVICE_BUSY (257 ms) | Q | PASS |
| 62 | PATCH activity validation: non-admin, empty body, unknown field, bad channel id, `autoBackfill` without a planner (AUTO_BACKFILL_REQUIRES_PLANNER), audit before/after, no-op change writes nothing | T | PASS |
| 63 | FR-5.11 auto-backfill flag is per activity: ON only for Polarity Zone by default, editable | T: seed test | PASS (setting only; behaviour OUT OF SCOPE, row 92) |

### 3.6 Time and week boundaries (FR-4.x, AC-15, business rule 4)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 64 | Occurrence `startsAt` equals Bangkok wall time for all 16 events (UTC = Bangkok minus 7 h), correct calendar date, weekday map 0=Mon..6=Sun | Q: all 16 events, weekday +/-1 dates rejected with INVALID_OCCURRENCE_DATE | PASS |
| 65 | Sunday night / Monday morning: the +/-56 day window flips exactly at 00:00 Bangkok (16:59:59Z vs 17:00:00Z), not at UTC midnight (both directions) | Q: faked clock; T: time.test | PASS |
| 66 | Monday-first week grouping: Mon..Sun `GET /registrations` puts Sunday 21:00 Castle Siege on that Sunday and next Tuesday in the next week | Q | PASS |
| 67 | Wrong-weekday, impossible (2026-02-30), malformed (`2026-9-1`), out-of-window, unknown event | T + Q | PASS |
| 68 | 14-day range cap, `from <= to` | T | PASS |
| 69 | GET endpoints never create occurrences; failed writes (wrong weekday, forbidden, closed, inactive, impossible date) leave no occurrence row | T + Q | PASS |
| 70 | AC-15 planner week boundaries | Planner not built | OUT OF SCOPE |

### 3.7 Notifications (FR-6.x, AC-12, WP5)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 71 | Enqueue in the same transaction: rollback leaves no row (also proven with a business write in the same tx); forced failure rolls back the business tx (no swallow) | T + Q | PASS |
| 72 | Dedupe: 20 concurrent identical enqueues insert exactly 1 DM + 1 channel row; new planVersion is a new row | Q | PASS |
| 73 | FR-6.2 no channel row when no channel id is configured | T | PASS |
| 74 | Provider `off`: no rows, no provider/worker created; `bot` requires URL and secret | T + Q | PASS |
| 75 | Retry ladder with jitter 0: 30, 60, 120, 240, 480, 900, 900 s, DEAD at attempt 8, exactly one `notification.dead` audit row, DEAD never re-claimed, admin retry gives a fresh budget and delivers | Q | PASS |
| 76 | 429 honors `Retry-After`; permanent codes (DM_CLOSED) go DEAD at once while the channel row still delivers | T + Q | PASS |
| 77 | Lease reclaim: stale SENDING reset and re-sent; fresh lease untouched; last-attempt stale row is DEAD with audit | T + Q | PASS |
| 78 | 5 concurrent workers over 40 rows: each row sent exactly once (attempts = 1), 40 distinct idempotency keys | Q | PASS |
| 79 | Provider outage (bot down / hung): rows stay PENDING with NETWORK_ERROR / TIMEOUT, secret never stored | Q | PASS |
| 80 | HMAC: body altered after signing rejected by the fake bot; timestamp older than 5 min rejected; wrong secret gives DEAD | T | PASS |
| 81 | Mention safety: 13 hostile IGNs/team/room/activity names (`@everyone`, `@here`, `<@&role>`, `<@!id>`, `<#chan>`, markdown, spoiler, link, `<t:>`, RTL) yield `allowedMentions = {parse:[], users:[promoted only]}` and no raw mention/markdown syntax | T + Q | PASS |
| 82 | FR-6.3 Thai text with activity, Bangkok date/time, room/team/slot, promoted member | T + Q | PASS |
| 83 | Admin routes: list with counts/filters, retry (PENDING ok, SENDING/SENT 409 NOTIFICATION_NOT_RETRYABLE, garbage id 422, concurrent retries safe), non-admin 403 | T + Q | PASS |
| 84 | Worker logs carry ids and status only | Q | PASS |
| 85 | FR-6.1 / AC-12 notification emitted on reserve promotion; failing Discord does not roll back the promotion (end to end) | Producer and worker proven; trigger is the backfill in WP7b | OUT OF SCOPE (mechanics PASS, rows 71 to 84) |

### 3.8 Platform: scaffold, schema, OpenAPI, errors (WP1, WP2, NFR)

| # | Requirement | Test case(s) | Result |
|---|---|---|---|
| 86 | WP1: healthz with DB, unknown route JSON error, `AppError` shape, Zod gives VALIDATION_ERROR 422, env validation fails fast with clear message, `tx()` maxWait/timeout and P2028 to SERVICE_BUSY, P2034 retried once | T: app.test | PASS |
| 87 | WP2: migrate deploy from empty and repeat, seed twice, 9th job after seed, capacities 60/90/50/40/40, backfill only Polarity, UTF8 and `normalize()` | T + manual fresh-DB run | PASS |
| 88 | WP2 constraints: one OPEN round per type, winner needs wonAt, backfill needs planner, job in use, one placement per member per occurrence, one member per slot, FK blocks hard delete, room key re-creatable after archive, WinCap rule | T: constraints.test | PASS |
| 89 | OpenAPI: the 22 real route+method pairs equal the documented set (no extras, no missing), all design 6.1 to 6.4/6.7 WP1-6 routes exist, no member create/delete or admin-grant route, committed `openapi.json` and `schema.d.ts` current | T: openapi.test; Q; `ci.sh` `--check` | PASS (see L-4) |
| 90 | Error shape consistency: 19 failure classes (401, 403, 404, 422, malformed JSON, wrong content type, 413, bot 401/422, CSRF, OAuth, unknown event/activity ...) all return `{error:{code,message,details}}` plus `x-request-id`; code format `[A-Z_]+` | Q | PASS (see L-2) |
| 91 | Oversized/malformed bodies: 413 and 400 with the standard shape; unknown fields 422; strict bodies | T + Q | PASS |

### 3.9 Out of scope in this run

| # | Requirement | Result |
|---|---|---|
| 92 | FR-5.x planner (layout, placement, copy, reserves API, FR-5.11 to 5.20 backfill behaviour, undo), AC-7, AC-8, AC-10, AC-11, AC-13 | OUT OF SCOPE (WP7a/WP7b) |
| 93 | FR-2.x, FR-3.x, AC-3, AC-4, AC-5 auctions | OUT OF SCOPE (WP8/WP9) |
| 94 | AC-14 admin capabilities for auctions, layout | OUT OF SCOPE; members, deactivate, incomplete list, capacity, backfill flag, jobs and audit log verified above |
| 95 | Frontend change list, login UI states | OUT OF SCOPE (WP11 to WP15) |

Acceptance criteria roll-up:

| AC | Status |
|---|---|
| AC-1 | PASS (note: cookie + redirect + `/me`, deviation 12) |
| AC-2 | PASS |
| AC-3, AC-4, AC-5 | OUT OF SCOPE |
| AC-6 | PASS |
| AC-7, AC-8, AC-10, AC-11, AC-13 | OUT OF SCOPE |
| AC-9 | PASS |
| AC-12 | Mechanics PASS; trigger OUT OF SCOPE |
| AC-14 | Partially in scope: PASS for what exists |
| AC-15 | PASS for registration/occurrence/week logic; planner part OUT OF SCOPE |

Totals (95 matrix rows): PASS 87 (3 with notes: rows 1, 6, 60), FAIL 1 (row 40, D-1), BLOCKED 0, NOT TESTED 0, OUT OF SCOPE 7 (rows 21, 70, 85, 92, 93, 94, 95).

## 4. Defects

### D-1 (MEDIUM): NUL (U+0000) or lone surrogate in any free-text input returns 500 INTERNAL_ERROR

- Requirement: WP1/WP3 input validation ("malformed input is a VALIDATION_ERROR 422", error contract 6.8); design review "Map Prisma errors to stable codes". A client must never be able to trigger a 500 with a request body.
- Expected: 422 VALIDATION_ERROR (or a 404/409 with a stable code) and nothing written.
- Actual: 500 `INTERNAL_ERROR`; nothing is written, and the generic message leaks no internals.
- Affected inputs (all confirmed): bot `PUT /bot/members/:discordId` `ign` and `nickname`; `PATCH /admin/members/:id` `ign` and `nickname`; path param `eventId` on `PUT /events/:eventId/occurrences/:date/registrations/me` (reachable by any signed-in member); `PATCH /admin/activities/:id`; audit-log `actor` and `action` filters; notifications `eventType` filter. A lone surrogate (`\ud800`) in IGN also gives 500. (Side observation: a NUL in a job label via `PUT /admin/jobs` returns 409 CONFLICT, also wrong.)
- Steps to reproduce:
  1. `curl -X PUT localhost:3000/api/v1/bot/members/700001 -H 'x-bot-key: <key>' -H 'content-type: application/json' -d '{"ign":"a b","job":"Knight"}'` gives 500.
  2. As any signed-in member: `PUT /api/v1/events/a%00b/occurrences/2026-09-22/registrations/me` with `{"status":"JOINED"}` gives 500.
  3. As admin: `GET /api/v1/admin/audit-log?actor=a%00b` gives 500.
- Severity: MEDIUM. Impact: error-log/alert noise, a bad bot payload looks like a server outage and may be retried forever, the contract "4xx for bad input" is broken. No data loss or disclosure.
- Suspected cause: PostgreSQL text cannot hold ` `, and the Zod schemas only check length/regex (`name()` trims and NFC-normalizes but does not reject control characters); the driver error surfaces as an unhandled Prisma error (`P2010`/22021) that the error handler maps to 500. Lone surrogates fail UTF-8 encoding the same way.
- Recommendation: reject ` ` and unpaired surrogates in the shared `name()` helper and in every `z.string()` that reaches SQL (params and querystrings), for example a refine on `/^[^ ]*$/` and `String.prototype.isWellFormed()`; optionally map Prisma 22021/22P05 to VALIDATION_ERROR in `errorHandler`. QA tests that will turn green: `qa-auth-authz.test.ts` (2 tests) and `qa-members-jobs.test.ts` (1 test).

### LOW findings (do not block)

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| L-1 | IGN can be made of invisible/format characters (`U+202E` alone was accepted with 201); zero-width characters inside a name defeat the uniqueness check visually (`Al​pha` differs from `Alpha`); internal double spaces are not collapsed | Q: "nasty IGN" run, "Solo  two" accepted | Reject IGNs with no visible character; consider stripping `Cf`/zero-width characters and collapsing whitespace. Product decision, not a requirement gap |
| L-2 | Error codes returned but not in design 6.8: `BAD_REQUEST` (malformed JSON 400, oversized 413, unsupported media type), `CSRF_REJECTED`, `CONFLICT`, `REFERENCE_CONFLICT`, `INTERNAL_ERROR`, `DB_UNAVAILABLE`, and 413 has no dedicated code | Q: error-shape run | Add them to the 6.8 table so the frontend map is complete; consider `PAYLOAD_TOO_LARGE` |
| L-3 | Concurrent duplicate job label (race) surfaces as generic 409 `CONFLICT`, not `DUPLICATE_JOB_LABEL`; job labels are case-sensitive (`knight` next to `Knight` accepted) while the bot's job lookup is exact-match | Q: concurrent PUT /admin/jobs; case-variant test | Map the unique violation to DUPLICATE_JOB_LABEL; decide whether labels are case-insensitive |
| L-4 | OpenAPI documents only the 200/201 responses; error responses and the `{error}` envelope, security (cookie vs bot key) are not described, so generated frontend types cannot type errors | Q: "OPENAPI responses documented" (`200` only) | Add a shared error schema and security schemes |
| L-5 | Deployment: `TRUST_PROXY` defaults to false. Behind a reverse proxy every user shares one IP, so the 30/min login limit becomes global (the 31st login in a minute gets 429). `/docs/json` is public | Code review of `app.ts`, `auth/routes.ts`; Q sign-in stress tripped the limit | Set `TRUST_PROXY=true` in production docs; decide whether `/docs/json` should be behind auth |
| L-6 | `bulk-import-members --dry-run` reports "created" for a row that a real run rejects with DUPLICATE_IGN (duplicate IGN inside the same file), so a dry run under-reports failures. Bot deactivate of an unknown Discord id returns 404 (a leave event for a never-registered user may be retried by the bot) | Manual run of the script with 5 rows; bot.test | Make dry run one transaction that is rolled back at the end; consider 200/204 for unknown ids on deactivate |

## 5. Design-review watch-outs checked

| Watch-out | Result |
|---|---|
| B1 Activity row is the lock, lazily created occurrences covered | PASS (T + Q: capacity/backfill PATCH, registration, deactivation, chaos run, no deadlock) |
| B3 pool settings, P2028 to 503 | PASS (150 concurrent writes on 25 connections, no SERVICE_BUSY) |
| S3 no session cache, no `lastSeen` write per request | PASS |
| S4 bot keys as env digests with `timingSafeEqual` | PASS |
| S7 no swallowed enqueue failure | PASS |
| S11 derived `isIncomplete` | PASS |
| Reads never create occurrences (item 16) | PASS |
| Reactivation checks IGN (item 6) | PASS |
| Job sequence reset after seed (item 5) | PASS |
| Redact `x-bot-key`, cookies, OAuth code in Pino | PASS (trace-level and real-server logs) |
| Bot routes exempt from CSRF and reject cookies; member routes reject bot key | PASS |
| `updatedAt` set in raw SQL | PASS (worker and deactivation statements set it) |
| Auth error redirect uses `?authError=` query string | PASS |

## 6. Missing coverage / risks not closed

- Backfill on withdrawal and deactivation, planner reads/writes, notification trigger wiring: not built, so the end-to-end AC-10/12/13 chain is untested. Re-verify when WP7a/WP7b land, in particular the rule "trigger only when previous status was JOINED and a placement exists" and the deactivation hook at the marked comment in `members/deactivate.ts`.
- Real Discord OAuth and a real bot were not used (mock Discord and fake bot receiver only).
- No performance/load test beyond 150 concurrent writes (type-1 auction load belongs to WP8).
- Definition-of-Done rows for approved test plan and Forge code review could not be verified by QA.

## 7. Files

- Report: `/Users/sunny_chong/Documents/Repositories/Cover_TH/docs/qa-report-wp1-wp6.md`
- QA probes (uncommitted): `/Users/sunny_chong/Documents/Repositories/Cover_TH/backend/test/qa/` (`qa-auth-authz.test.ts`, `qa-members-jobs.test.ts`, `qa-registration.test.ts`, `qa-notifications.test.ts`, `qa-openapi.test.ts`)
