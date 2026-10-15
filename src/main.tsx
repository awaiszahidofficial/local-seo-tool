import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { EnvErrorScreen } from './components/EnvErrorScreen'
import { validateEnv } from './lib/env'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root was not found in index.html')

const root = createRoot(container)
const envResult = validateEnv(import.meta.env)

if (!envResult.ok) {
  // Show a clear configuration screen instead of crashing when Supabase variables are missing.
  root.render(
    <StrictMode>
      <EnvErrorScreen errors={envResult.errors} />
    </StrictMode>,
  )
} else {
  // Imported lazily so the Supabase client is only created once the environment is known to be valid.
  void import('./App').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
