-- CreateTable
CREATE TABLE IF NOT EXISTS "MagicLink" (
    "id" SERIAL NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "providerPhone" VARCHAR(20) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "MagicLink_providerPhone_idx" ON "MagicLink"("providerPhone");
