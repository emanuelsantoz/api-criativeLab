-- Feedback opcional, associado à submissão e não a uma conta de visitante.
CREATE TYPE "SubmissionFeedbackEase" AS ENUM ('VERY_EASY', 'EASY', 'DIFFICULT', 'VERY_DIFFICULT');
CREATE TYPE "SubmissionFeedbackExperience" AS ENUM ('PERFECT', 'GOOD', 'BAD', 'VERY_BAD');
CREATE TYPE "SubmissionFeedbackHardestStep" AS ENUM ('COURSE_CLASS', 'PROJECT_INFORMATION', 'TEAM_MEMBERS', 'MEDIA_UPLOAD', 'PROJECT_LINKS', 'NO_DIFFICULTY', 'OTHER');
CREATE TYPE "SubmissionFeedbackUnderstanding" AS ENUM ('YES_COMPLETELY', 'YES_PARTIALLY', 'NO');
CREATE TYPE "SubmissionFeedbackReuseIntent" AS ENUM ('DEFINITELY', 'PROBABLY', 'MAYBE', 'PROBABLY_NOT', 'WOULD_NOT_USE');

CREATE TABLE "SubmissionFeedback" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requiredInformationEase" "SubmissionFeedbackEase" NOT NULL,
  "overallExperience" "SubmissionFeedbackExperience" NOT NULL,
  "hardestStep" "SubmissionFeedbackHardestStep" NOT NULL,
  "hardestStepOther" VARCHAR(160),
  "understoodNextSteps" "SubmissionFeedbackUnderstanding" NOT NULL,
  "reuseIntent" "SubmissionFeedbackReuseIntent" NOT NULL,
  "improvementSuggestion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubmissionFeedback_projectId_key" ON "SubmissionFeedback"("projectId");
CREATE INDEX "SubmissionFeedback_createdAt_idx" ON "SubmissionFeedback"("createdAt");

ALTER TABLE "SubmissionFeedback"
  ADD CONSTRAINT "SubmissionFeedback_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
