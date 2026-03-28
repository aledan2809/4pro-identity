require('dotenv').config();

const Fastify = require('fastify');
const cookie = require('@fastify/cookie');
const cors = require('@fastify/cors');

const authRoutes = require('./routes/auth');
const identityRoutes = require('./routes/identity');

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
