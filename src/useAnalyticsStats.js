// tradio-pwa/src/useAnalyticsStats.js
// Real-time read hooks for the analytics dashboard.
//
// The app writes counters under `listeners/stats/*` (the `listeners/*`
// tree is the only path the RTDB rules allow anonymous clients to
// touch — the top-level `stats/*` tree is locked with 401).
//
// The dashboard subscribes with onValue, so every widget live-updates
// with no polling.

import { useEffect, useMemo, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db, firebaseReady } from './firebase'

const STATS_ROOT = 'listeners/stats'

function sub(path, cb) {
  if (!firebaseReady || !db) return () => {}
  const r = ref(db, path.startsWith(STATS_ROOT) ? path : `${STATS_ROOT}/${path}`)
  return onValue(r, (snap) => cb(snap.val()), (err) => {
    console.error(`[T-Radio] dashboard subscribe failed ${path}:`, err.message)
  })
}

/** Live app-wide active listener count (scans listeners/active). */
export function useActiveCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    return sub('listeners/active', (data) => {
      setCount(data ? Object.keys(data).length : 0)
    })
  }, [])
  return count
}

/** Live per-station listener breakdown: { [stationId]: count }. */
export function useListenersByStation() {
  const [byStation, setByStation] = useState({})
  useEffect(() => {
    return sub('listeners/active', (data) => {
      const out = {}
      for (const key of Object.keys(data || {})) {
        const sid = data[key]?.stationId
        if (sid) out[sid] = (out[sid] || 0) + 1
      }
      setByStation(out)
    })
  }, [])
  return byStation
}

/** All counters: playsTotal, visitorsTotal, plays/{id}, stationMeta/{id}. */
export function useStatsCounters() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    return sub(STATS_ROOT, (data) => {
      setStats(data || null)
    })
  }, [])
  return stats
}

/**
 * Daily buckets for the last N UTC days.
 * Subscribes once to the whole `daily` tree (tiny at this scale) and
 * derives the last-N-days window locally. Returns an array of
 * { date, playsTotal, plays, visitors } oldest→newest with zero-filled
 * gaps, so charts never have holes.
 */
export function useDailySeries(days = 14) {
  const [daily, setDaily] = useState(null)
  const [todayIdx, setTodayIdx] = useState(() => Math.floor(Date.now() / 86_400_000))

  useEffect(() => {
    const off = sub(`${STATS_ROOT}/daily`, (data) => {
      setDaily(data || {})
    })
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

  return useMemo(() => {
    if (!daily) return null
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date((todayIdx - i) * 86_400_000).toISOString().slice(0, 10)
      const day = daily[d]
      out.push({
        date: d,
        playsTotal: day?.playsTotal || 0,
        plays: day?.plays || {},
        visitors: day?.visitors || 0,
      })
    }
    return out
  }, [daily, days, todayIdx])
}

/** Live "last seen" per station from listener presence (updatedAt). */
export function useLastActiveByStation() {
  const [lastActive, setLastActive] = useState({})
  useEffect(() => {
    return sub('listeners/active', (data) => {
      const out = {}
      for (const key of Object.keys(data || {})) {
        const rec = data[key]
        const sid = rec?.stationId
        if (sid && rec?.updatedAt && (!out[sid] || rec.updatedAt > out[sid])) {
          out[sid] = rec.updatedAt
        }
      }
      setLastActive(out)
    })
  }, [])
  return lastActive
}
