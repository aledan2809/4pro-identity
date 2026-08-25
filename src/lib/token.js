const jwt = require('jsonwebtoken');

// Fail-closed (G-ID-002): without the real secret this service would silently
// sign tokens for all 7 consumer apps with a value readable from the repo.
const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET;
if (!SSO_JWT_SECRET) {
  console.error('[identity] FATAL: SSO_JWT_SECRET is not set — refusing to start.');
  process.exit(1);
}

const TOKEN_EXPIRY = '24h';
const SSO_ISSUER = process.env.SSO_ISSUER || 'https://id.4pro.io';

function signToken(globalId, phone, extra = {}) {
  return jwt.sign({ globalId, phone, ...extra }, SSO_JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
    issuer: SSO_ISSUER
  });
}

function verifyToken(token) {
  // Issuer is enforced: every ecosystem issuer (identity, PRO, 4pro-client,
  // 4pro-biz, eCabinet) has stamped it since May 2026 and the shortest-lived
  // pre-issuer tokens (biz, 30d) expired in June — a token without it is foreign.
  return jwt.verify(token, SSO_JWT_SECRET, { issuer: SSO_ISSUER, algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };
