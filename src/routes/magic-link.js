const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getClient } = require('../lib/prisma');

// Fail-closed (same class as G-ID-002): a guessable magic-link secret would let
// anyone forge join links, so refuse to run without the real one.
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET;
if (!MAGIC_LINK_SECRET) {
  console.error('[identity] FATAL: MAGIC_LINK_SECRET is not set — refusing to start.');
  process.exit(1);
}
const MAGIC_LINK_EXPIRY_DAYS = 7;
const CLIENT_JOIN_URL = 'https://client.4pro.io/join';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function lookupProvider(providerPhone) {
  const prisma = getClient();

  // Check in Identity table (registered providers)
  const identity = await prisma.identity.findUnique({
    where: { phone: providerPhone },
    select: { firstName: true, lastName: true, phone: true },
  });

  if (identity) {
    const name = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
    return { providerName: name || providerPhone, found: true };
  }

  return { providerName: null, found: false };
}

async function sendWhatsAppMagicLink(providerPhone, providerName, serviceType, providerLocation, magicLinkUrl, logger) {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      logger.warn('WhatsApp credentials not configured — skipping magic link send');
      return;
    }

    const { WhatsAppClient, templates } = require('@aledan/whatsapp');
    const client = new WhatsAppClient({ phoneNumberId, accessToken });

    // magicLinkSuffix is the query-string portion after the base URL
    const url = new URL(magicLinkUrl);
    const magicLinkSuffix = url.search; // e.g. "?magic=TOKEN"

    const { templateName, components } = templates.magicLinkDiscovery(
      providerName,
      serviceType,
      providerLocation,
      magicLinkSuffix
    );

    await client.sendTemplate(providerPhone, templateName, 'ro', components);
    logger.info({ providerPhone }, 'Magic link WhatsApp sent');
  } catch (err) {
    logger.error({ err, providerPhone }, 'Failed to send magic link WhatsApp — continuing');
  }
}

async function magicLinkRoutes(fastify) {
  // POST /api/magic-link/generate
  fastify.post('/generate', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { providerPhone, serviceType, providerLocation } = request.body || {};

    if (!providerPhone || typeof providerPhone !== 'string' || !providerPhone.trim()) {
      return reply.code(400).send({ error: 'providerPhone is required' });
    }

    if (!serviceType || typeof serviceType !== 'string' || !serviceType.trim()) {
      return reply.code(400).send({ error: 'serviceType is required' });
    }

    if (!providerLocation || typeof providerLocation !== 'string' || !providerLocation.trim()) {
      return reply.code(400).send({ error: 'providerLocation is required' });
    }

    const phone = providerPhone.trim();

    const { providerName, found } = await lookupProvider(phone);

    if (!found) {
      return reply.code(400).send({ error: 'Provider not found for the given phone number' });
    }

    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const payload = {
      providerName,
      serviceType: serviceType.trim(),
      providerLocation: providerLocation.trim(),
      redirectUrl: CLIENT_JOIN_URL,
    };

    const magicLinkToken = jwt.sign(payload, MAGIC_LINK_SECRET, {
      expiresIn: `${MAGIC_LINK_EXPIRY_DAYS}d`,
      algorithm: 'HS256',
    });

    const tokenHash = hashToken(magicLinkToken);

    await getClient().magicLink.create({
      data: {
        tokenHash,
        providerPhone: phone,
        expiresAt,
        metadata: payload,
      },
    });

    const magicLinkUrl = `${CLIENT_JOIN_URL}?magic=${magicLinkToken}`;

    // Fire-and-forget WhatsApp send (error logged, not returned)
    sendWhatsAppMagicLink(
      phone,
      providerName,
      serviceType.trim(),
      providerLocation.trim(),
      magicLinkUrl,
      fastify.log
    );

    return reply.send({ magicLinkToken, magicLinkUrl });
  });

  // GET /api/magic-link/verify?token=TOKEN
  fastify.get('/verify', async (request, reply) => {
    const { token } = request.query || {};

    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'token query parameter is required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, MAGIC_LINK_SECRET, { algorithms: ['HS256'] });
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const tokenHash = hashToken(token);
    const record = await getClient().magicLink.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt < new Date()) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    return reply.send({
      valid: true,
      providerName: payload.providerName,
      serviceType: payload.serviceType,
      providerLocation: payload.providerLocation,
    });
  });
}

module.exports = magicLinkRoutes;
