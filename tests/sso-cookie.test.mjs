import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);

// Ensure env is loaded
process.env.COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || 'localhost';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false';
process.env.COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'Lax';

const { build } = require('../src/server');
const { signToken } = require('../src/lib/token');

let app;

// Generate unique phone for each test run to avoid collisions
function uniquePhone() {
  const rand = Math.floor(Math.random() * 900000000) + 100000000;
  return `+40${rand}`;
}

beforeAll(async () => {
  app = await build();
});

afterAll(async () => {
  await app.close();
});

function findSsoCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const match = arr.find((c) => c.startsWith('4pro_sso='));
  return match || null;
}

async function registerUser(overrides = {}) {
  const phone = overrides.phone || uniquePhone();
  const payload = {
    phone,
    password: overrides.password || 'testpass123456',
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    ...overrides,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  });
  return { res, phone, password: payload.password };
}

describe('SSO Cookie - Register', () => {
  it('sets 4pro_sso cookie on successful register', async () => {
    const { res } = await registerUser();

    expect(res.statusCode).toBe(201);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('domain=localhost');
  });

  it('register response includes jwt and globalId in body', async () => {
    const { res } = await registerUser();
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
  });

  it('does not set cookie on invalid register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: 'bad', password: 'x', firstName: '', lastName: '' },
    });

    expect(res.statusCode).toBe(400);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeNull();
  });
});

describe('SSO Cookie - Login', () => {
  let phone;
  const password = 'securepass999999';

  beforeAll(async () => {
    const reg = await registerUser({ password });
    phone = reg.phone;
    expect(reg.res.statusCode).toBe(201);
  });

  it('sets 4pro_sso cookie on successful login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone, password },
    });

    expect(res.statusCode).toBe(200);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('domain=localhost');
  });

  it('login response includes jwt and globalId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone, password },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jwt).toBeDefined();
    expect(body.globalId).toBeDefined();
  });

  it('does not set cookie on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone, password: 'wrongpassword123' },
    });

    expect(res.statusCode).toBe(401);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeNull();
  });
});

describe('SSO Cookie - Logout', () => {
  it('clears the 4pro_sso cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeTruthy();
    // Cleared cookie should have domain set
    expect(cookie.toLowerCase()).toContain('domain=localhost');
  });
});

describe('SSO Cookie - Verify Endpoint', () => {
  it('returns profile when valid SSO cookie is present', async () => {
    const { res: regRes } = await registerUser({
      email: `verify-${Date.now()}@4pro.io`,
      firstName: 'Verify',
      lastName: 'User',
    });
    expect(regRes.statusCode).toBe(201);
    const { jwt } = JSON.parse(regRes.body);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': jwt },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.globalId).toBeDefined();
    expect(body.firstName).toBe('Verify');
    expect(body.lastName).toBe('User');
    expect(body.email).toContain('@4pro.io');
  });

  it('returns 401 when no cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('SSO cookie missing');
  });

  it('returns 401 for invalid/tampered JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': 'invalid.jwt.token' },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Invalid or expired token');
  });

  it('returns 401 for expired JWT', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(
      { globalId: crypto.randomUUID(), phone: '+40700000000' },
      process.env.JWT_SECRET,
      { expiresIn: '0s' }
    );

    await new Promise((r) => setTimeout(r, 50));

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': expired },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when user globalId not found in DB', async () => {
    // Use a valid UUID that doesn't exist in the DB
    const fakeUuid = crypto.randomUUID();
    const token = signToken(fakeUuid, '+40700000000');

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': token },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Identity not found');
  });
});

describe('SSO Cookie Attributes', () => {
  it('cookie has correct sameSite attribute', async () => {
    const { res } = await registerUser();
    expect(res.statusCode).toBe(201);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it('cookie has path=/', async () => {
    const { res } = await registerUser();
    expect(res.statusCode).toBe(201);
    const cookie = findSsoCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie.toLowerCase()).toContain('path=/');
  });
});
