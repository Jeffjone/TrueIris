# Initial repository analysis

This records the initial repository/foundation snapshot. See [README](../README.md) and [milestones](IMPLEMENTATION_PLAN.md) for current implemented features and integration status.

Analyzed on October 3, 2026 against `origin/main` at `6406c392c69c31bb6dd7e6adf73c7d71264302d3`.

## Starting state

The remote contained only `README.md` (project name and RowdyHacks XII attribution), one initial commit, and no application code. The local directory contained an untracked `TRUEIRIS_SPEC.md` and initially had no Git metadata. Git metadata was initialized, the remote fetched, and local `main` attached to `origin/main` without modifying the specification.

There were no manifests, TypeScript configs, Electron settings, environment templates, migrations, database code, tests, CI, or ignore rules. No ancestor `AGENTS.md` was present. Nothing needed migrating or replacing.

## Tooling and feasibility

The host has Node 26.10.0, pnpm 12.8.1, Git 2.56.0, and Docker. The repository targets Node 24 LTS and pins pnpm 12.8.1. The `copilot` executable is AWS Copilot, not GitHub Copilot; no accessible GitHub Copilot integration was found, so development proceeds without it.

Presage documents a native Node/Electron SDK for macOS Apple Silicon, Linux x64/ARM64, and Windows x64. Native runtime packaging, subscription-authorized metrics, camera permission, and actual device behavior need verification in feature 2. No sensor has been installed or activated by this foundation.

The installed electron-vite 5 peer range accepts Vite 5–7, so the desktop uses Vite 7 instead of the latest Vite 8. TypeScript 5.9 and ESLint 9 keep the initial tooling within compatible ranges; the lockfile records exact resolved dependencies. pnpm 12 uses `allowBuilds`; only Electron and esbuild are allowlisted for dependency build scripts. Electron 44 has no postinstall script and downloads its binary on first use or via `install-electron`.

## Scope delivered

- Runnable Electron main process, sandboxed CommonJS preload, React renderer, and hash-based navigation.
- Fastify API with validated `GET /health`, structured logging, environment validation, and shutdown handling.
- Shared runtime contracts for health, desktop status, and future sensor readings with explicit provenance.
- Restrained design tokens, empty states, unavailable API behavior, and a renderer error boundary.
- Workspace commands, deterministic lockfile, formatting/lint/type checks, focused tests, production builds, and CI.
- Architecture, data model, privacy boundaries, integration risks, and ordered implementation milestones.

No readings, history, agent answers, voice, credentials exchange, database migrations, screenshots, or OS observations are simulated or silently collected. Integrations report `not_implemented` even if an API key is configured. Demo mode is a validated configuration flag only; seeded data and fallback behavior are future features.

## Verification

`pnpm install --frozen-lockfile` and `pnpm check` passed, including formatting, lint, strict TypeScript, 18 tests, and API/desktop production builds. Two Playwright tests launched the built Electron app with the API connected and offline, checked all routes and bridge restrictions, blocked additional windows, and verified the compact layout keeps the connection indicator in the viewport. Production screenshots were visually inspected. Development startup was exercised with real health polling.

The editor host sets `ELECTRON_RUN_AS_NODE=1`; the integration launcher removes it, and the development smoke run used `env -u ELECTRON_RUN_AS_NODE pnpm dev`. This is a launch-environment setting, not an application capability. Verification ran on macOS Apple Silicon with Electron 44.5.1; Linux CI is configured but was not run locally. Upstream Zod comments produce harmless Rollup annotation warnings during preload bundling.

## Next work

Feature 2 is the next vertical slice: real camera → Presage adapter → normalized reading → UI, with labeled mock sensing and failure states. Complete and push that feature before proceeding to the Live view and persistence. See [implementation roadmap](IMPLEMENTATION_PLAN.md) and [architecture](ARCHITECTURE.md).

## Official references

- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/)
- [electron-vite setup](https://electron-vite.org/guide/)
- [SmartSpectra Node/Electron SDK](https://smartspectra.presagetech.com/docs/nodejs/)
- [SmartSpectra metrics and authorization](https://smartspectra.presagetech.com/docs/nodejs/metrics)
- [pnpm build-policy changes](https://pnpm.io/blog/releases/11.0)
