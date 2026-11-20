# Fugly Search architecture

Electron (electron-vite) + React + TS. Fuzzy line-by-line search over an in-memory index in a worker thread.

## Contract
`src/shared/types.ts` is the single IPC contract (types, `Api`, `IPC` channel names). `src/preload/index.ts` exposes `window.api: Api`.
Change the contract only deliberately; update preload + ipc.ts together.

## Ownership
| Path | Owner |
|---|---|
| src/shared/types.ts, src/preload, src/main/index.ts, src/main/ipc.ts, src/main/settings.ts, configs | scaffold |
| src/main/search/engine.ts, worker.ts (built as out/main/search-worker.js) | engine agent |
| src/main/editors.ts | editor agent |
| src/renderer/src/** (App.tsx placeholder) | UI agent |
| e2e tests | testing agent |

## Env vars
- `FUGLY_TEST_WORKSPACE=<dir>`: auto-open at startup (renderer can also read `api.getStartupWorkspace()`).
- `FUGLY_USER_DATA=<dir>`: override Electron userData.

## Commands
`npm run dev`, `npm run build`, `npm run typecheck`. Paths: `@shared/*`, `@renderer/*`.
ipc.ts resolves/validates relative paths against the workspace root before readFile/openInEditor.
