import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api, type IndexStatus, type MenuCommand } from '../shared/types'

const api: Api = {
  pickWorkspace: () => ipcRenderer.invoke(IPC.pickWorkspace),
  openWorkspace: (p) => ipcRenderer.invoke(IPC.openWorkspace, p),
  search: (req) => ipcRenderer.invoke(IPC.search, req),
  onIndexStatus: (cb) => {
    const h = (_: unknown, s: IndexStatus): void => cb(s)
    ipcRenderer.on(IPC.indexStatus, h)
    return () => ipcRenderer.removeListener(IPC.indexStatus, h)
  },
  readFile: (req) => ipcRenderer.invoke(IPC.readFile, req),
  listEditors: () => ipcRenderer.invoke(IPC.listEditors),
  openInEditor: (f, l, c, e) => ipcRenderer.invoke(IPC.openInEditor, f, l, c, e),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (p) => ipcRenderer.invoke(IPC.setSettings, p),
  removeRecentWorkspace: (p) => ipcRenderer.invoke(IPC.removeRecent, p),
  getStartupWorkspace: () => ipcRenderer.invoke(IPC.startupWorkspace),
  onMenu: (cb) => {
    const h = (_: unknown, c: MenuCommand): void => cb(c)
    ipcRenderer.on(IPC.menu, h)
    return () => ipcRenderer.removeListener(IPC.menu, h)
  }
}

contextBridge.exposeInMainWorld('api', api)
