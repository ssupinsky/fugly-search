// IPC contract shared by main, preload and renderer. Keep dependency-free.

export interface SearchRequest {
  id: number | string
  query: string
  caseSensitive?: boolean
  maxResults: number
}

export interface SearchMatch {
  /** path relative to workspace root, forward slashes */
  file: string
  /** 1-based */
  line: number
  text: string
  /** [start, end) char ranges within `text` */
  matchRanges: [number, number][]
  score: number
}

export interface SearchResponse {
  id: number | string
  matches: SearchMatch[]
  totalFiles: number
  totalLines: number
  tookMs: number
  truncated: boolean
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'ready'
  files: number
  lines: number
  root: string | null
}

export type EditorId = 'webstorm' | 'vscode' | 'cursor' | 'system'

export interface EditorInfo {
  id: EditorId
  label: string
  available: boolean
}

export interface Settings {
  editor: EditorId
  recentWorkspaces: string[]
  theme?: 'dark' | 'light' | 'system'
}

export interface FileContextRequest {
  file: string // relative path
  line: number // 1-based center line
  /** lines before/after `line`; default 50 */
  radius?: number
}

export interface FileContextResponse {
  file: string
  /** 1-based line number of lines[0] */
  startLine: number
  lines: string[]
  totalLines: number
  /** false if binary/unreadable/too large */
  ok: boolean
  error?: string
}

export interface Api {
  pickWorkspace(): Promise<string | null>
  openWorkspace(path: string): Promise<IndexStatus>
  search(req: SearchRequest): Promise<SearchResponse>
  onIndexStatus(cb: (s: IndexStatus) => void): () => void
  readFile(req: FileContextRequest): Promise<FileContextResponse>
  listEditors(): Promise<EditorInfo[]>
  openInEditor(file: string, line: number, col?: number, editor?: EditorId): Promise<boolean>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** forget a recent workspace (list entry only; nothing on disk is deleted) */
  removeRecentWorkspace(path: string): Promise<Settings>
  /** workspace passed via FUGLY_TEST_WORKSPACE, if any */
  getStartupWorkspace(): Promise<string | null>
  /** native menu commands */
  onMenu(cb: (cmd: MenuCommand) => void): () => void
}

export type MenuCommand = 'open-folder' | 'focus-search' | 'toggle-preview' | 'toggle-case' | 'toggle-group'

export const IPC = {
  pickWorkspace: 'workspace:pick',
  openWorkspace: 'workspace:open',
  search: 'search:run',
  indexStatus: 'index:status',
  readFile: 'file:read',
  listEditors: 'editors:list',
  openInEditor: 'editors:open',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  removeRecent: 'settings:removeRecent',
  startupWorkspace: 'workspace:startup',
  menu: 'menu:cmd'
} as const
