// tradio-pwa/src/useAnalyticsStats.js
// Real-time read hooks for the analytics dashboard.
//
// Two trees feed the dashboard:
//   listeners/active   → presence written by useListenerCount (one entry
//                        per tab that is currently playing)
//   listeners/stats/*  → counters written by useStatsTracker (plays,
//                        visitors, per-station totals, daily buckets)
//
// The dashboard subscribes with onValue, so every widget live-updates
// with no polling.
//
// Every hook reports `ready` (the first snapshot arrived, whatever it
// contained) and `error` so the dashboard can leave its skeleton state
// even when a tree is empty or the rules deny the read, instead of
// spinning forever.

import { useEffect, useMemo, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db, firebaseReady } from './firebase'

export const ACTIVE_ROOT = 'listeners/active'
export const STATS_ROOT = 'listeners/stats'

/**
 * How old a presence record may be before it is ignored. Writers refresh
 * updatedAt every HEARTBEAT_MS (60s), so anything older than 2.5 beats is
 * a tab that died without its onDisconnect firing.
 */
export const PRESENCE_STALE_MS = 150_000

/**
 * Subscribe to an absolute RTDB path.
 *
 * The path is used as given — earlier versions prefixed anything that did
 * not start with `listeners/stats`, which silently turned the presence
 * reads (`listeners/active`) into `listeners/stats/listeners/active` and
 * left every live widget empty.
 */
function subscribe(path, onData, onError) {
  if (!firebaseReady || !db) {
    onError?.(new Error('Firebase is not configured (VITE_FIREBASE_* missing)'))
    return () => {}
  }
  try {
    return onValue(
      ref(db, path),
      (snap) => onData(snap.val()),
      (err) => onError?.(err),
    )
  } catch (err) {
    onError?.(err)
    return () => {}
  }
}

/** Live sessions in listeners/active, dropping dead tabs. */
function activeRecords(data, now = Date.now()) {
  if (!data || typeof data !== 'object') return []
  return Object.keys(data)
    .map((key) => ({ key, ...(data[key] || {}) }))
    .filter((rec) => !rec.updatedAt || now - rec.updatedAt <= PRESENCE_STALE_MS)
}

/** Re-render helper so expired presence disappears without a new snapshot. */
function useNowTick(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Live app-wide active listener count. */
export function useActiveCount() {
  const [state, setState] = useState({ data: null, ready: false, error: null })
  const now = useNowTick()
  useEffect(() => {
    return subscribe(
      ACTIVE_ROOT,
      (data) => setState({ data: data || {}, ready: true, error: null }),
      (err) => setState({ data: {}, ready: true, error: err.message }),
    )
  }, [])
  const count = useMemo(() => activeRecords(state.data, now).length, [state.data, now])
  return { count, ready: state.ready, error: state.error }
}

/** Live per-station listener breakdown: { [stationId]: count }. */
export function useListenersByStation() {
  const [data, setData] = useState(null)
  const now = useNowTick()
  useEffect(() => {
    return subscribe(ACTIVE_ROOT, (d) => setData(d || {}), () => setData({}))
  }, [])
  return useMemo(() => {
    const out = {}
    for (const rec of activeRecords(data, now)) {
      if (rec.stationId) out[rec.stationId] = (out[rec.stationId] || 0) + 1
    }
    return out
  }, [data, now])
}

/**
 * All counters: playsTotal, visitorsTotal, plays/{id}, stationMeta/{id},
 * daily/{date}/..., visitorIds/{id}.
 *
 * `stats` is an object (never null) once `ready` is true, so callers can
 * render zero-filled empty states instead of waiting for data that may
 * never arrive.
 */
export function useStatsCounters() {
  const [state, setState] = useState({ stats: null, ready: false, error: null })
  useEffect(() => {
    return subscribe(
      STATS_ROOT,
      (data) => setState({ stats: data && typeof data === 'object' ? data : {}, ready: true, error: null }),
      (err) => setState({ stats: {}, ready: true, error: err.message }),
    )
  }, [])
  return state
}

/**
 * Daily buckets for the last N UTC days.
 * Subscribes once to the whole `daily` tree (tiny at this scale) and
 * derives the last-N-days window locally. Returns {
 *   series: [{ date, playsTotal, plays, visitors }] oldest→newest with
 *           zero-filled gaps so charts never have holes,
 *   ready:  the first snapshot arrived,
 *   error,
 * }.
 */
export function useDailySeries(days = 14) {
  const [state, setState] = useState({ daily: null, ready: false, error: null })
  const [todayIdx, setTodayIdx] = useState(() => Math.floor(Date.now() / 86_400_000))

  useEffect(() => {
    const off = subscribe(
      `${STATS_ROOT}/daily`,
      (data) => setState({ daily: data && typeof data === 'object' ? data : {}, ready: true, error: null }),
      (err) => setState({ daily: {}, ready: true, error: err.message }),
    )
    // Refresh the UTC day index once a minute so the window slides
    // overnight without a reload.
    const t = setInterval(() => {
      setTodayIdx(Math.floor(Date.now() / 86_400_000))
    }, 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const series = useMemo(() => {
    if (!state.daily) return null
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date((todayIdx - i) * 86_400_000).toISOString().slice(0, 10)
      const day = state.daily[d]
      out.push({
        date: d,
        playsTotal: day?.playsTotal || 0,
        plays: day?.plays || {},
        visitors: day?.visitors || 0,
      })
    }
    return out
  }, [state.daily, days, todayIdx])

  return { series, ready: state.ready, error: state.error }
}

/** Live "last seen" per station from listener presence (updatedAt). */
export function useLastActiveByStation() {
  const [data, setData] = useState(null)
  const now = useNowTick()
  useEffect(() => {
    return subscribe(ACTIVE_ROOT, (d) => setData(d || {}), () => setData({}))
  }, [])
  return useMemo(() => {
    const out = {}
    for (const rec of activeRecords(data, now)) {
      const sid = rec.stationId
      if (sid && rec.updatedAt && (!out[sid] || rec.updatedAt > out[sid])) {
        out[sid] = rec.updatedAt
      }
    }
    return out
  }, [data, now])
}
