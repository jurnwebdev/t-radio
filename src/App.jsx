import { Suspense, lazy, useEffect, useState } from 'react'
import HomeScreen from './HomeScreen'
import './App.css'

/**
 * Minimal hash router. `#/admin` renders the owner analytics dashboard,
 * everything else renders the radio. Hash routing keeps the PWA's
 * static hosting model (no server rewrites, deep links survive
 * service-worker precache, back button works on mobile).
 */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return hash
}

/** Lazy so the dashboard (charts + Firebase reads) stays out of the main bundle. */
const AnalyticsDashboard = lazy(() => import('./AnalyticsDashboard'))

function App() {
  const hash = useHashRoute()
  const isAdmin = hash.startsWith('#/admin')

  if (isAdmin) {
    return (
      <Suspense
        fallback={
          <div style={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center', background: 'var(--app-bg)', color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
            Loading dashboard…
          </div>
        }
      >
        <AnalyticsDashboard
          onBack={() => {
            window.location.hash = ''
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          }}
        />
      </Suspense>
    )
  }

  return <HomeScreen />
}

export default App
