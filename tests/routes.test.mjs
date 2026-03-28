import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret-key';
process.env.COOKIE_DOMAIN = 'localhost';

const require = createRequire(import.meta.url);

const mockDb = {
  identities: [],
  phoneLogs: [],
};

let idCounter = 0;

const mockPrisma = {
  identity: {
    findUnique: async ({ where, select }) => {
      let record = null;
      if (where.globalId) record = mockDb.identities.find(i => i.globalId === where.globalId) || null;
      else if (where.phone) record = mockDb.identities.find(i => i.phone === where.phone) || null;
      else if (where.email) record = mockDb.identities.find(i => i.email === where.email) || null;
      if (!record || !select) return record;
      const filtered = {};
      for (const key of Object.keys(select)) {
        if (select[key]) filtered[key] = record[key];
      }
      return filtered;
    },
    create: async ({ data }) => {
      const identity = {
        globalId: `test-uuid-${++idCounter}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        email: null,
        avatarUrl: null,
        locale: 'ro',
        ...data,
      };
      mockDb.identities.push(identity);
      return identity;
    },
    update: async ({ where, data, select }) => {
      const idx = mockDb.identities.findIndex(i => i.globalId === where.globalId);
      if (idx === -1) throw new Error('Not found');
      Object.assign(mockDb.identities[idx], data, { updatedAt: new Date() });
      const result = { ...mockDb.identities[idx] };
      if (select) {
        const filtered = {};
        for (const key of Object.keys(select)) {
          if (select[key]) filtered[key] = result[key];
        }
        return filtered;
      }
      return result;
    },
  },
  phoneChangeLog: {
    create: async ({ data }) => {
      const log = { id: ++idCounter, changedAt: new Date(), approvedBy: null, ...data };
      mockDb.phoneLogs.push(log);
      return log;
    },
  },
};

// Override the prisma module's getClient before loading server
const prismaModule = require('../src/lib/prisma');
prismaModule.getClient = () => mockPrisma;

const { build } = require('../src/server');

let app;

beforeAll(async () => {
  app = await build();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockDb.identities = [];
  mockDb.phoneLogs = [];
  idCounter = 0;
});

describe('GET /health', () => {
  it('should return ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /auth/register', () => {
  it('should register a new user and return jwt + globalId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+40712345678',
        password: 'SecurePass1!',
        firstName: 'Ion',
        lastName: 'Popescu',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
  });

  it('should reject invalid phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '0712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'short', firstName: 'A', lastName: 'B' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject missing firstName', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', lastName: 'B' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject missing lastName', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject duplicate phone', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass2!', firstName: 'C', lastName: 'D' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('should accept optional email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+40712345678',
        password: 'SecurePass1!',
        firstName: 'Ion',
        lastName: 'Popescu',
        email: 'ion@example.com',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockDb.identities[0].email).toBe('ion@example.com');
  });
});

describe('POST /auth/login', () => {
  it('should login and return jwt', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+40712345678', password: 'SecurePass1!' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
  });

  it('should reject wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+40712345678', password: 'WrongPass1!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject non-existent phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+40799999999', password: 'SecurePass1!' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /identity/:globalId', () => {
  it('should return profile for authenticated user', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'Ion', lastName: 'Popescu' },
    });
    const { jwt: token, globalId } = regRes.json();

    const res = await app.inject({
      method: 'GET',
      url: `/identity/${globalId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.firstName).toBe('Ion');
    expect(body.lastName).toBe('Popescu');
    expect(body.phone).toBe('+40712345678');
    expect(body.hashedPassword).toBeUndefined();
  });

  it('should reject unauthenticated request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/identity/some-id',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject accessing another user profile', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const { jwt: token } = regRes.json();

    const res = await app.inject({
      method: 'GET',
      url: '/identity/other-user-id',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /identity/:globalId', () => {
  it('should update profile fields', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'Ion', lastName: 'Popescu' },
    });
    const { jwt: token, globalId } = regRes.json();

    const res = await app.inject({
      method: 'PUT',
      url: `/identity/${globalId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Vasile', email: 'vasile@example.com', locale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.firstName).toBe('Vasile');
    expect(body.email).toBe('vasile@example.com');
    expect(body.locale).toBe('en');
  });

  it('should reject empty update', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const { jwt: token, globalId } = regRes.json();

    const res = await app.inject({
      method: 'PUT',
      url: `/identity/${globalId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /identity/change-phone', () => {
  it('should change phone with valid verification code', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const { jwt: token } = regRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/identity/change-phone',
      headers: { authorization: `Bearer ${token}` },
      payload: { newPhone: '+40799999999', verificationCode: '123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockDb.phoneLogs).toHaveLength(1);
    expect(mockDb.phoneLogs[0].oldPhone).toBe('+40712345678');
    expect(mockDb.phoneLogs[0].newPhone).toBe('+40799999999');
    expect(mockDb.identities[0].phone).toBe('+40799999999');
  });

  it('should reject invalid verification code', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const { jwt: token } = regRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/identity/change-phone',
      headers: { authorization: `Bearer ${token}` },
      payload: { newPhone: '+40799999999', verificationCode: '000000' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject invalid new phone format', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });
    const { jwt: token } = regRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/identity/change-phone',
      headers: { authorization: `Bearer ${token}` },
      payload: { newPhone: '0799999999', verificationCode: '123456' },
    });
    expect(res.statusCode).toBe(400);
  });
});
