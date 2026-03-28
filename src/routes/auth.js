const { getClient } = require('../lib/prisma');
const { hashPassword, verifyPassword } = require('../lib/password');
const { isValidE164, sanitizePhone } = require('../lib/validation');
const { signToken, verifyToken } = require('../lib/token');

const SSO_COOKIE = '4pro_sso';

function getCookieOptions() {
  return {
    domain: process.env.COOKIE_DOMAIN || 'localhost',
    path: '/',
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: (process.env.COOKIE_SAMESITE || 'Lax').toLowerCase(),
    maxAge: 60 * 60 * 24, // 1 day in seconds
  };
}

const PROFILE_SELECT = {
  globalId: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
};

async function authRoutes(fastify) {
  // POST /auth/register
  fastify.post('/register', async (request, reply) => {
    const { phone, password, firstName, lastName, email, avatarUrl, locale } = request.body || {};

    const sanitized = sanitizePhone(phone);
    if (!isValidE164(sanitized)) {
      return reply.code(400).send({
        error: 'Invalid phone format. Must be E.164 (e.g. +40712345678)',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return reply.code(400).send({
        error: 'Password must be at least 8 characters',
      });
    }

    if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
      return reply.code(400).send({ error: 'firstName is required' });
    }

    if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
      return reply.code(400).send({ error: 'lastName is required' });
    }

    if (email !== undefined && email !== null) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }
    }

    const existing = await getClient().identity.findUnique({ where: { phone: sanitized } });
    if (existing) {
      return reply.code(409).send({ error: 'Phone number already registered' });
    }

    if (email) {
      const emailExists = await getClient().identity.findUnique({ where: { email } });
      if (emailExists) {
        return reply.code(409).send({ error: 'Email already registered' });
      }
    }

    const hashedPassword = await hashPassword(password);
    const data = {
      phone: sanitized,
      hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };

    if (email) data.email = email;
    if (avatarUrl) data.avatarUrl = avatarUrl;
    if (locale) data.locale = locale;

    const identity = await getClient().identity.create({ data });

    const token = signToken(identity.globalId, identity.phone);

    reply
      .setCookie(SSO_COOKIE, token, getCookieOptions())
      .code(201)
      .send({ jwt: token, globalId: identity.globalId });
  });

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    const { phone, password } = request.body || {};

    const sanitized = sanitizePhone(phone);
    if (!isValidE164(sanitized)) {
      return reply.code(400).send({ error: 'Invalid phone format' });
    }

    if (!password || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Password is required' });
    }

    const identity = await getClient().identity.findUnique({
      where: { phone: sanitized },
    });

    if (!identity) {
      fastify.log.warn({ phone: sanitized }, 'Auth failed: phone not found');
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, identity.hashedPassword);
    if (!valid) {
      fastify.log.warn(
        { phone: sanitized, globalId: identity.globalId },
        'Auth failed: wrong password'
      );
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = signToken(identity.globalId, identity.phone);

    reply
      .setCookie(SSO_COOKIE, token, getCookieOptions())
      .send({
        jwt: token,
        globalId: identity.globalId,
      });
  });

  // POST /auth/logout
  fastify.post('/logout', async (request, reply) => {
    reply
      .clearCookie(SSO_COOKIE, {
        domain: process.env.COOKIE_DOMAIN || 'localhost',
        path: '/',
      })
      .send({ success: true });
  });

  // GET /auth/verify — validate SSO cookie and return identity profile
  fastify.get('/verify', async (request, reply) => {
    const token = request.cookies?.[SSO_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: 'SSO cookie missing' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const identity = await getClient().identity.findUnique({
      where: { globalId: payload.globalId },
      select: PROFILE_SELECT,
    });

    if (!identity) {
      return reply.code(401).send({ error: 'Identity not found' });
    }

    return reply.send(identity);
  });
}

module.exports = authRoutes;
