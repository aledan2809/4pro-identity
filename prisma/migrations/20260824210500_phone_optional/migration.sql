-- Identity.phone becomes optional: email-only identities (eCabinet public
-- registration) need to exist. Unique constraint stays — Postgres allows
-- multiple NULLs on a unique column.
ALTER TABLE "Identity" ALTER COLUMN "phone" DROP NOT NULL;
