import { useEffect, useState, useCallback } from 'react'
import { ref, onValue, set, remove, onDisconnect } from 'firebase/database'
import { db, firebaseReady } from './firebase'

/* ----------------------------------------------------------------
 * useListenerCount — Real-time presence listener tracking
 *
 * Architecture:
 * - Each browser tab is assigned a unique sessionId.
 * - When audio starts playing, the tab registers under:
 *     listeners/active/{sessionId} = { stationId, updatedAt }
 * - An onDisconnect(sessionRef).remove() handler is registered with Firebase.
 *   If the tab closes, crashes, or loses connection, the Firebase server
 *   automatically removes this record immediately.
 * - When audio is paused/stopped, the record is removed by the client.
 * - The live global listener count is simply the number of active sessions
 *   under listeners/active. No counter drift, no ghost counts.
 * ---------------------------------------------------------------- */

// Unique session identifier for this browser tab
const tabSessionId =
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`

let currentStationId = null
let isTrackingActive = false
let stopTimer = null

function getSessionRef() {
  if (!firebaseReady || !db) return null
  return ref(db, `listeners/active/${tabSessionId}`)
}

/**
 * Use ONCE at the app root (e.g. HomeScreen).
 * Subscribes to the live total active listeners and returns trackPlay / trackStop
 * functions safe to call from anywhere in the app.
 */
export function useSessionListener() {
  const [count, setCount] = useState(0)

  // Subscribe to live active listeners across all stations
  useEffect(() => {
    if (!firebaseReady || !db) return undefined

    let unsubActive = () => {}
    let unsubConnected = () => {}

    try {
      const activeRef = ref(db, 'listeners/active')
      unsubActive = onValue(
        activeRef,
        (snap) => {
          const data = snap.val() || {}
          const activeCount = Object.keys(data).length
          console.log(`[T-Radio] RTDB active listeners: ${activeCount}`)
          setCount(activeCount)
        },
        (err) => {
          console.error('[T-Radio] RTDB active listeners subscribe failed:', err)
        }
      )

      // Re-arm presence if network disconnects and reconnects while listening
      const connectedRef = ref(db, '.info/connected')
      unsubConnected = onValue(connectedRef, (snap) => {
        if (snap.val() === true && isTrackingActive && currentStationId) {
          const sessionRef = getSessionRef()
          if (sessionRef) {
            set(sessionRef, {
              stationId: currentStationId,
              updatedAt: Date.now(),
            }).catch(() => {})
            onDisconnect(sessionRef).remove().catch(() => {})
          }
        }
      })
    } catch (err) {
      console.error('[T-Radio] Failed to initialize listeners listener:', err)
    }

    const handleBeforeUnload = () => {
      if (isTrackingActive) {
        const sessionRef = getSessionRef()
        if (sessionRef) {
          remove(sessionRef).catch(() => {})
        }
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unsubActive()
      unsubConnected()
      if (stopTimer) {
        clearTimeout(stopTimer)
        stopTimer = null
      }
      if (isTrackingActive) {
        isTrackingActive = false
        const sessionRef = getSessionRef()
        if (sessionRef) {
          remove(sessionRef).catch(() => {})
        }
      }
    }
  }, [])

  /**
   * Call when audio starts playing a station.
   * Registers this tab's session in listeners/active and arms onDisconnect.
   */
  const trackPlay = useCallback((stationId) => {
    if (!stationId) return

    if (stopTimer) {
      clearTimeout(stopTimer)
      stopTimer = null
    }

    currentStationId = stationId
    isTrackingActive = true

    const sessionRef = getSessionRef()
    if (!sessionRef) return

    set(sessionRef, {
      stationId,
      updatedAt: Date.now(),
    })
      .then(() => {
        console.log(`[T-Radio] ✓ Active listener registered (${stationId})`)
      })
      .catch((err) => {
        console.error('[T-Radio] ✗ Failed to register active listener:', err)
      })

    onDisconnect(sessionRef)
      .remove()
      .catch((err) => {
        console.error('[T-Radio] ✗ onDisconnect setup failed:', err)
      })
  }, [])

  /**
   * Call when the user pauses / stops the station.
   * Debounced slightly to prevent momentary flicker during station switching.
   */
  const trackStop = useCallback((stationId) => {
    if (stationId && currentStationId && stationId !== currentStationId) {
      return
    }

    if (stopTimer) clearTimeout(stopTimer)

    stopTimer = setTimeout(() => {
      isTrackingActive = false
      currentStationId = null

      const sessionRef = getSessionRef()
      if (!sessionRef) return

      onDisconnect(sessionRef)
        .cancel()
        .catch(() => {})

      remove(sessionRef)
        .then(() => {
          console.log('[T-Radio] ✓ Active listener session removed')
        })
        .catch((err) => {
          console.error('[T-Radio] ✗ Failed to remove active listener:', err)
        })
    }, 120)
  }, [])

  return {
    count,
    trackPlay,
    trackStop,
  }
}

/**
 * READ-ONLY subscription for a single station's live "X listening now"
 * count. Updates DOM elements with [data-station-listener-count]
 * and returns the count.
 */
export function useStationListener(stationId) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!stationId || !firebaseReady || !db) return undefined

    let unsub = () => {}
    try {
      const activeRef = ref(db, 'listeners/active')
      unsub = onValue(activeRef, (snap) => {
        const data = snap.val() || {}
        let stationCount = 0
        for (const key of Object.keys(data)) {
          if (data[key]?.stationId === stationId) {
            stationCount++
          }
        }
        setCount(stationCount)
        document
          .querySelectorAll(`[data-station-listener-count="${stationId}"]`)
          .forEach((el) => {
            el.textContent = String(stationCount)
          })
      })
    } catch (err) {
      console.error('[T-Radio] useStationListener error:', err)
    }

    return () => unsub()
  }, [stationId])

  return { count }
}
