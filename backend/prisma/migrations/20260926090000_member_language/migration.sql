-- The UI language a member picked last ('en' or 'th'); NULL until they switch it once.
ALTER TABLE "Member" ADD COLUMN "language" TEXT;
ALTER TABLE "Member" ADD CONSTRAINT "Member_language_check" CHECK ("language" IN ('en', 'th'));
