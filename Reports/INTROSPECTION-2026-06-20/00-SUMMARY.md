# 00 — SUMMARY (pe limbaj simplu) — 4pro-identity

> Audit READ-ONLY (introspecție, fără modificări de cod) — 2026-06-20.
> 4pro-identity = **inima de login a întregului ecosistem 4PRO**. Cine controlează acest serviciu poate emite identitate validă pentru TOATE cele 7 aplicații (PRO, eCabinet, eat, client, biz, landing). De aceea securitatea contează cel mai mult aici.

---

## Verdict

**Serviciu mic, curat, bine făcut pe fundamentele de bază — DAR are 1 problemă de securitate gravă (cheia secretă) + 2 probleme medii care țin de modul cum se verifică token-urile.** Nu e o catastrofă, dar pentru că e "cheia de la toate ușile", ce e P0 aici trebuie tratat cu prioritate maximă.

Notă: serviciul **nu are interfață web** (nu are pagini de click). E un serviciu "din spate" (backend) pe care îl folosesc celelalte aplicații. De aceea NU am produs un "ghid pe pagini" și NU am rulat auditul vizual extern — n-ar avea ce să verifice.

## Cât de avansat e

Mai avansat decât scrie în documente. CLAUDE.md zice "11 teste, JWT + telefon" — în realitate sunt **~80 de teste**, plus integrare cu Legal Hub (consimțăminte GDPR), magic-link prin WhatsApp, login prin OTP (cod SMS Twilio), schimbare de telefon cu verificare. Concluzie: **documentația e rămasă în urmă; codul e mai bogat. Nu tăiem nimic — ridicăm documentația la nivelul codului.**

## Securitate (cel mai important capitol aici)

- 🔴 **Cheia secretă SSO are o "parolă de avarie" hardcodată** (`dev-secret-change-me`). Dacă pe server lipsește variabila corectă (`SSO_JWT_SECRET`), serviciul folosește automat această cheie publică, cunoscută de oricine citește codul → oricine ar putea fabrica login-uri valide pentru tot ecosistemul. **Plus**: `.env`-ul local definește `JWT_SECRET`, dar codul citește `SSO_JWT_SECRET` — nume diferite → mare risc de a rula chiar pe cheia de avarie.
- 🟠 **La verificarea token-ului NU se verifică cine l-a emis** (claim-ul `issuer`). Token-ul e semnat cu `issuer: id.4pro.io`, dar la verificare nimeni nu controlează asta. Consumatorii (ex. eat) DA verifică issuer — deci serviciul-emitent e mai laxist decât clienții lui.
- 🟠 **Token-urile nu au "audiență" (`aud`) și nu există token de refresh** — token-ul de login trăiește 24h fix, nu se poate revoca, și un token bun pentru o aplicație e bun pentru toate.
- 🟢 **Parolele sunt bine securizate** (bcrypt cost 12). Rate-limiting există pe login/register/OTP (bun). Bug-ul vechi de "cod OTP magic 123456" a fost deja reparat (G-ID-001).
- 🟡 **11 vulnerabilități în dependențe** (npm audit) — dar toate vin din `hono`/`qs` aduse tranzitiv de uneltele de build Prisma, NU din serverul care rulează în producție. Risc real mic, dar de curățat.

## Oportunități (fără limbaj de "AI")

Migrare graduală spre standardul industriei: chei asimetrice (RS256 + JWKS) ca să nu mai existe o singură cheie comună care semnează ȘI verifică peste tot; token-uri scurte (15 min) + refresh-token rotativ; adăugarea claim-ului `aud` ca un token pentru o aplicație să nu meargă la alta.

## Ordine fix (PROPUNERI — așteaptă review)

1. **P0** — Elimină cheia de avarie din `token.js` + aliniază numele variabilei (`SSO_JWT_SECRET`) + verifică pe VPS că e setată corect.
2. **P0/P1** — Verifică `issuer` la `verifyToken` (1 linie).
3. **P1** — `npm audit fix` pe dependențele de build.
4. **P2** — adaugă `aud`, token scurt + refresh rotativ (mai mare, plan dedicat).
5. **P2** — ridică documentația (STRATEGY/README/CONTEXT lipsesc) + actualizează CLAUDE.md.

## Ce ai TU de făcut (rezumat)

- Decizie + confirmare pe fix-urile P0/P1 (sunt mici, dar pe NO-TOUCH-ish SSO core → propose-confirm).
- Pe VPS1: verifică că `/var/www/4pro-identity/.env` are `SSO_JWT_SECRET` setat (NU `JWT_SECRET`) și că e identic cu cel din PRO/eCabinet/eat/client.
- Decizie strategică: vrei migrare la RS256/JWKS (recomandat pe termen mediu) sau rămânem pe secret comun cu hardening?

> Detalii complete: `01-gap-strategy-vs-code.md`, `03-deep-research-optimization.md`, `04b-security-audit.md`.
