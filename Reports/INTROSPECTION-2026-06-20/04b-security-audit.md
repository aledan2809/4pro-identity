# Audit Securitate (Cyber) — 4pro-identity

> Audit READ-ONLY, 2026-06-20. **Cel mai critic serviciu din lotul de audit**: 4pro-identity este *issuer-ul SSO* (`id.4pro.io`). Cine compromite semnarea token-urilor aici fabrică identitate validă pentru TOATE cele 7 aplicații 4PRO (PRO, eCabinet, eat, client, biz, landing, identity însuși).
>
> **Stack:** Fastify 5 + Prisma 7 (PG/Neon) + bcrypt + jsonwebtoken + Twilio Verify. CommonJS. Port 4100. `/health`.
>
> Fiecare finding: severitate · evidence (file:line) · fix · **PROPUNERE (așteaptă review)**. NU s-a modificat niciun fișier.

---

## 🗣️ Pe înțelesul tău + implicații (non-tehnic)

Gândește-te la acest serviciu ca la "fabrica de legitimații" a ecosistemului. El semnează o legitimație (token JWT) cu o **cheie secretă**, iar celelalte aplicații o acceptă verificând că semnătura e bună.

Două lucruri sunt vitale:
1. **Cheia secretă trebuie să fie cu adevărat secretă și unică.** Am găsit că, dacă pe server lipsește variabila corectă, codul folosește automat o "cheie de avarie" scrisă în clar în cod (`dev-secret-change-me`), pe care o poate citi oricine. Cu ea, cineva ar putea fabrica legitimații false pentru tot ecosistemul. **Asta e P0.** Agravant: fișierul de configurare local numește cheia altfel (`JWT_SECRET`) decât o cere codul (`SSO_JWT_SECRET`) → e foarte ușor să rulezi din greșeală pe cheia de avarie.
2. **Verificarea legitimației trebuie să fie strictă.** Aici, la verificare, NU se controlează "cine a emis legitimația" (issuer). E ca și cum ai accepta orice act care arată ok, fără să verifici ștampila emitentului. E un strat de apărare lipsă (P1).

Vestea bună: **parolele sunt protejate corect** (bcrypt puternic), iar limitarea încercărilor de login (rate-limit) există. Bug-ul vechi de "cod SMS magic 123456" a fost deja reparat.

Implicație: prioritar e (1) eliminarea cheii de avarie + alinierea numelui variabilei și (2) verificarea issuer. Sunt fix-uri mici, dar fiindcă serviciul e "cheia de la toate ușile", trebuie tratate cu prioritate maximă și cu confirmare înainte de aplicare.

---

## F1 — 🔴 P0 CRITICAL — Secret SSO cu fallback hardcodat + nume variabilă divergent

**Evidence:**
- `src/lib/token.js:3` — `const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET || 'dev-secret-change-me';`
- `.env` (local) — definește `JWT_SECRET=<...>`, **NU** `SSO_JWT_SECRET` (verificat: `grep SSO_JWT_SECRET .env` → 0 rezultate)
- `.env.example` — la fel, doar `JWT_SECRET="change-me-to-a-strong-random-secret"`

**Problemă:** Există un secret-fallback **hardcodat în cod sursă** (deci public pentru oricine citește repo-ul). Dacă pe vreun mediu (local, VPS, CI) `SSO_JWT_SECRET` lipsește, serviciul semnează token-uri SSO valide cu `'dev-secret-change-me'`. Pentru că `.env`/`.env.example` numesc cheia `JWT_SECRET` (alt nume), riscul ca var-ul corect să lipsească este **ridicat și concret**, nu teoretic. Un atacator care cunoaște secretul (din cod) poate forja un JWT cu orice `globalId` → bypass total al autentificării pe ÎNTREG ecosistemul 4PRO (consumatorii partajează `SSO_JWT_SECRET` — vezi CLAUDE.md "SSO_JWT_SECRET must match across PRO/Client/eCabinet").

Best-practice (OWASP / WorkOS): secretele NU se hardcodează niciodată; cu HS256 (secret comun) absența secretului trebuie să fie **fail-closed** (crash la boot), nu fallback la o valoare cunoscută.

**Fix (PROPUNERE — așteaptă review):**
1. În `token.js`, elimină fallback-ul → fail-closed la boot:
   ```js
   const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET;
   if (!SSO_JWT_SECRET) throw new Error('SSO_JWT_SECRET is required (no fallback)');
   ```
2. Aliniază numele: ori codul citește `JWT_SECRET`, ori `.env`/`.env.example` redenumesc în `SSO_JWT_SECRET`. **Recomandat:** standardizează pe `SSO_JWT_SECRET` (numele e deja folosit ecosistem-wide în Master docs) + actualizează `.env.example`.
3. **USER (VPS1):** verifică `/var/www/4pro-identity/.env` are `SSO_JWT_SECRET=<valoarea canonică>` identică cu PRO/eCabinet/eat/client (vezi incident istoric `SSO_JWT_ISSUER_DRIFT` în Master TODO Optimise SSO).

> Atenție governance: e SSO core → orice patch = propose-confirm-apply + health-check pe toți consumatorii după (cabinet/pro/client/eat).

---

## F2 — 🟠 P1 HIGH — `verifyToken` nu validează `issuer` (asimetrie cu consumatorii)

**Evidence:**
- `src/lib/token.js:7-10` — `signToken` setează `issuer: process.env.SSO_ISSUER || 'https://id.4pro.io'` ✅
- `src/lib/token.js:13-15` — `verifyToken(token) { return jwt.verify(token, SSO_JWT_SECRET); }` — **fără opțiunea `{ issuer }`** ❌
- Consumator de referință care DA verifică: `4pro-eat/src/lib/auth/jwt.ts:88` — `jwtVerify(token, key, { issuer: expectedIssuer })`; `4pro-eat/src/middleware.ts:154` idem.

**Problemă:** Emitentul (acest serviciu) verifică token-uri proprii fără să confirme `issuer`/`subject`. Standardul (OWASP JWT/REST cheat sheet): la verificare trebuie validate cel puțin `iss` și `aud`. Aici, orice JWT semnat cu același secret (ex. un token de **alt tip** emis de altă componentă care folosește din greșeală același `SSO_JWT_SECRET`, sau un token `eat-impersonation` semnat cu același secret) ar trece prin `set-password`, `/auth/verify`, `/identity/*`, `/legal/*`. Riscul crește pentru că `SSO_JWT_SECRET` e **partajat ecosistem-wide** (HS256 → oricine semnează poate fi acceptat).

**Fix (PROPUNERE — așteaptă review):**
```js
function verifyToken(token) {
  return jwt.verify(token, SSO_JWT_SECRET, {
    issuer: process.env.SSO_ISSUER || 'https://id.4pro.io',
    algorithms: ['HS256'],            // pin algoritm — vezi F2b
  });
}
```
(1 linie funcțional, cu beneficiu de defense-in-depth.) Adaugă `SSO_ISSUER` în `.env.example`.

---

## F2b — 🟠 P1 — Algoritm nepinned la `jwt.verify` (risc teoretic alg-confusion)

**Evidence:** `src/lib/token.js:14` — `jwt.verify(token, SSO_JWT_SECRET)` fără `{ algorithms: [...] }`.

**Problemă:** `jsonwebtoken` fără `algorithms` whitelist acceptă orice algoritm din header-ul token-ului. Cu un secret HS, riscul clasic "RS256→HS256 confusion" nu se aplică direct (nu există cheie publică RSA folosită ca secret), dar best-practice 2026 (OWASP, loginradius) cere **pinning explicit** al algoritmului la verificare. Cost de implementare: zero, beneficiu: elimină o întreagă clasă de atacuri viitoare.

**Fix (PROPUNERE):** include `algorithms: ['HS256']` (vezi snippet F2). `magic-link.js` deja face corect acest pinning (`algorithms: ['HS256']` la linia 136) — token.js trebuie aliniat la același standard.

---

## F3 — 🟠 P1 — Lipsă `aud`, lipsă refresh-token, token 24h nerevocabil

**Evidence:** `src/lib/token.js:4` — `TOKEN_EXPIRY = '24h'`; payload = `{ globalId, phone }` fără `aud`. Nu există model/rută de refresh token; logout doar șterge cookie-ul (`auth.js:172-179`) → token-ul rămâne valid 24h chiar după "logout".

**Problemă (best-practice 2026 — CIAM/Auth0/Okta):**
- **Fără `aud`** → un token bun pentru o aplicație e bun pentru toate (replay cross-service). OWASP: `aud` e exact mecanismul care previne reutilizarea unui token între servicii.
- **24h access token, fără refresh** → fereastră lungă de compromitere; standardul e access 5-15 min + refresh-token rotativ stocat **hashat**, cu detecție de reutilizare (revocă întreaga familie la reuse).
- **Logout neefectiv** → token-ul furat rămâne valid până la `exp`.

**Fix (PROPUNERE — plan dedicat, NU 1 linie):**
1. Adaugă `aud` per-consumator sau `aud: '4pro-ecosystem'` + cere consumatorilor să-l verifice (coordonat — afectează toți cei 7).
2. Scurtează access la ~15 min + introdu refresh-token (model nou `RefreshToken { tokenHash, globalId, family, expiresAt, revokedAt }`), rotativ, hashat (sha256), cu reuse-detection.
3. Logout = revocă familia curentă.
> Acesta e un schimb arhitectural ecosistem-wide → planificare separată, nu fix punctual.

---

## F4 — 🟢 OK (verificat) — Parole

**Evidence:** `src/lib/password.js` — `bcrypt.hash(password, 12)` + `bcrypt.compare`. Politică la set-password: min 8, ≥1 majusculă, ≥1 cifră (`auth.js:266-277`). La register doar min 8 (`auth.js:70`).

**Verdict:** bcrypt cost 12 = solid pentru 2026. **Observație minoră (P2):** inconsistență — register cere doar lungime ≥8, dar set-password cere și majusculă+cifră. **PROPUNERE (review):** aliniază politica la register (sau mai bine, verificare împotriva listelor de parole compromise / lungime ≥12). Fără finding de severitate.

---

## F5 — 🟢 OK (verificat) — Rate-limiting & enumerare

**Evidence:** `server.js:24-30` rate-limit global 100/min; per-rută: register 5/min, login 10/min, send-otp 3/min, verify-otp 5/min, magic-link/generate 5/min, identity/exists 30/min.

**Verdict:** acoperire bună (G-ID-002 ELIMINATED confirmat în cod). Login răspunde uniform "Invalid credentials" la telefon inexistent vs parolă greșită (`auth.js:145, 158`) → **bun anti-enumerare**.

**Observații (P2, PROPUNERE review):**
- `/identity/exists` (`identity.js:47`) **expune intenționat** existența unui email/telefon (by design pentru duplicate-detection cross-app), rate-limited 30/min. E un trade-off acceptat, dar 30/min permite scraping lent. PROPUNERE: consideră limită mai strânsă (10/min) sau autentificare server-to-server (header intern) dacă doar app-urile o folosesc.
- `magic-link/generate` întoarce 400 "Provider not found" dacă telefonul nu e înregistrat (`magic-link.js:82-84`) → **enumerare de furnizori**. PROPUNERE: răspuns generic + fire-and-forget (nu dezvălui found/not-found).

---

## F6 — 🟢 OK (verificat) — Cookie SSO & CORS

**Evidence:** `auth.js:35-44` — cookie `httpOnly:true`, `secure` din `COOKIE_SECURE`, `sameSite` din env (default Lax), `domain` din `COOKIE_DOMAIN`. CORS (`server.js:33-42`) permite doar `*.4pro.io` + `localhost:3000`, `credentials:true`.

**Verdict:** corect ca design. **Risc de configurare (P1 operational, PROPUNERE):** `.env` local are `COOKIE_SECURE=false` + `COOKIE_DOMAIN=localhost`. **USER trebuie să confirme** că pe VPS1 prod `.env` are `COOKIE_SECURE=true` + `COOKIE_DOMAIN=.4pro.io` + `COOKIE_SAMESITE` potrivit (pentru iframe-embed eat sub client → ar putea fi nevoie `None`+`Secure`). Cookie `Secure=false` pe prod = token trimis pe HTTP = interceptabil.

---

## F7 — 🟡 P1 — Vulnerabilități în dependențe (11: 5 moderate, 6 high)

**Evidence:** `npm audit --omit=dev` → 11 vulns. Lanț: `prisma@7.6.0 → @prisma/dev → @hono/node-server / hono@4.12.9` (high-uri Hono: JWT NumericDate, cookie injection, CORS wildcard, etc.) + `qs 6.11.1` (moderate DoS). `npm ls hono` confirmă: vin EXCLUSIV din `@prisma/dev` (tooling de development Prisma), **NU** din runtime-ul Fastify de producție.

**Verdict:** risc real **redus** (Hono nu e în calea de request a serverului — e adus de uneltele Prisma dev), dar igienă obligatorie. `fix available via npm audit fix`.

**Fix (PROPUNERE — review):** `npm audit fix` (non-breaking conform output) + re-rulează `npm test` (≈80 teste) ca regression. Dacă `@prisma/dev` rămâne pe Hono vulnerabil, e acceptabil ca dev-only — documentează în AUDIT_GAPS.

---

## F8 — 🟢 OK (verificat) — Secrete în git

**Evidence:** `.gitignore` conține `.env`; `git ls-files | grep .env` → doar `.env.example` tracked (cu placeholdere). `.env` real NU e în git.

**Verdict:** corect. **Observație (P2):** `.env.example` conține un comentariu cu numele proiectului Neon real (`billowing-surf-59639801`) în `.env` local — informație de mediu, nu secret. Recomandare minoră: nu lăsa identificatori de proiect cloud în fișiere example.

---

## F9 — 🟡 P2 — Headers de securitate lipsă (helmet)

**Evidence:** `server.js` înregistrează cookie, cors, rate-limit — **nu** `@fastify/helmet`. Răspunsurile sunt JSON-API (nu HTML), deci riscul XSS e mic, dar lipsesc `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, etc.

**Fix (PROPUNERE — review):** adaugă `@fastify/helmet` cu config minimal (HSTS + nosniff). Cost mic, beneficiu defense-in-depth. Non-blocant.

---

## 🔗 Cross-ref obligatoriu — `x-user-id` în 4pro-client vs token-urile identity

**Constatare (cerută explicit):** În `4pro-client`, **20+ rute API** citesc identitatea utilizatorului din header-ul brut `x-user-id` (ex. `4pro-client/src/app/api/v1/contracts/route.ts:6`, `.../user-documents/route.ts:5`, `.../ocr/*`, `.../rfq/*`, `.../ratings/*`). Acest header **NU e semnat** — e doar text. Dacă acele rute sunt accesibile direct dinspre browser (nu doar dintr-un BFF intern care îl populează după verificarea SSO), oricine poate trimite `x-user-id: <alt globalId>` și **impersona orice utilizator**.

**Care e calea de încredere INTENȚIONATĂ?** Token-ul SSO `4pro_sso` emis de acest serviciu (HS256, `globalId` în payload). Pe partea identity, calea corectă de verificare există și e folosită intern: `authenticate()` în `identity.js:6-19`, `legal.js`, `user-documents.js` fac `verifyToken(cookie/Bearer)` → derivă `globalId` din token semnat, NU dintr-un header brut. **Deci modelul corect este: consumatorii TREBUIE să verifice JWT-ul `4pro_sso` (semnătură + issuer + exp) și să deriveze `globalId` din el — NU să se bazeze pe `x-user-id`.**

**Implicații pentru issuer-enforcement (de ce F2 contează aici):**
- `4pro-client/src/middleware.ts` doar verifică **prezența** cookie-ului `4pro_sso` pe câteva rute (`:11-16`), **fără să-l verifice criptografic**, și NU populează `x-user-id` din el. Deci `x-user-id` din rutele API trebuie să vină din altă parte (cod client / componentă internă) — ceea ce înseamnă că **trust path-ul real e fragil** dacă acele rute sunt expuse public.
- Pentru ca un consumator să poată verifica *corect* token-ul (issuer + subject), emitentul (acest serviciu) trebuie să **emită consistent** `issuer`/`subject` ȘI să-și verifice propriile token-uri la fel de strict (F2). Azi `signToken` setează issuer (bun), dar NU setează `sub`/`subject` explicit (doar `globalId` în payload) — `4pro-eat` citește `payload.globalId ?? payload.sub`, deci merge, dar inconsistența `sub` lipsă e o sursă de fragilitate cross-app (vezi `4pro-client/src/lib/sso.ts:21-29` care reface `globalId` din `ssoId`).

**PROPUNERE (review — vizează 4pro-client, NU identity, dar relevant pentru contractul SSO):**
1. În identity, `signToken` să seteze explicit și `subject: globalId` (`jwt.sign(..., { subject: globalId, issuer, ... })`) → contract clar pentru toți consumatorii (`sub` standard).
2. **Recomandare ecosistem (separat, 4pro-client):** auditează dacă rutele `x-user-id` din 4pro-client sunt expuse public; dacă da, înlocuiește trust-ul pe `x-user-id` cu verificare `verifySSOToken(cookie 4pro_sso)` (cum face deja `4pro-client/src/lib/sso.ts`) + derivare `globalId` din token. Acesta e probabil cel mai serios risc real din ecosistem și merită un finding dedicat în `4pro-client/AUDIT_GAPS.md`.

---

## Acțiuni care necesită USER

1. **🔴 P0 — VPS1 `.env` verify:** confirmă `/var/www/4pro-identity/.env` are `SSO_JWT_SECRET` (NU `JWT_SECRET`) setat la valoarea canonică, identică cu PRO/eCabinet/eat/client. Dacă lipsește → serviciul rulează pe `'dev-secret-change-me'` ACUM.
2. **🔴 P0 — Confirmare fix F1:** aprobare pentru a elimina fallback-ul hardcodat din `token.js` + a alinia numele variabilei + `.env.example` (propose-confirm-apply, SSO core).
3. **🟠 P1 — Confirmare fix F2/F2b:** aprobare pentru issuer + algorithms pinning la `verifyToken` (1 linie) + adăugare `SSO_ISSUER` în `.env.example`.
4. **🟠 P1 — Cookie prod (F6):** confirmă pe VPS `COOKIE_SECURE=true` + `COOKIE_DOMAIN=.4pro.io` + `COOKIE_SAMESITE` corect pentru embed.
5. **🟡 P1 — Dependențe (F7):** aprobare `npm audit fix` + re-test.
6. **🔗 Cross-ref — decizie ecosistem:** vrei un audit dedicat pe `4pro-client` pentru riscul `x-user-id` (impersonare)? (recomandat — potențial cel mai grav risc real din lot).
7. **📐 Strategic:** decizie pe migrarea la RS256/JWKS + refresh-token rotativ (F3) — vezi `03-deep-research-optimization.md`.
