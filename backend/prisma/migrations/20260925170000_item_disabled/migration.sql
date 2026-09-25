-- An admin can untick items when creating a round: they keep their slot on the board but can't be claimed or ranked.
ALTER TABLE "AuctionItem" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
