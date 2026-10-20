import { useCallback, useEffect, useState } from 'react'
import HomeScreen from './HomeScreen'
import AdminGate from './AdminGate'
import './App.css'

/**
 * Minimal hash router: `#/admin` opens the owner analytics dashboard
 * behind a passcode gate (see AdminGate.jsx), everything else is the
 * radio. Hash routing keeps the PWA's static hosting model (no server
 * rewrites, deep links survive service-worker precache, the back button
 * works on mobile).
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

function App() {
  const hash = useHashRoute()
  const isAdmin = hash.startsWith('#/admin')

  const goHome = useCallback(() => {
    window.location.hash = ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])

  if (isAdmin) return <AdminGate onExit={goHome} />

  return <HomeScreen />
}

export default App
