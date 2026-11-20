import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

async function boot(): Promise<void> {
  const flag = new URLSearchParams(location.search + location.hash.replace('#', '&')).has('FUGLY_MOCK')
  if (flag || !window.api) (await import('./lib/mock')).installMock()
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(<App />)
}
void boot()
