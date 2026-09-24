-- CreateTable
CREATE TABLE "PartyMember" (
    "memberId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,

    CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "PartyMember_slot_idx" ON "PartyMember"("slot");

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Constraint Prisma cannot express (design 4.2 / 4.4); mirrored in scripts/check-raw-migrations.sh.
ALTER TABLE "PartyMember" ADD CONSTRAINT "party_slot_positive" CHECK ("slot" >= 1);
