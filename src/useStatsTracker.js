import { ref, runTransaction } from 'firebase/database'
import { db, firebaseReady } from './firebase'

/* ----------------------------------------------------------------
 * Stats tracking for the analytics dashboard.
 *
 * Data lives under `listeners/stats/*` — the `listeners/*` tree is
 * the one path the RTDB rules allow anonymous clients to write to.
 * The `stats/*` tree is locked (401) and must NOT be used.
 *
 * Schema:
 *   listeners/stats/
 *     playsTotal               number
 *     plays/{stationId}        number
 *     stationMeta/{stationId} { name, country, tags }
 *     visitorsTotal            number
 *     visitorIds/{visitorId}   timestamp
 *     daily/{YYYY-MM-DD}/
 *       visitors               number
 *       playsTotal            number
 *       plays/{stationId}     number
 *
 * All writes are fire-and-forget: tracking must never break playback.
 * ---------------------------------------------------------------- */

const VKEY = 'tradio.visitorId'
const STATS_ROOT = 'listeners/stats'

function isReady() {
  return firebaseReady && !!db
}

/* ---------------- per-tab / per-session guards ---------------- */

const lastPlayTs = new Map() // stationId -> epoch ms (30s debounce)
let visitorRegistered = false // this page-load only

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VKEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `v_${Math.random().toString(36).slice(2)}_${Date.now()}`
      localStorage.setItem(VKEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Safe increment of a counter. Returns the delta actually applied (0 on
 * failure).
 *
 * Uses a transaction rather than `increment()`: `increment()` from
 * firebase/database is a *server-value sentinel* that has to be handed to
 * set()/update(). Calling `await increment(ref, delta)` does not write
 * anything — it just resolves to the sentinel — which is why every counter
 * this file wrote stayed empty while the transactions below (stationMeta,
 * visitorIds) worked.
 */
async function bump(path, delta) {
  if (!isReady()) return 0
  try {
    const result = await runTransaction(ref(db, `${STATS_ROOT}/${path}`), (current) => {
      const value = typeof current === 'number' && Number.isFinite(current) ? current : 0
      return value + delta
    })
    if (result && !result.committed) {
      console.warn(`[T-Radio] stats bump rejected ${path}`)
      return 0
    }
    return delta
  } catch (err) {
    console.warn(`[T-Radio] stats bump failed ${path}:`, err.message)
    return 0
  }
}

/** Register this device as a unique visitor — once per device, ever. */
export async function trackVisit() {
  if (!isReady() || visitorRegistered) return
  const id = getVisitorId()
  if (!id) return
  visitorRegistered = true

  try {
    // If visitorIds/{id} is null this is a first visit — write a timestamp
    // AND flag it in the commit so we can bump the total once, only then.
    let wasNew = false
    const r = await runTransaction(ref(db, `${STATS_ROOT}/visitorIds/${id}`), (v) => {
      if (v === null) {
        wasNew = true
        return Date.now()
      }
      return v
    })
    if (r && !r.committed) return
    if (wasNew) {
      await bump('visitorsTotal', 1)
    }
  } catch (err) {
    console.warn('[T-Radio] trackVisit failed:', err.message)
  }

  // Once per device per UTC day
  const day = utcDay()
  const markKey = `tradio.visited.${day}`
  let visitedToday = false
  try {
    visitedToday = localStorage.getItem(markKey) === '1'
  } catch {}
  if (!visitedToday) {
    await bump(`daily/${day}/visitors`, 1)
    try {
      localStorage.setItem(markKey, '1')
    } catch {}
  }
}

/**
 * Count a station play. Debounced 30s per station so rapid taps,
 * resumes, and auto-reconnects do not inflate the counter.
 * Call from startStation ONLY — never from togglePlay or resumeStream.
 */
export async function trackStatsPlay(st) {
  if (!isReady() || !st || !st.stationuuid) return

  const now = Date.now()
  const key = st.stationuuid
  const last = lastPlayTs.get(key) || 0
  if (now - last < 30_000) return
  lastPlayTs.set(key, now)

  const day = utcDay()

  // stationMeta: write only when absent or when details improved
  try {
    const r = await runTransaction(
      ref(db, `${STATS_ROOT}/stationMeta/${key}`),
      (cur) => {
        if (cur && cur.name) return cur
        return {
          name: st.name || key,
          country: st.country || '',
          tags: (st.tags || '').slice(0, 120),
        }
      },
    )
    if (r && !r.committed) console.warn('[T-Radio] stationMeta write denied by rules')
  } catch (err) {
    console.warn('[T-Radio] stationMeta failed:', err.message)
  }

  await bump('playsTotal', 1)
  await bump(`plays/${key}`, 1)
  // The daily total has to move with the per-station daily counter below,
  // otherwise the trend chart (daily/playsTotal) drifts away from the sum
  // of the per-station numbers.
  await bump(`daily/${day}/playsTotal`, 1)
  await bump(`daily/${day}/plays/${key}`, 1)
}

/**
 * Convenience for the app root: run once on mount.
 */
export function trackSessionStart() {
  trackVisit()
}
