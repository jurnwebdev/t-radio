import { useEffect, useState } from 'react'

/* localStorage key so a dismissed banner stays dismissed on this device. */
export const INSTALL_DISMISS_KEY = 'tradio.install.dismissed'

/**
 * usePwaInstall — tell the user how to install the PWA so the radio can keep
 * playing in the background (iOS requires an installed PWA for this).
 *
 * Returns {
 *   shouldShow   — banner should be visible (not installed, not dismissed)
 *   platform     — 'android' | 'ios' | 'desktop' | 'unknown'
 *   canPrompt    — true when a one-tap install prompt is available (Chrome)
 *   isStandalone — true when already running as an installed PWA
 *   promptInstall()  — fires the OS install dialog (no-op without canPrompt)
 *   dismiss()        — hide the banner permanently for this device
 * }
 */
export function usePwaInstall() {
  const [installEvent, setInstallEvent] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  /* Is the app running as an installed PWA? Two signals: the legacy
     navigator.standalone flag (iOS) and the display-mode media query
     (Chrome/Android). */
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof navigator === 'undefined') return false
    return (
      navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    )
  })

  /* Capture beforeinstallprompt (Chrome / Android) so we can re-fire it on
     demand. The event is consumed the moment prompt() is called, so we keep
     the reference. */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    const onInstalled = () => setInstallEvent(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = () => {
    if (installEvent && installEvent.prompt) {
      try {
        installEvent.prompt()
        installEvent.userChoice
          .then((choice) => {
            if (choice?.outcome === 'accepted') setInstallEvent(null)
          })
          .catch(() => {})
      } catch { /* prompt unavailable */ }
    }
  }

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1')
    } catch { /* ignore quota / private mode */ }
  }

  const platform = detectPlatform()

  /* Show the banner only when: we're not already installed, and the user
     hasn't dismissed it on this device. iOS has no beforeinstallprompt, so
     we show the manual Share → Add-to-Home-Screen instructions there.
     Desktop users: we still show it — installing the PWA to the desktop is
     the path to background audio there too. */
  const shouldShow = !isStandalone && !dismissed

  return {
    shouldShow,
    platform,
    canPrompt: Boolean(installEvent),
    isStandalone,
    promptInstall,
    dismiss,
  }
}

/* Detect the browser platform so we can show the right install steps.
   iOS Safari: no beforeinstallprompt, manual share-sheet flow.
   Android Chrome: beforeinstallprompt available → one-tap install. */
function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIOS) return 'ios'
  const isAndroid = /android/i.test(ua)
  if (isAndroid) return 'android'
  if (/mobile/i.test(ua)) return 'android' // other mobile browsers
  return 'desktop'
}
