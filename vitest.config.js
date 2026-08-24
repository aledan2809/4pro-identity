import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      SSO_JWT_SECRET: 'test-secret-key',
      MAGIC_LINK_SECRET: 'test-magic-link-secret',
      IDENTITY_S2S_KEY: 'test-s2s-key',
    },
  },
});
