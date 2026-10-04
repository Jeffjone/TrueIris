import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: [
    '@trueiris/shared',
    '@trueiris/schemas',
    '@trueiris/db',
    '@trueiris/analytics',
  ],
  external: ['pg'],
  clean: true,
});
