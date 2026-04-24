# 4PRO Ecosystem — TODO Persistent

> **Scope:** items cross-app care afectează **întregul ecosistem 4PRO** (PRO, eCabinet, 4pro-client, 4pro-biz, 4pro-landing, 4pro-identity, 4pro-eat, sau SSO / data layer / GDPR shared între ele).
>
> **Ubicație:** acest file trăiește în `4pro-identity/` pentru că identity/auth este hub-ul SSO al ecosistemului (user accounts, consent records, data subject rights — toate converg aici).
>
> **Per-app items** merg în `<app>/TODO_PERSISTENT.md` (ex: `4pro-eat/TODO_PERSISTENT.md`, `eCabinet/TODO_PERSISTENT.md`).
>
> **Master-level items** (cross-ecosystem, multi-proiect independent) merg în `Master/TODO_PERSISTENT.md`.

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
