-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PROTOCOL', 'STUDY_DESIGN', 'REGULATORY', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "disease" TEXT,
    "country" TEXT,
    "region" TEXT,
    "protocolId" TEXT,
    "documentType" TEXT,
    "content" TEXT NOT NULL,
    "cmcSection" TEXT,
    "clinicalSection" TEXT,
    "sections" JSONB,
    "userId" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
