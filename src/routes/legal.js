'use strict';

const crypto = require('crypto');
const { verifyToken } = require('../lib/token');

const LEGAL_URL = process.env.LEGAL_API_URL || 'https://legal.knowbest.ro';
const APP_SLUG = '4pro-identity';
const HMAC_KEY = process.env.LEGAL_HMAC_KEY || '';
const SKIP_HMAC = process.env.SKIP_LEGAL_HMAC === '1';

function authenticate(request, reply) {
  const token =
    request.cookies?.['4pro_sso'] ||
    (request.headers?.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice(7)
      : null);
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

function globalUserId(globalId) {
  return `identity:${globalId}`;
}

function buildHmacSignature(bodyStr, timestamp, nonce, globalId) {
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const message = `${APP_SLUG}:${timestamp}:${nonce}:${globalId}:${bodyHash}`;
  return crypto.createHmac('sha256', HMAC_KEY).update(message).digest('hex');
}

async function legalRoutes(fastify) {
  // GET /api/v1/legal/document?type=tos|privacy|cookies
  // Public — no auth required.
  fastify.get('/document', async (request, reply) => {
    const type = (request.query.type || '').toLowerCase();
    if (!['tos', 'privacy', 'cookies'].includes(type)) {
      return reply.code(400).send({ error: 'Invalid document type' });
    }

    try {
      const res = await fetch(
        `${LEGAL_URL}/api/v1/documents/latest?type=${type.toUpperCase()}&appSlug=${APP_SLUG}&renderTokens=true`,
        { headers: { 'x-app-slug': APP_SLUG }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        return reply.code(res.status).send({ error: `Legal Hub error: ${res.status}` });
      }

      const data = await res.json();
      const tokens = {
        app_name: '4PRO Identity',
        app_slug: APP_SLUG,
        rendered_at: new Date().toISOString(),
      };

      let content = (data.contentMarkdown || data.content || '');
      for (const [k, v] of Object.entries(tokens)) {
        content = content.replaceAll(`{${k}}`, v);
      }

      return reply
        .header('Cache-Control', 'no-store')
        .send({ contentMarkdown: content, versionId: data.versionId || data.id, version: data.version ?? null, entityName: data.entityName ?? null });
    } catch {
      return reply.code(502).send({ error: 'Failed to fetch document' });
    }
  });

  // GET /api/v1/legal/consent/status
  // Authenticated — returns pending consent items for the current user.
  fastify.get('/consent/status', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    try {
      const uid = globalUserId(payload.globalId);
      const res = await fetch(
        `${LEGAL_URL}/api/v1/consent/status?appSlug=${APP_SLUG}&globalUserId=${encodeURIComponent(uid)}`,
        { headers: { 'x-app-slug': APP_SLUG }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        return reply.code(res.status).send({ error: `Legal Hub error: ${res.status}` });
      }
      const data = await res.json();
      return reply.send(data);
    } catch {
      return reply.code(502).send({ error: 'Failed to check consent status' });
    }
  });

  // POST /api/v1/legal/consent/record
  // Authenticated — record a consent decision.
  fastify.post('/consent/record', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { documentVersionId, consentText, method } = request.body || {};
    if (!documentVersionId || !consentText) {
      return reply.code(400).send({ error: 'documentVersionId and consentText are required' });
    }

    const uid = globalUserId(payload.globalId);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const bodyObj = {
      documentVersionId,
      consentText,
      method: method || 'IN_APP',
      globalUserId: uid,
      appSlug: APP_SLUG,
    };
    const bodyStr = JSON.stringify(bodyObj);

    const headers = { 'Content-Type': 'application/json', 'x-app-slug': APP_SLUG };

    if (!SKIP_HMAC && HMAC_KEY) {
      headers['x-hmac-timestamp'] = timestamp;
      headers['x-hmac-nonce'] = nonce;
      headers['x-hmac-signature'] = buildHmacSignature(bodyStr, timestamp, nonce, uid);
    }

    try {
      const res = await fetch(`${LEGAL_URL}/api/v1/consent/record`, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return reply.code(res.status).send({ error: err.error || `Legal Hub error: ${res.status}` });
      }
      const data = await res.json();
      return reply.code(201).send(data);
    } catch {
      return reply.code(502).send({ error: 'Failed to record consent' });
    }
  });

  // POST /api/v1/legal/dsr
  // Authenticated — proxy Data Subject Request (export/delete) to Legal Hub.
  fastify.post('/dsr', async (request, reply) => {
    const payload = authenticate(request, reply);
    if (!payload) return;

    const { type } = request.body || {};
    if (!type || !['EXPORT', 'DELETE'].includes(type)) {
      return reply.code(400).send({ error: 'type must be EXPORT or DELETE' });
    }

    const uid = globalUserId(payload.globalId);

    try {
      const res = await fetch(`${LEGAL_URL}/api/v1/dsr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-slug': APP_SLUG },
        body: JSON.stringify({ globalUserId: uid, appSlug: APP_SLUG, type }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return reply.code(res.status).send({ error: err.error || `Legal Hub error: ${res.status}` });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(502).send({ error: 'Failed to submit DSR' });
    }
  });
}

module.exports = legalRoutes;
