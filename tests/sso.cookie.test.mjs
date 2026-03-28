import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret-key';
process.env.COOKIE_DOMAIN = 'localhost';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'Lax';

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

const prismaModule = require('../src/lib/prisma');
prismaModule.getClient = () => mockPrisma;

const { build } = require('../src/server');
const { signToken } = require('../src/lib/token');

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

function parseCookies(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(c => {
    const parts = c.split(';').map(p => p.trim());
    const [nameVal, ...attrs] = parts;
    const [name, ...valParts] = nameVal.split('=');
    return {
      name,
      value: valParts.join('='),
      attributes: attrs.map(a => a.toLowerCase()),
      raw: c,
    };
  });
}

function findSsoCookie(res) {
  return parseCookies(res).find(c => c.name === '4pro_sso');
}

async function registerUser(payload) {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      phone: '+40712345678',
      password: 'SecurePass1!',
      firstName: 'Ion',
      lastName: 'Popescu',
      ...payload,
    },
  });
}

describe('SSO Cookie - Registration', () => {
  it('sets 4pro_sso cookie on register', async () => {
    const res = await registerUser();
    expect(res.statusCode).toBe(201);

    const cookie = findSsoCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie.value).toBeTruthy();
    expect(cookie.attributes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('httponly'),
      ])
    );
  });

  it('cookie value matches returned JWT', async () => {
    const res = await registerUser();
    const body = res.json();
    const cookie = findSsoCookie(res);
    expect(cookie.value).toBe(body.jwt);
  });
});

describe('SSO Cookie - Login', () => {
  it('sets 4pro_sso cookie on login', async () => {
    await registerUser();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+40712345678', password: 'SecurePass1!' },
    });
    expect(res.statusCode).toBe(200);

    const cookie = findSsoCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie.value).toBe(res.json().jwt);
  });
});

describe('SSO Cookie - Logout', () => {
  it('clears 4pro_sso cookie on logout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const cookie = findSsoCookie(res);
    expect(cookie).toBeDefined();
    // Cleared cookies have empty value or max-age=0
    expect(
      cookie.value === '' ||
      cookie.attributes.some(a => a.includes('max-age=0') || a.includes('expires='))
    ).toBe(true);
  });
});

describe('GET /auth/verify', () => {
  it('returns profile when valid SSO cookie is present', async () => {
    const regRes = await registerUser({ email: 'ion@4pro.io' });
    const { jwt: token, globalId } = regRes.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': token },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.globalId).toBe(globalId);
    expect(body.phone).toBe('+40712345678');
    expect(body.firstName).toBe('Ion');
    expect(body.email).toBe('ion@4pro.io');
    expect(body.hashedPassword).toBeUndefined();
  });

  it('returns 401 when no cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('SSO cookie missing');
  });

  it('returns 401 for expired/invalid JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': 'invalid.jwt.token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid or expired token');
  });

  it('returns 401 for tampered JWT', async () => {
    const regRes = await registerUser();
    const { jwt: token } = regRes.json();
    // Tamper with the token
    const tampered = token.slice(0, -5) + 'XXXXX';

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': tampered },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when identity no longer exists', async () => {
    // Sign a token for a non-existent globalId
    const token = signToken('nonexistent-id', '+40700000000');

    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      cookies: { '4pro_sso': token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Identity not found');
  });
});

describe('SSO Cookie - Domain config', () => {
  it('cookie domain matches COOKIE_DOMAIN env var', async () => {
    const res = await registerUser();
    const cookie = findSsoCookie(res);
    expect(cookie.attributes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('domain=localhost'),
      ])
    );
  });
});
