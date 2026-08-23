# AUDIT_GAPS — 4pro-identity

> Persistent ledger of audit findings. OPEN = actionable. ELIMINATED = fixed + verified. All fixes require propose-confirm-apply (ACTIVE classification).

---

## Open Gaps

### G-ID-002 — P1 — Secretul SSO cade tăcut pe o valoare vizibilă în cod

**Status**: OPEN (verificat 2026-08-23 — **producția e în regulă azi**, riscul e la viitor)

`src/lib/token.js:3` citește `process.env.SSO_JWT_SECRET || 'dev-secret-change-me'`.
Verificat live pe VPS1: `.env` are un secret real de 64 de caractere, `server.js:1` îl
încarcă prin dotenv înainte de orice, iar proba funcțională confirmă că un token semnat cu
valoarea din cod e **respins cu 401** pe `/identity/resolve`. Deci ramura de rezervă nu se
atinge acum. `COOKIE_SECURE=true`, `COOKIE_DOMAIN=.4pro.io`.

**Riscul**: dacă `.env` e vreodată pierdut, redenumit sau necitit, serviciul **nu refuză să
pornească** — coboară tăcut la un secret pe care oricine cu acces la depozit îl poate citi,
și continuă să semneze tokenuri pentru toate cele 7 aplicații din ecosistem. Un eșec de
configurare devine astfel o breșă tăcută, în loc de o pană zgomotoasă.

**Reparație propusă**: fail-closed — fără `SSO_JWT_SECRET`, procesul se oprește la pornire
cu mesaj explicit, în loc să folosească o valoare implicită. Aceeași sesiune ar trebui să
verifice și emitentul la verificare (`jwt.verify` nu impune azi `issuer`, deși semnarea îl
pune) — vezi și itemul din `Master/TODO_PERSISTENT.md` despre driftul VPS↔depozit.

**De ce nu s-a aplicat acum**: 4pro-identity e autoritatea SSO a 7 aplicații; o schimbare la
pornirea procesului cere sesiune dedicată, cu verificarea fiecărui consumator după.

---

## Eliminated Gaps

### G-ID-001 — P0 CRITICAL — Hardcoded OTP bypass in change-phone

**Status**: ELIMINATED 2026-05-17 (commit `1ad3ae0`)
**Finding**: `POST /identity/change-phone` accepted `verificationCode === '123456'` unconditionally, bypassing Twilio Verify entirely. Any authenticated user could change their phone to any unregistered number using this magic code.
**Fix**: Replaced hardcoded check with real `verifyOTP(sanitized, verificationCode)` call from `src/lib/twilio.js`. Also fixed variable ordering bug (phone sanitize + E.164 validation now happens BEFORE OTP call).
**Verification**: 80/80 tests pass. Test "reject invalid code" updated to use `mockOtpStatus='pending'` (mock Twilio returning non-approved for invalid code).

---

### G-ID-002 — P1 HIGH — No rate limiting on auth endpoints

**Status**: ELIMINATED 2026-05-17 (commit `1ad3ae0`)
**Finding**: Auth routes `/auth/login`, `/auth/register`, `/auth/send-otp`, `/auth/verify-otp` had no rate limiting. Vulnerable to brute-force password attacks and OTP enumeration via mass `send-otp` calls. Only `/identity/exists` had a per-route rate limit (30/min).
**Fix**: Registered `@fastify/rate-limit` globally (100 req/min, test env exempt via `allowList`). Added per-route overrides: register 5/min, login 10/min, send-otp 3/min, verify-otp 5/min.
**Verification**: 80/80 tests pass. Rate-limit plugin skips in `NODE_ENV=test` so test suite isolation preserved.

---

### G-ID-003 — P1 HIGH — Magic-link double rate-limit register crashes server

**Status**: ELIMINATED 2026-05-17 (commit `0f8eb4f`)
**Finding**: `magicLinkRoutes` called `fastify.register(@fastify/rate-limit, ...)` inside the plugin scope after the plugin was already registered globally in `server.js`. This throws "FST_ERR_DEC_ALREADY_PRESENT: decorator already added" at startup, crashing the server before any request is served.
**Fix**: Removed the redundant `fastify.register()` block. Added `{ config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }` directly on the POST `/generate` route definition — matching the pattern already used in `auth.js`.
**Verification**: 80/80 tests pass.

---

### G-ID-004 — P1 HIGH — Magic-link /verify skips DB check (no revocation)

**Status**: ELIMINATED 2026-05-17 (commit `0f8eb4f`)
**Finding**: `GET /api/magic-link/verify` only validated the JWT signature via `jwt.verify()`. It never queried the `MagicLink` table by `tokenHash`. Consequence: (1) a revoked/deleted token would still verify as valid; (2) expired tokens already past `expiresAt` in DB would still pass if JWT `exp` hadn't elapsed; (3) single-use enforcement was impossible.
**Fix**: After JWT verification, compute `hashToken(token)` and call `magicLink.findUnique({ where: { tokenHash } })`. Return 401 if no record exists or `record.expiresAt < new Date()`.
**Verification**: 80/80 tests pass.

---

## Open Gaps

_None at this time._

---

## Audit History

| Date | Tool | Score | Notes |
|------|------|-------|-------|
| 2026-05-17 | E2E CODE [7] | 67/100 | infra-checker no baseUrl; db-verifier 100; cross-suggester 100 |
| 2026-05-17 | /review | — | P0 G-ID-001 + P1 G-ID-002 found; both fixed same session |
| 2026-05-17 | /review (follow-up) | — | P1 G-ID-003 + P1 G-ID-004 found in magic-link.js; both fixed same session |
