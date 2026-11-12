# Dependency security maintenance

The November 12, 2026 dependency refresh resolves the reported shell-quote and Electron advisories and the remaining findings in the workspace's public npm audit.

- `concurrently` stays on major 9 at `9.2.5`, resolving `shell-quote@1.12.0`. The [command-injection advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) requires at least `1.11.0`.
- Electron is pinned to `44.11.3`, above the [certificate mitigation's `44.9.1` minimum](https://github.com/advisories/GHSA-jr5w-w6x2-84p9). Its downloader also resolves a patched Undici version.
- Fastify, Vite 7, Vitest 4 and Zod 4 are refreshed to patched releases, together with their compatible transitive dependencies.
- `tsup@9.0.0` adopts patched esbuild 0.28 without overriding its declared esbuild range. The existing API build configuration is retained and validated.
- The current TypeScript ESLint release still requests affected minimatch 10. A parent-scoped workspace override supplies `minimatch@11.0.1` or newer only to `@typescript-eslint/typescript-estree`; unaffected minimatch 3 consumers keep their existing API.
- pnpm records an explicit release-age exception for the exact Electron security-update version, rather than disabling release-age checks globally.

Use the checked-in pnpm lockfile and the repository's pinned package manager:

```bash
pnpm install --frozen-lockfile
pnpm audit
pnpm check
pnpm test:integration
```

Validation at this refresh: zero audit findings, 230 passing unit tests, and 33 passing built-desktop integration tests. Three hardware/database opt-in checks remain skipped in the ordinary integration command. The local integration providers do not call paid AI, speech or database services. No service subscription, production migration or deployment is required for these dependency fixes.

Recheck the parent-scoped minimatch override when TypeScript ESLint adopts a patched version natively. Audit results reflect the advisory database at the time of the check, so run the audit again for future updates.
