# Gap Analysis — Strategie vs Cod — 4pro-identity

> Audit READ-ONLY, 2026-06-20. Sursă de adevăr = codul. Regulă: **cod mai avansat decât strategia = strategia e veche; NU recomandăm tăierea funcțiilor, ci "ridicarea documentației la nivelul codului".**
>
> **Notă (fără ghid pe pagini):** serviciul este un backend microservice fără interfață web (fără pagini de click). De aceea NU există deliverable de tip "ghid pe pagini" și NU s-a rulat auditul vizual extern — n-ar avea suprafață UI de evaluat.

---

## 🗣️ Pe înțelesul tău + implicații (non-tehnic)

4pro-identity e "biroul de acte" al ecosistemului 4PRO: aici se nasc conturile (telefon + parolă sau cod SMS), se eliberează "legitimația" (token-ul SSO) cu care intri în PRO, eCabinet, eat, client etc., și tot aici se rezolvă cererile GDPR și consimțămintele (prin Legal Hub).

Ce am găsit comparând ce SCRIE în documente cu ce FACE de fapt codul:

- **Documentele sunt rămase mult în urmă.** CLAUDE.md zice "11 teste, doar JWT + telefon, deploy local". În realitate serviciul are ~80 de teste, login prin OTP SMS, magic-link pe WhatsApp, integrare completă cu Legal Hub (consimțăminte + cereri de export/ștergere date), schimbare de telefon verificată. **Codul a evoluat, documentația nu.** Nu tăiem nimic — doar urcăm documentația la nivelul codului.
- **Lipsesc fișierele de strategie/context** (STRATEGY.md, README.md, CONTEXT.md) pe care chiar CLAUDE.md le cere la fiecare pornire de sesiune. Asta înseamnă că oricine reia proiectul peste 3 luni pornește "pe orb".
- **Există cod scris dar nefolosit**: ruta `user-documents.js` (documente de utilizator) e implementată dar **nu e conectată** în server → e cod mort momentan. Plus modelul de date pentru ea (`UserDocument`) nici nu există în schema bazei de date.

Implicația practică: serviciul e mai capabil decât pare, dar "memoria scrisă" e săracă — riscul e să se piardă context și să apară regresii (cineva crede că o funcție nu există și o reface greșit).

---

## (a) Promis dar lipsă (promised-but-missing)

| # | Promis în | Realitate în cod | Sever. |
|---|-----------|------------------|--------|
| A1 | CLAUDE.md §"Self-validation" (din MASTER_SYSTEM) cere STRATEGY.md, README.md, CONTEXT.md, DECISIONS.md, GUARDRAILS.md, CHANGELOG.md | **Niciunul nu există** (doar CLAUDE.md, AUDIT_GAPS.md, DEVELOPMENT_STATUS.md, TODO_PERSISTENT.md, knowledge/lessons-learned.md gol) | P2 |
| A2 | `.env.example` declară `JWT_SECRET` ca "JWT secret for signing SSO tokens" | Codul (`src/lib/token.js`) citește `process.env.SSO_JWT_SECRET`, NU `JWT_SECRET` → contractul de configurare e divergent; risc de rulare pe fallback hardcodat | **P0** |
| A3 | `.env.example` NU listează `SSO_ISSUER`, `MAGIC_LINK_SECRET`, `LEGAL_HMAC_KEY`, `SKIP_LEGAL_HMAC`, `WHATSAPP_*` | Toate sunt citite din env în cod (token.js, magic-link.js, legal.js) → `.env.example` e incomplet, induce în eroare la deploy | P2 |
| A4 | CLAUDE.md "Testing: Vitest — 11 tests" | Realitate: ~7 fișiere de test, ~80 cazuri (routes.test.mjs singur are 649 linii) | P2 (doc-drift) |

## (b) Construit dar nedocumentat — DRIFT (documentație de ridicat la nivelul codului)

> **Aceste capabilități EXISTĂ și funcționează; problema e că documentația nu le menționează. Recomandarea e să fie documentate, NU eliminate.**

| # | Capabilitate reală în cod | Unde | Documentat? |
|---|---------------------------|------|-------------|
| B1 | **Login prin OTP SMS** (Twilio Verify): `/auth/send-otp`, `/auth/verify-otp`, auto-creare cont la primul OTP cu `forcePasswordSet` | `src/routes/auth.js:181-248`, `src/lib/twilio.js` | ❌ nu |
| B2 | **Set-password post-OTP** (`/auth/set-password`) + politică de parolă (min 8, 1 majusculă, 1 cifră) | `src/routes/auth.js:251-297` | ❌ nu |
| B3 | **Magic-link prin WhatsApp** (discovery providers): generate + verify cu token hash în DB, expirare 7 zile | `src/routes/magic-link.js`, model `MagicLink` | ❌ nu |
| B4 | **Schimbare telefon verificată** prin OTP + audit log (`PhoneChangeLog`) | `src/routes/identity.js:178-240` | ❌ nu |
| B5 | **Probe de existență cross-app** (`/identity/exists`) cu rate-limit anti-scraping | `src/routes/identity.js:47-76` | ❌ nu |
| B6 | **Integrare Legal Hub completă**: document proxy, consent status/record cu **semnătură HMAC**, DSR (EXPORT/DELETE) | `src/routes/legal.js`, `src/routes/auth.js:17-31` (`resolveControllerEntity`) | parțial (doar CLAUDE.md §"Legal Hub Phase 9") |
| B7 | **`controllerEntitySlug` embed în JWT** la register + new-identity OTP | `src/routes/auth.js:116-118, 234-239` | parțial |
| B8 | **AI Router wiring** (`src/lib/ai-router.js`) — nefolosit de nicio rută momentan | `src/lib/ai-router.js` | ❌ nu (cod pregătit, neutilizat) |

## (c) TODO reconciliation

- `AUDIT_GAPS.md`: **G-ID-001..004 toate ELIMINATED** (OTP bypass, rate-limit, magic-link double-register, magic-link DB check). "Open Gaps: None." → ledger curat și corect față de cod (verificat: change-phone folosește acum `verifyOTP` real, rate-limit global e în server.js, magic-link verify face `findUnique` pe tokenHash).
- `TODO_PERSISTENT.md`: predominant scope **conversie/marketing Legal-landing** (cross-project, nu securitate). Un item relevant aici: "apps-side prefill + WhatsApp wiring remains" — nu afectează securitatea SSO.
- **Cod mort de reconciliat**: `src/routes/user-documents.js` există dar **NU e înregistrat** în `server.js` (nu apare în cele 4 `fastify.register`). Modelul `UserDocument` lipsește din `prisma/schema.prisma`. → fie se finalizează (model + register), fie se marchează explicit ca "deferred/WIP" ca să nu rămână cod ambiguu.

## (d) Top gap-uri (P0/P1/P2)

| Prio | Gap | Path real | De ce |
|------|-----|-----------|-------|
| **P0** | Secret SSO cu fallback hardcodat + nume de var divergent (`SSO_JWT_SECRET` în cod vs `JWT_SECRET` în `.env`/`.env.example`) | `src/lib/token.js:3`; `.env`; `.env.example` | Dacă var lipsește pe VPS → semnează cu cheie publică → întreg ecosistemul compromisibil. Detalii în `04b-security-audit.md` (F1). |
| **P1** | `verifyToken` NU verifică `issuer` (deși signToken îl setează) | `src/lib/token.js:13-15` | Asimetrie cu consumatorii (eat verifică issuer); pierde un strat de apărare. Vezi `04b` F2. |
| **P1** | 11 vulns npm (hono/qs tranzitiv din Prisma dev) | `package-lock.json` | `npm audit fix` rezolvă; risc real mic (build-time), dar igienă. Vezi `04b` F7. |
| **P2** | Documente de governance lipsă (STRATEGY/README/CONTEXT) + CLAUDE.md stale (11 teste, "JWT only") | rădăcină proiect | Drift de context; risc de regresie la reluare. |
| **P2** | `user-documents.js` cod mort (rută neînregistrată + model absent) | `src/routes/user-documents.js`; `prisma/schema.prisma` | Ambiguitate: pare feature, dar nu rulează. |
| **P2** | `.env.example` incomplet (lipsesc SSO_ISSUER, MAGIC_LINK_SECRET, LEGAL_HMAC_KEY, SKIP_LEGAL_HMAC, WHATSAPP_*) | `.env.example` | Deploy-ul pe orb; ușor de uitat o cheie critică. |

---

### Concluzie gap

Serviciul e **sănătos pe fundamente** (parole, rate-limit, ledger curat) și **mai avansat decât documentația sa**. Acțiunea principală NU e dezvoltare nouă, ci: (1) închiderea celor 2 găuri P0/P1 de securitate (vezi `04b`), (2) ridicarea documentației la nivelul codului real (B1-B8), (3) clarificarea codului mort (user-documents).
