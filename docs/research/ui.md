# UI Research and Spec: Find in Files clone (Electron + React, macOS)

Status: dark palette and syntax colors VERIFIED against the kpitt Zed port of New UI Dark (see Sources). Items tagged [UNVERIFIED] come from memory. JetBrains docs give only Windows/Linux shortcuts; macOS mappings are [UNVERIFIED] (Ctrl -> Cmd by convention). Preview-pane and cmd+enter/alt+enter behaviors are not documented in the fetched pages.

## 1. WebStorm Find in Files: layout and behavior

Popup (cmd+shift+F) is a modeless-ish dialog, ~ 1000x640 default, resizable, remembers size.
- Header row: title "Find in Files", right side has "Open in Find Tool Window" link and a pin icon.
- Search field (top): text input with right-aligned inline toggles: Match Case (Cc), Words (W), Regex (.*). Tooltips show shortcuts (cmd+opt+C, cmd+opt+W, cmd+opt+R on macOS). Below/next: History dropdown (cmd+up/down in field cycles history).
- Second row: "In Project | Module | Directory | Scope" tabs/segmented control; "File mask" combobox with filter icon; "Preserve case"/"Replace" mode is separate (cmd+shift+R).
- Results: list below, FLAT list in popup, each row = file icon, `line text` with match highlighted, and right-aligned gray `filename` (and dir path in dimmer color). The Find tool window (after "Open in Find Tool Window") groups by file in a tree with counts ("3 matches"). Spec: offer flat list with optional "Group by file" toggle (default grouped sticky headers is a nice upgrade).
- Match highlight: background tint (yellow-ish in Darcula: rgba(50,89,61)-like green in New UI; classic is `#32593D` bg on dark) with bold-free text. Selected row highlights with accent blue (`#2F65CA` New UI dark / `#0D293E` Darcula list sel).
- Preview pane: bottom (or right) editor, read-only, syntax-highlighted, scrolled to match line with context, match highlighted, line numbers on, gutter. Toggle preview with cmd+P (in Search Everywhere) / "Show preview" checkbox. Header strip shows file path and "line:col".
- Footer: status text "N matches in M files", progress indicator while searching, "Open in Find Window" button, and hint text ("Press ⏎ to open, ⌘⏎ to open in new tab" etc.).
- Result cap: WebStorm stops at ~1000 matches ("1000+ results, refine"). We should cap configurable (e.g. 10k) and say so.

### Keyboard map (macOS, target)
Verified from JetBrains docs (Windows/Linux; macOS Cmd mapping [UNVERIFIED]): Ctrl+Shift+F opens Find in Files and pre-fills selected text; pressing it again starts a new search; Alt+Down shows previous search strings (history); Ctrl+Alt+Up/Down moves between occurrences in multi-line search; Ctrl+Shift+R opens Replace in Path; Search Everywhere: Shift twice, Tab switches scope, Ctrl+Up/Down jumps between sections, Enter opens. Docs also confirm: toggles Words / Match case / Regex, multi-line search icon, filter icon (exclude comments), Directory, Scope, file mask (`*`, `?`, `,`, `!` exclude), "Open in Find Window", "Open Results in New Tab" checkbox, multiple matches on one line merged into one entry. NOT in docs, so the table below is our design (cmd+enter, alt+enter, cmd+1..9, cmd+P, toggle shortcuts are [UNVERIFIED]):

| Key | Action |
|---|---|
| cmd+shift+F | Open window / focus field (select all text) |
| Up / Down | Move selection (wraps off by default) |
| PageUp / PageDown | Move 10 rows |
| cmd+Up / cmd+Down | First / last result |
| Enter | Open selected match in editor (e.g. `code`/`webstorm` URL scheme) and close |
| cmd+Enter | Open, keep window open |
| alt+Enter | Context actions menu (Copy path, Reveal in Finder, Open with...) |
| shift+Enter | Open in default external app / split |
| Esc | Clear field if non-empty? (JetBrains: close). Spec: close; if a popup menu is open close that first |
| cmd+opt+C / W / R | Toggle match case / whole word / regex |
| cmd+P | Toggle preview |
| cmd+G / cmd+shift+G | Next / previous (alias for down/up) |
| cmd+1..9 | Jump to and open nth visible row (1 = first visible) |
| Tab / shift+Tab | Cycle field, file mask, results, preview |
| cmd+C | Copy selected line text (cmd+shift+C copies path:line) |
| cmd+, | Settings |
| cmd+W | Close window |

## 2. Colors and fonts

Fonts: JetBrains Mono (code, 13px, line-height 1.5 ≈ 20px, ligatures off by default in search list; enable `font-feature-settings: "calt" 0` for list, on in preview optional). UI: Inter (JetBrains uses Inter in New UI, 13px). Fall back `-apple-system, "SF Pro Text"`. Bundle woff2 files (no network).

### New UI Dark (VERIFIED from kpitt/zed-theme-intellij-newui unless tagged)
- Window bg `#1E1F22`; panel/popup bg `#2B2D30`; editor bg `#1E1F22`
- Border `#393B40`; separator `#2B2D30`/`#393B40`
- Text `#DFE1E5`; muted `#9DA0A8`; disabled `#6F737A` [UNVERIFIED]
- Accent text `#6B9BFA`; button accent `#3574F0` [UNVERIFIED]; list selection `#2E436E` [UNVERIFIED] (Zed port uses `#5A5D6399` selected / `#5A5D6366` hover, which are neutral overlays)
- Input bg `#1E1F22`, input border `#4E5157`, focus ring `#548AF7`
- Match highlight bg `#32593D` / alt `#614F20` [UNVERIFIED]; border `#393B40` verified; panel `#2B2D30` and editor `#1E1F22` verified
- Syntax (Darcula): keyword `#CF8E6D`, string `#6AAB73`, number `#2AACB8`, comment `#7A7E85`, function `#56A8F5`, type `#6FAFBD` (corrects earlier `#DFE1E5`), property/field `#C77DBB`, tag `#D5B778`, attribute `#D5B778` (corrects earlier `#BABABA`), annotation `#B3AE60` [UNVERIFIED], punctuation/default `#BCBEC4` [UNVERIFIED]

### Classic Darcula
bg `#2B2B2B`, panel `#3C3F41`, text `#A9B7C6`, keyword `#CC7832`, string `#6A8759`, number `#6897BB`, comment `#808080`, function `#FFC66D`, selection `#0D293E`/`#4B6EAF`, border `#323232`.

### New UI Light
- Window bg `#F7F8FA`; popup/panel `#FFFFFF`; border `#EBECF0`/`#DFE1E5`
- Text `#000000` -> use `#1E1F22`; secondary `#6C707E`; disabled `#A8ADBD`
- Accent `#3574F0`; selection `#D4E2FF`; hover `#F2F3F5`; input border `#C9CCD6`; focus ring `#3574F0`
- Match highlight bg `#C3EFC8`-ish (use `#BDE7C3`); keyword `#0033B3`, string `#067D17`, number `#1750EB`, comment `#8C8C8C`, function `#00627A`, field `#871094`, tag `#0033B3`, annotation `#9E880D`

## 3. Syntax highlighting: highlight.js vs Shiki vs Prism

- Shiki (TextMate grammars, oniguruma WASM): best fidelity, can load actual JetBrains-like themes (or a custom theme JSON). Slow-ish startup (WASM + grammar load, 100-300ms) and ~0.2-1ms per short line after warm-up when using `codeToTokens`/`createHighlighterCore` with JS regex engine (`shiki/engine/javascript`) for faster init. Best for the PREVIEW pane (full file).
- highlight.js: sync, ~tens of microseconds per short line, auto-detect and 190 languages, small bundle with `highlight.js/lib/core` + register only needed languages. Output is HTML spans with class names -> theme with CSS variables (great for dark/light switching with zero re-highlight).
- Prism: also sync and fast, fewer languages, regex-based, class-name output as well. Comparable to hljs; hljs has better language coverage and maintenance.

Recommendation:
1. Results list rows: highlight.js core (sync), lazily, ONLY for rows in the viewport (+ overscan) via a memoized per-row cache `Map<key, html>` (LRU ~5k). Single line has no context so multi-line constructs (block comments, template strings) can mis-tokenize; acceptable. Optionally seed state: hljs `highlight(line, {language, ignoreIllegals:true, continuation})` supports passing `continuation` state; use the previous lines from context only when preview is open.
2. Preview pane: Shiki with class/CSS-variable theme (`shiki` "css-variables" theme) so dark/light is a variable swap. Highlight the full file once (cap files at 1 MB / 5k lines else plain), cache per path+mtime. Do tokenization in a worker or `requestIdleCallback`; show plain text immediately then swap.
3. Language by extension: map `ext -> hljs/shiki id` (ts,tsx->typescript/tsx, js,mjs,cjs,jsx, json, md, css, scss, html, vue, py, go, rs, java, kt, rb, php, sh, yml, toml, sql, c/cpp/h, swift). Special names: Dockerfile, Makefile, .env*, `.gitignore`. Unknown -> plain, never auto-detect (slow, wrong).
4. Match highlight is applied AFTER syntax: split ranges by offsets; easiest is render tokens, then wrap match offsets using a DOM-less pass over the HTML string (walk text nodes with a small tokenizer) or render `<mark>` by slicing the text and highlighting segments independently (cheaper, slight inaccuracy). Use the walk approach for correctness.
5. Trim long lines: show a window of ~200 chars around the first match with ellipsis (JetBrains does this); store offset shift for ranges.

## 4. Virtualization

- @tanstack/react-virtual (v3): headless, supports dynamic `measureElement`, sticky headers (custom `rangeExtractor`), scrollToIndex with alignment, horizontal/grid. Active maintenance, ~3 KB. Recommended.
- react-window: fixed/variable size (needs `getItemSize` upfront, no auto-measure); simpler but stale; react-virtuoso is a fuller alternative with group headers built in.
Spec: rows are FIXED height (24px) -> use `estimateSize: () => 24`, no measurement, `overscan: 12`. Group headers 26px. Both 10k-100k rows are fine at fixed height. Avoid per-row state in React; keep selection index in a ref+store (useSyncExternalStore / zustand) and only re-render the two affected rows. Stream results in batches (every 50ms / 500 matches) into a mutable array and bump a version counter; don't setState per match. Use `scrollToIndex(i, {align:'auto'})` on arrow keys.

## 5. Electron macOS polish

```ts
new BrowserWindow({
  width: 1000, height: 640, minWidth: 640, minHeight: 400,
  show: false,                       // show on ready-to-show to avoid white flash
  titleBarStyle: 'hiddenInset',      // or 'hidden' + trafficLightPosition
  trafficLightPosition: { x: 14, y: 14 },
  vibrancy: 'under-window',          // 'sidebar' / 'popover' / 'hud' alternatives
  visualEffectState: 'followWindow', // 'active' keeps vibrancy when unfocused
  transparent: false,                // vibrancy works without it on mac
  backgroundColor: '#00000000',
  fullscreenable: false,
  webPreferences: { preload, contextIsolation: true, sandbox: true, spellcheck: false },
});
win.once('ready-to-show', () => win.show());
```
- Vibrancy: popover-style windows use `vibrancy:'popover'` or `'under-window'`; make panel backgrounds semi-transparent (`rgba(43,45,48,0.85)`) over it, or skip vibrancy for solid JetBrains fidelity (spec: opt-in setting, default solid).
- Drag regions: `-webkit-app-region: drag` on the top header (height 38px), `no-drag` on inputs and buttons. Leave 78px left padding for traffic lights when `hiddenInset`.
- Theme: `nativeTheme.themeSource = 'system'`; listen `nativeTheme.on('updated')` and send `shouldUseDarkColors` to renderer via IPC; renderer sets `document.documentElement.dataset.theme`. Also CSS `color-scheme: light dark` and a `@media (prefers-color-scheme)` fallback. Offer setting System / Light / Dark.
- Focus: on show, `win.focus()` then renderer focuses and selects the search input (`input.select()`); on blur (`win.on('blur')`) optionally hide if "close on blur" like Spotlight-style popups (JetBrains popup closes on focus loss; make it a setting). Use `app.on('activate')` to re-show. Prefer a single instance (`requestSingleInstanceLock`).
- Shortcut: `globalShortcut.register('CommandOrControl+Shift+F', ...)` is GLOBAL and will steal the key from every app; use a rarely-used default (e.g. ctrl+opt+cmd+F) for global, and bind cmd+shift+F via the menu accelerator (app-local). Handle registration failure (returns false).
- Native menu: App (About, Settings cmd+, , Hide, Quit), File (New Search cmd+shift+F, Close cmd+W), Edit (roles: undo, redo, cut, copy, paste, selectAll - REQUIRED or cmd+C/V fail), View (Toggle Preview cmd+P, Group by File, Reload/DevTools in dev only), Window (roles), Help.
- Misc: `app.dock` icon, `win.setVibrancy` on theme change, `-webkit-font-smoothing: antialiased`, `user-select:none` on chrome, `cursor: default`, disable overscroll bounce for the list (`overscroll-behavior: contain`), `app.setAboutPanelOptions`, remember bounds with `electron-store`, `webContents.setZoomFactor` locked (disable pinch zoom).
- Security: contextIsolation true, nodeIntegration false, search runs in main/utility process (ripgrep via `child_process`, JSON `--json` output streamed) and results pushed via IPC / MessagePort in batches.

## 6. Accessibility (combobox + listbox)

Use the ARIA 1.2 combobox pattern with the input retaining DOM focus:
```html
<input role="combobox" aria-expanded="true" aria-controls="results" aria-activedescendant="row-42" aria-autocomplete="none" aria-label="Search in files">
<div id="results" role="listbox" aria-label="Search results">
  <div role="presentation"/group header: role="group" aria-label="src/app.ts">
  <div role="option" id="row-42" aria-selected="true" aria-posinset="43" aria-setsize="10234">
```
- Because of virtualization, ALWAYS set `aria-posinset` and `aria-setsize` on options, and keep the active row rendered.
- Live region (`role="status"`, `aria-live="polite"`): "1,204 matches in 87 files", "Searching...", "No results". Debounce announcements (500ms).
- Toggles are `<button aria-pressed>` with `aria-label` ("Match case") and visible focus ring. Preview pane: `role="region" aria-label="File preview"`, `tabIndex=0`.
- Respect `prefers-reduced-motion` (no fades), `prefers-contrast: more` (stronger borders and selection), minimum 4.5:1 contrast for text (secondary `#868A91` on `#2B2D30` is ~4.2:1; use `#9DA0A8` for small text).

## 7. UI SPEC

### Layout (window 1000x640, min 640x400)
```
+----------------------------------------------------------------+ 
| [traffic lights]  Find in Files            (drag)   [pin]      |  38px titlebar (drag)
| [ search field ........................ Cc  W  .* ]  [history]  |  44px (field 30px high, 12px pad)
| In Project v | File mask [*.ts,*.tsx  v] | Scope v             |  32px options row
|----------------------------------------------------------------|
| results list (flex 1, min 160px)                               |  rows 24px, headers 26px
|----------------------------------------------------------------|  4px resize handle (drag, snaps)
| preview header: path/to/file.ts  12:8            (24px)        |
| preview editor (default 42% of body height, min 120px)         |
|----------------------------------------------------------------|
| 1,204 matches in 87 files   [progress]      Hint     [Open all]|  28px status bar
+----------------------------------------------------------------+
```
- Corner radius: 10px window (macOS default), 6px inputs/buttons, 4px rows (inset 6px from list edges, JetBrains New UI style), 1px borders.
- Row anatomy (24px): 8px pad | file icon 16px | 6px | line text (JetBrains Mono 12.5px, truncate with ellipsis centered on match) | flex gap | `filename` Inter 12px secondary | `:line` tabular nums | 10px pad. Grouped mode: header row (chevron, icon, filename bold, dir path secondary, count badge) and match rows indented 28px with line number column 40px right-aligned secondary.
- Layout toggle for preview: bottom (default) or right (min width 900).
- Preview: line numbers gutter 48px (`--gutter-fg`), 5 lines context above the match scroll offset, current-match line bg `--line-hl`, match range bg `--match-bg` + 1px outline `--match-outline`.

### CSS variables
```css
:root, :root[data-theme="dark"] {
  color-scheme: dark;
  --bg-window: #1e1f22;  --bg-panel: #2b2d30;  --bg-input: #1e1f22;  --bg-editor: #1e1f22;
  --bg-hover: #2e3033;   --bg-selected: #2e436e; --bg-selected-inactive: #393b40;
  --border: #393b40;     --border-input: #4e5157; --focus: #548af7;  --accent: #3574f0;
  --fg: #dfe1e5; --fg-secondary: #9da0a8; /* verified */ --fg-disabled: #6f737a; --fg-link: #548af7;
  --match-bg: #32593d; --match-outline: #4f8a5c; --line-hl: #26282e; --gutter-fg: #4b5059;
  --scrollbar: rgba(255,255,255,.18); --shadow: 0 12px 40px rgba(0,0,0,.5);
  --syn-keyword:#cf8e6d; --syn-string:#6aab73; --syn-number:#2aacb8; --syn-comment:#7a7e85;
  --syn-function:#56a8f5; --syn-field:#c77dbb; --syn-tag:#d5b778; --syn-attr:#d5b778; --syn-annotation:#b3ae60;
  --syn-type:#6fafbd; --syn-punct:#bcbec4; --syn-default:#bcbec4;
  --font-ui: Inter, -apple-system, "SF Pro Text", sans-serif;
  --font-code: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --fs-ui: 13px; --fs-code: 12.5px; --row-h: 24px; --radius: 6px;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg-window:#f7f8fa; --bg-panel:#ffffff; --bg-input:#ffffff; --bg-editor:#ffffff;
  --bg-hover:#f2f3f5; --bg-selected:#d4e2ff; --bg-selected-inactive:#dfe1e5;
  --border:#ebecf0; --border-input:#c9ccd6; --focus:#3574f0; --accent:#3574f0;
  --fg:#1e1f22; --fg-secondary:#6c707e; --fg-disabled:#a8adbd; --fg-link:#2470b3;
  --match-bg:#bde7c3; --match-outline:#7cc08a; --line-hl:#f5f8fe; --gutter-fg:#a0a4ae;
  --scrollbar: rgba(0,0,0,.2); --shadow: 0 12px 40px rgba(0,0,0,.18);
  --syn-keyword:#0033b3; --syn-string:#067d17; --syn-number:#1750eb; --syn-comment:#8c8c8c;
  --syn-function:#00627a; --syn-field:#871094; --syn-tag:#0033b3; --syn-annotation:#9e880d;
  --syn-type:#1e1f22; --syn-punct:#1e1f22; --syn-default:#1e1f22;
}
@media (prefers-contrast: more) { :root { --border:#6f737a; } }
```
hljs class mapping: `.hljs-keyword,.hljs-built_in{color:var(--syn-keyword)}`, `.hljs-string{string}`, `.hljs-number,.hljs-literal{number}`, `.hljs-comment{comment;font-style:italic}`, `.hljs-title.function_{function}`, `.hljs-title.class_,.hljs-type{type}`, `.hljs-attr,.hljs-property{field}`, `.hljs-tag,.hljs-name{tag}`, `.hljs-meta{annotation}`.

### Component list
- `App` (theme + IPC bridge), `TitleBar` (drag region, pin)
- `SearchField` (combobox input, history, clear button), `ToggleButton` (Cc, W, .*), `ScopeSelect`, `FileMaskInput`
- `ResultsList` (tanstack virtualizer, listbox), `ResultRow`, `FileGroupHeader`, `HighlightedLine` (syntax + match marks), `FileIcon` (extension -> icon set)
- `PreviewPane` (`PreviewHeader`, `CodeView` with gutter), `Splitter`
- `StatusBar` (counts, spinner, hint), `ContextMenu` (alt+Enter), `EmptyState`, `Toast`
- Hooks/stores: `useSearch` (IPC stream, batching, cancel on new query), `useSelection`, `useTheme`, `useHotkeys`, `highlightCache`
- Main: `windowManager`, `menu`, `shortcuts`, `searchService` (ripgrep, utility process), `settingsStore`

### Behaviors
- Debounce 150ms after typing (0 for toggles); each new query cancels the previous process. Min query length 1 (2 for regex off in huge dirs, setting).
- Selection resets to first result on new query unless the same item still exists (keep by file+line+col key).
- Selecting a row updates preview after 60ms debounce (instant on keyboard hold).
- Double-click opens; single click selects; right-click shows context menu.
- Invalid regex: field border red (`#DB5C5C`), inline message in status bar, no search.
- Window state persisted: bounds, splitter ratio, toggles, scope, last 30 queries.

### States
- Initial/empty query: centered icon (magnifier, 32px, secondary), "Type to search in files", below: recent searches (up to 5, click to apply) and shortcut hint line "⌘⌥C case · ⌘⌥W word · ⌘⌥R regex". Preview hidden or shows "No selection".
- Loading: thin 2px indeterminate bar under the field (accent), status bar spinner + "Searching... 312 matches in 14 files" counting live, results stream in; list does not jump (stable ordering: by file path order of discovery, not re-sorted while typing; optional final sort).
- Results: status "1,204 matches in 87 files" (+ "· showing first 10,000" with a "Refine" hint when capped); elapsed ms in tooltip.
- No results: "No matches for “foo” in Project" + chips to loosen: "Turn off Match Case", "Turn off Whole Words", "Search in All Places" (only if relevant toggles are on); preview shows blank.
- Error: banner row (red tint) "ripgrep failed: <msg>" with Retry; invalid directory: "Folder not found" + "Choose folder".
- Binary/large files: preview shows "Binary file not shown" or "File too large (3.2 MB). Open in editor." Matches inside minified long lines are truncated with an ellipsis window.
- Unfocused window: selection color becomes `--bg-selected-inactive`, titlebar text dims.

### Motion and performance budgets
- Open window < 120ms to interactive (pre-create hidden window, `show()` on shortcut). Keystroke-to-first-result < 80ms on a mid repo. Scrolling 60fps with 100k rows; list render < 4ms/frame. Animations: 120ms ease-out opacity/scale(0.98->1) on open; none for selection moves.

## Sources
- https://raw.githubusercontent.com/kpitt/zed-theme-intellij-newui/main/themes/intellij-newui.json (dark palette, syntax colors)
- https://www.jetbrains.com/help/webstorm/finding-and-replacing-text-in-project.html (Find in Files)
- https://www.jetbrains.com/help/webstorm/searching-everywhere.html (Search Everywhere)
- https://blog.jetbrains.com/platform/2025/09/islands-theme-the-new-look-coming-to-jetbrains-ides/ (Islands theme context; not used for values)

## Still unverified
Light palette, classic Darcula values, Inter/JetBrains Mono sizing, macOS shortcut mapping, preview pane behavior, library performance claims (hljs/Shiki/Prism, react-virtual), Electron option behavior, ARIA contrast numbers.
