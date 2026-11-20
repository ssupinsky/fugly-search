import type { Api } from '@shared/types'
/** Real preload api, or the mock when FUGLY_MOCK is set (contextBridge props are read-only). */
export const api: Api = (window as unknown as { __mockApi?: Api }).__mockApi ?? window.api
