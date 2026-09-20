-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberSource" AS ENUM ('BOT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AuctionType" AS ENUM ('LIVE_CLAIM', 'QUEUE_RANKED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('PET', 'MATERIAL', 'GEMBOX', 'GEAR', 'CARD', 'RELIC');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('JOINED', 'WAITLISTED', 'LEAVE');

-- CreateEnum
CREATE TYPE "WinSource" AS ENUM ('CLAIM', 'ALLOCATION');

-- CreateEnum
CREATE TYPE "PlacementSource" AS ENUM ('ADMIN', 'COPY', 'AUTO_BACKFILL');

-- CreateEnum
CREATE TYPE "BackfillReason" AS ENUM ('UNREGISTERED', 'LEAVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('MEMBER', 'BOT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotifyTarget" AS ENUM ('DISCORD_DM', 'DISCORD_CHANNEL');

-- CreateEnum
CREATE TYPE "NotifyStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DEAD');

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "discordId" TEXT NOT NULL,
    "ign" TEXT NOT NULL,
    "nickname" TEXT,
    "jobId" INTEGER NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "source" "MemberSource" NOT NULL DEFAULT 'BOT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isGuild" BOOLEAN NOT NULL DEFAULT false,
    "hasPlanner" BOOLEAN NOT NULL DEFAULT false,
    "registrationCapacity" INTEGER,
    "autoBackfill" BOOLEAN NOT NULL DEFAULT false,
    "notifyChannelId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" SERIAL NOT NULL,
    "occurrenceId" INTEGER NOT NULL,
    "memberId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" SERIAL NOT NULL,
    "activityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 5,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" SERIAL NOT NULL,
    "occurrenceId" INTEGER NOT NULL,
    "memberId" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "source" "PlacementSource" NOT NULL DEFAULT 'ADMIN',
    "backfilledForMemberId" UUID,
    "backfillReason" "BackfillReason",
    "placedById" UUID,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionRound" (
    "id" SERIAL NOT NULL,
    "type" "AuctionType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "durationSec" INTEGER NOT NULL DEFAULT 300,
    "winCap" INTEGER,
    "startDelaySec" INTEGER NOT NULL DEFAULT 3,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "allocatedAt" TIMESTAMP(3),
    "algorithmVersion" INTEGER,
    "sourceRoundId" INTEGER,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionItem" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "winnerId" UUID,
    "wonAt" TIMESTAMP(3),
    "winSource" "WinSource",
    "queuePos" INTEGER,

    CONSTRAINT "AuctionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" SERIAL NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "memberId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundQueueCutoff" (
    "roundId" INTEGER NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "cutoffId" INTEGER NOT NULL,

    CONSTRAINT "RoundQueueCutoff_pkey" PRIMARY KEY ("roundId","category")
);

-- CreateTable
CREATE TABLE "RoundQueueSnapshot" (
    "roundId" INTEGER NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "memberId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RoundQueueSnapshot_pkey" PRIMARY KEY ("roundId","category","memberId")
);

-- CreateTable
CREATE TABLE "Preference" (
    "roundId" INTEGER NOT NULL,
    "memberId" UUID NOT NULL,
    "itemId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("roundId","memberId","itemId")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" SERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "target" "NotifyTarget" NOT NULL,
    "recipientMemberId" UUID,
    "recipientDiscordId" TEXT,
    "channelId" TEXT,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" "NotifyStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "requestId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_label_key" ON "Job"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Member_discordId_key" ON "Member"("discordId");

-- CreateIndex
CREATE INDEX "Session_memberId_idx" ON "Session"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Occurrence_eventId_date_key" ON "Occurrence"("eventId", "date");

-- CreateIndex
CREATE INDEX "Registration_occurrenceId_status_registeredAt_idx" ON "Registration"("occurrenceId", "status", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_occurrenceId_memberId_key" ON "Registration"("occurrenceId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_occurrenceId_memberId_key" ON "Placement"("occurrenceId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_occurrenceId_teamId_slot_key" ON "Placement"("occurrenceId", "teamId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionRound_sourceRoundId_key" ON "AuctionRound"("sourceRoundId");

-- CreateIndex
CREATE INDEX "AuctionItem_roundId_winnerId_idx" ON "AuctionItem"("roundId", "winnerId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_category_memberId_key" ON "QueueEntry"("category", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Preference_roundId_memberId_rank_key" ON "Preference"("roundId", "memberId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_entityType_entityId_idx" ON "NotificationOutbox"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_backfilledForMemberId_fkey" FOREIGN KEY ("backfilledForMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionRound" ADD CONSTRAINT "AuctionRound_sourceRoundId_fkey" FOREIGN KEY ("sourceRoundId") REFERENCES "AuctionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionRound" ADD CONSTRAINT "AuctionRound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AuctionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundQueueCutoff" ADD CONSTRAINT "RoundQueueCutoff_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AuctionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundQueueSnapshot" ADD CONSTRAINT "RoundQueueSnapshot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AuctionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundQueueSnapshot" ADD CONSTRAINT "RoundQueueSnapshot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AuctionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AuctionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

