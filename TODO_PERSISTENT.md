# 4PRO Ecosystem — TODO Persistent

> **Scope:** items cross-app care afectează **întregul ecosistem 4PRO** (PRO, eCabinet, 4pro-client, 4pro-biz, 4pro-landing, 4pro-identity, 4pro-eat, sau SSO / data layer / GDPR shared între ele).
>
> **Ubicație:** acest file trăiește în `4pro-identity/` pentru că identity/auth este hub-ul SSO al ecosistemului (user accounts, consent records, data subject rights — toate converg aici).
>
> **Per-app items** merg în `<app>/TODO_PERSISTENT.md` (ex: `4pro-eat/TODO_PERSISTENT.md`, `eCabinet/TODO_PERSISTENT.md`).
>
> **Master-level items** (cross-ecosystem, multi-proiect independent) merg în `Master/TODO_PERSISTENT.md`.

---

## [ ] Cross-app SSO dedup audit — same bug ca eat (creat 2026-04-25)

**Prioritate:** High — bugul cauzează conturi duplicate în ecosistem și poate scurge date la cleanup ulterior.

**Context:** După ce am rezolvat bug-ul de pe `eat.4pro.io` (register-ul nu verifica 4pro-identity înainte de a crea cont local), am auditat celelalte 5 aplicații din ecosistem. Toate au aceeași anomalie: verifică DOAR baza lor proprie înainte de create, apoi sincronizează cu 4pro-identity "fire-and-forget" (non-blocking) sau prin proxy la o altă app care are același pattern.

### Status per app

| App | Pattern actual la `register` | Verdict | Fix priority |
|---|---|---|---|
| **PRO** | local-first (verifică PRO db pentru phone+email), creează user local, apoi `identityRegister` non-blocking | ❌ BUG | **P0** — sursa primară pentru `4pro-client` |
| **eCabinet** | local-first (verifică eCabinet db pentru email + phone-fuzzy match pentru placeholder upgrade), creează în transaction, apoi `identityRegister` non-blocking | ❌ BUG | **P0** — sursa primară pentru `4pro-biz` |
| **4pro-client** | Proxy către PRO `/api/auth/register` (PRO_API_URL=:6660). Nu verifică identity direct | ❌ BUG (moștenit din PRO) | **P1** — fix-ul PRO va remedia și aici, eventual schimbare la apel direct identity |
| **4pro-biz** | Proxy către eCabinet `/api/v1/auth/login`. Nu verifică identity direct | ❌ BUG (moștenit din eCabinet) | **P1** — la fel, fix-ul eCabinet remediază; biz nu are register propriu, doar login proxy |
| **4pro-landing** | Nu are API de auth — landing page pur | ✅ N/A | — |
| **4pro-eat** | Identity-first cu pre-flight `/identity/exists`, fail-closed dacă identity e jos | ✅ FIX (commit `<TBD>` la 2026-04-25) | reference implementation |

### Cum se manifestă bugul (în limbaj clar)

Imaginează-ți ecosistemul ca un mall cu 5 magazine. Fiecare magazin are propriul registru de clienți + un birou central comun de evidență (4pro-identity). Bugul: când Maria intră în PRO și se înscrie, magazinul își notează "Maria, telefon X" în registrul lui propriu. Apoi spune biroului central "hei, e și Maria". Biroul confirmă. OK.

A doua zi, Maria încearcă să se înscrie în eCabinet. eCabinet **NU întreabă biroul central** dacă există deja Maria. Verifică doar registrul propriu, nu găsește, deci o înscrie ca client nou. Apoi spune biroului "hei, e Maria". Biroul răspunde "Maria există deja" — dar pentru că PRO și eCabinet folosesc patterns diferite în spate, eCabinet uneori ignoră răspunsul, sau creează ca pe dublură.

Rezultat: aceeași persoană are 2-3 ID-uri diferite în 4pro-identity, sau apare ca pro_embedded într-un loc și standalone în altul.

### Fix recommended (în ordine de impact)

1. **PRO + eCabinet** (P0) — schimbă ordinea: verifică identity ÎNAINTE de a crea local. Dacă identity zice "există", returnează 409 cu URL de login. Dacă zice "nu există", create în identity FIRST, apoi mirror local cu `globalId`. Reference: `4pro-eat/src/app/api/v1/auth/register/route.ts` (commit `<TBD>` 2026-04-25).
2. **4pro-client** (P1) — opțional: ocolește proxy-ul către PRO și apelează identity direct (cleaner). Sau lasă proxy-ul după ce PRO e fix.
3. **4pro-biz** (P1) — la fel, fix-ul eCabinet remediază tranzitiv.
4. **Cleanup migration script** — pentru fiecare app, scriptul existent `4pro-eat/scripts/migrate-link-existing-identities.mjs` trebuie adaptat. Pattern: caut local users cu `globalId IS NULL`, întreb identity prin `/identity/exists`, dacă există deja sub alt globalId → re-link.

### Estimări effort

- PRO refactor: ~3h (register + login + tests + cleanup migration script)
- eCabinet refactor: ~3h
- 4pro-client cleanup: ~1h (după PRO)
- 4pro-biz cleanup: ~1h (după eCabinet)
- Cross-app cleanup migration (pentru utilizatori existenți deja duplicați): ~2h
- **Total: ~10h** plus QA / deploy + smoke fiecare

### Risk

NO-TOUCH CRITIC pe PRO + eCabinet (sunt prod live). Schimbările trebuie:
1. propose-confirm-apply per modificare (vezi `Master/CLAUDE.md` §2d)
2. backwards-compatible — useri existenți nu trebuie să resemneze
3. testat E2E înainte de deploy (TWG loop sau e2e-audit)

### Reference incident

Detectat în sesiunea 2026-04-25 când utilizatorul a încercat să creeze cont pe `eat.4pro.io` cu emailul folosit deja în PRO + eCabinet + Client. eat l-a creat duplicat. Vezi `4pro-eat/knowledge/lessons-learned.md` L01.


---

## [ ] GDPR Ecosystem Agreement — 4PRO (creat 2026-04-23)

**Prioritate:** High (pre-GA eat.4pro.io, pre-ML2 Wave 2 ecosystems, și pentru toate app-urile deja live).

**Context:** Userul a semnalat la 2026-04-23 că întreg ecosistemul 4PRO (deținut de **Fabulosos**) are nevoie de un acord GDPR cross-app complet — nu sunt clare rolurile controller/processor între Fabulosos și fiecare app (PRO, eCabinet, 4pro-client, 4pro-biz, 4pro-landing, 4pro-identity, 4pro-eat). Cu lansarea eat.4pro.io care include date sensibile (mese, poze meal, istoric nutriție, AI coach conversations) și integrare SSO mall-style (login once → access everywhere), este obligatoriu un cadru clar.

### Ce trebuie produs

1. **DPA master document** — Data Processing Agreement la nivel Fabulosos vs fiecare app. Definește:
   - Controller identity (Fabulosos most likely pentru toate gateway-urile user-facing)
   - Processor-ii (Neon DB, Stripe, OpenAI / Anthropic / Gemini pt AI Coach, Meta pt WhatsApp, Brevo / SendGrid pt email)
   - Data categories per app:
     - **eat**: meal logs + photos + health conditions — SPECIAL CATEGORY SENSITIVE (Art. 9)
     - **PRO**: fitness sessions + WhatsApp phone + goals
     - **eCabinet**: date medicale — SPECIAL CATEGORY (Art. 9)
     - **biz / landing / identity**: profile de bază, SSO tokens

2. **Sub-processor chain map** — pe ce furnizor merg datele (hosting VPS1 Hostinger Germany, Neon EU regions, S3 eu-central-1 pentru meal photos, provider AI region per call).

3. **Cross-app data flow diagram** — ce date traversează SSO (email, user_id, ± sex / birthdate / height / weight synced PRO → eat), ce NU traversează (meal logs stay în eat DB).

4. **Consent taxonomy unified** — granular consents compatibile cross-app:
   - `analytics_anonymized`
   - `photos_for_ai_training`
   - `anonymized_research_use`
   - `marketing_email`
   - `ai_coach_full_context`
   - `medical_data_processing` (pentru eCabinet + eat health conditions)
   - `fitness_tracking` (pentru PRO + eat activity sync)

5. **Retention policy matrix** — per data type:
   - `meal_photos`: 30d no-consent / 2y with consent + anonymized after 90d
   - `audit_log`: 3y (compliance)
   - `xp_events`: 1y granular, apoi aggregated
   - `payment_events`: 7y (legal tax retention RO/EU)
   - `user deletion cascade`: 30d grace period în fiecare app → hard delete

6. **Data export + deletion flow cross-app** — user cere ștergere în eat → propagare sau izolat pe PRO / eCabinet / Client? Ce se întâmplă cu invoice-urile în eCabinet (tax retention 7y) dacă user șterge contul în eat?

7. **Legal base per data category** (GDPR Art. 6):
   - `contract` (subscription + service provision)
   - `consent` (AI training, marketing)
   - `legitimate interest` (AI improvement, fraud detection)
   - `legal obligation` (payment records, medical records retention)

8. **DPO contact + incident response playbook** — cine primește notificările GDPR breach în 72h (Art. 33) și cum se coordonează între app-uri.

### Actions necesare

- [ ] Consultă avocat GDPR-specialized (Fabulosos must engage one if not already)
- [ ] Draft DPA v1 aliniată cu cerințele BE / RO / UE
- [ ] Update ToS + Privacy Policy pentru fiecare gateway (eat, PRO, eCabinet, Client, biz, landing)
- [ ] Implementează UI-ul granular consent consistent în fiecare app (un singur design pattern, reutilizat)
- [ ] Creează tabel centralizat `user_consents` în 4pro-identity DB pentru tracking cross-app (sau folosește Neon Auth dacă decideți să îl adoptați)
- [ ] Set up DPO email alias + DPO contact în footer-ul fiecărui site
- [ ] Procedură "right to be forgotten" — deletion API cross-app cu idempotency key

### Blochează

- **eat GA** (full public launch)
- **ML2 Wave 2** (4PRO batch audit — nu putem audita consent cross-app dacă consent-ul nu e definit)
- **Lansarea Client.4pro.io embedded pt eat** (embedded mode propagă consent state PRO → eat)

### Related files

- `Master/ECOSYSTEM_REGISTRY.md` → "Shared Services" section (SSO + credentials)
- `Master/CLASSIFICATION.md` → NO-TOUCH CRITIC proiecte (PRO, eCabinet) care procesează date sensibile
- `@aledan/ai-governance` → poate fi extins să injecteze GDPR context în toate apelurile Claude/AI
- `4pro-identity/` → locul natural pentru centralized consent storage

---

## [ ] 4pro-identity SSO secret mismatch — armed-but-dormant (creat 2026-04-29)

**Prioritate:** Medium acum / **P0 imediat ce flow-ul login se rutează prin 4pro-identity** (vezi item-ul "Cross-app SSO dedup audit" mai sus — fix-ul P0 PRO + eCabinet va declanșa direct acest bug).

**Context (verificat 2026-04-29):**
- `CLAUDE.md:21` declară corect: *"DO NOT MODIFY: SSO_JWT_SECRET must match across PRO/Client/eCabinet"*.
- DAR `src/lib/token.js:3-11` citește `process.env.JWT_SECRET` (NU `SSO_JWT_SECRET`) și folosește acea valoare atât la `jwt.sign` cât și la `jwt.verify`.
- VPS1 `/var/www/4pro-identity/.env` are `JWT_SECRET="4pro-identity-j..."` — divergent de canonical-ul ecosistemului `4d87a48546d9220e...` (folosit de 4pro-eat, 4pro-client, 4pro-biz, PRO, eCabinet).
- `src/routes/auth.js` setează activ cookie-ul `4pro_sso` cu token-ul semnat cu secretul greșit la lines 93, 136, 208, 258 (`setCookie(SSO_COOKIE, token, getCookieOptions())`).

**De ce nu se manifestă în prod azi:**
PRO este issuer-ul SSO activ (per `4pro-eat/AUDIT_GAPS.md` G-EAT-006 lessons). Niciun frontend nu rutează emiterea de token prin 4pro-identity. Endpoint-urile lui sunt folosite doar read-only (`/identity/exists` pentru cross-app dedup probe). Bugul e armed-but-not-triggered.

**Ce-l declanșează:**
Item-ul "Cross-app SSO dedup audit" de mai sus, pasul P0 PRO + eCabinet ("schimbă ordinea: verifică identity ÎNAINTE de a crea local"), va începe să ruteze login flow prin 4pro-identity. Din acel moment, fiecare login emite cookie cu secret greșit → toți consumer-ii (eat, client, biz, PRO, eCabinet) vor respinge cookie-ul → user redirected la `/login` în loop.

**Fix recommended (alege una):**

A. **Rename + align (preferat)** — modifică `src/lib/token.js` să citească `process.env.SSO_JWT_SECRET` în loc de `JWT_SECRET`, apoi setează `SSO_JWT_SECRET="4d87a48546d9220e..."` pe VPS1 `/var/www/4pro-identity/.env` (canonical din `Master/credentials/.env.shared`). Single source of truth; aliniat cu CLAUDE.md.

B. **Two-secret architecture** — păstrează `JWT_SECRET` pentru tokens interne identity-only (ex: refresh tokens, internal service-to-service), folosește `SSO_JWT_SECRET` separat pentru cookie-ul `4pro_sso` user-facing. Cere refactor `signToken` să accepte parametru `audience` și să folosească secretul corect per audiență.

C. **Document și amână** — dacă 4pro-identity rămâne intentional read-only (nu issuer SSO), elimină `setCookie(SSO_COOKIE, ...)` din `auth.js` (4 locații) ca să nu existe cale de declanșare. Riscul rămâne dacă cineva re-adaugă inadvertent.

**Risk dacă rămâne neresolved la fix-ul P0:** silent SSO failure pe TOT ecosistemul 4PRO simultan în momentul flip-ului. Toți userii care fac login după acel deploy vor fi blocați.

**Effort estimat:**
- Variant A: ~30 min (1 linie cod + 1 entry env + restart PM2 + smoke test)
- Variant B: ~2-3h (refactor signToken + tests)
- Variant C: ~10 min (delete 4 setCookie calls + tests)

**Reference:** investigare 2026-04-29 (sesiunea Direct pe 4pro-eat), `Master/HANDOFF-eat-session-2026-04-28.md` carry-forward CF#2.

---
