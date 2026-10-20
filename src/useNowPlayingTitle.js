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
const RETRY_MS = 120000 // after a definitive "no metadata" answer

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
    try {
      const res = await fetch(
        `/api/nowplaying?url=${encodeURIComponent(streamUrl)}&name=${encodeURIComponent(stationName || '')}`,
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
      } else {
        // Station has no metadata (or was briefly unreachable).
        setMeta(result || null)
        timerRef.current = setTimeout(tick, RETRY_MS)
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
