-- A member who never picked a language gets English: no NULL any more.
UPDATE "Member" SET "language" = 'en' WHERE "language" IS NULL;
ALTER TABLE "Member" ALTER COLUMN "language" SET DEFAULT 'en';
ALTER TABLE "Member" ALTER COLUMN "language" SET NOT NULL;
