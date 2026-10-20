import { useEffect, useRef, useCallback } from 'react'
import { ref, onValue, increment } from 'firebase/database'
import { db, firebaseReady } from './firebase'

function bumpCounter(path, delta) {
  if (!firebaseReady) return
  increment(ref(db, path), delta).catch(() => {})
}

/* ----------------------------------------------------------------
 * useListenerCount — real-time "how many are listening now"
 *
 * A browser tab counts as ONE listener. Even if multiple
 * components are watching the same station, each tab
 * increments the counter exactly once.
 *
 * Counters:
 *   listeners/total        -> app-wide "X listening now"
 *   listeners/{stationId}   -> per-station "X listening to Y now"
 *
 * All writes go through useSessionListener's trackPlay/trackStop.
 * useStationListener is read-only — it just subscribes to display.
 * ---------------------------------------------------------------- */

// Per-tab guard: has the total counter been incremented for this tab?
let totalIncremented = false

// Per-tab, per-station: has this station counter been incremented?
const stationCounted = new Map() // stationId -> true

// Which stations this tab has active, so cleanup can roll back each
const activeStations = new Set()

function totalPath() {
  return 'listeners/total'
}

function stationPath(stationId) {
  return `listeners/${stationId}`
}

/**
 * Use ONCE at the app root (e.g. HomeScreen).
 * Subscribes to the live total and returns trackPlay / trackStop
 * functions that are safe to call from anywhere in the app.
 *
 * Double-counting is impossible — each browser tab increments
 * the total exactly once, and each station exactly once.
 */
export function useSessionListener() {
  const stateRef = useRef({ count: 0 })

  // Subscribe to the live app-wide total
  useEffect(() => {
    if (!firebaseReady) return
    const totalRef = ref(db, totalPath())
    const unsub = onValue(totalRef, (snap) => {
      const count = snap.val() ?? 0
      stateRef.current.count = count
      // Update any element with [data-listener-count] in the DOM
      document.querySelectorAll('[data-listener-count]').forEach((el) => {
        el.textContent = String(count)
      })
    })

    // On unmount, roll back every station this tab had active
    return () => {
      unsub()
      activeStations.forEach((stationId) => {
        if (stationCounted.get(stationId)) {
          bumpCounter(stationPath(stationId), -1)
          stationCounted.set(stationId, false)
        }
      })
      activeStations.clear()
      if (totalIncremented) {
        bumpCounter(totalPath(), -1)
        totalIncremented = false
      }
    }
  }, [])

  /**
   * Call when audio starts playing a station.
   * Increments the station counter (once per station per tab)
   * and the total counter (once per tab).
   */
  const trackPlay = useCallback((stationId) => {
    if (!stationId) return
    activeStations.add(stationId)
    if (!stationCounted.get(stationId)) {
      bumpCounter(stationPath(stationId), 1)
      stationCounted.set(stationId, true)
    }
    if (!totalIncremented) {
      bumpCounter(totalPath(), 1)
      totalIncremented = true
    }
  }, [])

  /**
   * Call when the user pauses / stops the station.
   * Decrements the station counter; if no stations remain active
   * in this tab, also decrements the total.
   */
  const trackStop = useCallback((stationId) => {
    if (!stationId) return
    activeStations.delete(stationId)
    if (stationCounted.get(stationId)) {
      bumpCounter(stationPath(stationId), -1)
      stationCounted.set(stationId, false)
    }
    if (activeStations.size === 0 && totalIncremented) {
      bumpCounter(totalPath(), -1)
      totalIncremented = false
    }
  }, [])

  return {
    get count() {
      return stateRef.current.count
    },
    trackPlay,
    trackStop,
  }
}

/**
 * READ-ONLY subscription for a single station's live "X listening now"
 * count. Updates DOM elements with [data-station-listener-count]
 * so the count displays without triggering React re-renders.
 */
export function useStationListener(stationId) {
  const stateRef = useRef({ count: 0 })

  useEffect(() => {
    if (!stationId || !firebaseReady) return
    const stationRef = ref(db, stationPath(stationId))
    const unsub = onValue(stationRef, (snap) => {
      const count = snap.val() ?? 0
      stateRef.current.count = count
      document
        .querySelectorAll(`[data-station-listener-count="${stationId}"]`)
        .forEach((el) => {
          el.textContent = String(count)
        })
    })
    return () => unsub()
  }, [stationId])

  return {
    get count() {
      return stateRef.current.count
    },
  }
}
