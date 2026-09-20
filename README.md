# Clover_TH Guild Item Reservation

Frontend for the Clover_TH Ragnarok: The New World guild auction queue.

## Features

- Discord login gate (mocked locally until the backend OAuth callback is connected)
- Uses the signed-in Discord display name as the reservation name (must match a roster name for queue eligibility)
- Displays 4 items per selected page (200 items total across 50 pages)
- Uses a popup page selector showing Pages 1-25, with a next set for Pages 26-50
- Admin tags pages as Gear / Card / Relic ("Tag pages": tick pages, press a category, Save); untagged pages stay normal first-come reservations
- On tagged pages only members in that category's queue can claim: one member per slot, one slot per category per round (a claim can be moved to another free slot), first come first served
- When the round ends (timer or "End round & resolve") every slot holder wins, is added to the reservation summary and leaves that queue; members who claimed nothing keep their queue spot
- After a round an admin can mark a winner who did not buy in game as "Passed", which logs it and frees the slot
- Admins get an "Admin config" tab (also reachable from the ADMIN badge menu, `#admin`) to grant or remove admin access for guild members; non-admins are redirected away from it
- Auction starts locked; after setting the duration, Admin must press Start round and wait for the 3-2-1 countdown before reservations open
- Reserve available items and update the live claimed count; each member can hold at most 5 reservations per session (counter on the round card, Reserve buttons disable at the cap)
- Admins can switch to the User view to preview it and switch back from the USER badge menu
- Reservation summary grouped by guild member
- Copy the summary list for Discord
- Responsive layout for desktop, tablet (iPad portrait/landscape) and phone; the weekly grid scrolls sideways on narrow screens and auto-centres on today
- Auction queue tab: members queue up for Gear / Card / Relic (any or all), see their position, which pages are tagged this round and their current claim; history log of every win/pass
- Weekly activity schedule on real calendar dates (Tuesday, Thursday and Sunday activities are highlighted as guild days) (all activity cards share one neutral style; a hammer marks guild activities) (Mon-Sun x time slots, matching the in-game activity board) with previous/next week and Today navigation; today's column is highlighted
- Members tap an activity to register as playing or mark leave; admins can record playing/leave for any member and clear entries; each card shows the playing/leave count
- "Registrations by date" summary under the grid lists who is playing and who is on leave per event per day, with a copy-for-Discord button
- Guild team planner: Team A and Team B, 8 subteams each, 5 members per subteam; admins drag member cards (coloured by job) into subteams, or tap a card then tap a subteam on touch devices; everyone can view and copy the plan for Discord
- Admins can add a new member (name + job), and edit any member from the pencil icon on its card: rename, change job/colour, or delete members they added; renames follow the member into team assignments and attendance
- Admins manage the job list ("Manage jobs" / "Edit jobs" on the chart): rename a job, pick any colour, add new jobs, delete unused ones; changes are drafted and applied on Save (Cancel discards), then every card, swatch and chart row updates
- Each subteam card has a "type a name to add" box for admins: type part of a name, pick from the unassigned matches (or press Enter for the first match) to place the member without hunting for the card
- Members-per-job bar chart (in a subteam vs. unassigned) on the team planner
- Tabs are deep-linkable via `#calendar` and `#teams`

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Build and lint

```bash
cd frontend
npm run build
npm run lint
```

## Guild data

Roster, default jobs and the weekly event list live in `frontend/src/data/guild.ts` (`defaultJobs`, `guildMembers`, `scheduleEvents`). Default job colours follow the in-game class icons; at runtime jobs are state in `App.tsx` (`jobs`) and each card gets its colour through `jobStyle()`, which also picks dark or light text for readability.

## Scope: frontend only

This repo is the UI. The backend/database is built separately; everything below is mock state inside `App.tsx` and should be swapped for API calls. The state shapes the backend needs to provide/accept:

| State | Shape | Used by |
|---|---|---|
| `members` | `{ name, job, custom? }[]` | roster, team planner, schedule admin picker |
| `jobs` | `{ id, label, color }[]` | card colours, chart, job manager |
| `teamAssignments` | `{ [memberName]: "A-3" }` | team planner |
| `queues` / `categoryClaims` / `slotRankings` / `queueLog` | `{ gear|card|relic: { member, joinedAt }[] }`, claims `{ category: { member: itemId } }`, rankings per slot at resolution, outcome log | auction queue + tagged pages |
| `pageCategories` | `{ [page]: "gear" \| "card" \| "relic" }` | tagged auction pages |
| `attendance` | `{ ["YYYY-MM-DD:eventId"]: { [memberName]: "joined" \| "leave" } }` | schedule, roster by date |
| `scheduleEvents` | static weekly template in `data/guild.ts` | schedule grid |
| auth | `isAuthenticated`, `userName`, `isAdmin` (mocked by the Sign in button as roster member "Gantzping") | every admin-only control |

## Backend integration points

The Discord sign-in and admin role are still mocked locally until the backend OAuth callback and role check are connected. The in-game name is currently populated from the signed-in profile state, not typed by the user. The item list starts empty with no seeded reservations; hydrate `items`, `reservations`, `roundNumber`, `timeLeft`, and `isAuctionLocked` from the API. Send reservation/removal actions from `claimItem` to the backend, where the timer and admin lock must be enforced again. Attendance (`attendance`, keyed by `YYYY-MM-DD:eventId` then member name) team assignments (`teamAssignments`, member name to subteam such as `A-3`), the editable roster (`members`) and the job list (`jobs`) are in-memory only and should be hydrated from and persisted to the API as well.
