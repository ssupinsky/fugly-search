import { app, BrowserWindow, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { IPC, type MenuCommand } from '../shared/types'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { dispose } from './search/engine'

if (process.env.FUGLY_USER_DATA) app.setPath('userData', process.env.FUGLY_USER_DATA)

const boundsFile = (): string => join(app.getPath('userData'), 'window.json')
function loadBounds(): { width: number; height: number; x?: number; y?: number } {
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8'))
    if (Number.isFinite(b.width) && Number.isFinite(b.height)) return b
  } catch { /* none */ }
  return { width: 1200, height: 800 }
}
const iconPath = join(__dirname, '../../resources/icon.png')

function buildMenu(win: BrowserWindow): void {
  const send = (c: MenuCommand) => () => win.webContents.send(IPC.menu, c)
  const mac = process.platform === 'darwin'
  const t: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: send('open-folder') },
      { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: send('focus-search') },
      { type: 'separator' }, mac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+P', click: send('toggle-preview') },
      { label: 'Match Case', accelerator: 'CmdOrCtrl+Alt+C', click: send('toggle-case') },
      { label: 'Group by File', click: send('toggle-group') },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(t))
}

function createWindow(): void {
  const saved = loadBounds()
  const win = new BrowserWindow({
    ...saved,
    icon: existsSync(iconPath) ? iconPath : undefined,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#1e1f22',
    title: 'Fugly Search',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  const saveBounds = (): void => { try { if (!win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) writeFileSync(boundsFile(), JSON.stringify(win.getBounds())) } catch { /* ignore */ } }
  win.on('close', saveBounds)
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)
  buildMenu(win)
  win.on('page-title-updated', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  registerIpc(win)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => {
  void dispose()
  if (process.platform !== 'darwin') app.quit()
})
