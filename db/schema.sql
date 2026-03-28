-- 4PRO Identity Service - Database Schema
-- Database: identity_service_db
-- Neon Project: 4PRO-Identity-Service (billowing-surf-59639801)
-- Created: 2026-03-27

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Identity table: core user identity across all 4PRO apps
CREATE TABLE "Identity" (
  "globalId"       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone"          VARCHAR(20) UNIQUE NOT NULL,
  "hashedPassword" VARCHAR(255) NOT NULL,
  "salt"           VARCHAR(255) NOT NULL,
  "createdAt"      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt"      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PhoneChangeLog: audit trail for phone number changes
CREATE TABLE "PhoneChangeLog" (
  "id"         SERIAL PRIMARY KEY,
  "globalId"   UUID REFERENCES "Identity"("globalId") ON DELETE CASCADE,
  "oldPhone"   VARCHAR(20) NOT NULL,
  "newPhone"   VARCHAR(20) NOT NULL,
  "changedAt"  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "approvedBy" UUID  -- NULL if system-initiated (e.g., migration)
);

-- Indexes
CREATE INDEX idx_phone_change_log_global_id ON "PhoneChangeLog"("globalId");
