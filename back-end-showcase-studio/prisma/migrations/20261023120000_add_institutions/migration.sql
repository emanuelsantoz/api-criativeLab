-- Release 1: introduces the multi-institution domain without removing legacy
-- semester/course fields. Existing records are attached to a default institution.
CREATE TYPE "InstitutionRole" AS ENUM ('INSTITUTION_ADMIN', 'COORDINATOR', 'PROFESSOR');
CREATE TYPE "SubmissionContextStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');
CREATE TYPE "SubmissionScope" AS ENUM ('INSTITUTION', 'COURSE', 'DISCIPLINE');

CREATE TABLE "InstitutionType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstitutionType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "institutionTypeId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionMembership" (
    "institutionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "InstitutionRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstitutionMembership_pkey" PRIMARY KEY ("institutionId", "userId")
);

CREATE TABLE "AcademicPeriod" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AcademicPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseDiscipline" (
    "courseId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "recommendedPeriod" INTEGER,
    "required" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CourseDiscipline_pkey" PRIMARY KEY ("courseId", "disciplineId")
);

CREATE TABLE "SubmissionContext" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "courseId" TEXT,
    "disciplineId" TEXT,
    "scope" "SubmissionScope" NOT NULL,
    "status" "SubmissionContextStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "className" TEXT,
    "theme" TEXT,
    "submissionsOpenAt" TIMESTAMP(3),
    "submissionsCloseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubmissionContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionContextTag" (
    "submissionContextId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "SubmissionContextTag_pkey" PRIMARY KEY ("submissionContextId", "tagId")
);

ALTER TABLE "Course" ADD COLUMN "institutionId" TEXT;
ALTER TABLE "Project" ADD COLUMN "submissionContextId" TEXT;

-- A deterministic legacy tenant makes the migration safe for every existing deployment.
INSERT INTO "InstitutionType" ("id", "name", "slug", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Legado', 'legado', CURRENT_TIMESTAMP);
INSERT INTO "Institution" ("id", "name", "slug", "institutionTypeId", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000002', 'Instituição padrão', 'instituicao-padrao', '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP);

UPDATE "Course" SET "institutionId" = '00000000-0000-0000-0000-000000000002' WHERE "institutionId" IS NULL;
ALTER TABLE "Course" ALTER COLUMN "institutionId" SET NOT NULL;

INSERT INTO "InstitutionMembership" ("institutionId", "userId", "role", "updatedAt")
SELECT '00000000-0000-0000-0000-000000000002', "id",
  CASE WHEN "role" = 'ADMIN' THEN 'INSTITUTION_ADMIN'::"InstitutionRole" ELSE 'COORDINATOR'::"InstitutionRole" END,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "role" IN ('ADMIN', 'COORDENADOR');

CREATE UNIQUE INDEX "InstitutionType_name_key" ON "InstitutionType"("name");
CREATE UNIQUE INDEX "InstitutionType_slug_key" ON "InstitutionType"("slug");
CREATE UNIQUE INDEX "Institution_slug_key" ON "Institution"("slug");
CREATE INDEX "Institution_institutionTypeId_idx" ON "Institution"("institutionTypeId");
CREATE INDEX "Institution_active_idx" ON "Institution"("active");
CREATE INDEX "InstitutionMembership_userId_active_idx" ON "InstitutionMembership"("userId", "active");
CREATE UNIQUE INDEX "AcademicPeriod_institutionId_code_key" ON "AcademicPeriod"("institutionId", "code");
CREATE INDEX "AcademicPeriod_institutionId_idx" ON "AcademicPeriod"("institutionId");
CREATE UNIQUE INDEX "Discipline_institutionId_name_key" ON "Discipline"("institutionId", "name");
CREATE UNIQUE INDEX "Discipline_institutionId_code_key" ON "Discipline"("institutionId", "code");
CREATE INDEX "Discipline_institutionId_idx" ON "Discipline"("institutionId");
CREATE INDEX "CourseDiscipline_disciplineId_idx" ON "CourseDiscipline"("disciplineId");
CREATE INDEX "SubmissionContext_institutionId_status_idx" ON "SubmissionContext"("institutionId", "status");
CREATE INDEX "SubmissionContext_academicPeriodId_idx" ON "SubmissionContext"("academicPeriodId");
CREATE INDEX "SubmissionContext_courseId_idx" ON "SubmissionContext"("courseId");
CREATE INDEX "SubmissionContext_disciplineId_idx" ON "SubmissionContext"("disciplineId");
CREATE INDEX "SubmissionContextTag_tagId_idx" ON "SubmissionContextTag"("tagId");
CREATE INDEX "Project_submissionContextId_idx" ON "Project"("submissionContextId");

DROP INDEX "Course_name_key";
CREATE UNIQUE INDEX "Course_institutionId_name_key" ON "Course"("institutionId", "name");
CREATE INDEX "Course_institutionId_idx" ON "Course"("institutionId");

ALTER TABLE "Institution" ADD CONSTRAINT "Institution_institutionTypeId_fkey" FOREIGN KEY ("institutionTypeId") REFERENCES "InstitutionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstitutionMembership" ADD CONSTRAINT "InstitutionMembership_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstitutionMembership" ADD CONSTRAINT "InstitutionMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscipline" ADD CONSTRAINT "CourseDiscipline_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseDiscipline" ADD CONSTRAINT "CourseDiscipline_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionContext" ADD CONSTRAINT "SubmissionContext_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionContext" ADD CONSTRAINT "SubmissionContext_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubmissionContext" ADD CONSTRAINT "SubmissionContext_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubmissionContext" ADD CONSTRAINT "SubmissionContext_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubmissionContextTag" ADD CONSTRAINT "SubmissionContextTag_submissionContextId_fkey" FOREIGN KEY ("submissionContextId") REFERENCES "SubmissionContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionContextTag" ADD CONSTRAINT "SubmissionContextTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_submissionContextId_fkey" FOREIGN KEY ("submissionContextId") REFERENCES "SubmissionContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;
