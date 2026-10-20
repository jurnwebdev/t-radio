import { useState, useEffect } from 'react'
import { StationBrandLogo } from './StationBrandLogo'
import { RadarSweep } from './components/RadarSweep'
import './NowPlayingScreen.css'

export function getCountryFlag(country = '') {
  const c = country.toLowerCase().trim()
  if (c === 'ng' || c.includes('nigeria')) return '🇳🇬'
  if (c === 'uk' || c.includes('united kingdom') || c.includes('britain') || c.includes('england')) return '🇬🇧'
  if (c === 'fr' || c.includes('france')) return '🇫🇷'
  if (c === 'us' || c.includes('united states') || c.includes('usa')) return '🇺🇸'
  if (c === 'gh' || c.includes('ghana')) return '🇬🇭'
  if (c === 'za' || c.includes('south africa')) return '🇿🇦'
  if (c === 'ca' || c.includes('canada')) return '🇨🇦'
  if (c === 'ke' || c.includes('kenya')) return '🇰🇪'
  if (c === 'jm' || c.includes('jamaica')) return '🇯🇲'
  return '🌍'
}

export function NowPlayingScreen({
  station,
  shareUrl = '',
  isPlaying,
  listeners = 0,
  needsResume = false,
  nowPlaying = null,
  trackLinks = null,
  onTogglePlay,
  onClose,
  isFav,
  onToggleFav,
  volume = 80,
  onVolumeChange,
  onPrevChannel,
  onNextChannel,
  isLoading = false,
  notice = '',
  lowBand = false,
}) {
  const [toastMessage, setToastMessage] = useState('')

  /* Local mirror of the volume. The slider is driven from here so a drag
   * stays responsive even while the parent re-renders (iOS is fussy about
   * re-rendering a control mid-drag). */
  const [localVolume, setLocalVolume] = useState(volume)

  useEffect(() => {
    setLocalVolume(volume)
  }, [volume])

  const handleVolume = (next) => {
    setLocalVolume(next)
    if (onVolumeChange) onVolumeChange(next)
  }

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(''), 2200)
    return () => clearTimeout(timer)
  }, [toastMessage])

  if (!station) return null

  const flag = getCountryFlag(station.country)
  const location = station.country === 'Nigeria' && station.city
    ? `${station.city}, ${station.country}`
    : (station.country || 'Global')

  const tagList = (station.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase()))

  // Ensure 2-3 tags are shown
  const displayTags = tagList.length > 0 ? tagList.slice(0, 3) : ['Afrobeats', 'Music']

  /* Share the station itself, not the app home: the link carries the
   * station slug (?station=cool-fm-96-9) so opening it loads that
   * station straight into Now Playing. */
  const handleShare = async () => {
    const text = `Listen to ${station.name} live on T-Radio`
    const url = shareUrl || window.location.origin

    if (navigator.share) {
      try {
        await navigator.share({ title: station.name, text, url })
        return
      } catch (err) {
        // Dismissing the share sheet is not a failure — stay quiet.
        if (err && err.name === 'AbortError') return
        // Any other error falls through to the clipboard below.
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setToastMessage('Link copied to clipboard!')
    } catch {
      setToastMessage('Could not copy the link')
    }
  }

  // 32-bar visualizer heights for symmetrical audio wave
  const waveHeights = [
    12, 18, 26, 38, 48, 62, 78, 92, 100, 88, 72, 60, 48, 36, 28, 20,
    20, 28, 36, 48, 60, 72, 88, 100, 92, 78, 62, 48, 38, 26, 18, 12,
  ]

  return (
    <div className="np-screen" role="dialog" aria-modal="true" aria-label="Now Playing">
      {/* Toast Notification */}
      {(toastMessage || notice) && (
        <div className="np-toast" role="status">
          {toastMessage || notice}
        </div>
      )}

      {/* Loading overlay (radar sweep) while navigating channels */}
      {isLoading && (
        <div className="np-loading-overlay">
          <RadarSweep label="Tuning station…" />
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="np-header">
        <button
          className="np-icon-btn"
          onClick={onClose}
          aria-label="Collapse now playing"
          title="Back"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <h1 className="np-title">Now Playing</h1>

        <button
          className={`np-icon-btn np-fav-btn${isFav ? ' faved' : ''}`}
          onClick={onToggleFav}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          title={isFav ? 'Favorited' : 'Add to favorites'}
        >
          {isFav ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
        </button>
      </header>

      {/* Scrollable Container */}
      <div className="np-body">
        {/* Large Station Cover Card */}
        <div className="np-cover-wrap">
          <div className="np-cover-card">
            <StationBrandLogo station={station} size={240} />
          </div>
        </div>

        {/* Station Title & Location */}
        <div className="np-info">
          <h2 className="np-station-name">{station.name}</h2>
          <div className="np-station-location">
            <span className="np-flag" aria-hidden="true">{flag}</span>
            <span>{location}</span>
          </div>

          {/* Genre Badges */}
          <div className="np-genre-pills">
            {displayTags.map((tag) => (
              <span key={tag} className="np-genre-pill">{tag}</span>
            ))}
          </div>

          {/* Live Badge */}
          <div className="np-live-badge">
            <span className="np-live-dot" />
            <span className="np-live-text">LIVE</span>
            <span className="np-listeners" aria-live="polite">
              <span>{listeners}</span>
              <span className="np-listeners-label">listening now</span>
            </span>
          </div>
        </div>

        {/* Now Playing song title (when the station publishes metadata) */}
        {nowPlaying && (
          <div className="np-song-card" aria-live="polite">
            <span className="np-song-label" aria-hidden="true">NOW PLAYING</span>
            <div className="np-song-title">{nowPlaying.title}</div>
            {nowPlaying.artist && (
              <div className="np-song-artist">{nowPlaying.artist}</div>
            )}
            {trackLinks && (
              <div className="np-song-links">
                <a
                  className="np-song-link np-song-link-spotify"
                  href={trackLinks.spotify}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open ${nowPlaying.track} on Spotify`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M12 0a12 12 0 100 24 12 12 0 000-24zm5.51 17.44a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.56-1.16a.75.75 0 11-.33-1.46c4.59-1.05 8.52-.6 11.67 1.34.35.22.46.68.25 1.03zm1.47-3.27a.94.94 0 01-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 11-.55-1.8c4.37-1.32 9.79-.68 13.5 1.6.44.28.59.85.31 1.29zm.13-3.4C15.28 8.46 8.94 8.25 5.33 9.35a1.12 1.12 0 11-.65-2.15c4.16-1.26 11.08-1.02 15.44 1.56a1.12 1.12 0 01-1.01 1.97z"/>
                  </svg>
                  Spotify
                </a>
                <a
                  className="np-song-link np-song-link-apple"
                  href={trackLinks.apple}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open ${nowPlaying.track} on Apple Music`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M16.66 12.71c-.02-2.44 1.99-3.6 2.08-3.66-1.13-1.66-2.9-1.88-3.52-1.91-1.5-.15-2.93.88-3.69.88-.76 0-1.94-.86-3.18-.84-1.64.02-3.15.95-3.99 2.42-1.7 2.95-.43 7.32 1.22 9.72.81 1.17 1.78 2.49 3.04 2.44 1.22-.05 1.68-.79 3.15-.79s1.89.79 3.18.77c1.31-.02 2.14-1.19 2.94-2.36.93-1.36 1.31-2.67 1.33-2.74-.03-.01-2.55-.98-2.56-3.9zM14.36 5.05c.67-.81 1.12-1.94 1-3.05-.96.04-2.13.64-2.82 1.45-.62.72-1.17 1.87-1.02 2.97 1.07.08 2.17-.55 2.84-1.37z"/>
                  </svg>
                  Apple Music
                </a>
              </div>
            )}
          </div>
        )}

        {/* Dynamic Waveform Visualizer */}
        <div className={`np-visualizer${isPlaying ? ' playing' : ''}`} aria-hidden="true">
          {waveHeights.map((h, i) => (
            <span
              key={i}
              className="np-wave-bar"
              style={{
                '--bar-max-h': `${h}%`,
                '--bar-delay': `${(i % 8) * 0.12}s`,
              }}
            />
          ))}
        </div>

        {needsResume && !isPlaying && (
          <p className="np-resume-note" role="status">
            Tap play to resume the live stream
          </p>
        )}

        {/* Playback Controls Row: Like | Big Play/Pause | Share */}
        <div className="np-controls-row">
          <div className="np-ctrl-group">
            <button
              className={`np-ctrl-btn${isFav ? ' faved' : ''}`}
              onClick={onToggleFav}
              aria-label={isFav ? 'Liked' : 'Like'}
            >
              {isFav ? (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              )}
            </button>
            <span className="np-ctrl-label">{isFav ? 'Liked' : 'Like'}</span>
          </div>

          <button
            className="np-play-btn"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1.5" />
                <rect x="14" y="4" width="4" height="16" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" style={{ marginLeft: '3px' }}>
                <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
              </svg>
            )}
          </button>

          <div className="np-ctrl-group">
            <button
              className="np-ctrl-btn"
              onClick={handleShare}
              aria-label="Share station"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <span className="np-ctrl-label">Share</span>
          </div>
        </div>

        {/* Volume Slider Bar */}
        <div className="np-volume-wrap">
          <svg className="np-vol-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          </svg>
          <div className="np-slider-container">
            <input
              type="range"
              min="0"
              max="100"
              value={localVolume}
              onChange={(e) => handleVolume(Number(e.target.value))}
              onInput={(e) => handleVolume(Number(e.target.value))}
              className="np-volume-slider"
              aria-label="Volume"
              style={{ '--vol': `${localVolume}%` }}
            />
          </div>
          <svg className="np-vol-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        </div>

        {/* Stream Information Card */}
        <section className="np-info-card" aria-label="Stream Information">
          <h3 className="np-info-title">Stream Information</h3>
          <div className="np-info-grid">
            <div className="np-info-row">
              <span className="np-info-key">Bitrate</span>
              <span className="np-info-val">{station.bitrate ? `${station.bitrate} kbps` : '128 kbps'}</span>
            </div>
            <div className="np-info-row">
              <span className="np-info-key">Codec</span>
              <span className="np-info-val">{station.codec ? station.codec.toUpperCase() : 'MP3'}</span>
            </div>
            <div className="np-info-row">
              <span className="np-info-key">Country</span>
              <span className="np-info-val">{flag} {station.country || 'Nigeria'}</span>
            </div>
            <div className="np-info-row">
              <span className="np-info-key">Genres</span>
              <span className="np-info-val">{displayTags.join(', ')}</span>
            </div>
            <div className="np-info-row">
              <span className="np-info-key">Source</span>
              <span className="np-info-val">Radio-Browser</span>
            </div>
            {lowBand && (
              <div className="np-info-row">
                <span className="np-info-key">Mode</span>
                <span className="np-info-val" style={{ color: 'var(--accent)' }}>Low bandwidth</span>
              </div>
            )}
          </div>
        </section>

        {/* Channel Navigation: Prev / Next (footer) */}
        <div className="np-channel-nav np-channel-nav-footer">
          <button
            className="np-nav-btn np-nav-prev"
            onClick={() => onPrevChannel && onPrevChannel()}
            disabled={!onPrevChannel || isLoading}
            aria-label="Previous channel"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="np-nav-label">Prev</span>
          </button>
          <button
            className="np-nav-btn np-nav-next"
            onClick={() => onNextChannel && onNextChannel()}
            disabled={!onNextChannel || isLoading}
            aria-label="Next channel"
          >
            <span className="np-nav-label">Next</span>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
