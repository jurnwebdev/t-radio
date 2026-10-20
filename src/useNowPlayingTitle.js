import { useCallback, useEffect, useRef, useState } from 'react'

/* ----------------------------------------------------------------
 * useNowPlayingTitle — polls /api/nowplaying while audio is playing.
 *
 * The server reads ICY metadata from the station stream (the browser
 * cannot). Vercel's CDN caches per station, so polling is cheap.
 *
 * Returns:
 *   { artist, title, available, track, source } | null
 *
 * `track` is the display/search string: "Artist - Title" or just Title.
 * ---------------------------------------------------------------- */

const POLL_MS = 30000
const RETRY_MS = 60000 // after a definitive "no metadata" answer
const ERROR_RETRY_MS = 10000 // after a failed request (keep the last title)

/* The API response is CDN-cacheable ("public, s-maxage=25, ..."), which also
 * makes it cacheable by the browser. Chrome would then replay the *cached*
 * body for up to two minutes, so the song title would not move until the
 * user navigated away and back. Every poll therefore asks for a unique URL:
 * the bucket changes every CACHE_BUCKET_MS, so no poll can ever be answered
 * from a previous one. The CDN still absorbs the traffic — all listeners
 * polling inside the same bucket share one cache entry. */
const CACHE_BUCKET_MS = 20000

/** Build a stable cache key so a re-render doesn't restart polling. */
function useUrl(station) {
  return station ? station.url_resolved || station.url || '' : ''
}

export function useNowPlayingTitle(station) {
  const [meta, setMeta] = useState(null)
  const url = useUrl(station)
  const name = station ? station.name || '' : ''
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)

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
    if (!url) {
      setMeta(null)
      return undefined
    }

    cancelledRef.current = false
    let stopped = false

    const tick = async () => {
      if (stopped) return
      const result = await fetchOnce(url, name)
      if (stopped || cancelledRef.current) return

      if (result && result.available) {
        setMeta(result)
        timerRef.current = setTimeout(tick, POLL_MS)
      } else if (result) {
        // The station answered but had no song in this particular window.
        // Some stations publish the title only intermittently (ads, track
        // changes), so keep the last title we know instead of blanking the
        // card — and look again shortly to catch the next update.
        const permanent =
          /station identifiers only|no icy metadata/.test(result.reason || '')
        if (permanent) {
          setMeta(result)
          timerRef.current = setTimeout(tick, RETRY_MS)
        } else {
          timerRef.current = setTimeout(tick, ERROR_RETRY_MS)
        }
      } else {
        // Request failed outright — keep the title we already have and try
        // again soon instead of blanking the screen for a minute.
        timerRef.current = setTimeout(tick, ERROR_RETRY_MS)
      }
    }

    tick()

    return () => {
      stopped = true
      cancelledRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [url, name, fetchOnce])

  if (!meta || !meta.available) return null

  return {
    artist: meta.artist || '',
    title: meta.title || '',
    source: meta.source || 'icy',
    track: meta.artist ? `${meta.artist} - ${meta.title}` : meta.title,
  }
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
