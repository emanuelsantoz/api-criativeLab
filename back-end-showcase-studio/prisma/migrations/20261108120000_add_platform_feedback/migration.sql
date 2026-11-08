CREATE TYPE "PlatformFeedbackType" AS ENUM ('SUGGESTION', 'PROBLEM', 'PRAISE');

CREATE TYPE "PlatformFeedbackTopic" AS ENUM ('SUBMISSION_FORM', 'SUPPORT_CHANNEL', 'SEARCH_SYSTEM', 'PROJECT_EVALUATION');

CREATE TABLE "PlatformFeedback" (
  "id" TEXT NOT NULL,
  "visitorHash" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "rating" INTEGER,
  "type" "PlatformFeedbackType" NOT NULL,
  "topic" "PlatformFeedbackTopic" NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformFeedback_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5))
);

CREATE UNIQUE INDEX "PlatformFeedback_visitorHash_day_key" ON "PlatformFeedback"("visitorHash", "day");
CREATE INDEX "PlatformFeedback_createdAt_idx" ON "PlatformFeedback"("createdAt");
CREATE INDEX "PlatformFeedback_topic_idx" ON "PlatformFeedback"("topic");
