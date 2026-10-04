import { defineConfig } from 'tsup';
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    migrate: '../../packages/db/src/migrate.ts',
  },
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
