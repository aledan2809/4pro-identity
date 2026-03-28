import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword } = require('../src/lib/password');

describe('password hashing', () => {
  it('should hash a password and return a bcrypt hash string', async () => {
    const hash = await hashPassword('TestPass123!');
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(50);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('should produce different hashes for same password', async () => {
    const h1 = await hashPassword('SamePassword1!');
    const h2 = await hashPassword('SamePassword1!');
    expect(h1).not.toBe(h2);
  });

  it('should verify correct password', async () => {
    const password = 'MySecretPass99!';
    const hash = await hashPassword(password);
    const result = await verifyPassword(password, hash);
    expect(result).toBe(true);
  });

  it('should reject wrong password', async () => {
    const hash = await hashPassword('CorrectPassword1!');
    const result = await verifyPassword('WrongPassword1!', hash);
    expect(result).toBe(false);
  });

  it('should reject empty password', async () => {
    const hash = await hashPassword('ValidPass123!');
    const result = await verifyPassword('', hash);
    expect(result).toBe(false);
  });
});
