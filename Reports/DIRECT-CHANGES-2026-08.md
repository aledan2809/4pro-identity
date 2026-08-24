
## 2026-08-24 21:00 — Punctul 4: POST /identity/register + telefon opțional (commit `fa18df3`)

Decizie user (dimineața): punctul 4 la 21:00. Regim mesh: design pe contractul real al consumatorilor → dev → review advers (6 verificări; 2 întăriri aplicate din el) → deploy → E2E pe producție.

- **Ruta** `POST /identity/register` {email?, phone?, firstName?, lastName?, source} → 201 {globalId} / 409 / 400 — exact contractul pe care eCabinet îl cheamă din mai (`identityRegisterByEmail`) către o rută care nu a existat niciodată.
- **Gard S2S fail-closed** (`x-identity-api-key`, cheie partajată cu eCabinet, în seif): fără el, o rută deschisă permitea squatting de email nerecuperabil (identity nu are auth pe email). Rate limit 60/min (S2S localhost = o singură găleată).
- **Identity.phone opțional** — migrare `20260824210500_phone_optional` aplicată curat prin `prisma migrate deploy` (istoricul verificat ÎNAINTE pe prod: ambele migrări înregistrate). change-phone loghează oldPhone='' pentru identități fără telefon (calea prin care doar-email își setează primul telefon).
- **Bug frate găsit de E2E în eCabinet**: `User.phone` era și acolo NOT NULL → înscrierea fără telefon dădea 500 (pre-existent, mascat). Fix eCabinet `c117b22` + ALTER țintit pe prod (0 rânduri null la momentul schimbării).
- **E2E pe producție**: înscriere publică sintetică pe cabinet.4pro.io → **201 + globalId identic în ambele baze** (`User.globalId` = `Identity.globalId`, telefon null pe ambele) → conturi de test șterse. 403 fără cheie / 201 cu cheie / 409 duplicat verificate direct pe rută. L41: toate cele 6 fronturi + identity health 200.
- Suita: 90/90. **G-ECAB-REG-003(b) închis end-to-end.**
