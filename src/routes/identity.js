const { getClient } = require('../lib/prisma');
const { isValidE164, sanitizePhone } = require('../lib/validation');
const { verifyToken } = require('../lib/token');

function authenticate(request, reply) {
  const token = request.cookies?.['4pro_sso'] || extractBearer(request);
  if (!token) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }

  try {
    return verifyToken(token);
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return null;
  }
}

function extractBearer(request) {
  const auth = request.headers?.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
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

async function identityRoutes(fastify) {
  // GET /identity/:globalId
  fastify.get('/:globalId', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { globalId } = request.params;

    if (payload.globalId !== globalId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const identity = await getClient().identity.findUnique({
      where: { globalId },
      select: PROFILE_SELECT,
    });

    if (!identity) {
      return reply.code(404).send({ error: 'Identity not found' });
    }

    return reply.send(identity);
  });

  // PUT /identity/:globalId
  fastify.put('/:globalId', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { globalId } = request.params;

    if (payload.globalId !== globalId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const existing = await getClient().identity.findUnique({
      where: { globalId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Identity not found' });
    }

    const { firstName, lastName, email, avatarUrl, locale } = request.body || {};
    const updateData = {};

    if (firstName !== undefined) {
      if (typeof firstName !== 'string' || firstName.trim().length === 0) {
        return reply.code(400).send({ error: 'firstName cannot be empty' });
      }
      updateData.firstName = firstName.trim();
    }

    if (lastName !== undefined) {
      if (typeof lastName !== 'string' || lastName.trim().length === 0) {
        return reply.code(400).send({ error: 'lastName cannot be empty' });
      }
      updateData.lastName = lastName.trim();
    }

    if (email !== undefined) {
      if (email === null) {
        updateData.email = null;
      } else {
        if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return reply.code(400).send({ error: 'Invalid email format' });
        }
        if (email !== existing.email) {
          const emailExists = await getClient().identity.findUnique({ where: { email } });
          if (emailExists) {
            return reply.code(409).send({ error: 'Email already in use' });
          }
        }
        updateData.email = email;
      }
    }

    if (avatarUrl !== undefined) {
      updateData.avatarUrl = avatarUrl;
    }

    if (locale !== undefined) {
      if (typeof locale !== 'string' || locale.trim().length === 0) {
        return reply.code(400).send({ error: 'locale cannot be empty' });
      }
      updateData.locale = locale.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    const updated = await getClient().identity.update({
      where: { globalId },
      data: updateData,
      select: PROFILE_SELECT,
    });

    return reply.send(updated);
  });

  // POST /identity/change-phone
  fastify.post('/change-phone', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { newPhone, verificationCode } = request.body || {};

    if (!verificationCode || verificationCode !== '123456') {
      return reply.code(400).send({ error: 'Invalid verification code' });
    }

    const sanitized = sanitizePhone(newPhone);
    if (!isValidE164(sanitized)) {
      return reply.code(400).send({
        error: 'Invalid phone format. Must be E.164 (e.g. +40712345678)',
      });
    }

    const existing = await getClient().identity.findUnique({
      where: { globalId: payload.globalId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Identity not found' });
    }

    if (sanitized === existing.phone) {
      return reply.code(400).send({ error: 'New phone is same as current phone' });
    }

    const duplicate = await getClient().identity.findUnique({ where: { phone: sanitized } });
    if (duplicate) {
      return reply.code(409).send({ error: 'Phone number already in use' });
    }

    await getClient().phoneChangeLog.create({
      data: {
        globalId: payload.globalId,
        oldPhone: existing.phone,
        newPhone: sanitized,
      },
    });

    await getClient().identity.update({
      where: { globalId: payload.globalId },
      data: { phone: sanitized },
    });

    return reply.send({ success: true });
  });
}

module.exports = identityRoutes;
