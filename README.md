# Clover_TH Guild Item Reservation

Frontend for the Clover_TH Ragnarok: The New World guild auction queue.

## Features

- Discord login gate (mocked locally until the backend OAuth callback is connected)
- Uses the signed-in Discord display name as the reservation name
- Displays 4 items per selected page (200 items total across 50 pages)
- Uses a popup page selector showing Pages 1-25, with a next set for Pages 26-50
- Supports per-page holds; all pages start open and the admin chooses which pages to hold
- Admin can lock/unlock a page and release only held pages after the first round
- Admin can manage multiple pages at once with comma-separated input such as `4, 5, 15`
- Admin can open the Admin Config view from the header badge and assign admin access to guild members
- Auction starts locked; after setting the duration, Admin must press Start round and wait for the 3-2-1 countdown before reservations open
- Reserve available items and update the live claimed count
- Reservation summary grouped by guild member
- Copy the summary list for Discord
- Responsive layout for desktop and mobile

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

## Backend integration points

The Discord sign-in and admin role are still mocked locally until the backend OAuth callback and role check are connected. The in-game name is currently populated from the signed-in profile state, not typed by the user. The item list starts empty with no seeded reservations; hydrate `items`, `reservations`, `roundNumber`, `timeLeft`, and `isAuctionLocked` from the API. Send reservation/removal actions from `claimItem` to the backend, where the timer and admin lock must be enforced again.
