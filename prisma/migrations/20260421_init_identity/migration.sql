-- CreateEnum
CREATE TYPE "UserDocumentType" AS ENUM ('CI', 'PERMIS_CONDUCERE', 'PASAPORT', 'CERTIFICAT_MEDICAL', 'CARD_SANATATE', 'ALT');

-- CreateTable
CREATE TABLE IF NOT EXISTS "Identity" (
    "globalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "hashedPassword" VARCHAR(255),
    "email" TEXT,
    "firstName" VARCHAR(100) NOT NULL DEFAULT '',
    "lastName" VARCHAR(100) NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ro',
    "forcePasswordSet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("globalId")
);

-- CreateTable (UserDocument — Phase 6)
CREATE TABLE IF NOT EXISTS "UserDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "UserDocumentType" NOT NULL,
    "fileUrl" TEXT,
    "allowedScopes" TEXT[],
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PhoneChangeLog" (
    "id" SERIAL NOT NULL,
    "globalId" UUID NOT NULL,
    "oldPhone" VARCHAR(20) NOT NULL,
    "newPhone" VARCHAR(20) NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,

    CONSTRAINT "PhoneChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Identity_phone_key" ON "Identity"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Identity_email_key" ON "Identity"("email");
CREATE INDEX IF NOT EXISTS "UserDocument_userId_idx" ON "UserDocument"("userId");
CREATE INDEX IF NOT EXISTS "PhoneChangeLog_globalId_idx" ON "PhoneChangeLog"("globalId");

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Identity"("globalId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneChangeLog" ADD CONSTRAINT "PhoneChangeLog_globalId_fkey" FOREIGN KEY ("globalId") REFERENCES "Identity"("globalId") ON DELETE CASCADE ON UPDATE CASCADE;
