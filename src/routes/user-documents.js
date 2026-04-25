const { getClient } = require('../lib/prisma');
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

const VALID_SCOPES = ['insurance_company', 'police_request', 'employment_verification'];

async function userDocumentRoutes(fastify) {
  // GET /api/v1/user-documents
  fastify.get('/', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { scope } = request.query;

    const where = { userId: payload.globalId };

    if (scope) {
      if (!VALID_SCOPES.includes(scope)) {
        return reply.code(400).send({ error: `Invalid scope. Valid: ${VALID_SCOPES.join(', ')}` });
      }
      where.allowedScopes = { has: scope };
    }

    const docs = await getClient().userDocument.findMany({
      where,
      select: {
        id: true,
        type: true,
        fileUrl: true,
        allowedScopes: true,
        consentGiven: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: docs });
  });

  // POST /api/v1/user-documents — create document record with consent
  fastify.post('/', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { type, fileUrl, allowedScopes, consentGiven } = request.body || {};

    const validTypes = ['CI', 'PERMIS_CONDUCERE', 'PASAPORT', 'CERTIFICAT_MEDICAL', 'CARD_SANATATE', 'ALT'];
    if (!type || !validTypes.includes(type)) {
      return reply.code(400).send({ error: `Invalid type. Valid: ${validTypes.join(', ')}` });
    }

    if (consentGiven !== true) {
      return reply.code(400).send({ error: 'Consent is required (consentGiven must be true)' });
    }

    const scopes = Array.isArray(allowedScopes) ? allowedScopes.filter(s => VALID_SCOPES.includes(s)) : [];

    const doc = await getClient().userDocument.create({
      data: {
        userId: payload.globalId,
        type,
        fileUrl: fileUrl || null,
        allowedScopes: scopes,
        consentGiven: true,
      },
      select: {
        id: true,
        type: true,
        fileUrl: true,
        allowedScopes: true,
        consentGiven: true,
        createdAt: true,
      },
    });

    return reply.code(201).send({ data: doc });
  });
}

module.exports = userDocumentRoutes;
