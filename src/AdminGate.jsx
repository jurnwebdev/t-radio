// tradio-pwa/src/AdminGate.jsx
//
// Passcode gate in front of the owner analytics dashboard.
//
// This keeps the dashboard out of casual reach; it is NOT real security.
// VITE_ADMIN_PASSCODE is inlined into the bundle at build time, so anyone
// who reads the JavaScript can find it, and the RTDB rules are still the
// thing that actually protects the data. Real auth (Firebase Auth + rules
// bound to the owner uid) is the upgrade path.
//
// The unlocked state is stored per device so the passcode is asked once.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

const AnalyticsDashboard = lazy(() => import('./AnalyticsDashboard'))

const STORE_KEY = 'tradio.admin'
const PASSCODE = import.meta.env.VITE_ADMIN_PASSCODE

/** SHA-256 hex of a string; falls back to the raw value without crypto.subtle. */
async function digest(value) {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
    return `plain:${value}`
  }
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readUnlocked() {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}

export default function AdminGate({ onExit }) {
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lock = useCallback(() => {
    try {
      localStorage.removeItem(STORE_KEY)
    } catch {}
    setUnlocked(false)
    setValue('')
    setError('')
  }, [])

  useEffect(() => {
    if (!PASSCODE) setError('Admin passcode is not configured (VITE_ADMIN_PASSCODE).')
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!PASSCODE || busy) return
    setBusy(true)
    setError('')
    try {
      const [entered, expected] = await Promise.all([digest(value), digest(PASSCODE)])
      if (entered === expected) {
        try {
          localStorage.setItem(STORE_KEY, '1')
        } catch {}
        setUnlocked(true)
        setValue('')
      } else {
        setError('Wrong passcode.')
      }
    } catch {
      setError('Could not verify the passcode on this device.')
    } finally {
      setBusy(false)
    }
  }

  if (unlocked) {
    return (
      <Suspense fallback={<div className="dash-gate-loading">Loading dashboard…</div>}>
        <AnalyticsDashboard onBack={onExit} onLock={lock} />
      </Suspense>
    )
  }

  return (
    <div className="dash-gate">
      <form className="dash-gate-card" onSubmit={submit}>
        <h1>T-Radio · Owner</h1>
        <p>Enter the admin passcode to open the analytics dashboard.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          placeholder="Passcode"
          aria-label="Admin passcode"
          autoComplete="current-password"
          autoFocus
          disabled={!PASSCODE}
        />
        {error && <span className="dash-gate-error" role="alert">{error}</span>}
        <button type="submit" disabled={!PASSCODE || busy || !value}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <button type="button" className="dash-gate-back" onClick={onExit}>
          Back to the radio
        </button>
      </form>
    </div>
  )
}
