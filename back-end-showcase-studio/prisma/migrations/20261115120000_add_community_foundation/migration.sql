-- v1.6.0 — Fundação da comunidade.
-- Mudança aditiva: mantém todos os registros institucionais existentes e
-- permite que novos projetos comunitários não possuam curso ou semestre.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMUNITY_MEMBER';
CREATE TYPE "ProjectOrigin" AS ENUM ('INSTITUTIONAL', 'COMMUNITY');

ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "name" SET DEFAULT 'Membro da comunidade';
ALTER TABLE "User" ADD COLUMN "communityEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Project" ADD COLUMN "origin" "ProjectOrigin" NOT NULL DEFAULT 'INSTITUTIONAL';
ALTER TABLE "Project" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "Project" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "semesterId" DROP NOT NULL;

-- Projetos já publicados recebem uma referência de publicação sem reordenar o
-- acervo histórico: updatedAt é o melhor dado disponível para a migração.
UPDATE "Project"
SET "publishedAt" = "updatedAt"
WHERE "status" = 'APPROVED' AND "publishedAt" IS NULL;

CREATE TABLE "CommunityAccessToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityAccessToken_tokenHash_key" ON "CommunityAccessToken"("tokenHash");
CREATE INDEX "CommunityAccessToken_email_expiresAt_idx" ON "CommunityAccessToken"("email", "expiresAt");
CREATE INDEX "CommunityAccessToken_expiresAt_idx" ON "CommunityAccessToken"("expiresAt");
CREATE INDEX "Project_origin_status_publishedAt_idx" ON "Project"("origin", "status", "publishedAt");
