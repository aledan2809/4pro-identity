# Deep Research — Optimizare & WOW Effect

> Benchmark al `4pro-identity` (issuer SSO al ecosistemului 4PRO) față de furnizorii de identitate/SSO din 2026 (Auth0, Clerk, Keycloak, WorkOS, Supabase Auth, Ory) + best-practices actuale pe JWT/JWKS, token lifetimes, refresh-token rotation, session security, OIDC, secret management, MFA.
>
> Context curent (read-only): Fastify + jsonwebtoken, **HS256** cu **secret comun** ecosistem-wide, token **24h fix**, **fără refresh-token**, **fără `aud`**, **fără JWKS**, OTP prin Twilio Verify, magic-link WhatsApp, integrare Legal Hub.

---

## Unde se situează 4pro-identity față de standardul 2026

| Dimensiune | 4pro-identity azi | Standard industrie 2026 | Gap |
|---|---|---|---|
| Algoritm semnare | HS256, secret partajat (oricine semnează poate emite) | RS256/ES256/EdDSA asimetric pentru sisteme distribuite; HS256 doar când issuer = singurul verifier | 🔴 mare |
| Rotație chei | manuală, dureroasă (un secret pe toate app-urile) | JWKS: rotezi cheia, verifierii preiau automat din endpoint pinned | 🔴 mare |
| Verificare claims | doar semnătură (fără `iss`/`aud` la verify) | obligatoriu `exp`+`iss`+`aud`+`iat`; algoritm pinned | 🟠 mediu |
| Access token lifetime | 24h | 5-15 min (acces) | 🟠 mediu |
| Refresh token | inexistent | rotativ, hashat în DB, reuse-detection (revocă familia) | 🟠 mediu |
| Revocare/logout | logout doar șterge cookie (token rămâne valid) | revocare familie + token list / introspection | 🟠 mediu |
| MFA | OTP SMS (factor unic, sau parolă) | MFA opțional TOTP/passkeys; SMS = cel mai slab factor | 🟡 mic |
| Stocare token client | cookie httpOnly+Secure+SameSite | ✅ deja conform | ✅ OK |

Concluzie: pe **fundamente operaționale** (cookie, rate-limit, bcrypt) ești la nivel; pe **arhitectura criptografică a SSO** ești pe modelul "secret comun HS256" pe care providerii enterprise (Keycloak, Auth0, WorkOS) l-au depășit în favoarea asimetricului + JWKS exact pentru cazul "mai multe servicii care verifică același token".

---

## Top 10 optimizări (ordonate impact/efort)

1. **Elimină secret-fallback hardcodat + fail-closed** (P0, 10 min) — `token.js`. Cea mai importantă, cost minim. (vezi `04b` F1)
2. **Verifică `issuer` + pin `algorithms:['HS256']` la `verifyToken`** (P1, 1 linie) — aliniere cu consumatorii (eat verifică deja). (`04b` F2/F2b)
3. **`npm audit fix`** pe lanțul hono/qs (P1, 15 min). (`04b` F7)
4. **Setează `subject: globalId` explicit la semnare** (P1, mic) — contract `sub` standard pentru toți consumatorii; elimină fragilitatea `globalId ?? sub` din eat/client.
5. **Adaugă `aud`** (per-app sau `4pro-ecosystem`) + cere consumatorilor să-l verifice (P2, coordonat) — previne replay cross-service (OWASP).
6. **Access token scurt (15 min) + refresh-token rotativ hashat** cu reuse-detection (P2, plan dedicat) — standardul CIAM 2026. Model nou `RefreshToken{tokenHash,globalId,family,...}`.
7. **Migrare la RS256 + endpoint JWKS** (`/.well-known/jwks.json`) (strategic) — issuer semnează cu cheie privată, consumatorii verifică cu cheia publică din JWKS → rotație de chei fără downtime, fără secret comun de protejat peste tot.
8. **`@fastify/helmet`** pentru HSTS + nosniff (P2, mic). (`04b` F9)
9. **Strânge enumerarea**: răspuns generic la `magic-link/generate` + limită mai strictă pe `/identity/exists` (P2). (`04b` F5)
10. **Politică parolă consistentă register vs set-password** + check împotriva parolelor compromise (P2). (`04b` F4)

---

## 5 idei WOW

1. **OIDC discovery real** — expune `/.well-known/openid-configuration` + `/.well-known/jwks.json`. Brusc `id.4pro.io` devine un Identity Provider standard pe care orice librărie OIDC (inclusiv viitoare app-uri terțe sau integratori) îl consumă out-of-the-box, fără să mai partajezi manual secrete. E pasul care transformă "microserviciu intern" în "IdP al ecosistemului".
2. **Passkeys / WebAuthn (passwordless)** — login fără parolă, rezistent la phishing, peste fundația existentă (OTP-first deja există). Diferențiator de UX major pentru utilizatorii 4PRO.
3. **Token family + reuse-detection ca semnal de fraudă** — când un refresh-token e refolosit după invalidare, revoci familia ȘI notifici utilizatorul ("ți s-a accesat contul de pe alt dispozitiv"). Transformi un furt de token dintr-o capabilitate pe termen lung într-un eveniment detectabil + alertabil.
4. **Sesiuni & dispozitive vizibile utilizatorului** — pagină "dispozitivele tale conectate" + buton "deconectează peste tot" (posibil odată ce ai refresh-token families). Feature de încredere pe care îl au Google/Auth0.
5. **Step-up auth pentru acțiuni sensibile** — `change-phone`, DSR-delete, set-password cer re-verificare (OTP/passkey) chiar dacă sesiunea e validă. Deja parțial (change-phone cere OTP) — generalizat devine un pattern de securitate elegant.

---

## Quick wins vs Strategic bets

**Quick wins (ore, risc mic):** #1 fail-closed secret · #2 issuer+alg pinning · #3 npm audit fix · #4 `subject` explicit · #8 helmet · #9 anti-enumerare. → închid toate găurile P0/P1 fără schimbare arhitecturală.

**Strategic bets (plan dedicat, coordonare ecosistem):** #6 refresh-token rotativ · #7 RS256+JWKS · WOW #1 OIDC discovery · WOW #2 passkeys. → necesită modificări coordonate la toți cei 7 consumatori (mai ales #5 `aud` și #7 verificare cu cheie publică) → migrare în faze, cu compat dual-verify (acceptă vechi+nou în fereastra de tranziție).

**Ordinea recomandată:** întâi quick-wins (1→4, 8, 9), apoi `subject`+`aud` ca pregătire de contract, apoi RS256/JWKS + refresh-token ca proiect arhitectural cu plan de rollout dual-key.

---

## Surse

- [WorkOS — RS256 vs HS256: deep dive into JWT signing algorithms](https://workos.com/blog/rs256-vs-hs256-jwt-signing-algorithms)
- [SuperTokens — RS256 vs HS256](https://supertokens.com/blog/rs256-vs-hs256)
- [jwtsecrets.com — HS256 vs RS256: Which JWT Algorithm Should You Use?](https://jwtsecrets.com/blog/hs256-vs-rs256-jwt-algorithm)
- [SSOJet — Handling JWT for Enterprise Auth: validation, rotation, pitfalls](https://ssojet.com/blog/how-to-handle-jwt-in-java-for-enterprise-authentication-validation-rotation-and-pitfalls)
- [ECOSIRE — JWT Authentication: Security Best Practices in 2026](https://ecosire.com/blog/jwt-authentication-best-practices)
- [env.dev — JWT Best Practices: Storage, Algorithms & Revocation](https://env.dev/guides/jwt-best-practices)
- [SSOJet — Best practices for server-side JWT token handling](https://ssojet.com/ciam-qna/best-practices-for-server-side-jwt-token-handling)
- [guptadeepak.com — Token Lifetime Best Practices (Access/Refresh/ID/Session) 2026](https://guptadeepak.com/ciam-compass/guides/token-lifetime-best-practices/)
- [Auth0 Docs — Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [Okta Developer — Refresh access tokens and rotate refresh tokens](https://developer.okta.com/docs/guides/refresh-tokens/main/)
- [Obsidian Security — Refresh Token Security: Best Practices](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)
- [Security Boulevard — What are Refresh Tokens? Implementation & Security (2026)](https://securityboulevard.com/2026/01/what-are-refresh-tokens-complete-implementation-guide-security-best-practices/)
- [nhimg.org — JWT audience validation failures create replay risk across services](https://nhimg.org/articles/jwt-audience-validation-failures-create-replay-risk-across-services/)
- [OWASP — REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP — OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- [LoginRadius — JWT Validation Checklist](https://www.loginradius.com/blog/identity/jwt-validation-checklist-tokens)
- [phasetwo.io — JWT Security Best Practices](https://phasetwo.io/articles/jwts/jwt-security-best-practices/)
- [LeanCode — IAM Solutions Compared: Ory Kratos, Keycloak, Auth0, Supabase, Firebase](https://leancode.co/blog/identity-management-solutions-part-2-the-choice)
- [Descope — Top 8 WorkOS Alternatives for B2B Auth & SSO](https://www.descope.com/blog/post/workos-alternatives)
- [Just After Midnight — Clerk vs Auth0 vs Keycloak vs FusionAuth](https://www.justaftermidnight247.com/insights/clerk-vs-auth0-vs-keycloak-vs-fusionauth/)
- [Skycloak — Top Auth0 Alternatives in 2026: Open Source and Managed](https://skycloak.io/blog/auth0-alternatives-open-source-managed/)
- [DanubeData — Self-Host Authentik or Keycloak: Open-Source Auth0 Alternatives (2026)](https://danubedata.ro/blog/self-host-authentik-keycloak-auth0-alternative-2026)
- [APIsec — JWT Security Vulnerabilities: Prevention Guide](https://www.apisec.ai/blog/jwt-security-vulnerabilities-prevention)
