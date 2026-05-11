/**
 * Tests for resolveControllerEntity() behaviour in auth routes.
 * Covers: LEGAL_API_URL absent, Legal Hub 5xx, successful resolve,
 * and the isNewIdentity gate in verify-otp.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret-key';
process.env.COOKIE_DOMAIN = 'localhost';

const require = createRequire(import.meta.url);

// Minimal mock DB
const mockDb = { identities: [] };
let idCounter = 0;

const mockPrisma = {
  identity: {
    findUnique: async ({ where }) => {
      if (where.phone) return mockDb.identities.find(i => i.phone === where.phone) || null;
      if (where.email) return mockDb.identities.find(i => i.email === where.email) || null;
      if (where.globalId) return mockDb.identities.find(i => i.globalId === where.globalId) || null;
      return null;
    },
    create: async ({ data }) => {
      const identity = {
        globalId: `test-uuid-${++idCounter}`,
        email: null,
        avatarUrl: null,
        locale: 'ro',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      mockDb.identities.push(identity);
      return identity;
    },
  },
};

const prismaModule = require('../src/lib/prisma');
prismaModule.getClient = () => mockPrisma;

const twilioModule = require('../src/lib/twilio');
twilioModule.sendOTP = async () => ({ sid: 'mock', status: 'pending' });
twilioModule.verifyOTP = async () => ({ status: 'approved' });

const { build } = require('../src/server');
let app;

beforeAll(async () => {
  app = await build();
  await app.ready();
});

afterAll(async () => { await app.close(); });

beforeEach(() => {
  mockDb.identities = [];
  idCounter = 0;
  delete process.env.LEGAL_API_URL;
});

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe('POST /auth/register — Legal Hub integration', () => {
  it('succeeds and returns JWT without controllerEntitySlug when LEGAL_API_URL absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712000001', password: 'Password1', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBeUndefined();
  });

  it('embeds controllerEntitySlug in JWT when Legal Hub returns a slug', async () => {
    process.env.LEGAL_API_URL = 'http://localhost:9999';
    // Stub global fetch to simulate Legal Hub response
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ slug: 'class-rda-impex', id: '1', name: 'Class RDA Impex SRL' }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712000002', password: 'Password1', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBe('class-rda-impex');

    globalThis.fetch = originalFetch;
  });

  it('still returns 201 and omits slug when Legal Hub returns 5xx', async () => {
    process.env.LEGAL_API_URL = 'http://localhost:9999';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503 });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712000003', password: 'Password1', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBeUndefined();

    globalThis.fetch = originalFetch;
  });

  it('still returns 201 and omits slug when Legal Hub fetch throws (timeout/network)', async () => {
    process.env.LEGAL_API_URL = 'http://localhost:9999';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Network error'); };

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712000004', password: 'Password1', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBeUndefined();

    globalThis.fetch = originalFetch;
  });
});

// ---------------------------------------------------------------------------
// POST /auth/verify-otp
// ---------------------------------------------------------------------------

describe('POST /auth/verify-otp — Legal Hub integration', () => {
  it('embeds controllerEntitySlug for NEW identity (first OTP verify)', async () => {
    process.env.LEGAL_API_URL = 'http://localhost:9999';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ slug: 'class-rda-impex', id: '1', name: 'Class RDA Impex SRL' }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712000010', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBe('class-rda-impex');

    globalThis.fetch = originalFetch;
  });

  it('does NOT call Legal Hub for EXISTING identity (subsequent OTP verify)', async () => {
    process.env.LEGAL_API_URL = 'http://localhost:9999';
    // Pre-seed an existing identity
    mockDb.identities.push({
      globalId: 'existing-1',
      phone: '+40712000011',
      email: null,
      hashedPassword: null,
      forcePasswordSet: false,
      avatarUrl: null,
      locale: 'ro',
      firstName: 'Existing',
      lastName: 'User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let fetchCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCallCount++;
      return { ok: true, json: async () => ({ slug: 'class-rda-impex' }) };
    };

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712000011', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    // Legal Hub must NOT have been called for existing identity
    expect(fetchCallCount).toBe(0);
    const { jwt } = res.json();
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(payload.controllerEntitySlug).toBeUndefined();

    globalThis.fetch = originalFetch;
  });
});
