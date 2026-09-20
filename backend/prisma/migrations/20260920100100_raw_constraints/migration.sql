-- Constraints Prisma cannot express (design 4.2 / 4.4).
-- DO NOT regenerate or edit casually: scripts/check-raw-migrations.sh greps for every statement below.

-- IGN is unique among ACTIVE members, case-insensitively and NFC-normalized (FR-1.10).
-- normalize() is IMMUTABLE on PostgreSQL 13+, so it is allowed in an index expression. Requires a UTF8 database.
CREATE UNIQUE INDEX "member_ign_active" ON "Member" (lower(normalize("ign", NFC))) WHERE "isActive";

-- Only one OPEN round per auction type.
CREATE UNIQUE INDEX "one_open_per_type" ON "AuctionRound" ("type") WHERE "status" = 'OPEN';

-- An archived room's key can be re-created.
CREATE UNIQUE INDEX "room_key_live" ON "Room" ("activityId", "key") WHERE "archivedAt" IS NULL;

ALTER TABLE "Activity" ADD CONSTRAINT "activity_backfill_requires_planner" CHECK (NOT "autoBackfill" OR "hasPlanner");
ALTER TABLE "Placement" ADD CONSTRAINT "placement_slot_positive" CHECK ("slot" >= 1);
ALTER TABLE "AuctionRound" ADD CONSTRAINT "round_wincap_only_live_claim" CHECK (("type" = 'LIVE_CLAIM') = ("winCap" IS NOT NULL));
ALTER TABLE "AuctionItem" ADD CONSTRAINT "item_winner_matches_wonat" CHECK (("winnerId" IS NULL) = ("wonAt" IS NULL));
