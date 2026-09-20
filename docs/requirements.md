# Cover_TH (Clover_TH Guild) Backend: Validated Requirements

Status: FINAL for architecture hand-off (v5). Author: Product Owner (Milo).
Timezone for everything in this document: Asia/Bangkok. Weeks start on Monday.

Legend for every item:

- **[CONFIRMED]** stated by the product owner/user.
- **[DEFAULT]** recommended default so design is not blocked; the user may change it later.
- **[ASSUMPTION]** an assumption not confirmed by the user; must be validated (see section 12).

---

## 1. Overview and goals

The guild is named **Clover_TH** [CONFIRMED]; the repository and project folder are named Cover_TH. This is a management app for the Clover_TH guild in Ragnarok: The New World (Thai server). A React/Vite frontend already exists in `frontend/`, running entirely on mock in-memory state. This project builds the backend (Node.js, PostgreSQL, Prisma) that replaces the mock state.

Business goals:

1. Run guild auctions fairly, with results enforced server-side.
2. Let members register for, or take leave from, weekly guild activities, with visible rosters.
3. Let management plan who plays with whom in each activity, with everyone else view-only.
4. Sign members in with Discord only, with members provisioned by the existing Discord bot.

Deliverables downstream: system design, Prisma/PostgreSQL ER schema, API design, and a list of frontend changes.

## 2. Users and roles

| Role | Description | Source of truth |
|---|---|---|
| Guest | A Discord user not registered by the bot. Cannot log in. | n/a |
| Member | A registered guild member. Can register attendance, take part in auctions, view plans. | Member table, created by the bot [CONFIRMED] |
| Admin | Management. Can run auctions, edit members, edit settings, edit team plans. | An admin flag in the DB, set manually [CONFIRMED]. No Discord role sync. |
| Bot (service) | The existing Discord bot. Pushes new-member data and receives notification requests. | A shared secret or API key [CONFIRMED that it needs its own auth; exact mechanism is the architect's] |

Admin is not grantable through the UI or API [CONFIRMED]. The frontend's Admin Config "grant admin" control must be hidden or removed.

## 3. Glossary

| Term | Meaning |
|---|---|
| Occurrence | One dated instance of an activity, e.g. Guild League on Tue 2026-09-22 at 21:30. Registration and team plans are per occurrence. Key format used by the frontend: `YYYY-MM-DD:eventId`. |
| Round | One auction session with a start, a duration, and a set of items. |
| Type-1 auction | Live click race for Pet, Material, Gem Box items. |
| Type-2 auction | Queue plus ranked preferences for Gear, Card, Relic. |
| Queue entry | A member's position in a per-category queue, ordered by time. |
| Room / Team / Slot | Planner structure: an activity has rooms; a room has teams; a team has slots (default 5). |
| Reserve (ตัวสำรอง) | A member who is registered as joined but not placed in a planner slot. |
| Backfill | Automatic placement of the first reserve into a slot vacated by a withdrawal. |
| Withdraw | A placed member unregisters or sets `leave`. |
| Registration capacity | An optional cap on registrations per activity, which produces a registration waitlist. Not the same as planner slots. |
| Job | The member's in-game class (High Priest, Knight, Wizard, Sniper, Gunslinger, ดรูอิด, Assassin, Paladin by default). |

## 4. Activity catalog (from the existing frontend schedule)

Days are weekly. Times are Asia/Bangkok. Source: `frontend/src/data/guild.ts`. The "Guild" column is the in-game hammer icon.

| Activity | Thai name | Day / time | Guild | Team planning |
|---|---|---|---|---|
| Guild League | Guild League (this is what the user calls "Guild War") | Tue 21:30, Tue 22:00, Thu 22:00 | Yes | Yes |
| Mirror World | Mirror World | Thu 21:00 | Yes | Yes |
| Polarity Zone | Polarity Zone | Sun 12:00 | Yes | Yes |
| Castle Siege | ศึกชิงปราสาท | Sun 21:00 | No | Yes |
| Hazy Forest | Hazy Forest | Thu 21:30 | Yes | No (solo activity, registration only) [DEFAULT] |
| Luminous Vale | Luminous Vale | Sat 08:00 | No | No |
| Graduate Exam | การประเมินบัณฑิต | Fri 12:00 | No | No |
| King Battle | ศึกราชันย์ | Sat 13:00 | No | No |
| King Battle (cross-server) | ศึกราชันย์ข้ามเซิร์ฟ | Sat 18:00 | No | No |
| Sage Selection | การคัดเลือก Sage | Fri 19:00 | No | No |
| Clash of the Chosen | Clash of the Chosen | Sat 20:00 | No | No |
| Family Party | งานเลี้ยงครอบครัว | Tue 21:00 | No | No |
| Hoppy Quiz | Hoppy Quiz | Fri 21:00 | No | No |
| Ancient Ruins | Ancient Ruins | Wed 21:30 | No | No |

- Planning is required only for Mirror World, Guild League, Castle Siege and Polarity Zone [CONFIRMED].
- The activity list is data, editable by admins, not a hardcoded enum [DEFAULT].
- Guild League is played on two battlefields, Main and Sub. Web sources (unverified for the Thai server) say only appointed "elite" members may enter Main. See open item O-6.

## 5. Functional requirements

### 5.1 Identity and bot registration

| ID | Requirement | Tag |
|---|---|---|
| FR-1.1 | Login is Discord OAuth only. On success the API returns JSON: member id, Discord id, in-game name, nickname, job, isAdmin. | [CONFIRMED] |
| FR-1.2 | Only members already registered by the bot can log in. Any other Discord user is rejected with a distinct error code and no session is created. | [CONFIRMED] |
| FR-1.3 | New members must join the Discord server first. The existing Discord bot pushes each new member's data (Discord id, in-game name, nickname, job) to a backend registration endpoint. | [CONFIRMED] |
| FR-1.4 | The bot endpoint has its own authentication (shared secret or API key in a header), separate from user OAuth. Missing or wrong key returns 401 and changes nothing. The key is configuration, rotatable, and never logged. | [CONFIRMED] need for own auth; [DEFAULT] shared-secret form |
| FR-1.5 | The bot endpoint is idempotent and upserts by Discord id. Repeated calls create no duplicates. | [DEFAULT] |
| FR-1.6 | The admin flag is computed by the server from the DB. The client's claim is never trusted. | [CONFIRMED] |
| FR-1.7 | Members are identified by an immutable id. Names (in-game name, nickname) can change and are never used as keys. The frontend keys by name today and must change. | [DEFAULT] |
| FR-1.8 | The bot can send a deactivate request when a member leaves the Discord server. A deactivated member cannot log in, and is removed from queues, from future registrations, and from future team placements. Past records are kept. | [CONFIRMED] removal of future registrations and placements; [DEFAULT] bot-driven trigger (O-11) |
| FR-1.9 | A member is "incomplete" when optional data is missing (for example nickname), or when the record was created or edited by other means. Because an invalid job is rejected at registration (FR-1.11), the incomplete-member flow no longer covers a missing or invalid job. Incomplete members can still log in and are flagged for admin follow-up. Required bot fields: Discord id, in-game name, job. Nickname is optional. | [DEFAULT] (O-10) |
| FR-1.10 | In-game names are unique case-insensitively. A bot call that would create a duplicate name is rejected with a clear error. | [DEFAULT] (frontend already enforces this) |
| FR-1.11 | If a bot payload has an invalid job (not in the job list), the bot call is rejected with a clear error code. The member is not created and cannot log in. A payload that omits the job entirely is treated the same way. | [CONFIRMED] invalid job; [DEFAULT] omitted job |

### 5.2 Auction type 1: Pet, Material, Gem Box (live click race)

| ID | Requirement | Tag |
|---|---|---|
| FR-2.1 | An admin creates a round, enters items, sets the duration, and starts it. Item catalog is admin-entered. | [CONFIRMED] |
| FR-2.2 | The race is live for the whole window. Default duration is 5 minutes (300 s). An admin may override per round. | [CONFIRMED] 5 minutes; [DEFAULT] override |
| FR-2.3 | Within the window, the earliest valid claim by server time wins an item. The winner is shown immediately. | [CONFIRMED] |
| FR-2.4 | Cap: 5 items per member per round. It is enforced at click time. The 6th claim is rejected with a clear reason code. | [CONFIRMED] cap; [DEFAULT] click-time enforcement |
| FR-2.5 | A member may release their own claim while the window is open. The item reopens to the race and the release frees one cap slot. | [DEFAULT] |
| FR-2.6 | Claims outside the open window are rejected. The window is enforced by the server clock. The server also returns its time so the frontend countdown is accurate. | [DEFAULT] |
| FR-2.7 | Concurrent claims on one item produce exactly one winner. Ties are broken by a strict server-side sequence. | [DEFAULT] |
| FR-2.8 | A result endpoint returns the winner for every item, with the claim time. A member can query their own result (covers dropped connections). | [CONFIRMED] winner list; [DEFAULT] own-result query |
| FR-2.9 | Live updates use polling, at about 1 to 2 seconds while a round is open. Push is not required. | [DEFAULT] |
| FR-2.10 | Each catalog item is one unit. Multiple units are entered as multiple rows. Fields: name, category (Pet, Material, GemBox), optional rarity and image. This applies to type-2 categories (Gear, Card, Relic) as well. In v1 the image is a URL that the admin pastes; file upload is a later phase. | [DEFAULT] fields; [CONFIRMED] image = pasted URL in v1 |
| FR-2.11 | An admin can close a round early. Extension of a running round is not supported. | [DEFAULT] |

### 5.3 Auction type 2: Gear, Card, Relic (queue plus ranked preferences)

| ID | Requirement | Tag |
|---|---|---|
| FR-3.1 | There is one queue per category: Gear, Card, Relic, separately. | [CONFIRMED] |
| FR-3.2 | A member joins a queue by pressing to join. Queue order is the time of the join press (server time). Entries are persisted. | [CONFIRMED] |
| FR-3.3 | Each member can see their own rank in each queue. The full queue order is visible to all members. | [CONFIRMED] own rank; [DEFAULT] full queue visible |
| FR-3.4 | An admin creates a round with items per category and starts it. A round covers all three categories under one shared window of 5 minutes (default). Each category has its own queue and its own cap. | [CONFIRMED] 5 minutes; [DEFAULT] round shape |
| FR-3.5 | During the window every queued member may mark the items they want, as a ranked list (priority order). A member may only list items in the current round and category. The list length is uncapped up to the item count. | [CONFIRMED] ranking; [DEFAULT] uncapped |
| FR-3.6 | The queue order is snapshotted when the window opens. Members who join the queue during the window go to the tail and are not eligible this round. | [DEFAULT] |
| FR-3.7 | At close, allocation runs per category. It is a single pass in queue order. Each member receives the highest-ranked item on their list that is still unallocated. | [CONFIRMED] |
| FR-3.8 | A member wins at most 1 item per category per round. | [CONFIRMED] |
| FR-3.9 | Every winner gets a new queue entry at the tail. The new tail entries are ordered among themselves by the winners' previous queue order. Non-winners keep their relative order and stay in front. | [CONFIRMED] |
| FR-3.10 | A queued member who submitted no list, or whose items were all taken, wins nothing and keeps their position. | [DEFAULT] |
| FR-3.11 | A member has one active entry per category. A member may leave a queue and lose their position. A member who leaves a queue while a window is open loses eligibility for that round. Preferences cannot be changed after close. | [CONFIRMED] leaving during an open window; [DEFAULT] the rest |
| FR-3.12 | Allocation is deterministic. Inputs (queue snapshot, lists, items) and results are stored, so it can be replayed. Running it twice gives identical results (idempotent). | [DEFAULT] |
| FR-3.13 | Leftovers are all type-2 items that end unallocated, including items nobody listed and items whose listers all lost out. They are copied into a new draft type-1 round. An admin reviews and starts it. It never opens automatically. | [CONFIRMED] leftovers roll into type-1; [DEFAULT] draft and admin start |
| FR-3.14 | Results (who won what) are published to everyone at close. A member's ranked list is visible only to that member and admins during and after the round. | [DEFAULT] |

**Golden test (corrected and confirmed by the user):**

| | |
|---|---|
| Queue before | A, B, C, D, E |
| Items | 5 items in the category, numbered 1 to 5 |
| Lists | A = (1, 3), B = (1, 3), C = (3, 2). D and E listed nothing. |
| Allocation | A gets 1 (top of queue). B: 1 is taken, gets 3. C: 3 is taken, gets 2. |
| Result | A: 1, B: 3, C: 2 |
| Queue after | **D, E, A, B, C** (winners A, B, C move to the tail, in their previous order) |
| Leftover | Items 4 and 5 go to a draft type-1 round |

### 5.4 Weekly registration, leave, and waitlist

| ID | Requirement | Tag |
|---|---|---|
| FR-4.1 | Each occurrence has a roster. A member can register (joined), unregister (none), or set `leave`. Everyone can see all rosters. | [CONFIRMED] register, unregister, show; [CONFIRMED] keep `leave` |
| FR-4.2 | Statuses per member per occurrence: joined, waitlisted, leave, none. A member has at most one. `leave` does not consume capacity. | [DEFAULT] |
| FR-4.3 | A member changes only their own status. An admin can set or clear the status of any member. | [CONFIRMED] (matches the frontend) |
| FR-4.4 | Registration capacity is a nullable per-activity setting, editable by an admin. When null (the default for all activities) there is no cap and no registration waitlist. | [CONFIRMED] (no cap for Polarity Zone); [ASSUMPTION] null for all other activities, including Guild League (see A-2) |
| FR-4.5 | When a capacity is set and reached, further registrations become waitlisted in registration order. When a joined member unregisters, the first waitlisted member is promoted atomically (exactly once). | [CONFIRMED] from the original brief |
| FR-4.6 | Registration time is the server time of the member's most recent transition into joined. Reserve ordering uses it. Tie-break by member id. A `leave` to joined toggle resets the time, so the member goes to the back of the reserve queue. | [CONFIRMED] reset on toggle; [DEFAULT] tie-break |
| FR-4.7 | Members cannot change their own status once the occurrence has started. Admins always can. | [DEFAULT] |
| FR-4.8 | All requests are idempotent. Repeating a registration creates no duplicate. | [DEFAULT] |

### 5.5 Team planner

**Structure.** Each planned activity has a layout expressed as data: rooms, each with a team count and team size. Room capacity is derived (teams x team size) and is not stored separately. [DEFAULT]

| Activity | Room | Teams x size | Capacity | Auto-backfill | Tag |
|---|---|---|---|---|---|
| Guild League | Main | 12 x 5 | 60 | OFF | [CONFIRMED] capacities and backfill OFF; [DEFAULT] 12 x 5 structure |
| Guild League | Sub | 18 x 5 | 90 | OFF | same |
| Polarity Zone | single room | 10 x 5 | 50 | **ON** | [CONFIRMED] 50 and ON; [DEFAULT] 10 x 5 structure |
| Mirror World | single room | 8 x 5 | 40 | OFF | [DEFAULT] placeholder until the user researches sizes; [CONFIRMED] backfill OFF |
| Castle Siege (ศึกชิงปราสาท) | single room | 8 x 5 | 40 | OFF | same |

Layout, sizes and the backfill setting are editable per activity by an admin. Nothing (8 x 5, A/B) is hardcoded.

| ID | Requirement | Tag |
|---|---|---|
| FR-5.1 | A plan belongs to one occurrence. Guild League has three occurrences a week. A member can be in Main for one and Sub for another. | [DEFAULT] |
| FR-5.2 | Only admins can create or edit a plan. The server rejects any other write with a permission error and changes nothing. Everyone can read plans. | [CONFIRMED] |
| FR-5.3 | A member occupies at most one slot per occurrence, across all rooms. A slot holds at most one member. A team cannot exceed its size. | [DEFAULT] (frontend enforces one team and 5 per team) |
| FR-5.4 | The Sub room is a real room with slots. Sub membership is tracked in the plan. | [CONFIRMED] |
| FR-5.5 | Registered (joined) members who are not placed appear in an "unplaced / reserves" pool, ordered by registration time (FR-4.6). This includes Guild League members beyond its 150 slots. | [CONFIRMED] for Polarity Zone; [DEFAULT] for others |
| FR-5.6 | Placing a member who is not registered as joined, or who is on leave, is allowed but shows a warning. It is not blocked. | [DEFAULT] |
| FR-5.7 | An admin can copy the previous week's plan for the same activity as a starting point. Members no longer joined are flagged, not silently dropped. | [DEFAULT] |
| FR-5.8 | Concurrent edits: last write wins with a version check. A stale write is rejected with a conflict error. | [DEFAULT] |
| FR-5.9 | A layout change that would leave placed members without a slot (fewer teams or smaller size) is rejected until those members are moved. | [DEFAULT] |
| FR-5.10 | If a member is placed and later unregisters or goes on leave, and auto-backfill is OFF, they stay in the plan flagged as "withdrawn" for an admin to resolve. | [DEFAULT] |

**Auto-backfill (per-activity setting).**

| ID | Requirement | Tag |
|---|---|---|
| FR-5.11 | Auto-backfill is a per-activity boolean setting: ON for Polarity Zone, OFF by default for Guild League, Mirror World, Castle Siege. | [CONFIRMED] ON for Polarity Zone; [CONFIRMED] auto-backfill only for Polarity Zone by default, OFF for the others |
| FR-5.12 | Trigger: a member placed in a slot withdraws, meaning they unregister or set `leave` for that occurrence. Deactivation of a placed member also counts as withdrawal (their placements and future registrations are removed, FR-1.8). | [CONFIRMED] unregister, leave, and removal on deactivation; [DEFAULT] treating deactivation as a backfill trigger |
| FR-5.13 | Action: the first eligible reserve is placed into the exact vacated slot. Eligible = status joined, not on leave, not placed, ordered by earliest registration time (ตัวสำรอง). | [CONFIRMED] |
| FR-5.14 | If there are no eligible reserves, the slot stays empty. In an auto-backfill activity, a placed member who withdraws is always removed from the slot, even when there is no reserve to take it. | [CONFIRMED] |
| FR-5.15 | The vacate-and-place operation is atomic and idempotent. Repeated or concurrent withdrawal requests cause exactly one promotion per vacated slot. Two simultaneous withdrawals with one reserve promote that reserve once. | [CONFIRMED] |
| FR-5.16 | Each auto-backfill is written to the audit log: occurrence, vacated member, promoted member, slot, time, trigger. | [CONFIRMED] |
| FR-5.17 | An admin can override or undo an auto-backfill in the planner (move the promoted member out, place someone else). The override is audit-logged. A member moved out returns to the reserves at their original registration-time position. | [CONFIRMED] |
| FR-5.18 | Auto-backfill applies only until the occurrence starts. After that, admins handle changes manually. | [CONFIRMED] |
| FR-5.19 | An admin removing a placed member by hand does not trigger backfill. Only withdrawals (FR-5.12) do. | [CONFIRMED] |
| FR-5.20 | Backfill never applies to a plan slot that an admin deliberately left empty before any withdrawal. It fires only on a vacancy caused by a withdrawal. | [CONFIRMED] |

### 5.6 Admin page (in scope; expands the existing frontend Admin view)

All actions are admin-only and enforced server-side.

| Area | Capabilities | Tag |
|---|---|---|
| Auction management | Create rounds and items, set duration, start and close a round, review and start the draft type-1 round created from leftovers. | [CONFIRMED] |
| Member management | Edit in-game name, nickname, job. Deactivate a member. List bot-registered members with incomplete data (missing optional data such as nickname; an invalid job is rejected at registration, FR-1.11). Members cannot be created here (the bot creates them). | [CONFIRMED] edit, deactivate, incomplete list; [DEFAULT] no create |
| Activity settings | Registration capacity per activity. Team layout per activity (rooms, teams, sizes). Auto-backfill on/off per activity. Notification channel (see 5.7). | [CONFIRMED] capacity and layout; [DEFAULT] backfill and channel settings |
| Job management | Existing feature: rename, recolour, add, delete unused jobs. A job in use cannot be deleted. | [CONFIRMED] |
| Audit log | Read-only view of who did what and when. | [CONFIRMED] |
| Not included | Granting admin by UI or API. Admin stays a manual DB flag. The "grant admin" control in the frontend is hidden or removed. | [CONFIRMED] |

### 5.7 Discord notifications (in scope)

| ID | Requirement | Tag |
|---|---|---|
| FR-6.1 | When a reserve is promoted by auto-backfill, notify Discord: a message to the promoted member. | [CONFIRMED] |
| FR-6.2 | Also post a message to a guild channel. The channel id is a configuration value that an admin sets later in Activity settings. Until it is set, no channel post is made. | [CONFIRMED] channel post and configurable channel; default channel id is OPEN (O-17) |
| FR-6.3 | Message content: activity, occurrence date and time (Asia/Bangkok), room/team/slot, promoted member. Language Thai by default. | [DEFAULT] |
| FR-6.4 | Constraint: delivery must not block or roll back the promotion. If Discord is down, the promotion still commits. Delivery is retried, and failures are visible (audit log). The delivery mechanism (transactional outbox and retry policy, and whether it goes through the bot or a webhook) is the architect's decision. Delivery goes through an outbox [CONFIRMED]. **Open (O-3):** whether the existing bot can expose an inbound HTTP endpoint to receive these events. Fallbacks if not: a Discord webhook for channel posts, and the bot polling a backend endpoint for pending DMs. | [CONFIRMED] no block/rollback, outbox delivery; architect decides the rest; endpoint question OPEN |
| FR-6.5 | The bot's own internal logic (commands, message formatting on its side) is out of scope. The backend only emits the notification request. | [CONFIRMED] |
| FR-6.6 | Other notifications (auction open, results, manual promotions from a registration waitlist) are not required. | [DEFAULT] |

## 6. Business rules

1. Server time is the only clock for auction windows, click ordering, queue order, and registration order.
2. Every write is authorized server-side. Client-supplied role or identity claims are ignored.
3. All records reference members by immutable id.
4. Occurrence dates and week boundaries are computed in Asia/Bangkok, week starting Monday. Timestamps are stored in UTC.
5. Claim caps, single-winner per item, waitlist promotion, and backfill are transactional (no double winner, no double promotion).
6. Type-2 allocation is a pure function of stored inputs.
7. A member holds at most 5 type-1 wins per round, and at most 1 type-2 win per category per round.
8. A member has at most one status per occurrence and at most one planner slot per occurrence.
9. A job that is in use by any member cannot be deleted.
10. Deactivation preserves history.
11. Room capacity is derived from teams x team size.
12. Admin status changes only through the DB.

## 7. Edge cases

**Login and bot**
- Discord user not in the guild, or in the server but not yet registered by the bot: rejected, no session.
- Bot retry or duplicate delivery: idempotent upsert.
- Wrong or missing bot key: 401, no change.
- Duplicate in-game name in a bot payload: rejected.
- Bot payload with an invalid or omitted job: rejected (FR-1.11), no member created.
- Changed Discord username: Discord id remains the key.
- Member leaves the server while holding queue entries or slots.
- Two devices logged in for one user; a session expiring mid-auction.

**Type 1**
- Simultaneous claims on one item (one winner); a 6th claim; a request arriving just after close; duplicate submit or retry; a dropped connection (own-result query); a member deactivated mid-round; a round with no items; an admin closing early.

**Type 2**
- Queue shorter or longer than item count; two members with the same first choice (queue order wins); an empty list (keeps position); a list containing items already taken; a member joining the queue during the window (tail, not eligible); a member in queues of several categories (allowed, each independent); a member leaving a queue; preference edit after close (rejected).

**Registration and waitlist**
- Repeated register; register for a past occurrence or after start; the last joined member unregistering with an empty waitlist; simultaneous unregisters with one waitlisted member (single promotion); a status flip from leave to joined (new registration time).

**Planner and backfill**
- Placing into a full team; a member with two slots (rejected); an unregistered or on-leave member placed (warning); a layout shrink with placed members (rejected); two admins editing at once (version conflict); a placed member who withdraws when backfill is OFF (flagged).
- Backfill: no reserves (empty slot); reserve on leave or already placed (skipped, next reserve); two placed members withdrawing at the same instant with one reserve (one promotion, the other slot empty); repeated withdrawal request (one promotion); a promoted member who then also withdraws (their slot backfills again); admin undo of a backfill (member returns to reserves at original position); withdrawal after the occurrence start (no backfill); Discord notification failing (promotion stands, retry).
- More than 150 Guild League registrations, or more than 50 for Polarity Zone: extras stay unplaced (reserves).

## 8. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 | A valid Discord OAuth login of a registered member returns JSON with member id, Discord id, in-game name, nickname, job, isAdmin. An unregistered Discord user is rejected and gets no session. |
| AC-2 | A bot call with the valid key creates or updates a member. A repeat creates no duplicate. A missing or wrong key returns 401 and changes nothing. A payload with an invalid or missing job is rejected with a clear error code, no member is created, and that person cannot log in. |
| AC-3 | Type 1: the earliest valid claim wins; the winner is visible immediately; a 6th claim by one member is rejected; claims outside the window are rejected; 80 concurrent claims on one item yield exactly one winner. |
| AC-4 | Golden test (section 5.3): queue A, B, C, D, E; lists A=(1,3), B=(1,3), C=(3,2); result A:1, B:3, C:2; **queue after allocation = D, E, A, B, C**. |
| AC-5 | Type 2: a member never wins more than one item per category per round and never wins an unlisted item. Running allocation twice gives the same result. Leftover items appear in a draft type-1 round that does not open until an admin starts it. |
| AC-6 | Registration: a member can change only their own status (admins can change anyone's); repeated requests are idempotent; with a capacity set, an unregister promotes the first waitlisted member exactly once. |
| AC-7 | Planner: a non-admin write returns a permission error and changes nothing; an admin write into a full team is rejected; a member cannot hold two slots in one occurrence; everyone can read the plan. |
| AC-8 | Layout: changing teams or size for an activity needs no code change; a shrink that orphans placed members is rejected. Guild League Main is 12 x 5 (60), Sub is 18 x 5 (90), Polarity Zone is 10 x 5 (50) by default. |
| AC-9 | Polarity Zone accepts more than 50 registrations. Those not placed are listed as reserves in registration-time order. A member who toggles from `leave` back to joined goes to the back of that order. |
| AC-10 | Polarity Zone backfill: with 50 placed and reserves R1 (earlier) and R2, when a placed member unregisters or sets leave, R1 is placed into that exact slot. This is atomic, appears once in the audit log, and repeating the withdrawal request does not promote R2. With no reserves the withdrawing member is still removed and the slot stays empty. No backfill happens once the occurrence has started. |
| AC-11 | With auto-backfill OFF (Guild League default), a withdrawal does not promote anyone; the member is flagged as withdrawn. |
| AC-12 | A promotion triggers a Discord notification to the member and a post to the configured channel. If Discord delivery fails, the promotion is still committed, the failure is recorded, and delivery is retried. |
| AC-13 | An admin can undo an auto-backfill; the audit log records it and the displaced member returns to reserves at their original position. |
| AC-14 | Admin page: an admin can manage auctions, edit members, deactivate, see incomplete members, set capacity and layout and backfill per activity, manage jobs, and read the audit log. A non-admin gets a permission error for each. No UI or API grants admin. |
| AC-15 | Dates, occurrences, and week boundaries follow Asia/Bangkok with Monday as the first day. |

## 9. Scope

**In scope**
- Discord OAuth login; bot registration and deactivation endpoints with their own auth.
- Member, job, and activity management (admin).
- Auction type 1 and type 2, admin-created catalog and rounds, draft type-1 round from leftovers.
- Weekly registration with `leave`, optional registration capacity and waitlist.
- Per-activity team planner with data-driven layout, Sub room, reserves, and per-activity auto-backfill.
- Discord notification on reserve promotion (member message, guild-channel post).
- Audit log with a read-only admin view.
- ER schema, API design, frontend change list (architect deliverables).

**Out of scope**
- The Discord bot's own internal logic (commands, its message handling).
- Discord role sync; admin grant by UI or API.
- Websockets or required push (polling is acceptable; architect may choose SSE).
- Notifications other than reserve promotion (FR-6.6).
- Game-client integration; multi-guild support; payments or trading.
- Page holds from the old frontend auction UI [DEFAULT].
- Item image file upload. v1 uses an admin-pasted URL; upload is a later phase [CONFIRMED].

**Frontend changes implied** (for the architect's change list)
- Replace mock state with API calls and key everything by member id.
- Replace hardcoded A/B x 8 x 5 with per-activity room layouts (Main/Sub etc.).
- Auction UI: replace 200 generic items and page holds with categories, per-round items, queues, ranked preference entry; default duration 5 minutes.
- Attendance UI: add waitlisted and reserve displays; keep `leave`.
- Remove admin "add member" and "delete member" (bot creates; admin deactivates), and hide the "grant admin" control.
- Show reserves and an undo action for auto-backfills in the planner; handle mostly-empty rooms (Guild League has 150 slots and the roster is about 76 members).
- Login: real Discord OAuth; show the "not registered" error state.

## 10. Non-functional constraints

- Server-side time and authorization everywhere; transactional claim, promotion, and backfill.
- Load target: about 80 concurrent members clicking during a type-1 round [DEFAULT].
- Type-2 allocation is replayable from stored inputs.
- Notification delivery is decoupled from the promotion transaction (FR-6.4).
- API errors return stable error codes; the frontend handles Thai and English text [DEFAULT].

## 11. Data the system must hold (for the architect; not a schema)

Members (id, Discord id, in-game name, nickname, job, active, isAdmin), jobs, activities (settings: registration capacity, backfill flag, notification channel), layouts (rooms, teams, team size), occurrences, registrations (status, registration time), plans and slots, auction rounds, items, type-1 claims, type-2 queue entries, preference lists, allocations, notification outbox, audit log.

## 12. Assumptions and open items (each with its default)

| ID | Item | Default so design is not blocked | Tag |
|---|---|---|---|
| A-1 | Auto-backfill only for Polarity Zone by default; OFF for Guild League, Mirror World, Castle Siege (per-activity setting). Resolved. | An admin can switch it on per activity. No architecture impact. | [CONFIRMED] |
| A-2 | Guild League has no registration cap. Main 60 and Sub 90 are planner limits (150 total); extras are unplaced reserves. | Registration capacity is null. An admin can set a cap later. | [ASSUMPTION] |
| A-3 | Team structure 12 x 5 (Guild League Main), 18 x 5 (Sub), 10 x 5 (Polarity Zone) is a proposed structure that divides the confirmed capacities evenly. | Editable data. | [DEFAULT] |
| O-1 | Mirror World and Castle Siege team sizes: the user is researching them. | 8 teams x 5 members. | Open |
| O-2 | Roster size is about 76 members but Guild League capacity is 150. Are those game room limits rather than a fill target? | Treated as limits; most slots are empty. | Open (low risk) |
| O-3 | Can the existing Discord bot expose an inbound HTTP endpoint to receive notification events from the backend? (DM to the promoted member plus a channel post via an outbox is already confirmed.) | Design for an inbound endpoint. Fallbacks if the bot cannot: a Discord webhook for channel posts, and the bot polling a backend endpoint for pending DMs. The architect should keep the outbox compatible with both. | Open |
| O-4 | Does a promoted member also need a Discord notification when the promotion is later undone by an admin? | No. | Open (low risk) |
| O-5 | Should the guild be told when an occurrence has reserves left over but no vacancy? | No notification. | Open (low risk) |
| O-6 | Guild League Main: is entry restricted to appointed "elite" members? (Web sources say so; unverified for the Thai server.) | No restriction; admins place freely. No elite flag. | Open |
| O-7 | Type-1 release semantics: may a member release their own claim during the window? | Yes; the item reopens. | [DEFAULT], confirm |
| O-8 | Leftover definition includes items members listed but lost out on. | Yes, all unallocated items. | [DEFAULT], confirm |
| O-9 | Result visibility for type 2: winners published to all at close; lists private. | As stated. | [DEFAULT], confirm |
| O-10 | Members with incomplete optional data (for example no nickname) can log in. An invalid or missing job is rejected (FR-1.11), so it is not part of this flow. Consequence: the "incomplete members" admin list will mostly hold missing-nickname or admin-edited records. | Yes, flagged. | [DEFAULT], confirm |
| O-11 | Bot-driven deactivation when a member leaves Discord. | Supported. | [DEFAULT], confirm |
| O-12 | Registration cut-off for members: until the occurrence starts. | As stated. | [DEFAULT], confirm |
| O-13 | Auto-backfill window: until occurrence start. Resolved. | As stated. | [CONFIRMED] |
| O-14 | Auction duration is 5 minutes with per-round admin override, no mid-round extension. | As stated. | [DEFAULT], confirm |
| O-15 | Polling (1 to 2 s) is acceptable instead of push. | Polling. | [DEFAULT], confirm |
| O-16 | Whether a member on reserve who is registered but on `leave` is skipped for backfill. | Skipped (not eligible). | [CONFIRMED] by the eligibility rule in FR-5.13 |
| O-17 | Default Discord channel id for reserve-promotion posts. | Not set. No channel post is made until an admin configures it. | Open |

## 13. Change log and decisions

| # | Decision | Source | Supersedes |
|---|---|---|---|
| D-1 | Worked example corrected: A=(1,3), B=(1,3), C=(3,2) gives A:1, B:3, C:2. | User | Original brief, which contradicted itself |
| D-2 | Queue after allocation is D, E, A, B, C (all winners to the tail, in previous order). | User | Earlier draft AC-4 |
| D-3 | Management is an admin flag in the DB, set manually. No Discord role sync. | User | |
| D-4 | Type-2 queue order is time of join press; winners re-enter at the tail; queues per category. | User | |
| D-5 | Type 2: at most 1 win per category per round. | User | |
| D-6 | "Guild War" means Guild League (Main and Sub rooms). | User | |
| D-7 | Type 1 is a live 5-minute race, winner shown immediately, cap 5 per round per person. | User | |
| D-8 | Login is Discord-only; the bot registers members through a separately authenticated endpoint; unregistered users cannot log in. | User | Frontend mock sign-in |
| D-9 | Admin creates rounds and items. | User | |
| D-10 | Keep `leave`. | User | |
| D-11 | Asia/Bangkok, Monday start. | User | Browser-local time in the frontend |
| D-12 | Team planning applies to Mirror World, Guild League, Castle Siege, Polarity Zone. | User | |
| D-13 | Room capacities: Guild League Main 60, Sub 90; Polarity Zone 50. Sub is a tracked room. Layouts are data. | User | Earlier draft of 50 for Main and an implicit Sub |
| D-14 | Proposed structures 12 x 5, 18 x 5, 10 x 5; 8 x 5 remains for Mirror World and Castle Siege until researched. | User (capacities), PO (structure) | Frontend's single A/B x 8 x 5 layout |
| D-15 | Admin page is kept and expanded (auctions, members, activity settings, jobs, audit log). No admin grant. | User | Earlier default of hiding the page and "audit log data only" |
| D-16 | Polarity Zone has no registration cap; unplaced registrants are reserves in registration order. | User | Earlier open question on Polarity Zone 50 |
| D-17 | Auto-backfill on withdrawal (unregister or leave), atomic, idempotent, audit-logged; admin can undo. | User (behavior), PO (undo, timing) | |
| D-18 | Auto-backfill is a per-activity setting: ON for Polarity Zone, OFF elsewhere. | User (Polarity Zone ON, others OFF confirmed in v5) | |
| D-19 | Discord notification on reserve promotion is in scope, and must not block or roll back the promotion. | User | Earlier "notifications out of scope" |
| D-20 | Guild League has no registration cap by default; capacity is a nullable per-activity setting. | Main assistant [ASSUMPTION], still to be confirmed | Earlier waitlist-for-Guild-League idea |
| D-21 | The guild is named Clover_TH. The repository and project folder stay named Cover_TH. | User | Ambiguous naming in earlier drafts |
| D-22 | A bot payload with an invalid job is rejected: no member is created and they cannot log in. An omitted job is treated the same. The incomplete-member flow covers only missing optional data (for example nickname) or records created or edited by other means. | User (invalid job), PO (omitted job, consequence) | Earlier default that invalid data creates an "incomplete" member |
| D-23 | Approved as-is: Polarity Zone reserve and auto-backfill rules; a `leave` to joined toggle resets registration time (back of the reserve queue); no backfill after occurrence start; a withdrawing placed member is always removed from the slot even with no reserve; auto-backfill only for Polarity Zone by default; admin can undo a backfill; leaving a queue during an open window loses eligibility for that round; deactivation removes future registrations and placements. | User | Corresponding [DEFAULT] items in v4 |
| D-24 | Notification delivery through an outbox: DM to the promoted member plus a post to an admin-configurable channel (channel id set later as configuration). | User | v4 O-3 (partly) |
| D-25 | Item images in v1 are a URL pasted by the admin. File upload is a later phase. | User | |
| D-26 | Still open: whether the existing bot can expose an inbound HTTP endpoint (fallbacks: webhook for channel posts, bot polls a backend endpoint for DMs), and the default Discord channel id. | Open | |
