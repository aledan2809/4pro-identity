const jwt = require('jsonwebtoken');

const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRY = '24h';

function signToken(globalId, phone, extra = {}) {
  return jwt.sign({ globalId, phone, ...extra }, SSO_JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
    issuer: process.env.SSO_ISSUER || 'https://id.4pro.io'
  });
}

function verifyToken(token) {
  return jwt.verify(token, SSO_JWT_SECRET);
}

module.exports = { signToken, verifyToken };
