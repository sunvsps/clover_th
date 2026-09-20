#!/usr/bin/env bash
# Fails if any expected raw-SQL statement is missing from prisma/migrations (design 4.4).
set -euo pipefail
cd "$(dirname "$0")/.."
dir=prisma/migrations
expected=(
  'CREATE UNIQUE INDEX "member_ign_active" ON "Member" (lower(normalize("ign", NFC))) WHERE "isActive"'
  'CREATE UNIQUE INDEX "one_open_per_type" ON "AuctionRound" ("type") WHERE "status" = '
  'CREATE UNIQUE INDEX "room_key_live" ON "Room" ("activityId", "key") WHERE "archivedAt" IS NULL'
  'CONSTRAINT "activity_backfill_requires_planner" CHECK'
  'CONSTRAINT "placement_slot_positive" CHECK'
  'CONSTRAINT "round_wincap_only_live_claim" CHECK'
  'CONSTRAINT "item_winner_matches_wonat" CHECK'
)
ls "$dir"/*_raw_constraints/migration.sql >/dev/null
status=0
for s in "${expected[@]}"; do
  if ! grep -rqF -- "$s" "$dir"/*_raw_constraints/migration.sql; then
    echo "MISSING raw statement: $s" >&2
    status=1
  fi
done
[ $status -eq 0 ] && echo "raw migration statements: all present"
exit $status
