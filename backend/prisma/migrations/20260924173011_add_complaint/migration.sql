-- CreateTable
CREATE TABLE "Complaint" (
    "id" SERIAL NOT NULL,
    "memberId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Complaint_memberId_createdAt_idx" ON "Complaint"("memberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Complaint_createdAt_idx" ON "Complaint"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
