# Fugly Search

A fast fuzzy line-search desktop app (Electron + React + TypeScript) for source repos. Open a folder, type a few keywords in any order, and get matching lines ranked by relevance, with a syntax-highlighted preview. Press Enter to open the line in your editor. The index lives in memory in a worker thread and is kept fresh by a file watcher.

## Run

Requires macOS and Node 22.12 or newer (developed and tested on Node 24; `nvm use` / `fnm use` picks it up from `.nvmrc`). Older Node versions install with warnings but the packager, vitest and the TypeScript tests are not expected to work.

```
npm install
npm run dev        # development
npm run build      # production build into out/
npm start          # preview the built app
npm run package    # build + produce a standalone macOS .app (see below)
```

## Build the .app (macOS)

```
npm run package
```

Runs a fresh `electron-vite build`, then `@electron/packager` (`scripts/package.mjs`) and ad-hoc signs the result. Output: `release/Fugly Search-darwin-<arch>/Fugly Search.app` (about 255 MB, nearly all of it the Electron runtime; app code is about 2 MB). Only production runtime modules (`ignore`, `@parcel/watcher` and its dependencies) are included, native `.node` files are unpacked from the asar, and sources/tests/docs are excluded. Bundle id `com.fugly.search`.

Launch: `open "release/Fugly Search-darwin-arm64/Fugly Search.app"`, or copy it to /Applications.

Signing: ad-hoc only (`codesign -s -`), not notarized, no Developer ID. On the Mac that built it, it opens normally. If you copy or download it from elsewhere, Gatekeeper may block the first launch: right-click > Open, or run `xattr -dr com.apple.quarantine "Fugly Search.app"`.

`npm run test:package` (after `npm run package`) launches the packaged app, verifies the signature, runs a search and checks that the watcher picks up a new file.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Cmd+O | Open folder |
| Cmd+Shift+F | Focus search |
| Up / Down, PageUp / PageDown | Move selection (Cmd+Up / Cmd+Down: first / last) |
| Enter | Open selected line in the chosen editor |
| Cmd+1 .. Cmd+9 | Open the Nth result |
| Esc | Clear query (then blur) |
| Cmd+Alt+C | Match case |
| Cmd+P | Toggle preview |

Group-by-file is a toggle button and View menu item.

## Supported editors

WebStorm, VS Code, Cursor (auto-detected on macOS), or the system default app. Command lines used: `code|cursor -g file:line:col`, WebStorm `open -na WebStorm.app --args --line L --column C file`. If the chosen editor fails, others are tried, then the system default; failures show as a toast.

## Environment variables

- `FUGLY_TEST_WORKSPACE=<dir>`: open this folder at startup.
- `FUGLY_USER_DATA=<dir>`: override Electron userData (settings, window bounds).
- `FUGLY_EDITOR_DRY_RUN=1`: do not launch editors; append `{bin,args}` JSON lines to `<userData>/editor-dry-run.log`.

## Tests

```
npm run test:engine   # vitest, search engine (59 tests)
npm run test:e2e      # builds, then drives the real built app with Playwright (6 tests)
npm run typecheck
```

E2E asserts no renderer console errors/warnings and no main-process stderr output. It covers keyword search, ranking, keys, toggles, editor persistence, dry-run editor commands, watcher updates and keystroke-to-render latency on a generated 500k-line repo (about 40-90 ms in the renderer on the dev machine). Screenshots go to `tests/e2e/screenshots/`; `tests/e2e/shots.mts <workspace|self|500k>` captures the visual states.

## Known limitations / unverified

- Not verified: that the caret lands on the correct line/column in each editor. This needs macOS Screen Recording/Accessibility to observe, so only the exact command lines are asserted (dry run).
- The native Open Folder dialog is not automated; the IPC path behind it is exercised, the dialog itself is not.
- macOS only in practice (editor detection paths, hidden-inset titlebar). Windows/Linux untested.
- Index caps: files over a size limit, binary files and very large totals are skipped. `.gitignore` is honored; `node_modules`, `.git`, `out`, `build`, `dist` etc. are always ignored.
- Match case disables typo and subsequence tolerance (exact substring only).
- The app icon is a generated placeholder (`resources/icon.png`).
- Fonts: Inter and JetBrains Mono (variable) bundled via `@fontsource-variable/*`.
