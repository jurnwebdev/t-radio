import { useEffect } from 'react'
import HomeScreen from './HomeScreen'
import './App.css'

/**
 * The owner analytics dashboard is currently disabled: there is no
 * authentication in front of it yet, so it must not be reachable from
 * the app or by URL.
 *
 * `AnalyticsDashboard.jsx` is kept on disk (re-enabling it is a matter
 * of restoring the route in this file) but nothing links to it and the
 * old `#/admin` hash is cleared on load.
 */
function App() {
  useEffect(() => {
    if (window.location.hash.startsWith('#/admin')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  return <HomeScreen />
}

export default App
