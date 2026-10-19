import { useState, useEffect } from 'react'
import { StationBrandLogo } from './StationBrandLogo'
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
  isPlaying,
  onTogglePlay,
  onClose,
  isFav,
  onToggleFav,
  volume = 80,
  onVolumeChange,
}) {
  const [toastMessage, setToastMessage] = useState('')

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

  const handleShare = async () => {
    const text = `Listening to ${station.name} on T-Radio!`
    const url = window.location.origin
    if (navigator.share) {
      try {
        await navigator.share({ title: station.name, text, url })
      } catch {
        // Share cancelled or failed, fall back to copy
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setToastMessage('Link copied to clipboard!')
      } catch {
        setToastMessage(`Playing ${station.name}`)
      }
    } else {
      setToastMessage(`Playing ${station.name}`)
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
      {toastMessage && (
        <div className="np-toast" role="status">
          {toastMessage}
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
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#F59E0B" stroke="#F59E0B" strokeWidth="1.5">
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
          </div>
        </div>

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

        {/* Playback Controls Row: Like | Big Play/Pause | Share */}
        <div className="np-controls-row">
          <div className="np-ctrl-group">
            <button
              className={`np-ctrl-btn${isFav ? ' faved' : ''}`}
              onClick={onToggleFav}
              aria-label={isFav ? 'Liked' : 'Like'}
            >
              {isFav ? (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="#F59E0B" stroke="#F59E0B" strokeWidth="1.5">
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
              value={volume}
              onChange={(e) => onVolumeChange && onVolumeChange(Number(e.target.value))}
              className="np-volume-slider"
              aria-label="Volume"
              style={{
                background: `linear-gradient(to right, #F59E0B 0%, #F59E0B ${volume}%, rgba(255, 255, 255, 0.12) ${volume}%, rgba(255, 255, 255, 0.12) 100%)`,
              }}
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
          </div>
        </section>
      </div>
    </div>
  )
}
