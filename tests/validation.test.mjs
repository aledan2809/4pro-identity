import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { isValidE164, sanitizePhone } = require('../src/lib/validation');

describe('E.164 phone validation', () => {
  it('should accept valid E.164 numbers', () => {
    expect(isValidE164('+40712345678')).toBe(true);
    expect(isValidE164('+1234567890')).toBe(true);
    expect(isValidE164('+442079460958')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(isValidE164('0712345678')).toBe(false);
    expect(isValidE164('+0712345678')).toBe(false);
    expect(isValidE164('+')).toBe(false);
    expect(isValidE164('')).toBe(false);
    expect(isValidE164(null)).toBe(false);
    expect(isValidE164(undefined)).toBe(false);
    expect(isValidE164(12345)).toBe(false);
  });

  it('should sanitize phone input', () => {
    expect(sanitizePhone('+40 712 345 678')).toBe('+40712345678');
    expect(sanitizePhone('+40-712-345-678')).toBe('+40712345678');
    expect(sanitizePhone(null)).toBe('');
  });
});
