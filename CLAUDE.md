# 4pro-identity — JWT Auth & Phone Validation Microservice

## Overview
Authentication microservice for 4PRO ecosystem. JWT tokens, phone validation, user management.

## Stack
- Fastify, Prisma 7, PostgreSQL (Neon), bcrypt
- Testing: Vitest — 11 tests
- Deploy: Local only

## Build & Test
```bash
npm run dev      # Fastify dev server
npm test         # Vitest (11 tests)
```

## DO NOT MODIFY
- JWT token generation/validation
- Phone normalization logic
- Prisma schema without migration plan
- SSO_JWT_SECRET must match across PRO/Client/eCabinet

## Legal Hub integration (Phase 9)
`POST /auth/register` and the new-identity path of `POST /auth/verify-otp` embed
`controllerEntitySlug` in the JWT (via `resolveControllerEntity()`, gated on `LEGAL_API_URL`).

**Stale-slug caveat**: the slug reflects the active entity at signup time. Tokens are valid
for 24h — if the Legal Hub active entity changes during that window, tokens carry a stale
slug. Consumer apps MUST treat `controllerEntitySlug` as a hint only and call
`GET /api/v1/public/active-entity?appSlug=<slug>` on the Legal Hub for authoritative data.

Required env var (add to `/var/www/4pro-identity/.env` on VPS1):
```
LEGAL_API_URL=https://legal.knowbest.ro
```

## Governance Reference
See: `Master/knowledge/MASTER_SYSTEM.md` §1-§5. This project follows Master governance; do not duplicate rules.
