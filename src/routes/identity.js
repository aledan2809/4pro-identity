const { getClient } = require('../lib/prisma');
const { isValidE164, sanitizePhone, isValidEmail, normalizeEmail } = require('../lib/validation');
const { timingSafeEqual } = require('crypto');
const { verifyToken } = require('../lib/token');
const { verifyOTP } = require('../lib/twilio');

// Constant-time S2S key check. Compare BYTE lengths, not character lengths:
// timingSafeEqual throws on unequal buffers, and a header of multibyte
// characters can match in characters while differing in bytes — which would
// turn a plain rejection into an unhandled 500.
function s2sKeyMatches(presented, expected) {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
  // GET /identity/exists?email=…&phone=…
  // Public read-only existence probe used by sibling 4PRO apps for cross-app
  // duplicate detection BEFORE creating local user records. Does NOT leak
  // globalId or any profile field — only existence booleans + which match.
  // Rate-limited to avoid email enumeration scraping.
  fastify.get('/exists', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, phone } = request.query || {};

    if (!email && !phone) {
      return reply.code(400).send({ error: 'Provide email or phone (or both) as query parameter' });
    }

    const result = { exists: false, byEmail: false, byPhone: false };
    const client = getClient();

    if (email) {
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }
      const hit = await client.identity.findUnique({ where: { email: normalizeEmail(email) }, select: { globalId: true } });
      result.byEmail = !!hit;
    }

    if (phone) {
      const sanitized = sanitizePhone(phone);
      if (!isValidE164(sanitized)) {
        return reply.code(400).send({ error: 'Invalid phone format. Must be E.164 (e.g. +40712345678)' });
      }
      const hit = await client.identity.findUnique({ where: { phone: sanitized }, select: { globalId: true } });
      result.byPhone = !!hit;
    }

    result.exists = result.byEmail || result.byPhone;
    return reply.send(result);
  });

  // POST /identity/register { email?, phone?, firstName?, lastName?, source? }
  // S2S identity-first registration for sibling apps (eCabinet G-ECAB-REG-003).
  // Creates a passwordless identity anchored on email and/or phone and returns
  // the canonical globalId. Phone is optional at the schema level since
  // 2026-08-24 — email-only signups (eCabinet public registration) finally get
  // a real ecosystem link instead of globalId=null.
  fastify.post('/register', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    // S2S only: without the shared key the route is closed (fail-closed) — an
    // open register endpoint would allow unrecoverable email-squatting (the
    // identity service has no email-based auth to reclaim a squatted address).
    const s2sKey = process.env.IDENTITY_S2S_KEY;
    const presented = request.headers['x-identity-api-key'];
    if (!s2sKey || typeof presented !== 'string' || !s2sKeyMatches(presented, s2sKey)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { email, phone, firstName, lastName, source } = request.body || {};

    if (!email && !phone) {
      return reply.code(400).send({ error: 'Provide email or phone (or both)' });
    }

    const data = {};

    if (email !== undefined && email !== null) {
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }
      data.email = normalizeEmail(email);
    }

    if (phone !== undefined && phone !== null && phone !== '') {
      const sanitized = sanitizePhone(phone);
      if (!isValidE164(sanitized)) {
        return reply.code(400).send({ error: 'Invalid phone format. Must be E.164 (e.g. +40712345678)' });
      }
      data.phone = sanitized;
    }

    if (firstName && typeof firstName === 'string' && firstName.trim()) data.firstName = firstName.trim();
    if (lastName && typeof lastName === 'string' && lastName.trim()) data.lastName = lastName.trim();

    const client = getClient();

    if (data.email) {
      const emailHit = await client.identity.findUnique({
        where: { email: data.email },
        select: { globalId: true, hashedPassword: true, phone: true },
      });
      if (emailHit) {
        // An identity with no password AND no phone was never proven by anyone:
        // it is the shell this very route mints from an unverified address. If a
        // real person now registers that address at a consumer app, adopt the
        // shell instead of refusing — otherwise anyone could permanently lock a
        // stranger out of the ecosystem just by typing their email first, and
        // the shell itself grants no access (login needs phone + password).
        const unclaimed = !emailHit.hashedPassword && !emailHit.phone;
        if (!unclaimed) {
          return reply.code(409).send({ error: 'Email already registered' });
        }
        request.log.info(
          { globalId: emailHit.globalId, source: typeof source === 'string' ? source.slice(0, 50) : undefined },
          'identity-register-adopted-unclaimed'
        );
        return reply.code(200).send({ globalId: emailHit.globalId, adopted: true });
      }
    }
    if (data.phone) {
      const phoneHit = await client.identity.findUnique({ where: { phone: data.phone }, select: { globalId: true } });
      if (phoneHit) return reply.code(409).send({ error: 'Phone number already registered' });
    }

    let identity;
    try {
      identity = await client.identity.create({ data });
    } catch (err) {
      // Unique-constraint race between the pre-checks and the insert.
      if (err && err.code === 'P2002') {
        return reply.code(409).send({ error: 'Email or phone already registered' });
      }
      throw err;
    }

    request.log.info(
      { globalId: identity.globalId, source: typeof source === 'string' ? source.slice(0, 50) : undefined },
      'identity-register'
    );
    return reply.code(201).send({ globalId: identity.globalId });
  });

  // POST /identity/resolve { ssoToken }
  // S2S canonical-id resolution for sibling 4PRO apps. Returns the CANONICAL
  // globalId (UUID) for the phone carried by a valid SSO token.
  //
  // Closes the L79 "identity flap": a sibling app (PRO) historically stamped
  // its LOCAL cuid into the SSO token's id claim instead of the canonical
  // globalId. Consumers (4pro-client) that key Legal ConsentRecords on that
  // claim create cuid orphans (a DSR on the canonical UUID then misses them).
  // Identity is the source of truth — the token's phone resolves to the one
  // canonical UUID regardless of what id claim the token carries.
  //
  // Auth model: a validly-signed SSO token IS the credential (the caller
  // proves it already holds a session for that user). No enumeration risk —
  // without a signed token you cannot probe phone→globalId. Reuses the shared
  // SSO_JWT_SECRET every 4PRO app already holds; no new secret to provision.
  fastify.post('/resolve', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { ssoToken } = request.body || {};
    if (!ssoToken || typeof ssoToken !== 'string') {
      return reply.code(400).send({ error: 'ssoToken required' });
    }

    let payload;
    try {
      payload = verifyToken(ssoToken);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired SSO token' });
    }

    const phone = payload && payload.phone;
    if (!phone || typeof phone !== 'string') {
      return reply.code(422).send({ error: 'Token carries no phone claim' });
    }

    const sanitized = sanitizePhone(phone);
    if (!isValidE164(sanitized)) {
      return reply.code(422).send({ error: 'Token phone is not valid E.164' });
    }

    const hit = await getClient().identity.findUnique({
      where: { phone: sanitized },
      select: { globalId: true },
    });
    if (!hit) {
      return reply.code(404).send({ error: 'No identity for token phone' });
    }

    return reply.send({ globalId: hit.globalId });
  });

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
        if (!isValidEmail(email)) {
          return reply.code(400).send({ error: 'Invalid email format' });
        }
        // Normalize here too: an un-normalized update re-creates the case-variant
        // split the register paths close, and the lookup below would miss an
        // existing lowercase row — letting two identities hold the same
        // effective address (Postgres UNIQUE is case-sensitive).
        const normalized = normalizeEmail(email);
        if (normalized !== existing.email) {
          const emailExists = await getClient().identity.findUnique({ where: { email: normalized } });
          if (emailExists) {
            return reply.code(409).send({ error: 'Email already in use' });
          }
        }
        updateData.email = normalized;
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

    if (!verificationCode || typeof verificationCode !== 'string') {
      return reply.code(400).send({ error: 'Verification code is required' });
    }

    const sanitized = sanitizePhone(newPhone);
    if (!isValidE164(sanitized)) {
      return reply.code(400).send({
        error: 'Invalid phone format. Must be E.164 (e.g. +40712345678)',
      });
    }

    // Verify OTP sent to the new phone number via Twilio Verify
    let otpCheck;
    try {
      otpCheck = await verifyOTP(sanitized, verificationCode);
    } catch (err) {
      fastify.log.error({ err, phone: sanitized }, 'OTP verification failed');
      return reply.code(500).send({ error: 'OTP verification failed' });
    }

    if (otpCheck.status !== 'approved') {
      return reply.code(401).send({ error: 'Invalid or expired verification code' });
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
        oldPhone: existing.phone || '',
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
