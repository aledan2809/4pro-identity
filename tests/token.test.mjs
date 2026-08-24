import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret-key';

const require = createRequire(import.meta.url);
const { signToken, verifyToken } = require('../src/lib/token');

describe('JWT token', () => {
  it('should sign and verify a token with globalId and phone', () => {
    const globalId = '550e8400-e29b-41d4-a716-446655440000';
    const phone = '+40712345678';
    const token = signToken(globalId, phone);
    const payload = verifyToken(token);
    expect(payload.globalId).toBe(globalId);
    expect(payload.phone).toBe(phone);
  });

  it('should reject tokens signed without the ecosystem issuer', () => {
    const jwt = require('jsonwebtoken');
    // Same secret, no iss claim — the pre-May-2026 issuer-less shape.
    const foreign = jwt.sign({ globalId: 'x', phone: '+40700000001' }, process.env.SSO_JWT_SECRET, { expiresIn: '1h' });
    expect(() => verifyToken(foreign)).toThrow(/issuer/);
  });

  it('should reject tampered tokens', () => {
    const token = signToken('some-id', '+40700000000');
    expect(() => verifyToken(token + 'x')).toThrow();
  });

  it('should include expiry', () => {
    const token = signToken('some-id', '+40700000000');
    const payload = verifyToken(token);
    expect(payload.exp).toBeDefined();
    const expectedExp = Math.floor(Date.now() / 1000) + 86400;
    expect(Math.abs(payload.exp - expectedExp)).toBeLessThan(5);
  });
});
