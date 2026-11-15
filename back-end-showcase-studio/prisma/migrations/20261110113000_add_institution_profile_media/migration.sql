-- Extends the existing multi-institution domain with public profile content.
-- All new fields are nullable or have defaults so this migration is safe for
-- the published catalogue and does not rewrite Project records.
CREATE TYPE "InstitutionMediaType" AS ENUM ('IMAGE', 'VIDEO');

ALTER TABLE "Institution" ADD COLUMN "description" TEXT;

CREATE TABLE "InstitutionMedia" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "type" "InstitutionMediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstitutionMedia_institutionId_sortOrder_idx"
ON "InstitutionMedia"("institutionId", "sortOrder");

ALTER TABLE "InstitutionMedia"
ADD CONSTRAINT "InstitutionMedia_institutionId_fkey"
FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
