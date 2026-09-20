# Clover_TH Backend: Design Review (Forge, Mode A)

Reviewed: `docs/backend-design.md` (Atlas, "FINAL") against `docs/requirements.md` v5 and the existing frontend (`App.tsx`, `data/guild.ts`, `TeamPlanner.tsx`, `WeeklySchedule.tsx`, `README.md`).
Scale assumed: one guild, ~76 members, ~80 concurrent users during an auction, one API instance.

## 1. Verdict: APPROVE WITH CHANGES

The design is buildable, fits the frontend, and covers almost every FR/AC. The core ideas are sound: conditional single-row UPDATE for the type-1 race, pure allocation function, transactional outbox, DB-backed sessions, data-driven layout, `Activity`/`ScheduleEvent` split.

The concurrency story has real holes that must be closed before WP6 to WP9 start (section 2). The rest is over-built for one guild and can be trimmed (section 4). Four items need a short design addendum (not a redesign). Estimated total effort is unchanged or lower after the trims.

| Dimension | Rating |
|---|---|
| Feasibility | Yes, all of it |
| Complexity as written | HIGH (MEDIUM after section 4 trims) |
| Implementation impact | Backend: MAJOR (greenfield). Frontend: MAJOR (auction, planner, auth rewrite; schedule and admin LARGE) |
| Maintainability | Good, modular, pure allocation, tests on real Postgres |
| Performance | Fine for 80 users; two hot spots to fix (section 2 item 3, section 3 item 9) |
| Security | Sound. Session and CSRF are slightly over-layered but correct |
| Deployment / ops | LOW (one container plus Postgres) |
| Risk | MEDIUM, concentrated in locking (7.3, 7.4, 7.5, 7.2 finalize) |

## 2. Blocking issues (fix in the design before coding)

### B1. The locking domain is incomplete: lazily created occurrences and settings/layout changes are not covered (7.3, 7.4, 7.5, 3.3)

- 7.5 says layout PUT "runs under locks for every not-yet-started occurrence". 3.3 says occurrences are created lazily. A row that does not exist cannot be locked, and an occurrence being created by an uncommitted placement/registration tx is invisible to the layout tx.
- Race: admin A places a member into team T slot 5 (creates and locks the occurrence, uncommitted). Admin B shrinks T to size 4 or removes T. B sees no occurrence, commits. A commits a placement into a removed or oversized team. `LAYOUT_BELOW_PLACED` is bypassed.
- Same class of race for `registrationCapacity` and `autoBackfill` changes (7.3 lists "capacity change" as an occurrence-lock writer, but it spans many occurrences, some not yet existing) versus a concurrent registration or withdrawal. A withdrawal could read `autoBackfill = false` just before it is switched on.
- Deactivation (7.6) locking "each affected occurrence in ascending id order" and layout/capacity doing the same is a multi-lock protocol whose deadlock-freedom is asserted, not shown, because ids of lazily created rows arrive in arbitrary order.

**Fix.** Make the `Activity` row the lock, not the `Occurrence` row. Every writer that touches registrations, placements, layout, capacity or backfill does `SELECT ... FROM "Activity" WHERE id=$a FOR UPDATE` first (activity id is known from the event). Settings, layout and capacity PATCH/PUT use the same lock. At this scale (one guild, txs of a few ms, 76 people) per-activity serialization costs nothing measurable and removes the lazy-row problem, the ascending-id protocol, and the settings races. Deactivation locks the affected activities in ascending `id` (string) order (at most 5 planner activities plus registration-only ones, or simply all 14 in one ordered `FOR UPDATE` query). Keep `Occurrence` as a data row only (`planVersion`, `startsAt`). The lazy get-or-create must be raw `INSERT ... ON CONFLICT (eventId, date) DO NOTHING` then `SELECT`, not Prisma `upsert` (see G3).
If Atlas prefers to keep the occurrence lock, then the required order is Activity `FOR SHARE` (settings and layout take `FOR UPDATE`) then Occurrence `FOR UPDATE` ascending id, and this must be written into 7.3 and 7.5.

### B2. Type-2 preference submit can race with finalize and silently lose a submission (7.2)

- Submit checks `now <= closesAt` (or status OPEN) without any lock shared with finalize. A submit that passes the check at 4:59.99 can commit after finalize has read `Preference` rows (Read Committed). The member got a 200 but the allocation ignored it. It also breaks the "replayable from stored inputs" claim, because the stored inputs are missing a list the member was told was accepted.
- The same window exists for early admin close (type 2) and, more mildly, for type-1 claim vs admin early close (the claim reads the round with a plain SELECT, so a claim can commit just after `close` returned).

**Fix.** Submit (and release, and claim) do `SELECT ... FROM "AuctionRound" WHERE id=$r FOR SHARE` first, then check `status='OPEN' AND clock_timestamp() <= closesAt`, then write. `finalizeRound` and admin `close` take `FOR UPDATE` (already specified for finalize), so they wait for in-flight submits and later submits see `CLOSED`. 80 concurrent `FOR SHARE` on one row is fine on Postgres. Keep lock order: round row, then category advisory locks (sorted), then item/queue rows. Add a test that interleaves submit and finalize.

### B3. Prisma interactive transactions will not sustain "80 concurrent claims" as configured (7.1, WP8 acceptance)

- Every claim is an interactive `$transaction` (advisory lock, round read, count, update, audit insert, commit: about 6 round trips) holding a pooled connection. Prisma's default pool is `num_cpus*2+1` connections (often 5 to 17), default interactive `maxWait` is 2 s and `timeout` 5 s. With 80 simultaneous claims the excess will fail with P2028 ("Unable to start a transaction in the given time"), and AC-3 / the WP8 test will flake or fail.

**Fix.** Add to the design: explicit `connection_limit` (about 20 to 25, below Postgres `max_connections`), `pool_timeout`, and `$transaction(fn, {maxWait: 10000, timeout: 5000})`; map P2028 to a retryable 503. Prefer implementing the claim (and release, and queue join) as a single `$queryRaw` statement or a small plpgsql function (advisory lock, checks, conditional UPDATE, audit insert in one round trip) if the interactive version does not meet p95 < 200 ms in the WP8 load test. Decide this in WP8 by measurement, but the pool settings must be part of WP1/WP2 env config.

### B4. The work-package graph has dependency and sizing errors (section 15, section 14)

1. **WP11 depends on WP6.** WP11 loads `/events` and `/activities`, which are built in WP6, but lists dependencies WP3 and WP4 only. Fix: WP11 depends on WP6, or WP11 keeps the static `scheduleEvents` until WP12.
2. **OpenAPI/types come too late.** WP10 exports OpenAPI and generates `openapi-typescript`, but WP11 to WP15 consume the API from WP3 onward. Fix: wire `@fastify/swagger` plus the Zod type provider in WP1, generate types in every backend WP, and drop "OpenAPI export" from WP10 (keep a "generated spec matches routes" check).
3. **WP7 is too big to be one package** (layout, plan CRUD, versioning, copy, undo, backfill, deactivation hook, notification enqueue) and its acceptance list is about 20 tests. Split: **WP7a** layout, plan read, placement write, version check, clear, copy. **WP7b** backfill, undo, deactivation hook, enqueue. WP7a depends on WP6 only. WP7b depends on WP7a and WP5. WP13 can start after WP7a with reserves and flags.
4. **WP11, WP14, WP15 (and 12) all edit the 1240-line `App.tsx`,** which holds auth, auction, admin and state. Three parallel packages will conflict. Fix: add a first frontend package (call it WP11a) that only extracts `AuctionView`, `AdminView` and the state hooks out of `App.tsx` with no behaviour change, before any package wires API calls. Otherwise the order WP11, then 14/15 in sequence is mandatory.
5. **The frontend has no test tooling** (`package.json` has only `dev/build/lint`). Frontend acceptance criteria in WP11 to WP15 are manual. Add Vitest plus Testing Library (and MSW for API mocks) to WP11a so "date keys identical in UTC vs Asia/Bangkok" and "no hardcoded Mew" can be automated.
6. **The authorization matrix (WP10) is written last.** Build the matrix harness in WP3 and require each WP to register its routes in it, so WP10 only verifies completeness. Same for the one-time bot bulk-import script: needed for any integration test with real members, so move it to WP4.
7. Optional reorder: WP8 (type 1) depends only on WP3/WP4, and auctions are the highest-value feature. It can run in parallel with WP5 to WP7 if there is more than one developer.

### B5. The Prisma schema in 4.2 is not implementable as written (4.2, WP2)

Atlas says back-relations are elided, but the forward relations are also missing, so integrity is not defined:

- No `@relation` (so no FK) on: `AuctionItem.winnerId`, `AuctionRound.createdById`, `QueueEntry.memberId`, `Preference` (round, member, item), `RoundQueueCutoff.roundId`, `RoundQueueSnapshot` (round, member), `NotificationOutbox.recipientMemberId`, `Registration.updatedById`, `Placement.placedById`/`backfilledForMemberId`, `Session` is fine. The ER diagram shows them as relations.
- `AuctionRound.sourceRoundId` self-relation needs a named `@relation` on both sides in Prisma.
- No `onDelete` policy is stated except `Job`, `Session`, `Occurrence`.

**Fix.** Add a table to 4.2 with the rule: every member and round/item reference is a real FK. Members are never hard-deleted (deactivate), so use `Restrict` on all member FKs except `Session` (Cascade). `Preference` to `AuctionItem` and `Round`, and `RoundQueueCutoff`/`Snapshot` to `Round`: Cascade. `AuditLog` keeps plain text ids (no FK) so history survives. WP2 acceptance must include `prisma validate` and `prisma migrate diff --exit-code` (see G2) in CI.

## 3. Non-blocking issues and suggestions

Each one should be fixed in the WP named; none needs a design revision first.

1. **[ARCHITECTURE CONCERN] Session cache vs "takes effect immediately" (5, WP3).** The text says `isAdmin` is read from DB every request and deactivation is immediate, then allows a 30 s in-process cache. Pick one. Drop the cache. A primary-key lookup at 80 rps is trivial. Also "30-day sliding expiry" with `lastSeen` implies a write per request, which at polling rates is 40 to 80 writes/s of pure churn. Update `lastSeen/expiresAt` at most once per hour per session.
2. **BigInt ids (4.2).** `QueueEntry`, `RoundQueueCutoff.cutoffId`, `NotificationOutbox`, `AuditLog` use `BigInt`. `JSON.stringify` throws on BigInt in Fastify/Prisma results, and cursors need string handling. One guild will never exceed 2^31 rows (roughly 76 x 3 requeues per round). Use `Int` everywhere. If BigInt stays, add a global serializer and note it in WP1.
3. **Type-1 claim idempotency (7.1, FR "duplicate submit or retry", 7 edge cases).** Zero rows updated returns `ITEM_ALREADY_CLAIMED`. If the current winner is the caller, return 200 with the item (retry after a dropped response). Do this check before the cap check, otherwise a retry at 5/5 returns `CLAIM_CAP_REACHED` for an item the member owns.
4. **Prisma `@updatedAt` is client-side only.** Raw `UPDATE` statements (worker claim, claim/release, lock-then-write paths) will not set `updatedAt`. Set it explicitly in every raw statement, or use a DB trigger, or drop `updatedAt` where nothing reads it (Registration, Preference).
5. **Seeding jobs with explicit ids 1 to 8 (4.3)** leaves the autoincrement sequence at 1, so the first admin-created job collides. After seed: `SELECT setval(pg_get_serial_sequence('"Job"','id'), (SELECT max(id) FROM "Job"))`. Add to WP2 acceptance ("create a 9th job after seed").
6. **IGN uniqueness (FR-1.10, 4.2).** FR-1.10 says names are unique case-insensitively (not "among active members"). The partial index lets a deactivated member's name be reused, which is reasonable, but then `reactivate` and bot-driven reactivation can collide. Reactivation must check and return `DUPLICATE_IGN`. Map Prisma P2002 on the index and on `discordId` (concurrent bot retries) to the right code. Use `INSERT ... ON CONFLICT (discordId) DO UPDATE` for the bot upsert. Verify `normalize()` is usable in an index expression on the target PG and that the DB encoding is UTF8 (test in WP2).
7. **Layout edge cases (7.5, 4.2).** `Room @@unique([activityId, key])` blocks re-creating a room whose key was archived: make it a partial unique index `WHERE "archivedAt" IS NULL` (raw SQL). Room capacity must sum non-archived teams only. The "vacated team is archived" check in 7.4 is dead code (a team with future placements cannot be archived), harmless but remove it or say why it is kept.
8. **Copy-from-previous (6.5, FR-5.7).** The design says members no longer joined are "flagged, not dropped" but the response returns `skipped`. Define it: copy everyone whose account is active (flag the others through `regStatus`), skip only deactivated members and teams that no longer exist. Also define behaviour when the target plan is not empty (recommend: reject with 409 unless the plan is empty; admin calls `clear` first).
9. **Poll load (7.1).** The 500 ms in-process micro-cache plus invalidation-on-write plus ETag is unnecessary for about 80 rps of one small query (round row plus at most ~80 items). Drop the cache (see section 4). Keep ETag if you want, but compute it from `max(wonAt)`/an item version, not by serializing.
10. **Deviation 3 (registration time on system promotion).** Not blocking, but the requirement is literal: "most recent transition into joined" (FR-4.6). Keeping the original time on promotion is more fair and only matters when a capacity is set on an auto-backfill activity (not the default anywhere). Get PO confirmation as Atlas already asks. Also define the `WAITLISTED` requested `JOINED` transition explicitly (no-op while capacity is full).
11. **Registration of a placed, non-JOINED member (7.4).** If an admin placed a member who is on LEAVE (allowed by FR-5.6) and that member later moves LEAVE to NONE on an auto-backfill activity, the design treats it as a withdrawal and backfills. State the rule: trigger only when the previous status was JOINED and the placement exists. Otherwise the placed-with-warning case behaves surprisingly.
12. **`FR-1.1` says the API "returns JSON"** on login. The design returns a cookie plus redirect plus `GET /me`. That is the correct OAuth shape; get the PO to confirm the interpretation and note it in section 2.
13. **Frontend hash routing.** Post-login error redirect `FRONTEND_URL/#login?error=...` collides with `viewFromHash()` (views are `auction|calendar|teams`). Either use a query string (`/?authError=...`) or add a `login` case to `viewFromHash`.
14. **Vite dev proxy and cookies.** The Origin check must allow the dev origin (`http://localhost:5173`), and `Secure` cookies work on `localhost` only in modern browsers. Document the dev setup and use a `__Host-` cookie name in prod.
15. **Date handling gotchas (3.3).** `Occurrence.date` as `@db.Date` is surfaced by Prisma as a JS `Date` at UTC midnight. Treat dates as `YYYY-MM-DD` strings at every boundary and never construct them with local-time `Date`. Note `dayOfWeek` 0 = Monday (frontend and design) versus Luxon `weekday` 1 = Monday and JS `getDay()` 0 = Sunday. Add table-driven tests around 00:00 Bangkok (which is 17:00 UTC the previous day).
16. **Reads must not create rows.** `GET /registrations` and `GET .../plan` for an occurrence that does not exist yet must return empty data without inserting an `Occurrence`.
17. **Placement swap.** With `unique(occurrenceId, teamId, slot)` a drag-swap of two members cannot be done in two `PUT`s without an intermediate state. Either allow `PUT` to occupied slot to swap in one transaction, or accept a two-step client flow. Decide before WP13 (drag-and-drop is the main planner interaction).
18. **`winCap` on `AuctionRound`.** For QUEUE_RANKED it is fixed at 1 per category and `allocate` hardcodes it. Store `winCap` only for type 1 (default 5, admin override per round is allowed by FR-2.x) to avoid a field that means two things.
19. **Timestamp source.** `clock_timestamp()` for `wonAt` is right, but the window check compares to `opensAt/closesAt` that the API computes from `now()` at start. Use `clock_timestamp()` there too, and state that all comparisons are DB-side to avoid app/DB clock drift.
20. **Type-2 preference model.** Design stores one ranked list per round spanning categories (`unique(roundId, memberId, rank)`), filtered per category at allocation. That is compatible with FR-3.5 but the UI must present a per-category ordering; make sure the API validation does not force cross-category rank contiguity to be meaningful. Simplest: keep ranks dense over the whole list and let the UI sort within a category.

## 4. Simplifications recommended (over-engineering for one guild)

Ranked by savings. None of these removes a requirement.

| # | Cut or replace | Where | Why |
|---|---|---|---|
| S1 | Per-activity lock instead of per-occurrence locks plus ascending-id protocol | 7.3, 7.5, 7.6 | Same guarantees, fewer moving parts (B1) |
| S2 | Drop the in-process poll micro-cache | 7.1, 3.5 | 80 rps of a single small query does not need it; removes invalidation bugs and the "single instance" caveat |
| S3 | Drop the 30 s session cache and per-request `lastSeen` writes | 5 | Contradicts "immediate" and adds churn (Non-blocking 1) |
| S4 | Bot key: use env `BOT_API_KEYS` (comma-separated sha256 hashes, two allowed) instead of the `BotApiKey` table, `create-bot-key` script and `lastUsedAt` | 4.2, 5, WP3 | FR-1.4 says "the key is configuration, rotatable". Compare with `timingSafeEqual` on digests. Removes a table, a script, an FK from audit |
| S5 | Remove `NotificationRoute` table and its CRUD endpoints (6.7) and admin UI (WP15) | 4.2, 6.7, 8.1, WP5 | There is exactly one event type (FR-6.6). Channel id lives in `Activity.notifyChannelId` (FR-6.2 says so). DM/channel on-off can be the env `NOTIFICATIONS_PROVIDER`. Keep the template registry (tiny). Add routing when a second event exists |
| S6 | Ship one real provider plus the fake, not three | 8.4, WP5 | O-3 is open, so build the provider interface plus `fake` plus whichever of `bot`/`webhook` the user confirms. Defer the polling endpoints (`/bot/notifications/pending`, `/ack`) and the other provider until needed. The schema already supports them |
| S7 | Remove the SAVEPOINT guard around the outbox insert and `reconcile-notifications.ts` | 8.1, WP5, WP10 | The outbox exists so the message is committed atomically with the promotion. Swallowing an insert failure recreates the dual-write problem and needs a repair script. FR-6.4 forbids Discord outages from blocking a promotion, and the enqueue does no network I/O. A failed enqueue is a bug: let it roll back and alert |
| S8 | Remove `pg_notify`, the leader advisory lock, and the daily retention job from v1 | 8.3 | Single instance, 2 s timer is enough. Retention can be a later cron once the table grows (it will hold hundreds of rows a year) |
| S9 | Remove `POST .../verify-allocation` | 6.7, 7.2, WP9 | FR-3.12 needs stored inputs and idempotency, not an endpoint. Keep `RoundQueueSnapshot`, `algorithmVersion`, and golden/property tests. A replay script in `scripts/` or a test helper suffices |
| S10 | Drop `undo cancels PENDING outbox rows` | 2 (note 7), 6.5, WP7 | O-4 default is "no new message on undo". Cancelling pending ones needs a way to correlate rows to a promotion (currently only the `dedupeKey` string). Add it only if the PO asks |
| S11 | Replace `needsReview` plus `mark-reviewed` plus `adminEditedFields` with a derived rule, pending PO | 4.2, 6.3, deviations 4 and 5 | Not in requirements and internally awkward: every admin edit sets `needsReview = true`, including the edit that fills in the missing nickname, so the flag never clears without an extra endpoint. Simplest consistent rule: `isIncomplete = nickname IS NULL` (plus `source = MANUAL`). Keep `adminEditedFields` only if the PO wants bot re-pushes not to overwrite admin edits; otherwise document that the bot is authoritative for what it sends |
| S12 | `BigInt` to `Int` | 4.2 | Non-blocking 2 |
| S13 | Drop `POST /admin/notifications/test` (already tagged optional) and `Activity.isActive`, `ScheduleEvent.isActive` if there is no endpoint that sets them | 4.2, 6.7 | No requirement, no writer |
| S14 | `GET /time` | 6.1 | Redundant: every time-sensitive response already carries `serverTime`. Harmless (used for clock offset before a round loads), keep only if the frontend wants it |

Estimated effect: about 2 fewer tables (`BotApiKey`, `NotificationRoute`), about 8 fewer endpoints/scripts, and the in-process cache and the multi-lock ordering protocol gone.

## 5. Requirements coverage

### 5.1 Covered (spot-checked, no gap)

FR-1.1 to FR-1.11 (see gaps for 1.1, 1.9), FR-2.1 to FR-2.11, FR-3.1 to FR-3.14 including the golden test (7.2 trace verified: A:1, B:3, C:2, queue after D, E, A, B, C; the latecomer stays ahead of new winners because winners get fresh ids), FR-4.1 to FR-4.8, FR-5.1 to FR-5.20, FR-6.1 to FR-6.6, AC-1 to AC-15, business rules 1 to 12.
The type-2 queue design (id as order key under a per-category advisory lock, cutoff id as the snapshot) is correct: `nextval` is not commit-ordered by itself but the advisory lock held to end of transaction makes id order equal commit order.

### 5.2 Gaps and ambiguities

| Ref | Gap | Recommendation |
|---|---|---|
| FR-1.1 | "API returns JSON" at login; design redirects and uses `/me` | Confirm with PO (Non-blocking 12) |
| FR-1.9 | "created or edited by other means" is modeled as a sticky flag needing a clear action | Simplify (S11) or confirm `mark-reviewed` |
| FR-1.10 | Requirement says unique case-insensitively; design uniqueness is among active members only | Acceptable, but document, and guard reactivation (Non-blocking 6) |
| FR-4.6 | Deviation 3: keeps time on system promotion | Needs PO ack. Default is fine |
| FR-5.7 | "flagged, not silently dropped" vs `skipped[]` | Define (Non-blocking 8) |
| FR-5.9 | Shrink check is defined for not-yet-started occurrences only, and race with lazy creation (B1) | Fix B1 |
| FR-5.12 | Trigger for a placed member who was not JOINED before withdrawing | Define (Non-blocking 11) |
| FR-5.17 | "moved out returns to reserves at original registration position": true only if the member's `Registration` row still exists and is JOINED. If they withdrew after being promoted and admin then undoes, the state is consistent (withdrawn means no longer reserve). Fine, add a test | Test only |
| FR-3.13 | Leftover draft: `sourceRoundId @unique` gives the one-draft guarantee. Draft start is blocked if another type-1 round is OPEN (`ANOTHER_ROUND_OPEN`) which is correct, but the admin UI must explain it | UI note |
| FR-3.11 | A member who leaves and rejoins the queue mid-window: ineligible (correct) | Test only |
| AC-3 | "80 concurrent claims" holds only with pool settings (B3) | Fix B3 |
| FR-2.7 | "strict server-side sequence": the row-lock wake-up order is not guaranteed FIFO, but the first committed conditional UPDATE wins and `wonAt` is `clock_timestamp()`, which satisfies "exactly one winner". Document that arrival order is approximate under contention | Doc only |
| 5.6 Audit log | Read-only view: covered. Coverage list in 9 is complete. Note `AuditLog` writes for bot registration on every idempotent repeat would flood: audit only on create/change, not on no-op upsert | Note in WP3/WP4 |

### 5.3 Design elements not required (gold plating)

See section 4: S4 to S11, S13. Additionally, the `POST /admin/members/:id/mark-reviewed` route, `NotificationRoute` CRUD, the polling bot endpoints, and `verify-allocation` are all extras that Atlas tagged as small additions or fallbacks; the cost is in tests and UI (WP15), not just the endpoint.
Items that look extra but are worth keeping: `Activity`/`ScheduleEvent` split (needed for Guild League's three events), stored `slot` (needed by FR-5.13 exact-slot backfill), `planVersion` (FR-5.8), the outbox itself (D-24), `RoundQueueSnapshot` (FR-3.12), `dedupeKey` (cheap idempotency), archive-not-delete for teams (history).

## 6. Guidance for the developer (Nova)

### Order and packages
1. Apply the WP changes in B4 before starting: WP7a/WP7b split, WP11a extraction plus frontend test tooling, OpenAPI wired in WP1, authz-matrix harness in WP3, bot bulk-import script in WP4.
2. Do not start WP6 to WP9 until B1 and B2 are folded into the design (the lock protocol is the thing everything else in those packages depends on). WP1 to WP5 can start now.
3. Write the concurrency tests first (`Promise.all` against real Postgres) for: 80 claims on one item, 10 claims by one member (cap), simultaneous withdrawals with one reserve, concurrent unregisters with one waitlisted member, submit vs finalize interleave, layout shrink vs placement, finalize twice concurrently. Use a fresh database per test file and set the pool as per B3 in the test harness too.
4. Put the lock helper (`withActivityLock(tx, activityId)` and `withRoundLock`) in `lib/locks.ts` in WP6 and forbid taking locks anywhere else. State the global lock order in a comment: Activity, then Round, then category advisory locks (sorted), then rows.

### Watch-outs
- Hot paths (claim, release, queue join, backfill) are raw SQL inside `$transaction`; everything else can stay Prisma. Keep them in one file per module so the raw SQL is reviewable.
- Never call the network inside a transaction. Worker sends happen outside; only the claim/complete statements are transactions.
- Set `updatedAt` yourself in raw updates. Map Prisma P2002, P2003, P2028, P2034 (serialization/deadlock) to stable error codes; retry P2034 once.
- `hashtextextended` collisions across lock namespaces are harmless but prefix keys (`claim:`, `queue:`) as designed.
- `Registration`: "none" is deletion. Keep the audit row, because the deleted row loses history.
- Backfill selection query must tie-break by `(registeredAt, id)` as designed, and select the reserve with `FOR UPDATE SKIP LOCKED` only if you drop the activity lock; under the activity lock it is not needed.
- After-start behaviour: compare `startsAt` to `clock_timestamp()` inside the transaction, not to a value read before the lock wait.
- Sweeper and lazy finalize call the same `finalizeRound`. Run finalize once at process start for any OPEN round past `closesAt`.
- Admin close of a type-1 round: set `status = CLOSED` and `closesAt = clock_timestamp()` in one statement, so the claim window check needs only one source of truth.
- Test data: seed real Thai strings (combining marks, mixed Thai/Latin) in IGN tests, including `แมวกระเป๋า`, `เสีEวค่ะXลวงMา`, `-nara-` from the roster.

### Prisma / migrations
- Raw SQL in migrations (partial unique indexes on `Member(lower(normalize(ign,'NFC')))` and `AuctionRound(type) WHERE status='OPEN'`, CHECK constraints, partial unique on `Room`) will not appear in `schema.prisma`. Add a CI step that runs `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code` and one that greps the migration folder for the raw statements, so a future `migrate dev` does not silently drop or regenerate them. Keep raw SQL in a dedicated, clearly named migration so it is not rewritten.
- Complete the schema per B5 and run `prisma validate` in WP2.
- Seed idempotently with `upsert` on natural keys, and reset the Job sequence (Non-blocking 5).
- Use `prisma migrate deploy` in release only. The design already says so.

### Auth and security notes
- CSRF: the Origin check and `X-Requested-With` requirement apply to cookie-authenticated non-GET routes only. Bot-key routes must be exempt from the Origin/header check and must reject cookies. Write both as tests in the authz matrix.
- `GET /auth/discord/callback` must be rate limited per IP and must reject a reused or missing state. Check that Discord's token endpoint accepts `code_verifier` for your app type; if not, drop PKCE and keep `state` (a confidential server-side client does not depend on PKCE).
- Redact `x-bot-key`, cookies and OAuth `code` in Pino. Do not log request bodies for the bot routes.
- `@fastify/rate-limit` in memory is fine for one instance. Keys: member id for authenticated routes, IP for auth routes.

### API consistency
- `/registrations` uses `from`/`to` with a 14 day cap; `/events/:eventId/occurrences/:date/...` uses per-occurrence paths. Keep both, but return the same shape for a member status object everywhere. Uppercase enums (`JOINED`) on the wire differ from the frontend's `joined`/`leave` strings; put the mapping in `src/api/` (WP11), not scattered.
- Error codes: `NOT_AN_AUTO_BACKFILL` is listed twice in 6.8. `TEAM_FULL, SLOT_TAKEN, SLOT_OUT_OF_RANGE` are listed as "409 or 422"; fix a single status per code (409 for state conflicts, 422 for malformed input) so the frontend map is deterministic. Add `PLAN_VERSION_CONFLICT` details size cap (the plan for a 150-slot layout is around 10 KB, acceptable).
- `PUT .../registrations/me`: idempotent repeat returns 200 with the same body, including `promoted: []` and `backfilled: []`. Keep the envelope stable for the frontend.
- Times: always ISO 8601 with milliseconds and `Z`. Dates: `YYYY-MM-DD` in Bangkok.

### Frontend fit (checked against the code)
- Fit is good. Existing model already has `Attendance = "joined" | "leave"` keyed by `YYYY-MM-DD:eventId`, event ids match the seed, and the planner already has Team/slot search-to-add. The name-keyed state (`teamAssignments`, `attendance`, `members`, `adminMembers`) all must move to `memberId`; that is the biggest single edit and touches `App.tsx`, `TeamPlanner.tsx` and `WeeklySchedule.tsx` together, another reason for WP11a.
- `TeamPlanner.tsx` also contains the job manager and chart (around lines 500 to 610). Extract it during WP11a/WP15, otherwise the planner rewrite in WP13 drags the job manager along.
- `scheduleEvents` carries a `slot` field (grid row). It equals `start` for all 16 events, so the frontend can derive it; the API does not need to return it.
- Auction UI is a full rewrite (200 generic items, page holds, local timer) as Atlas says. Nothing to reuse except styling.
- `README.md` state table becomes obsolete (Atlas notes this); update it in WP11.

### Test expectations worth adding to acceptance lists
- WP2: create a 9th job after seed; deactivated member's IGN reusable, reactivation with a taken IGN fails with `DUPLICATE_IGN`; `prisma migrate diff` clean.
- WP3: session cookie not accepted on bot routes; bot key not accepted on member routes; no `lastSeen` write on every request.
- WP6: layout and capacity changes serialize with registration (B1 test); reads do not create occurrences.
- WP7b: `Promise.all` of a withdrawal and a layout shrink; withdrawal of a placed member who was LEAVE.
- WP8: 80 parallel claims across the pool limit with no P2028; retry of a winning claim returns 200; claim vs early close ordering.
- WP9: submit vs finalize interleave (B2); leaving the queue then rejoining during the window.

## 7. Answers to the standing questions

1. **Can we actually build this?** Yes. Nothing exotic: Postgres row locks, advisory locks, conditional updates, an outbox. The risks are correctness details, not feasibility.
2. **Is this the simplest reasonable solution?** No. About a quarter of the surface (routing table, three providers, reconcile script, caches, verify endpoint, review flag, key table) is not needed for one guild (section 4).
3. **Does it fit the existing system?** Yes. Event ids, job ids, hash routing and date-key convention are preserved. The frontend rewrites are known and scoped.
4. **How much existing code must change?** Frontend: nearly all of `App.tsx` state, all of `TeamPlanner.tsx`, most of `WeeklySchedule.tsx`; `guild.ts` shrinks to types and helpers. Backend: greenfield.
5. **What could break?** Silent lost preferences at close (B2), layout/capacity races (B1), claim errors under load (B3), stale planner conflicts after each backfill (documented), P2002 on concurrent bot upserts.
6. **Technical debt introduced?** Layout edits change how past plans render, unbounded audit log, in-process worker/sweeper, URL-only images, no item catalog. All acceptable and already listed by Atlas.
7. **What should the System Architect reconsider?** [ARCHITECTURE CONCERN] the per-occurrence lock scheme (B1), the unlocked submit/close path (B2), the outbox savepoint swallow (S7), the sticky `needsReview` model (S11), and the WP graph (B4).
8. **What should the Developer implement?** WP1 to WP5 as written (with the trims), then the corrected WP6 to WP9, then hardening; frontend packages after WP11a. See section 6.

## 8. Complexity and effort summary (after changes)

| Work | Complexity | Impact |
|---|---|---|
| WP1 scaffold | LOW | SMALL |
| WP2 schema/migrations/seed | MEDIUM (raw SQL, FK completion) | MODERATE |
| WP3 auth, sessions, bot key | MEDIUM | MODERATE |
| WP4 audit, members, jobs, deactivation | MEDIUM | MODERATE |
| WP5 outbox and worker | MEDIUM (was HIGH before S5 to S8) | MODERATE |
| WP6 registration and waitlist | MEDIUM | MODERATE |
| WP7a planner CRUD | MEDIUM | MODERATE |
| WP7b backfill/undo/deactivation hook | HIGH | MODERATE |
| WP8 type 1 | MEDIUM (HIGH if single-statement claim is needed) | MODERATE |
| WP9 type 2 | HIGH | LARGE |
| WP10 hardening | MEDIUM | MODERATE |
| WP11a/11 frontend foundation | HIGH (state re-keying) | LARGE |
| WP12 schedule | MEDIUM | MODERATE |
| WP13 planner | HIGH | LARGE |
| WP14 auctions | HIGH | LARGE |
| WP15 admin | MEDIUM (smaller after S5, S9, S11) | LARGE |
