-- An admin may create a live-claim round without tagging every item; an untagged item has no category.
-- Queue-ranked rounds still require Gear/Card/Relic on every item (enforced in the app, see assertCategoriesForType).
ALTER TABLE "AuctionItem" ALTER COLUMN "category" DROP NOT NULL;
