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

// Mock Twilio service
const twilioModule = require('../src/lib/twilio');
let mockOtpStatus = 'approved';
twilioModule.sendOTP = async (phone) => ({ sid: 'mock-sid', status: 'pending' });
twilioModule.verifyOTP = async (phone, code) => ({ status: mockOtpStatus });

afterEach(() => { mockOtpStatus = 'approved'; });

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
  mockOtpStatus = 'approved';
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

    mockOtpStatus = 'pending';
    const res = await app.inject({
      method: 'POST',
      url: '/identity/change-phone',
      headers: { authorization: `Bearer ${token}` },
      payload: { newPhone: '+40799999999', verificationCode: '000000' },
    });
    expect(res.statusCode).toBe(401);
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

describe('POST /identity/register', () => {
  beforeEach(() => {
    mockDb.identities = [];
    idCounter = 0;
  });

  it('returns 403 without the S2S key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      payload: { email: 'oricine@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('registers an email-only identity and returns globalId (eCabinet contract)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'pacient@example.com', source: 'eCabinet' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().globalId).toBeTruthy();
    expect(mockDb.identities[0].email).toBe('pacient@example.com');
    expect(mockDb.identities[0].phone).toBeUndefined();
  });

  it('does not create a second row for a duplicate email (adopts the shell)', async () => {
    const first = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { email: 'dup@example.com' } });
    const res = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { email: 'dup@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().globalId).toBe(first.json().globalId);
    expect(mockDb.identities.length).toBe(1);
  });

  it('registers a phone-only identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { phone: '+40712345699', firstName: 'Ion', lastName: 'Pop' },
    });
    expect(res.statusCode).toBe(201);
    expect(mockDb.identities[0].phone).toBe('+40712345699');
    expect(mockDb.identities[0].firstName).toBe('Ion');
  });

  it('returns 409 for duplicate phone', async () => {
    await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { phone: '+40712345699' } });
    const res = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { phone: '+40712345699' } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when neither email nor phone is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { source: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { email: 'nu-e-email' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid phone', async () => {
    const res = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { phone: '12345' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('email is treated case-insensitively (anti-duplicate)', () => {
  beforeEach(() => {
    mockDb.identities = [];
    idCounter = 0;
  });

  it('stores the email lowercased', async () => {
    await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'Ion.Pop@Gmail.COM' },
    });
    expect(mockDb.identities[0].email).toBe('ion.pop@gmail.com');
  });

  it('a case-variant duplicate resolves to the SAME identity, never a second one', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'ion.pop@gmail.com' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'ION.POP@GMAIL.com' },
    });
    expect(res.json().globalId).toBe(first.json().globalId);
    expect(mockDb.identities.length).toBe(1);
  });

  it('/identity/exists finds a lowercase identity when probed with mixed case', async () => {
    await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'ion.pop@gmail.com' },
    });
    const res = await app.inject({ method: 'GET', url: '/identity/exists?email=Ion.Pop@GMAIL.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json().byEmail).toBe(true);
  });

  it('/auth/register stores the email lowercased too', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+40712345688', password: 'parola1234',
        firstName: 'Ion', lastName: 'Pop', email: 'Mixed.Case@Example.COM',
      },
    });
    expect(mockDb.identities[0].email).toBe('mixed.case@example.com');
  });
});

describe('PUT /identity/:globalId normalizes email too (no re-split)', () => {
  beforeEach(() => { mockDb.identities = []; idCounter = 0; });

  const jwtFor = (globalId) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ globalId, phone: '+40712345600' }, process.env.SSO_JWT_SECRET, {
      expiresIn: '5m', issuer: 'https://id.4pro.io',
    });
  };

  it('stores a profile-update email lowercased', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'first@example.com' },
    });
    const { globalId } = reg.json();
    const res = await app.inject({
      method: 'PUT', url: `/identity/${globalId}`,
      headers: { authorization: `Bearer ${jwtFor(globalId)}` },
      payload: { email: 'Second.Address@Example.COM' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDb.identities[0].email).toBe('second.address@example.com');
  });

  it('refuses to take over another identity email via case variation', async () => {
    await app.inject({
      method: 'POST', url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'victim@example.com' },
    });
    const mine = await app.inject({
      method: 'POST', url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s-key' },
      payload: { email: 'mine@example.com' },
    });
    const { globalId } = mine.json();
    const res = await app.inject({
      method: 'PUT', url: `/identity/${globalId}`,
      headers: { authorization: `Bearer ${jwtFor(globalId)}` },
      payload: { email: 'VICTIM@example.com' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /identity/register — unclaimed shells cannot lock anyone out', () => {
  beforeEach(() => { mockDb.identities = []; idCounter = 0; });

  const reg = (payload) => app.inject({
    method: 'POST', url: '/identity/register',
    headers: { 'x-identity-api-key': 'test-s2s-key' }, payload,
  });

  it('adopts an email-only shell instead of refusing (200 + same globalId)', async () => {
    const first = await reg({ email: 'victima@example.com', source: 'squatter' });
    const second = await reg({ email: 'victima@example.com', source: 'eCabinet' });
    expect(second.statusCode).toBe(200);
    expect(second.json().globalId).toBe(first.json().globalId);
    expect(second.json().adopted).toBe(true);
    expect(mockDb.identities.length).toBe(1);
  });

  it('still refuses when the identity has a password (someone proved it)', async () => {
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: {
        phone: '+40712345655', password: 'parola1234',
        firstName: 'Real', lastName: 'Om', email: 'real@example.com',
      },
    });
    const res = await reg({ email: 'real@example.com', source: 'eCabinet' });
    expect(res.statusCode).toBe(409);
  });

  it('still refuses when the identity has a phone', async () => {
    await reg({ email: 'cufon@example.com', phone: '+40712345644' });
    const res = await reg({ email: 'cufon@example.com', source: 'eCabinet' });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /identity/register S2S key comparison', () => {
  beforeEach(() => { mockDb.identities = []; idCounter = 0; });

  it('rejects a key of the same length but wrong content', async () => {
    const wrong = 'x'.repeat('test-s2s-key'.length);
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': wrong },
      payload: { email: 'oricine@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a multibyte key of equal character length with 403, not 500', async () => {
    const multibyte = 'ă'.repeat('test-s2s-key'.length);
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': multibyte },
      payload: { email: 'oricine@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a key that is a prefix of the real one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/identity/register',
      headers: { 'x-identity-api-key': 'test-s2s' },
      payload: { email: 'oricine@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /identity/change-phone (email-only identity sets first phone)', () => {
  beforeEach(() => {
    mockDb.identities = [];
    mockDb.phoneLogs = [];
    idCounter = 0;
  });

  it('lets a phone-less identity set its first phone (oldPhone logged as empty)', async () => {
    const reg = await app.inject({ method: 'POST', url: '/identity/register', headers: { 'x-identity-api-key': 'test-s2s-key' }, payload: { email: 'nofon@example.com' } });
    const { globalId } = reg.json();
    const jwt = (await import('module')).createRequire(import.meta.url)('jsonwebtoken')
      .sign({ globalId, phone: null }, process.env.SSO_JWT_SECRET, { expiresIn: '5m', issuer: 'https://id.4pro.io' });
    mockOtpStatus = 'approved';
    const res = await app.inject({
      method: 'POST',
      url: '/identity/change-phone',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { newPhone: '+40712345677', verificationCode: '000000' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDb.phoneLogs[0].oldPhone).toBe('');
    expect(mockDb.identities[0].phone).toBe('+40712345677');
  });
});

describe('POST /auth/send-otp', () => {
  it('should send OTP for valid phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: { phone: '+40712345678' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('should reject invalid phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: { phone: '0712345678' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/verify-otp', () => {
  it('should create new user and return forcePasswordSet on first OTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
    expect(body.forcePasswordSet).toBe(true);
    expect(mockDb.identities).toHaveLength(1);
    expect(mockDb.identities[0].forcePasswordSet).toBe(true);
  });

  it('should return existing user without forcePasswordSet if password exists', async () => {
    // Pre-create user with password via register
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: '+40712345678', password: 'SecurePass1!', firstName: 'A', lastName: 'B' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.forcePasswordSet).toBe(false);
  });

  it('should reject invalid OTP code', async () => {
    mockOtpStatus = 'pending';
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject missing code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/set-password', () => {
  it('should set password after OTP verification', async () => {
    // Create user via OTP
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'NewSecure1!', confirmPassword: 'NewSecure1!' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
    expect(mockDb.identities[0].forcePasswordSet).toBe(false);
    expect(mockDb.identities[0].hashedPassword).toBeDefined();
  });

  it('should reject mismatched passwords', async () => {
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'NewSecure1!', confirmPassword: 'Different1!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject short password', async () => {
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'short', confirmPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject password without uppercase', async () => {
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'nouppercase1', confirmPassword: 'nouppercase1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject password without number', async () => {
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'NoNumberHere!', confirmPassword: 'NoNumberHere!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      payload: { password: 'NewSecure1!', confirmPassword: 'NewSecure1!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should allow login with phone+password after set-password', async () => {
    // OTP flow
    const otpRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: { phone: '+40712345678', code: '123456' },
    });
    const { jwt: otpToken } = otpRes.json();

    // Set password
    await app.inject({
      method: 'POST',
      url: '/auth/set-password',
      headers: { authorization: `Bearer ${otpToken}` },
      payload: { password: 'NewSecure1!', confirmPassword: 'NewSecure1!' },
    });

    // Login with phone + password
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+40712345678', password: 'NewSecure1!' },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().jwt).toBeDefined();
  });
});

describe('GET /identity/exists', () => {
  beforeEach(() => {
    mockDb.identities = [];
    idCounter = 0;
  });

  it('returns 400 when no email and no phone provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/identity/exists' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await app.inject({ method: 'GET', url: '/identity/exists?email=not-an-email' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid phone format', async () => {
    const res = await app.inject({ method: 'GET', url: '/identity/exists?phone=12345' });
    expect(res.statusCode).toBe(400);
  });

  it('returns exists=false for unknown email', async () => {
    const res = await app.inject({ method: 'GET', url: '/identity/exists?email=ghost@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false, byEmail: false, byPhone: false });
  });

  it('returns exists=true byEmail for matching email', async () => {
    mockDb.identities.push({
      globalId: 'g-1', phone: '+40700000001', email: 'known@example.com',
      firstName: 'A', lastName: 'B', avatarUrl: null, locale: 'ro',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await app.inject({ method: 'GET', url: '/identity/exists?email=known@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: true, byEmail: true, byPhone: false });
  });

  it('returns exists=true byPhone for matching phone', async () => {
    mockDb.identities.push({
      globalId: 'g-2', phone: '+40700000002', email: null,
      firstName: 'C', lastName: 'D', avatarUrl: null, locale: 'ro',
      createdAt: new Date(), updatedAt: new Date(),
    });
    // URL-encode the leading + (else Fastify decodes bare + as space).
    const res = await app.inject({ method: 'GET', url: '/identity/exists?phone=%2B40700000002' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: true, byEmail: false, byPhone: true });
  });

  it('does NOT leak globalId or profile fields', async () => {
    mockDb.identities.push({
      globalId: 'g-3-secret-leak', phone: '+40700000003', email: 'leak@example.com',
      firstName: 'Should', lastName: 'NotLeak', avatarUrl: null, locale: 'ro',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await app.inject({ method: 'GET', url: '/identity/exists?email=leak@example.com' });
    const body = res.json();
    expect(body).toEqual({ exists: true, byEmail: true, byPhone: false });
    expect(body.globalId).toBeUndefined();
    expect(body.firstName).toBeUndefined();
    expect(body.phone).toBeUndefined();
  });
});
