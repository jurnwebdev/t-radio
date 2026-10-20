import { useEffect, useRef, useCallback } from 'react'

/**
 * useMediaSession — mirror the radio player onto the OS media controls
 * (lock screen / media widget) with proper prev/next channel actions.
 *
 * The existing effect in HomeScreen sets metadata only. This hook adds the
 * actual handler wiring: prev -> previous station, next -> next station,
 * play/pause -> toggle, and artwork on the lock screen card.
 *
 * `handlersRef` is a ref whose `.current` is { onTogglePlay, onPrevChannel,
 * onNextChannel }. The media-session action handlers read from the ref at
 * call time, so the callbacks can be defined anywhere in the component
 * without re-registering the effect.
 *
 * Returns { acquireWakeLock } — call with a boolean to keep the screen
 * lit while actively listening.
 */
export function useMediaSession({ station, isPlaying, nowPlaying, handlersRef }) {
  /* Register play/pause/prev/next handlers once. They read from the ref,
   * so a channel change doesn't re-register anything. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    const setAction = (action, handler) => {
      try {
        ms.setActionHandler(action, handler)
        return true
      } catch {
        return false
      }
    }

    setAction('play', () => handlersRef.current?.onTogglePlay?.())
    setAction('pause', () => handlersRef.current?.onTogglePlay?.())
    setAction('previoustrack', () => handlersRef.current?.onPrevChannel?.())
    setAction('nexttrack', () => handlersRef.current?.onNextChannel?.())
    try { ms.setActionHandler('stop', () => {}) } catch { /* not supported */ }

    return () => {
      for (const k of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) {
        try { ms.clearActionHandler(k) } catch { /* noop */ }
      }
    }
  }, [])

  /* Update metadata + artwork whenever station/track changes. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    let artwork = null
    try {
      if (station?.favicon || station?.favicon_url || station?.logo) {
        const url = station.favicon || station.favicon_url || station.logo
        artwork = [{ src: url, sizes: '512x512', type: 'image/png' }]
      }
    } catch { /* ignore */ }

    const title = nowPlaying?.title || nowPlaying?.track || station?.name || 'T-Radio'
    const artist = nowPlaying?.artist || station?.name || 'T-Radio'
    const album = 'T-Radio · Live'
    try {
      // artwork must be omitted, not null: MediaMetadataInit.artwork
      // cannot be converted to a sequence when it is null, and the
      // constructor throws.
      const init = artwork && artwork.length ? { title, artist, album, artwork } : { title, artist, album }
      ms.metadata = new window.MediaMetadata(init)
    } catch (err) {
      console.warn('[mediaSession] metadata failed', err, { title, artist, artwork })
    }
  }, [station, nowPlaying])

  /* Reflect playback state so the OS play/pause button stays in sync. */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch { /* noop */ }
  }, [isPlaying])

  /* Keep the audio session alive while playing.
   *
   * A plain <audio> element gets its pipeline suspended by the browser when
   * the page goes to the background (screen off / another app takes the
   * audio session). The Web Audio API is the one pipeline the browser keeps
   * open in the background for a PWA — so while actively playing we hold a
   * silent AudioContext (0-gain node) to keep the audio session open.
   *
   * This only matters for an *installed* PWA; on a plain browser tab the
   * OS still kills background audio regardless. Created when isPlaying
   * turns true, released when it turns false. */
  const audioContextRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isPlaying) {
      try {
        audioContextRef.current?.suspend().catch(() => {})
      } catch { /* noop */ }
      if (audioContextRef.current) {
        try { audioContextRef.current.close().catch(() => {}) } catch { /* noop */ }
        audioContextRef.current = null
      }
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    try {
      const ctx = new Ctx()
      const gain = ctx.createGain()
      gain.gain.value = 0 // silent — just holds the audio session open
      gain.connect(ctx.destination)
      audioContextRef.current = ctx
      ctx.resume().catch(() => {})
    } catch { /* keep-alive is best-effort; never block playback */ }
    return () => {
      if (audioContextRef.current) {
        try { audioContextRef.current.close().catch(() => {}) } catch { /* noop */ }
        audioContextRef.current = null
      }
    }
  }, [isPlaying])

  /* Keep the screen awake while actively listening.
   * The Wake Lock API prevents the device screen from sleeping during
   * playback so the user can keep listening hands-free.
   *
   * The lock and its visibilitychange listener are released before a new
   * one is taken: this callback runs again on every channel change, and
   * without the cleanup each run would leave another listener behind. */
  const wakeLockRef = useRef(null)
  const visibleHandlerRef = useRef(null)

  const acquireWakeLock = useCallback(async (want) => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    if (visibleHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibleHandlerRef.current)
      visibleHandlerRef.current = null
    }
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release()
        wakeLockRef.current = null
      }
    } catch { /* already released */ }

    if (!want) return

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          navigator.wakeLock
            .request('screen')
            .then((lock) => { wakeLockRef.current = lock })
            .catch(() => {})
        }
      }
      visibleHandlerRef.current = onVisible
      document.addEventListener('visibilitychange', onVisible)
    } catch { /* wake lock denied — never block playback */ }
  }, [])

  /* Release the lock when the screen goes away. */
  useEffect(() => {
    return () => {
      if (visibleHandlerRef.current) {
        document.removeEventListener('visibilitychange', visibleHandlerRef.current)
        visibleHandlerRef.current = null
      }
      try { wakeLockRef.current?.release() } catch { /* noop */ }
    }
  }, [])

  return { acquireWakeLock }
}
