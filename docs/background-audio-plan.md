# Background Audio: what will make T-Radio keep playing when the screen is off

**Issue:** user listens, minimizes, turns the screen off — the radio stops.
**Expected:** radio keeps playing in the background (like the native radio apps).

---

## What the user is actually hitting

Mobile browsers **suspend `<audio>`** when the page loses *both* the screen
and the audio session, for battery. The behaviour differs by OS and by how
the PWA was opened:

| Situation | What happens | Why |
|---|---|---|
| **iOS Safari (not installed)** | Audio stops on lock / on home indicator swipe | Safari kills background audio for all web pages by default |
| **iOS PWA installed to home screen** | Audio *can* keep playing **if** `MediaSession` is set and the page was opened in standalone display | iOS treats an installed PWA like a native app; native apps keep playing audio in the background |
| **Android Chrome (not installed)** | Audio stops after a few minutes of background, or immediately on some OEM builds | Chrome throttles background tabs; no background-audio permission |
| **Android PWA installed** | Audio keeps playing **if** MediaSession is configured and the PWA stays alive | Android allows background media playback for installed PWA with MediaSession |

**Key fact:** The Wake Lock API (already in `useMediaSession.js`) only keeps the
*screen* awake. It does **not** keep the browser's audio pipeline alive in the
background. That's why "minimize + screen off" stops the radio even though the
lock screen shows a media widget.

---

## What T-Radio already has

- ✅ `MediaSession` with metadata + play/pause/prev/next handlers (`useMediaSession.js`)
- ✅ `wakeLock.request('screen')` while playing
- ✅ Auto-resume on `visibilitychange` / `focus` / `pageshow` (`HomeScreen.jsx:1254`)
- ✅ `playsInline` on the `<audio>` element (`HomeScreen.jsx:2393`)

**What's missing** — the three things that actually unlock background audio:

1. **`MediaSession` with `playbackState = 'playing'` is set *before* the user
   backgrounds the app** (already in place, but see §3 below for the timing bug).
2. **An `AudioContext` kept alive** — on iOS, the Web Audio API is the one
   audio pipeline that is *not* suspended in the background for an installed
   PWA. A silent `AudioContext` with a 0-gain node is enough to hold the
   audio session.
3. **`display: standalone` + install prompt** — without the user installing
   the PWA to the home screen, background audio on iOS is simply not
   available. There is no code that can fix this; it's a platform rule.

---

## Recommended changes (in priority order)

### 1. Install the PWA — the only real fix on iOS
The user needs to add T-Radio to the home screen. Until then, iOS Safari will
always stop the radio when the screen is off. No amount of code changes this.

**To surface this in the app:** add a one-time "Add to Home Screen" banner
on iOS (detect `standalone` mode via `matchMedia('(display-type: standalone)')`
or `navigator.standalone`). Copy:

> "Install T-Radio to keep the radio playing even when your phone's screen is
> off. Tap Share → Add to Home Screen."

### 2. Add an `AudioContext` keep-alive (works for installed PWA, iOS + Android)
In `useMediaSession.js`, alongside the existing Wake Lock, create a silent
`AudioContext` when `isPlaying === true`:

```js
// inside useMediaSession, new effect:
useEffect(() => {
  if (!isPlaying) {
    audioContextRef.current?.suspend().catch(() => {})
    audioContextRef.current = null
    return
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const gain = ctx.createGain()
  gain.gain.value = 0            // silent — just holds the audio session
  gain.connect(ctx.destination)
  audioContextRef.current = ctx
  ctx.resume().catch(() => {})
  return () => {
    gain.disconnect()
    ctx.close().catch(() => {})
    audioContextRef.current = null
  }
}, [isPlaying])
```

**Why this helps:** on an installed iOS PWA, the browser keeps the
`AudioContext` pipeline open in the background. The `<audio>` element alone
gets throttled; the Web Audio context does not. Combined with MediaSession,
iOS treats the PWA as a media app and lets audio continue.

**Caveat:** this does *nothing* on a non-installed PWA. It's only the second
half of the fix.

### 3. Fix the resume timing bug (HomeScreen.jsx:1254)
The current `tryResume` only runs when `document.visibilityState === 'visible'`.
That's fine for "user came back to the app" but the user's complaint is the
opposite: **audio stopped while they were *away***. The resume-on-return is a
safety net, not the fix. The keep-alive in §2 is what actually prevents the
stop in the first place.

No code change needed here for now — leave the resume handler as-is.

### 4. Manifest: add `background` + `display_override` hints
`vite.config.js` manifest section — add:

```js
manifest: {
  ...existing,
  launch_handler: {
    client: 'best-match',
  },
}
```

This is a minor hint that tells the browser to reuse an existing installed
instance rather than open a new one when the user re-taps the icon — prevents
the "two instances fighting over the audio session" bug on Android.

### 5. (Optional) Push notification "resume" fallback
For non-installed users on iOS, the only thing that can bring the radio back
is the user re-opening the app. A push notification with a "Resume listening"
action button (requires Firebase Cloud Messaging, which T-Radio already has)
is a nice-to-have but **out of scope** for a hobby project and won't actually
resume the audio — it just re-opens the page.

---

## What NOT to do

- **Don't try to keep the screen on permanently** (Wake Lock). That defeats
  the point of "screen off" and drains the battery.
- **Don't add a Web Worker to fake "background"** — a worker alone doesn't
  keep the audio session alive; the `AudioContext` is what does it.
- **Don't add a native shell (Capacitor/TWA)** just for this. The PWA +
  AudioContext + MediaSession combination is enough on both iOS and Android
  once the PWA is installed.

---

## Suggested order of work

1. **§2 — `AudioContext` keep-alive** (~30 lines in `useMediaSession.js`)
   — biggest bang-for-buck, works on both platforms once the PWA is installed.
2. **§1 — "Add to Home Screen" banner** (~40 lines + CSS) — without this,
   iOS users never know installing is the prerequisite.
3. **§4 — `launch_handler` manifest hint** (1 line).
4. Test on a real device (simulator audio behaviour differs):
   - iOS: install to home screen, start radio, lock phone, wait 30s,
     unlock → radio should still be playing.
   - Android: install, start radio, home button, wait 30s, reopen → radio
     should still be playing.

---

## Summary table

| Change | File | Status |
|---|---|---|
| `AudioContext` keep-alive | `src/useMediaSession.js` | ✅ added — holds the audio session open while playing, so the radio keeps going in the background on an installed PWA (both OSes) |
| "Add to Home Screen" install banner | `src/usePwaInstall.js` + `src/HomeScreen.jsx` + `src/HomeScreen.css` | ✅ added — one-time dismissible banner; one-tap install prompt on Android/Chrome, manual Share → Add-to-Home-Screen steps on iOS |
| `launch_handler` manifest hint | `vite.config.js` | ✅ added — prevents two instances fighting over the audio session on Android |
| (existing) MediaSession | `src/useMediaSession.js` | already done — lock-screen media widget |
| (existing) Wake Lock | `src/useMediaSession.js` | already done — screen stays lit while actively listening (foreground only) |

## Verify on a real device

1. **iOS**: open T-Radio in Safari → install banner shows "Install T-Radio to keep the radio playing with your screen off / Tap Share, then 'Add to Home Screen.'" → share → Add to Home Screen → start the radio → lock the phone → wait 30s → unlock → radio should still be playing.
2. **Android**: open T-Radio in Chrome → install banner shows an "Install" button → tap it → start the radio → press home → wait 30s → reopen → radio should still be playing.
3. **Either**: after installing, the banner disappears (standalone detection + permanent dismiss in `localStorage`). To re-test, clear site data / reinstall.
