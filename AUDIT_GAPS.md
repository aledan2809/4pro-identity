# AUDIT_GAPS — 4pro-identity

> Persistent ledger of audit findings. OPEN = actionable. ELIMINATED = fixed + verified. All fixes require propose-confirm-apply (ACTIVE classification).

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

## Open Gaps

_None at this time._

---

## Audit History

| Date | Tool | Score | Notes |
|------|------|-------|-------|
| 2026-05-17 | E2E CODE [7] | 67/100 | infra-checker no baseUrl; db-verifier 100; cross-suggester 100 |
| 2026-05-17 | /review | — | P0 G-ID-001 + P1 G-ID-002 found; both fixed same session |
