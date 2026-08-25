require('dotenv').config();

const Fastify = require('fastify');
const cookie = require('@fastify/cookie');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');

const authRoutes = require('./routes/auth');
const identityRoutes = require('./routes/identity');
const magicLinkRoutes = require('./routes/magic-link');
const legalRoutes = require('./routes/legal');

async function build() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    },
  });

  // Rate limiting keys on request.ip. Every caller is a sibling 4PRO app on this
  // same host (all consumers use http://localhost:4100; the port is firewalled
  // off the internet and no reverse proxy fronts it), so request.ip is 127.0.0.1
  // for effectively all traffic and the global bucket is ecosystem-wide.
  // Deliberately NOT setting trustProxy: nothing sets X-Forwarded-For here, so
  // trusting it would let any caller spoof its key and skip limits entirely.
  // Instead: the global cap is sized for ecosystem-wide S2S traffic, and the
  // abuse-sensitive routes key on the identity they target (see auth.js).
  await fastify.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 600),
    timeWindow: '1 minute',
    skipOnError: false,
    allowList: () => process.env.NODE_ENV === 'test',
  });

  await fastify.register(cookie);
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || /\.4pro\.io$/.test(origin) || origin === 'http://localhost:3000') {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  fastify.get('/health', async () => ({ status: 'ok' }));

  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(identityRoutes, { prefix: '/identity' });
  await fastify.register(magicLinkRoutes, { prefix: '/api/magic-link' });
  await fastify.register(legalRoutes, { prefix: '/api/v1/legal' });

  return fastify;
}

async function start() {
  const app = await build();
  const port = parseInt(process.env.IDENTITY_PORT || '4100', 10);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

module.exports = { build };

if (require.main === module) {
  start();
}
