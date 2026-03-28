# Project Status - 4PRO Identity Service

Last Updated: 2026-03-27

## Current State
- Neon PostgreSQL database `identity_service_db` provisioned and running
- Tables `Identity` and `PhoneChangeLog` created with correct schema
- Indexes: unique on `Identity.phone`, index on `PhoneChangeLog.globalId`
- Dedicated user `identity_service_user` with SELECT/INSERT/UPDATE only
- Neon built-in connection pooling active (project default)
- Neon automated backups enabled (daily snapshots, 7-day retention)
- Prisma 7 schema validated
- Database connectivity verified from local environment
- **Identity Service API running on port 4100** (Fastify + Prisma 7)
- All 3 endpoints implemented and integration-tested
- 11 unit tests passing (password, validation, token)

## Phase 1 Deliverables - COMPLETE
- [x] Neon project created: `4PRO-Identity-Service` (billowing-surf-59639801)
- [x] Database: `identity_service_db` on PostgreSQL 17
- [x] SQL schema file: `db/schema.sql`
- [x] `.env` with `IDENTITY_DB_URL` connection string
- [x] `.env.example` with placeholder credentials
- [x] Restricted user `identity_service_user` with read/write grants
- [x] Prisma schema: `prisma/schema.prisma`
- [x] Validation script passed: `node db/validate.js`
- [x] Credentials synced to Master: `C:\Projects\Master\credentials\4pro-identity.env`

## Phase 2 Deliverables - COMPLETE
- [x] Fastify server on port 4100
- [x] POST /identities — Register identity (E.164 phone validation, bcrypt cost=12, duplicate rejection)
- [x] POST /authenticate — Verify phone+password, set SSO cookie (JWT 24h, HttpOnly, Secure, SameSite=Lax, domain=4pro.io)
- [x] GET /identities/:globalId — Fetch identity (authenticated via SSO cookie, own-identity-only access)
- [x] Input validation and sanitization (E.164, password length)
- [x] Failed auth attempt logging (phone logged, password excluded)
- [x] Environment variables: JWT_SECRET, COOKIE_DOMAIN, IDENTITY_PORT
- [x] Unit tests: password hashing/verification (5), phone validation (3), JWT sign/verify (3)
- [x] Postman collection: `postman/4pro-identity-api.json`

## Project Structure
```
C:\Projects\4pro-identity\
├── .env                  # Real credentials (gitignored)
├── .env.example          # Template
├── package.json
├── vitest.config.js
├── db/
│   ├── schema.sql
│   ├── run-schema.js
│   ├── grant-permissions.js
│   └── validate.js
├── prisma/
│   ├── schema.prisma
│   └── prisma.config.ts
├── src/
│   ├── server.js         # Fastify app entry point
│   ├── lib/
│   │   ├── password.js   # bcrypt hash/verify (cost=12)
│   │   ├── prisma.js     # Prisma client with PrismaPg adapter
│   │   ├── token.js      # JWT sign/verify (24h expiry)
│   │   └── validation.js # E.164 phone validation/sanitization
│   └── routes/
│       ├── authenticate.js  # POST /authenticate
│       └── identities.js    # POST /identities, GET /identities/:id
├── tests/
│   ├── password.test.mjs
│   ├── token.test.mjs
│   └── validation.test.mjs
└── postman/
    └── 4pro-identity-api.json
```

## Technical Notes
- Prisma 7 no longer supports `url` in datasource block; connection URL goes in `prisma.config.ts`
- Prisma 7 client engine requires adapter — using `@prisma/adapter-pg` with `pg` Pool
- `@default(dbgenerated("gen_random_uuid()"))` used for UUID generation (not `cuid()`)
- Neon uses built-in connection pooling at project level; no separate PgBouncer setup needed
- SSL mode `require` maps to `verify-full` in current pg driver (warning expected)
- Environment var `IDENTITY_PORT` used instead of `PORT` to avoid conflicts with system PORT
- bcrypt embeds salt in hash; salt column stores extracted salt prefix for schema compliance
