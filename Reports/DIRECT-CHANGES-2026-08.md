
## 2026-08-24 21:00 — Punctul 4: POST /identity/register + telefon opțional (commit `fa18df3`)

Decizie user (dimineața): punctul 4 la 21:00. Regim mesh: design pe contractul real al consumatorilor → dev → review advers (6 verificări; 2 întăriri aplicate din el) → deploy → E2E pe producție.

- **Ruta** `POST /identity/register` {email?, phone?, firstName?, lastName?, source} → 201 {globalId} / 409 / 400 — exact contractul pe care eCabinet îl cheamă din mai (`identityRegisterByEmail`) către o rută care nu a existat niciodată.
- **Gard S2S fail-closed** (`x-identity-api-key`, cheie partajată cu eCabinet, în seif): fără el, o rută deschisă permitea squatting de email nerecuperabil (identity nu are auth pe email). Rate limit 60/min (S2S localhost = o singură găleată).
- **Identity.phone opțional** — migrare `20260824210500_phone_optional` aplicată curat prin `prisma migrate deploy` (istoricul verificat ÎNAINTE pe prod: ambele migrări înregistrate). change-phone loghează oldPhone='' pentru identități fără telefon (calea prin care doar-email își setează primul telefon).
- **Bug frate găsit de E2E în eCabinet**: `User.phone` era și acolo NOT NULL → înscrierea fără telefon dădea 500 (pre-existent, mascat). Fix eCabinet `c117b22` + ALTER țintit pe prod (0 rânduri null la momentul schimbării).
- **E2E pe producție**: înscriere publică sintetică pe cabinet.4pro.io → **201 + globalId identic în ambele baze** (`User.globalId` = `Identity.globalId`, telefon null pe ambele) → conturi de test șterse. 403 fără cheie / 201 cu cheie / 409 duplicat verificate direct pe rută. L41: toate cele 6 fronturi + identity health 200.
- Suita: 90/90. **G-ECAB-REG-003(b) închis end-to-end.**

## 2026-08-25 — Findings audit 4PRO: 4 din 6 rezolvate aici (`7e52ac3` + `e67a138`)

Regim mesh, fiecare cu verificare pe producție. Premisele auditului au fost verificate, nu presupuse — două s-au dovedit greșite.

- **#1 email insensibil la majuscule**: normalizare la register S2S, /auth/register, /identity/exists **și la actualizarea profilului**. Ultimul a fost prins de self-review și era cel mai grav: fără el, `PUT` putea scrie o variantă cu majuscule care **ocolea unicitatea** (UNIQUE în PG e case-sensitive), lăsând doi oameni cu același email real. Backfill: 1 rând, zero coliziuni. Verificat live: stocare mică, 409 pe variantă, /exists găsește indiferent de capitalizare.
- **#3 limite de rată**: auditul propunea `trustProxy` — **premisă falsă**, nu există niciun nginx în fața portului 4100 (verificat), iar setarea ar fi permis oricui să-și falsifice cheia de limitare. Cauza reală: toți consumatorii cheamă prin `localhost`. Fix: `keyGenerator` pe telefonul vizat + **`hook: 'preHandler'`** (la `onRequest` corpul nu e citit încă — prima încercare a colapsat tăcut în aceeași găleată, prins pe server real) + plafon global dimensionat pentru trafic S2S. Probat live: găleți separate per telefon.
- **#4 cheie S2S timing-safe**: comparație pe **octeți**, nu caractere — varianta pe caractere arunca la un antet cu diacritice de aceeași lungime → 500 în loc de 403 (al doilea defect prins de self-review). Verificat live.
- **#5** `verifyToken` pinuiește `algorithms:['HS256']`, ca `magic-link.js`. Test golden cu `alg=none`.
- **#2 ocuparea emailului**: o adresă neprobată nu mai poate bloca pe nimeni. Identity **adoptă** coaja nerevendicată (fără parolă ȘI fără telefon) returnând 200 cu același globalId; o identitate revendicată real întoarce 409 ca înainte. Verificat live ambele jumătăți, inclusiv scenariul complet prin înscrierea publică eCabinet.

Suita: 103/103 (21 teste noi). Mutation-check pe cele 3 teste critice de la #1/#4.
