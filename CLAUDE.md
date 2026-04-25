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


## Governance Reference
See: `Master/knowledge/MASTER_SYSTEM.md` §1-§5. This project follows Master governance; do not duplicate rules.
