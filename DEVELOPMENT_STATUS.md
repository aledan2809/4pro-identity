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

---

## TODO — Audit dep discipline în package.json (adăugat 2026-04-22)

**Prioritate:** Medium (risc latent, nu incident activ)
**Status:** OPEN

### De ce este în TODO-ul acestui proiect

Pe 2026-04-22, **procuchaingo2** (procuchain.com) a suferit un outage de ~3 min din următorul bug:

1. Fișierul `apps/web/src/lib/export/pdf.ts` importa `jspdf` și `jspdf-autotable`.
2. Nici unul din cele 2 pachete nu era declarat în `apps/web/package.json`.
3. Deploy-urile anterioare (inclusiv cele care au împins codul în prod timp de 11 zile) au reușit doar pentru că `node_modules` rămăsese cu copii phantom-installed ale acelor pachete dintr-o instalare anterioară.
4. Primul deploy care a folosit `pnpm install --frozen-lockfile` (flag-ul corect pentru prod) a refuzat să instaleze pachete nedeclarate → Next.js build a eșuat → `.next/` a rămas fără `BUILD_ID` → PM2 restart pe build invalid → `curl procuchain.com` returna 502.
5. Recovery a necesitat SSH manual pe VPS2, `pnpm add jspdf@... jspdf-autotable@...`, rebuild, restart.

### De ce **acest proiect** este în risc

Acest proiect folosește același flow npm/pnpm → Next.js build → PM2 restart ca procuchaingo2. Orice import care trimite la un pachet NEDECLARAT în `package.json` este o bombă cu ceas:
- Build-urile curente merg dacă pachetul există în `node_modules` din cauze colaterale (phantom dep, peer-pull, workspace hoisting, install anterior).
- Orice install curat (CI, Docker, VPS redeploy cu lockfile strict, upgrade Node) va eșua brusc.

Consecința: primul deploy "ca lumea" după X săptămâni de dev devine outage neașteptat, fără legătură cu ultima schimbare commit-uită.

### Audit concret — pași (~10 min per proiect)

**1. Scan source tree pentru importuri nedeclared:**

```bash
# Din root-ul proiectului:
grep -rhE "from[[:space:]]+['\"][^./][^'\"]+['\"]" src/ apps/*/src/ 2>/dev/null \
  | sed -E "s/.*from[[:space:]]+['\"]([^'\"/]+(\/[^'\"]+)?)['\"].*/\1/" \
  | sed -E "s/\/.*//" | sort -u > /tmp/imported.txt

# Extrage pachete declarate în toate package.json (root + workspaces):
find . -name "package.json" -not -path "*/node_modules/*" \
  -exec jq -r '.dependencies // {}, .devDependencies // {} | keys[]' {} \; \
  | sort -u > /tmp/declared.txt

# Diff (exclude Node builtins):
comm -23 /tmp/imported.txt /tmp/declared.txt \
  | grep -vE "^(fs|path|crypto|util|os|stream|http|https|url|events|buffer|child_process|process|zlib|querystring|net|tls|dns|readline|assert|timers)$"
```

**Output corect: listă goală.** Dacă apar pachete, sunt undeclared deps — riscuri concrete.

**2. Pentru fiecare finding, decide:**
- Adaugă pachetul în `dependencies` (sau `devDependencies`) cu versiunea curentă din `node_modules/<pkg>/package.json`.
- SAU șterge importul dacă codul e dead / unused.

**3. Lock it in:**

```bash
npm install    # sau pnpm install — actualizează lockfile
# Verifică cu install curat:
rm -rf node_modules .next
npm ci         # sau pnpm install --frozen-lockfile
npm run build  # trebuie să treacă
```

**4. Commit `package.json` + lockfile împreună.**

### Prevention (opțional, recomandat după audit)

Adaugă un GitHub Action care validează la fiecare PR că `install --frozen-lockfile` + `build` trec:

```yaml
# .github/workflows/build-check.yml
name: Build Check
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci         # sau pnpm install --frozen-lockfile
      - run: npm run build  # sau pnpm run build
```

### De ce acum, nu mai târziu

Bug-ul din procuchaingo2 a stat nedetectat 11 zile. Același tip de drift poate exista ACUM în acest proiect.

Cost audit: ~10 min. Cost outage: ~3 min downtime + recovery manual + incident report + timp user pentru triaj.

### Referințe

- Incident ledger: `<PROJECTS_ROOT>/procuchaingo2/reports/DIRECT-CHANGES-2026-04.md` (secțiunea "INCIDENT")
- Fix commits procuchaingo2: `caa055c` (G-PCG-004), `8a9e82e` (jspdf deps hotfix)
- Master/TODO_PERSISTENT.md — entry Procu-specific pentru CI gate
