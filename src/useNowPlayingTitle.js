import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* ----------------------------------------------------------------
 * useNowPlayingTitle — polls /api/nowplaying while audio is playing.
 *
 * The server reads ICY metadata from the station stream (the browser
 * cannot). Vercel's CDN caches per station, so polling is cheap.
 *
 * Returns { nowPlaying, status }:
 *   nowPlaying → { artist, title, source, track } | null
 *   status     → 'idle' | 'loading' | 'ok' | 'none'
 *
 * WHEN A TITLE MAY BE SHOWN
 * --------------------------
 * A title is only shown while all three hold:
 *
 *  1. It belongs to the station that is playing right now. Switching
 *     station clears the title immediately — a previous station's song
 *     must never be shown for the new one.
 *  2. The stream is still publishing it. The server re-reads the ICY
 *     metadata on every poll, so a title that stopped being published
 *     stops being confirmed. It is dropped CONFIRM_GRACE_MS later.
 *  3. The title is not stuck. Some stations keep a static "now playing"
 *     tag for hours (or forever); if the title string never changes for
 *     TITLE_STUCK_MS it is hidden — that is the "wrong song" case.
 * ---------------------------------------------------------------- */

const POLL_MS = 30000
const RETRY_MS = 60000 // after a definitive "this station has no titles" answer
const ERROR_RETRY_MS = 10000 // after a failed request (keep the last title)

/** How long a title survives without the server confirming it. */
const CONFIRM_GRACE_MS = 120000

/**
 * How long a title may stay identical before it is treated as stuck.
 * Songs run 3-8 minutes and talk shows much longer, so this is
 * deliberately longer than one song: it is a "the encoder never
 * updated" guard, not a "is this song still playing" guard.
 */
const TITLE_STUCK_MS = 600000

/* The API response is CDN-cacheable ("public, s-maxage=25, ..."), which also
 * makes it cacheable by the browser. Chrome would then replay the *cached*
 * body for up to two minutes, so the song title would not move until the
 * user navigated away and back. Every poll therefore asks for a unique URL:
 * the bucket changes every CACHE_BUCKET_MS, so no poll can ever be answered
 * from a previous one. The CDN still absorbs the traffic — all listeners
 * polling inside the same bucket share one cache entry. */
const CACHE_BUCKET_MS = 20000

/** Re-render tick, so a title disappears exactly when it goes stale. */
const TICK_MS = 10000

const EMPTY = {
  url: '',
  key: '',
  artist: '',
  title: '',
  source: '',
  confirmedAt: 0,
  changedAt: 0,
  answered: false,
}

/** Build a stable cache key so a re-render doesn't restart polling. */
function useUrl(station) {
  return station ? station.url_resolved || station.url || '' : ''
}

/**
 * The rule that decides whether a title may still be shown.
 * Exported so the policy can be tested on its own.
 */
export function isTitleFresh(state, now = Date.now()) {
  if (!state || !state.title || !state.confirmedAt) return false
  // The stream stopped confirming this title.
  if (now - state.confirmedAt > CONFIRM_GRACE_MS) return false
  // The title never changes: the station is showing a stale tag.
  if (now - state.changedAt > TITLE_STUCK_MS) return false
  return true
}

export function useNowPlayingTitle(station) {
  const url = useUrl(station)
  const name = station ? station.name || '' : ''
  const timerRef = useRef(null)
  const [state, setState] = useState(EMPTY)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  const fetchOnce = useCallback(async (streamUrl, stationName) => {
    if (!streamUrl) return null
    const bucket = Math.floor(Date.now() / CACHE_BUCKET_MS)
    try {
      const res = await fetch(
        `/api/nowplaying?url=${encodeURIComponent(streamUrl)}` +
          `&name=${encodeURIComponent(stationName || '')}&b=${bucket}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!url) return undefined

    let stopped = false

    const tick = async () => {
      if (stopped) return
      const result = await fetchOnce(url, name)
      if (stopped) return

      if (result && result.available) {
        const at = Date.now()
        setState((prev) => {
          const key = `${result.artist || ''}|${result.title || ''}`
          // The title counts as "new" when it changed, and also when it
          // comes back after having expired (same song, new broadcast).
          // `prev` may belong to another station — then it is always new.
          const sameStation = prev.url === url
          const expired = !sameStation || !prev.confirmedAt || at - prev.confirmedAt > CONFIRM_GRACE_MS
          const changed = !sameStation || prev.key !== key || expired
          return {
            url,
            key,
            artist: result.artist || '',
            title: result.title || '',
            source: result.source || 'icy',
            confirmedAt: at,
            changedAt: changed ? at : prev.changedAt,
            answered: true,
          }
        })
        timerRef.current = setTimeout(tick, POLL_MS)
        return
      }

      // No title this time (or the request failed). Whatever we are
      // showing survives only until CONFIRM_GRACE_MS runs out — that is
      // the "is the metadata still live?" check.
      setState((prev) => {
        if (prev.url === url) return prev.answered ? prev : { ...prev, answered: true }
        return { ...EMPTY, url, answered: true }
      })

      const reason = (result && result.reason) || ''
      const permanent =
        /station identifiers only|no icy metadata|no song titles published/i.test(reason)
      timerRef.current = setTimeout(tick, permanent ? RETRY_MS : ERROR_RETRY_MS)
    }

    tick()

    return () => {
      stopped = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [url, name, fetchOnce])

  const nowPlaying = useMemo(() => {
    // A title only counts for the station it was read from: switching
    // station hides the previous one immediately (derived, not a reset).
    if (state.url !== url) return null
    if (!isTitleFresh(state, now)) return null
    return {
      artist: state.artist,
      title: state.title,
      source: state.source,
      track: state.artist ? `${state.artist} - ${state.title}` : state.title,
    }
  }, [state, now, url])

  // 'none' only once the current station has answered and has no title.
  const status = !url
    ? 'idle'
    : nowPlaying
      ? 'ok'
      : state.url === url && state.answered
        ? 'none'
        : 'loading'

  return { nowPlaying, status }
}

/** Spotify / Apple Music deep links — no API keys, plain search URLs. */
export function musicLinks(track) {
  const q = (track || '').trim()
  if (!q) return null
  const enc = encodeURIComponent(q)
  return {
    spotify: `https://open.spotify.com/search/${enc}`,
    apple: `https://music.apple.com/search?term=${enc}`,
  }
}
