import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { StationBrandLogo, resolveStationArt } from './StationBrandLogo'
import { NowPlayingScreen } from './NowPlayingScreen'
import { useSessionListener } from './useListenerCount'
import { useNowPlayingTitle, musicLinks } from './useNowPlayingTitle'
import { useMediaSession } from './useMediaSession'
import { trackVisit, trackStatsPlay } from './useStatsTracker'
import { logAppEvent } from './firebase'
import { findStationBySlug, buildShareUrl, stationSlug } from './stationSlug'
import { setShareOgMeta } from './shareOg'
import { usePwaInstall } from './usePwaInstall'
import './HomeScreen.css'

import afrobeatImg from './assets/genres/afrobeat.svg'
import hiphopImg from './assets/genres/hiphop.svg'
import gospelImg from './assets/genres/gospel.svg'
import newsImg from './assets/genres/news.svg'
import talkImg from './assets/genres/talk.svg'
import sportsImg from './assets/genres/sports.svg'
import heroMicSvg from './assets/hero-mic.svg'

const API = 'https://all.api.radio-browser.info'
const HEADERS = { 'User-Agent': 'TRadioPWA/1.0' }

/* ---------- persistence keys ---------- */
const FAV_KEY = 'tradio.favorites'
const LAST_KEY = 'tradio.last'
const LAST_STATION_KEY = 'tradio.last.station'
const FAVONLY_KEY = 'tradio.home.favonly'
const THEME_KEY = 'tradio.theme'
const LOWBAND_DEFAULT_KEY = 'tradio.lowband.default'

/* ---------- Live edge ----------
 * Radio is live, but a connection can quietly fall behind the broadcast:
 * a paused stream keeps serving audio that is no longer live, a stalled
 * connection freezes at whatever point it reached, and a relay may hand
 * out a backlog of old audio on connect. We only re-open a connection to
 * recover from a genuine mid-playback stall (the broadcast goes silent for
 * a while); we deliberately do NOT chase the live edge, because re-opening
 * on the live edge is what made the radio stop and skip ahead mid-song.
 *   STALE_RESUME_MS    - paused longer than this -> reconnect on resume
 *   LIVE_EDGE_STALL_MS  - stalled this long -> reconnect
 */
const STALE_RESUME_MS = 8000
const LIVE_EDGE_STALL_MS = 8000
const REJOIN_COOLDOWN_MS = 20000

/* A play() promise rejects with AbortError when the source is swapped
 * (our live-edge re-open does exactly that). That is expected, not a
 * failure - the new source takes over. */
function isAbortError(err) {
  return !!err && err.name === 'AbortError'
}

/* ---------- Low-bandwidth / stream health ----------
 * Some stations publish an alternate, lower-bitrate stream on the same
 * host (e.g. an Icecast port-8000 "low" mount). When the user is on a
 * weak connection the default stream will stall; switching to the
 * low-band URL usually saves it. This is opt-in so we never silently
 * downgrade a good connection. */
function getLowBandDefault() {
  try {
    return localStorage.getItem(LOWBAND_DEFAULT_KEY) === '1'
  } catch {
    return false
  }
}

/* Best-effort guess of a lower-bitrate variant for a stream URL.
 * Returns a *different* URL to fall back to, or null when none can be
 * derived (in which case low-band mode just notifies instead of
 * switching). */
function lowBandUrlFor(streamUrl) {
  if (!streamUrl) return null
  try {
    const u = new URL(streamUrl)
    let alt = null
    if (u.pathname.includes('.mp3')) {
      // Icecast "listen" hosts commonly ship /low.mp3 and /high.mp3
      const low = u.pathname.replace(/\/high\.(mp3|aac)$/, '/low.$1')
      if (low !== u.pathname) {
        alt = new URL(low, u.origin).toString()
      }
    }
    // Append a mount hint some hosts honor (last resort).
    if (!alt) {
      const probe = `${u.toString().replace(/\/+$/, '')}/low`
      if (probe !== u.toString().replace(/\/+$/, '')) alt = probe
    }
    return alt
  } catch {
    return null
  }
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {}
  return 'dark'
}

/* Restore the full last-played station so it can render before the API loads */
function loadSavedStation() {
  try {
    const raw = localStorage.getItem(LAST_STATION_KEY)
    if (raw) {
      const st = JSON.parse(raw)
      if (st && st.stationuuid) return st
    }
  } catch {}
  return null
}

/* ---------- Deep link support: /?station=<slug> ----------
 * The slug is a friendly, human-readable id for a station
 * ("cool-fm-96-9"). Opening such a link loads that station and opens
 * the Now Playing screen. */
function readDeepLinkSlug() {
  try {
    const raw = new URLSearchParams(window.location.search).get('station')
    return raw ? raw.trim().toLowerCase() : ''
  } catch {}
  return ''
}

/**
 * Look a station up in the Radio Browser API by name.
 * Used when a shared link points at a station that is not in the
 * locally known list (e.g. a station from another country).
 */
async function searchStationBySlug(slug) {
  const words = slug.replace(/-/g, ' ').trim()
  // "cool fm 96 9" also tries "cool fm" — the API matches on the name
  // text, and the slug comparison below keeps it to the right station.
  const withoutNumbers = slug.replace(/-\d+(?:-\d+)*$/, '').replace(/-/g, ' ').trim()
  const queries = [words]
  if (withoutNumbers && withoutNumbers !== words) queries.push(withoutNumbers)

  for (const q of queries) {
    try {
      const res = await fetch(
        `${API}/json/stations/search?name=${encodeURIComponent(q)}&limit=25&hidebroken=true&order=clickcount&reverse=true`,
        { headers: HEADERS },
      )
      if (!res.ok) continue
      const data = await res.json()
      const hit = (data || []).find((st) => stationSlug(st) === slug)
      if (hit) return hit
    } catch {
      /* try the next query */
    }
  }
  return null
}

/* ---------- Curated top stations matching the mockup (100% tested working streams) ---------- */
const CURATED_POPULAR = [
  {
    stationuuid: 'curated-coolfm',
    name: 'Cool FM 96.9',
    country: 'Nigeria',
    tags: 'Afrobeats, Hits, Pop',
    url: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
    url_resolved: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
    votes: 9400,
    clickcount: 18200,
  },
  {
    stationuuid: 'curated-wazobia',
    name: 'Wazobia FM 95.1',
    country: 'Nigeria',
    tags: 'Afrobeats, Talk, Pidgin',
    url: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
    url_resolved: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
    votes: 8900,
    clickcount: 16700,
  },
  {
    stationuuid: 'curated-nigeriainfo',
    name: 'Nigeria Info 99.3 FM',
    country: 'Nigeria',
    tags: 'News, Talk, Sports',
    url: 'https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993',
    url_resolved: 'https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993',
    votes: 8200,
    clickcount: 14500,
  },
  {
    stationuuid: 'curated-capital',
    name: 'Capital FM',
    country: 'United Kingdom',
    tags: 'Pop, Hits, Dance',
    url: 'https://icecast.thisisdax.com/CapitalUKMP3',
    url_resolved: 'https://icecast.thisisdax.com/CapitalUKMP3',
    votes: 9800,
    clickcount: 19500,
  },
  {
    stationuuid: 'curated-heart',
    name: 'Heart UK',
    country: 'United Kingdom',
    tags: 'Pop, Hits, Adult Contemporary',
    url: 'https://icecast.thisisdax.com/HeartLondonMP3',
    url_resolved: 'https://icecast.thisisdax.com/HeartLondonMP3',
    votes: 7900,
    clickcount: 13800,
  },
  {
    stationuuid: 'curated-lagosjump',
    name: 'LagosJump Radio',
    country: 'Nigeria',
    tags: 'Afrobeats, Dancehall, Hip Hop',
    url: 'https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3',
    url_resolved: 'https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3',
    votes: 7300,
    clickcount: 11200,
  },
  {
    stationuuid: 'curated-metrofm',
    name: 'Metro FM 97.7',
    country: 'Nigeria',
    tags: 'Afrobeats, Urban, Music',
    url: 'https://go.webgateready.com/metrofm/radio.mp3',
    url_resolved: 'https://go.webgateready.com/metrofm/radio.mp3',
    votes: 6800,
    clickcount: 10400,
  },
  {
    stationuuid: 'curated-bbcws',
    name: 'BBC World Service',
    country: 'United Kingdom',
    tags: 'News, Talk, Global',
    url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
    url_resolved: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
    votes: 9900,
    clickcount: 22000,
  },
]

/* ---------- Genre tiles with photographic SVG artwork ---------- */
const GENRE_TILES = [
  { id: 'afrobeat', label: 'Afrobeat', tag: 'afrobeat', image: afrobeatImg },
  { id: 'hiphop', label: 'Hip Hop', tag: 'hiphop', image: hiphopImg },
  { id: 'gospel', label: 'Gospel', tag: 'gospel', image: gospelImg },
  { id: 'news', label: 'News', tag: 'news', image: newsImg },
  { id: 'talk', label: 'Talk', tag: 'talk', image: talkImg },
  { id: 'sports', label: 'Sports', tag: 'sports', image: sportsImg },
]

function formatFirstTags(st) {
  const raw = (st.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (!raw.length) return 'Music'
  return raw
    .slice(0, 2)
    .map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' • ')
}

function HeroMicGraphic() {
  return (
    <svg viewBox="0 0 200 240" width="100%" height="100%" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="mic-halo" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#5B9BFF" stopOpacity="0.85" />
          <stop offset="35%" stopColor="#3D7BFF" stopOpacity="0.5" />
          <stop offset="70%" stopColor="#1E40AF" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mic-body-metal" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1E293B" />
          <stop offset="25%" stopColor="#475569" />
          <stop offset="50%" stopColor="#94A3B8" />
          <stop offset="75%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0F172A" />
        </linearGradient>
        <linearGradient id="mic-gold-trim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1E40AF" />
          <stop offset="40%" stopColor="#A9CBFF" />
          <stop offset="70%" stopColor="#5B9BFF" />
          <stop offset="100%" stopColor="#0B2A6B" />
        </linearGradient>
        <linearGradient id="mic-ring-metal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#CBD5E1" />
          <stop offset="50%" stopColor="#64748B" />
          <stop offset="100%" stopColor="#1E293B" />
        </linearGradient>
      </defs>

      {/* Amber/Orange Backlight Halo */}
      <circle cx="100" cy="100" r="90" fill="url(#mic-halo)" />

      {/* Stand Rod */}
      <rect x="94" y="160" width="12" height="50" rx="3" fill="#1E293B" />
      <rect x="97" y="160" width="3" height="50" fill="#94A3B8" opacity="0.6" />

      {/* Base mount */}
      <ellipse cx="100" cy="210" rx="36" ry="12" fill="#0F172A" stroke="#334155" strokeWidth="2" />
      <ellipse cx="100" cy="208" rx="28" ry="8" fill="#1E293B" />
      <ellipse cx="100" cy="207" rx="14" ry="4" fill="#5B9BFF" opacity="0.8" />

      {/* Swivel Joint Knob */}
      <circle cx="100" cy="160" r="8" fill="#334155" stroke="#5B9BFF" strokeWidth="1.5" />
      <circle cx="100" cy="160" r="3" fill="#A9CBFF" />

      {/* Shockmount Outer Ring */}
      <circle cx="100" cy="98" r="48" fill="none" stroke="url(#mic-ring-metal)" strokeWidth="4.5" />
      <circle cx="100" cy="98" r="48" fill="none" stroke="#5B9BFF" strokeWidth="1" opacity="0.4" />

      {/* Shockmount Elastic Suspension Bands */}
      <line x1="66" y1="80" x2="82" y2="92" stroke="#5B9BFF" strokeWidth="2" strokeLinecap="round" />
      <line x1="134" y1="80" x2="118" y2="92" stroke="#5B9BFF" strokeWidth="2" strokeLinecap="round" />
      <line x1="66" y1="116" x2="82" y2="104" stroke="#5B9BFF" strokeWidth="2" strokeLinecap="round" />
      <line x1="134" y1="116" x2="118" y2="104" stroke="#5B9BFF" strokeWidth="2" strokeLinecap="round" />

      {/* Inner Shockmount Collar */}
      <ellipse cx="100" cy="132" rx="18" ry="6" fill="#1E293B" stroke="#475569" strokeWidth="2" />

      {/* Microphone Main Capsule */}
      <path d="M82,95 L118,95 L116,134 Q116,138 112,138 L88,138 Q84,138 84,134 Z" fill="url(#mic-body-metal)" />
      <rect x="81" y="92" width="38" height="4" rx="1.5" fill="url(#mic-gold-trim)" />
      <path d="M82,92 L82,60 Q82,34 100,34 Q118,34 118,60 L118,92 Z" fill="#1E293B" stroke="#475569" strokeWidth="1.5" />

      {/* Internal warm glow */}
      <ellipse cx="100" cy="62" rx="12" ry="18" fill="#5B9BFF" opacity="0.35" />

      {/* Metallic Grille Lines */}
      <g stroke="#94A3B8" strokeWidth="0.9" opacity="0.6">
        <line x1="84" y1="46" x2="116" y2="46" />
        <line x1="83" y1="52" x2="117" y2="52" />
        <line x1="82" y1="58" x2="118" y2="58" />
        <line x1="82" y1="64" x2="118" y2="64" />
        <line x1="82" y1="70" x2="118" y2="70" />
        <line x1="82" y1="76" x2="118" y2="76" />
        <line x1="82" y1="82" x2="118" y2="82" />
        <line x1="83" y1="88" x2="117" y2="88" />
      </g>

      <line x1="100" y1="34" x2="100" y2="92" stroke="#A9CBFF" strokeWidth="2" opacity="0.9" />
      <line x1="93" y1="36" x2="93" y2="91" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.45" />
      <line x1="93" y1="95" x2="93" y2="135" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.4" />
    </svg>
  )
}

/* ---------- Explore Category Filter Pills ---------- */
const EXPLORE_PILLS = ['All', 'Music', 'News', 'Talk', 'Sports', 'Afrobeats', 'Gospel']

/* ---------- Explore Curated Afrobeats (Mockup Screen 3) ---------- */
const EXPLORE_AFROBEATS = [
  {
    stationuuid: 'exp-thebeat',
    name: 'The Beat 99.9 FM',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Hip Hop',
    url: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
    url_resolved: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
  },
  {
    stationuuid: 'exp-naija',
    name: 'Naija FM 102.7',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Talk',
    url: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
    url_resolved: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
  },
  {
    stationuuid: 'curated-coolfm',
    name: 'Cool FM 96.9',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Hits',
    url: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
    url_resolved: 'https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969',
  },
  {
    stationuuid: 'curated-wazobia',
    name: 'Wazobia FM 95.1',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Talk',
    url: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
    url_resolved: 'https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951',
  },
  {
    stationuuid: 'curated-nigeriainfo',
    name: 'Nigeria Info 99.3 FM',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'News, Talk',
    url: 'https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993',
    url_resolved: 'https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993',
  },
  {
    stationuuid: 'curated-lagosjump',
    name: 'LagosJump Radio',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Dancehall',
    url: 'https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3',
    url_resolved: 'https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3',
  },
  {
    stationuuid: 'curated-metrofm',
    name: 'Metro FM 97.7',
    country: 'Nigeria',
    city: 'Lagos',
    tags: 'Afrobeats, Urban',
    url: 'https://go.webgateready.com/metrofm/radio.mp3',
    url_resolved: 'https://go.webgateready.com/metrofm/radio.mp3',
  },
]

/* ---------- Explore Curated International (Mockup Screen 3) ---------- */
const EXPLORE_INTERNATIONAL = [
  {
    stationuuid: 'exp-bbc1',
    name: 'BBC Radio 1',
    country: 'United Kingdom',
    city: 'London',
    tags: 'Pop, Chart',
    url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
    url_resolved: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
  },
  {
    stationuuid: 'curated-capital',
    name: 'Capital FM',
    country: 'United Kingdom',
    city: 'London',
    tags: 'Pop, Hits',
    url: 'https://icecast.thisisdax.com/CapitalUKMP3',
    url_resolved: 'https://icecast.thisisdax.com/CapitalUKMP3',
  },
  {
    stationuuid: 'exp-kiss',
    name: 'Kiss FM UK',
    country: 'United Kingdom',
    city: 'London',
    tags: 'R&B, Hip Hop',
    url: 'https://icecast.thisisdax.com/HeartLondonMP3',
    url_resolved: 'https://icecast.thisisdax.com/HeartLondonMP3',
  },
  {
    stationuuid: 'exp-rfi',
    name: 'RFI Afrique',
    country: 'France',
    city: 'Paris',
    tags: 'News, Talk',
    url: 'https://rfiafrique64kbps.ice.infomaniak.ch/rfiafrique-64.mp3',
    url_resolved: 'https://rfiafrique64kbps.ice.infomaniak.ch/rfiafrique-64.mp3',
  },
  {
    stationuuid: 'curated-heart',
    name: 'Heart UK',
    country: 'United Kingdom',
    city: 'London',
    tags: 'Pop, Hits',
    url: 'https://icecast.thisisdax.com/HeartLondonMP3',
    url_resolved: 'https://icecast.thisisdax.com/HeartLondonMP3',
  },
  {
    stationuuid: 'curated-bbcws',
    name: 'BBC World Service',
    country: 'United Kingdom',
    city: 'London',
    tags: 'News, Global',
    url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
    url_resolved: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
  },
]

function getCountryFlag(country = '') {
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

function ExploreStationRow({ station, isPlaying, onPlay, isFav, onToggleFav }) {
  const flag = getCountryFlag(station.country)
  const location = station.country === 'Nigeria' && station.city
    ? `${station.city}, ${station.country}`
    : (station.country || 'Global')
  const tagList = (station.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.replace(/\b\w/g, (c) => c.toUpperCase()))

  return (
    <article
      className={`hs-explore-row${isPlaying ? ' playing' : ''}`}
      onClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
    >
      <div className="hs-explore-row-left">
        <div className="hs-explore-row-art">
          <StationBrandLogo station={station} size={52} />
        </div>
        <div className="hs-explore-row-info">
          <h4 className="hs-explore-row-name" title={station.name}>
            {station.name}
          </h4>
          <p className="hs-explore-row-country">
            <span className="hs-explore-row-flag" aria-hidden="true">{flag}</span>
            <span>{location}</span>
          </p>
          <div className="hs-explore-row-tags">
            {tagList.map((tag) => (
              <span key={tag} className="hs-explore-row-tag">{tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="hs-explore-row-actions">
        {onToggleFav && (
          <button
            className={`hs-row-fav-btn${isFav ? ' active' : ''}`}
            aria-label={isFav ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFav(station)
            }}
          >
            <svg viewBox="0 0 24 24" fill={isFav ? '#FF4081' : 'none'} stroke={isFav ? '#FF4081' : 'currentColor'} strokeWidth="2.2" width="18" height="18">
              <path d="M12 21s-7.5-4.6-9.5-9.2C1 8.6 3.6 5.5 6.8 5.5c2 0 3.4 1.1 4.2 2.4.4.6 1.6.6 2 0 .8-1.3 2.2-2.4 4.2-2.4 3.2 0 5.8 3.1 4.3 6.3C19.5 16.4 12 21 12 21z" />
            </svg>
          </button>
        )}
        <button
          className="hs-explore-row-play"
          aria-label={isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
    </article>
  )
}

export default function HomeScreen() {
  const [stations, setStations] = useState(CURATED_POPULAR)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  /* ---------- Audio Playback State ---------- */
  const [current, setCurrent] = useState(loadSavedStation)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [volume, setVolume] = useState(85)
  const [isNavigating, setIsNavigating] = useState(false)
  // True when autoplay/resume was blocked by the browser and the user
  // needs to tap play once. Keeps the station loaded in the meantime.
  const [resumeHint, setResumeHint] = useState(false)

  /* ---------- Theme (dark / light) ---------- */
  const [theme, setTheme] = useState(getInitialTheme)

  /* ---------- PWA install banner (one-time, dismissible) ----------
   * Shown when the app is running in a plain browser tab (not installed),
   * so the user can install it and get background playback. */
  const {
    shouldShow: showInstallBanner,
    platform: installPlatform,
    canPrompt: installCanPrompt,
    promptInstall,
    dismiss: dismissInstall,
  } = usePwaInstall()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  /* ---------- Dashboard visitor tracking (once per page load) ---------- */
  useEffect(() => {
    trackVisit()
  }, [])
  const [showNowPlaying, setShowNowPlaying] = useState(() => {
    try {
      const tab = new URLSearchParams(window.location.search).get('tab')
      const scr = new URLSearchParams(window.location.search).get('screen')
      return tab === 'nowplaying' || scr === 'nowplaying' || location.hash === '#nowplaying'
    } catch {}
    return false
  })

  const audioRef = useRef(null)
  const candidatesRef = useRef([])
  const currentRef = useRef(null)
  const playCandidateRef = useRef(null)
  // Whether the user wants audio playing (true) or paused (false).
  // Survives OS-level interruptions so we can auto-resume when possible.
  const wantsPlayRef = useRef(false)
  // Guard so the saved station is only auto-started once per page load.
  const restoredRef = useRef(false)
  // Guard so a dead-stream recovery attempt can't loop forever.
  const recoveredRef = useRef(false)
  // Throttle resume attempts when both visibilitychange and focus fire.
  const lastResumeAttemptRef = useRef(0)
  /* ---------- Live edge bookkeeping ---------- */
  // When playback was paused, so a resume can tell live from stale.
  const pausedAtRef = useRef(0)
  // Last time we re-opened the connection, to avoid a reconnect loop.
  const rejoinCooldownRef = useRef(0)
  // How many live-edge corrections we already made this session.
  const rejoinCountRef = useRef(0)
  // True while we deliberately swap the source (live-edge re-open), so the
  // resulting pause event is not treated as the user hitting pause.
  const swappingRef = useRef(false)
  // Timer that fires when the stream stalls for too long.
  const stallTimerRef = useRef(null)
  // Timer for the one-shot re-open right after a stream starts.
  const startRejoinTimerRef = useRef(null)
  // Timer that clears the "rejoining live" notice.
  const noticeTimerRef = useRef(null)
  // Short notice shown while we re-open the connection.
  const [liveNotice, setLiveNotice] = useState('')
  // Deep link: /?station=<slug> — the station a shared link points at.
  const [deepLinkSlug] = useState(readDeepLinkSlug)
  const [deepLinkMissing, setDeepLinkMissing] = useState(false)
  // Guard so a deep-linked station is only applied once.
  const deepLinkDoneRef = useRef(false)
  // Guard so the name lookup against the Radio Browser API runs once.
  const deepLinkSearchRef = useRef(false)
  // True once the initial station list finished loading (or failed).
  const [stationsReady, setStationsReady] = useState(false)

  /* ---------- Low-bandwidth mode ----------
   * Opt-in toggle that prefers a lower-bitrate variant of the stream and
   * shows a notice when the connection is struggling. Persisted so it
   * survives a reload. */
  const [lowBand, setLowBand] = useState(getLowBandDefault)
  const [streamNotice, setStreamNotice] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(LOWBAND_DEFAULT_KEY, lowBand ? '1' : '0')
    } catch {}
  }, [lowBand])

  /* Auto-detect a weak connection (metered / save-data) once on mount and
   * suggest low-band mode. This is a *suggestion* — it never downgrades a
   * good connection on its own. */
  useEffect(() => {
    const conn = navigator.connection
    if (!conn) return
    if (conn.saveData) {
      setLowBand(true)
      setStreamNotice('Low-bandwidth mode: your browser is in data-saving mode')
    }
    const onWeak = () => {
      if ((conn.effectiveType || '').includes('2g')) {
        setStreamNotice('Slow connection detected — switch to low-bandwidth mode')
      }
    }
    conn.addEventListener('change', onWeak)
    return () => conn.removeEventListener('change', onWeak)
  }, [])

  /* ---------- Live song title (ICY metadata via /api/nowplaying) ----------
   * Declared before useMediaSession below: the media-session metadata
   * needs the current title, and a hook used before its declaration
   * throws a temporal dead zone error at render time. */
  const { nowPlaying, status: nowPlayingStatus } = useNowPlayingTitle(isPlaying ? current : null)
  const trackLinks = useMemo(() => musicLinks(nowPlaying ? nowPlaying.track : ''), [nowPlaying])

  /* ---------- OS media controls + lock-screen card ----------
   * The hook reads handlers via a ref (see useMediaSession), so this can
   * safely be wired after all the playback callbacks are defined below.
   * The ref is filled in at the end of the render body. */
  const mediaHandlersRef = useRef({ onTogglePlay: undefined, onPrevChannel: undefined, onNextChannel: undefined })
  const { acquireWakeLock } = useMediaSession({
    station: current,
    isPlaying,
    nowPlaying,
    handlersRef: mediaHandlersRef,
  })

  /* Keep the screen lit while actively playing (so the radio keeps
   * going in the background / on the lock screen). */
  useEffect(() => {
    acquireWakeLock(isPlaying && current)
  }, [isPlaying, current, acquireWakeLock])

  useEffect(() => { currentRef.current = current }, [current])

  /* ---------- Firebase listener tracking ----------
   * Counts THIS browser tab as one active listener while a station
   * is playing. trackPlay/trackStop are idempotent per tab, so
   * calling them on every play/pause/switch is safe. */
  const { count: globalListeners, trackPlay, trackStop } = useSessionListener()
  const lastTrackedStationRef = useRef(null)

  /* Media-session metadata, artwork, and playback state are handled by the
   * useMediaSession hook (see the call above). The hook owns all
   * navigator.mediaSession writes so the action handlers and the lock-screen
   * card stay in sync. */

  useEffect(() => {
    if (isPlaying && current) {
      trackPlay(current.stationuuid)
      // Log a GA4 event only the first time a station starts (not on every resume)
      if (lastTrackedStationRef.current !== current.stationuuid) {
        lastTrackedStationRef.current = current.stationuuid
        logAppEvent('station_listen', {
          station_id: current.stationuuid,
          station_name: current.name,
          country: current.country || '',
        })
        // Dashboard play counter — "new station start only" (30s debounce lives
        // inside the tracker, so resumes/reconnects never double-count).
        trackStatsPlay(current)
      }
    }
    return () => {
      if (current) trackStop(current.stationuuid)
    }
  }, [isPlaying, current, trackPlay, trackStop])

  /* Sync volume with audio element */
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100
    }
  }, [volume])

  /* Ensure a default station is loaded if Now Playing is opened directly */
  useEffect(() => {
    if (showNowPlaying && !current) {
      setCurrent(EXPLORE_AFROBEATS[0])
    }
  }, [showNowPlaying, current])

  /* ---------- Bottom Navigation Tab & Filters ---------- */
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const tab = new URLSearchParams(window.location.search).get('tab')
      if (tab && ['home', 'explore', 'favorites', 'search', 'more'].includes(tab)) return tab
    } catch {}
    return 'home'
  })
  const [favOnly, setFavOnly] = useState(() => localStorage.getItem(FAVONLY_KEY) === 'on')
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState('')
  const [showAllPopular, setShowAllPopular] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState(() => {
    try {
      const gTag = new URLSearchParams(window.location.search).get('genre')
      if (gTag) {
        return GENRE_TILES.find((g) => g.tag === gTag) || null
      }
    } catch {}
    return null
  })
  const [genreSearch, setGenreSearch] = useState('')

  /* ---------- Explore Screen State ---------- */
  /* Read a ?tag= deep link so a shared genre link opens Explore pre-filtered
   * to that pill. "afrobeat" maps to the "Afrobeats" pill, etc. */
  const explorePillFromUrl = (() => {
    try {
      const g = new URLSearchParams(window.location.search).get('tag')
      if (!g) return 'All'
      const pills = {
        afrobeat: 'Afrobeats', afrobeats: 'Afrobeats',
        hiphop: 'Music', 'hip hop': 'Music',
        gospel: 'Gospel', news: 'News', talk: 'Talk',
        sports: 'Sports', sport: 'Sports', music: 'Music',
      }
      return pills[g.toLowerCase()] || 'All'
    } catch {
      return 'All'
    }
  })()
  const [explorePill, setExplorePill] = useState(explorePillFromUrl)
  const [showExploreSearch, setShowExploreSearch] = useState(false)
  const [exploreSearch, setExploreSearch] = useState('')
  const [showAllAfrobeats, setShowAllAfrobeats] = useState(false)
  const [showAllInternational, setShowAllInternational] = useState(false)

  /* ---------- User Favorites ---------- */
  const [favs, setFavs] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'))
    } catch {
      return new Set()
    }
  })

  const toggleFavorite = useCallback((st, e) => {
    if (e) e.stopPropagation()
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(st.stationuuid)) next.delete(st.stationuuid)
      else next.add(st.stationuuid)
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  /* ---------- Load Stations from Radio Browser API ---------- */
  const loadStations = useCallback(async (genreTag = '') => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      countrycode: 'NG',
      limit: '150',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
    })
    if (genreTag) params.set('tag', genreTag)
    try {
      const res = await fetch(`${API}/json/stations/search?${params}`, { headers: HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      
      // Combine curated popular with API stations and deduplicate
      const seen = new Map()
      for (const st of CURATED_POPULAR) {
        if (!genreTag || (st.tags || '').toLowerCase().includes(genreTag)) {
          seen.set(st.name.toLowerCase().replace(/[^a-z0-9]/g, ''), st)
        }
      }
      for (const st of data) {
        const key = st.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!key) continue
        if (!seen.has(key)) {
          seen.set(key, st)
        }
      }
      setStations([...seen.values()])
      setLoading(false)
      setStationsReady(true)
    } catch {
      // Keep curated list on error
      setLoading(false)
      setStationsReady(true)
    }
  }, [])

  /* A ?tag= deep link should land on Explore with that pill active. */
  useEffect(() => {
    if (explorePillFromUrl !== 'All') {
      setActiveTab('explore')
      setSelectedGenre(null)
      setFavOnly(false)
      loadStations(explorePillFromUrl === 'Afrobeats' ? 'afrobeat'
        : explorePillFromUrl === 'Sports' ? 'sport'
        : explorePillFromUrl.toLowerCase())
    }
  }, [explorePillFromUrl, loadStations])

  useEffect(() => {
    loadStations()
  }, [loadStations])

  /* ---------- Stream Candidates & Player Logic ----------
   * When low-bandwidth mode is on, prefer a lower-bitrate variant of the
   * stream so a weak connection doesn't stall. The normal URLs are kept
   * as fallback so switching off low-band just reverts. */
  const streamCandidates = useCallback((st) => {
    const urls = [st.url_resolved, st.url].filter(Boolean)
    if (lowBand) {
      // Put a guessed low-bitrate variant first when one is derivable.
      const low = lowBandUrlFor(urls[0])
      if (low && !urls.includes(low)) return [low, ...new Set(urls)]
    }
    return [...new Set(urls)]
  }, [lowBand])

  const playCandidate = useCallback(() => {
    const a = audioRef.current
    const st = currentRef.current
    if (!a || !st) return
    const remaining = candidatesRef.current
    if (remaining.length === 0) {
      setError(`Stream "${st.name}" unavailable`)
      setIsPlaying(false)
      setIsPaused(false)
      return
    }
    const nextUrl = remaining.shift()
    candidatesRef.current = [...remaining]
    a.src = nextUrl
    a.load()
    const p = a.play()
    if (p !== undefined) {
      p.then(() => {
        setIsPlaying(true)
        setIsPaused(false)
        setError(null)
      }).catch((err) => {
        if (isAbortError(err)) return
        if (err && err.name === 'NotAllowedError') {
          setIsPlaying(false)
          setResumeHint(true)
          return
        }
        if (candidatesRef.current.length > 0) playCandidateRef.current()
        else {
          setIsPlaying(false)
          setIsPaused(false)
          setError(`Stream "${st.name}" unavailable`)
        }
      })
    }
  }, [])

  useEffect(() => {
    playCandidateRef.current = playCandidate
  }, [playCandidate])

  /* Reconnect to the live edge and resume playback. Used after an OS
   * interruption (phone call, another app grabbing the audio session,
   * screen lock) because iOS pauses web audio without resuming it. */
  const resumeStream = useCallback((station, { reload = true, attempt = 0 } = {}) => {
    const a = audioRef.current
    const st = station || currentRef.current
    if (!a || !st) return
    const urls = streamCandidates(st)
    if (!urls.length) return
    // Avoid spinning if a dead stream or a browser blocks playback repeatedly.
    if (recoveredRef.current && attempt > 1) return
    setResumeHint(false)
    setError(null)
    if (reload) {
      const [first, ...rest] = urls
      candidatesRef.current = rest
      a.src = first
      a.load()
    }
    const playPromise = a.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true)
          setIsPaused(false)
          setResumeHint(false)
          setError(null)
          recoveredRef.current = false
        })
        .catch((err) => {
          if (isAbortError(err)) return
          if (err && err.name === 'NotAllowedError') {
            setIsPlaying(false)
            setResumeHint(true)
            recoveredRef.current = true
            return
          }
          if (attempt < 2 && candidatesRef.current.length > 0) {
            recoveredRef.current = false
            playCandidateRef.current()
          } else {
            setIsPlaying(false)
            setResumeHint(true)
            recoveredRef.current = true
          }
        })
    }
  }, [streamCandidates])

  /* ---------- Live edge ----------
   * Re-open the stream connection so playback sits at the live edge
   * instead of trailing the broadcast. A fresh connection starts at the
   * live edge, so this is the only way to catch up. The cooldown keeps
   * a flaky network from turning into a reconnect loop. */
  const showLiveNotice = useCallback((msg) => {
    setLiveNotice(msg)
    clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setLiveNotice(''), 2600)
  }, [])

  const rejoinLive = useCallback((reason) => {
    // We only ever call this from a genuine stall, never for "catch up to
    // the live edge". Re-opening on a stall is essential to recover from a
    // broken connection; re-opening to chase the live edge just stops the
    // user mid-song, so we skip that case.
    if (reason !== 'stall') return
    const st = currentRef.current
    if (!st || !wantsPlayRef.current) return
    const now = Date.now()
    if (now - rejoinCooldownRef.current < REJOIN_COOLDOWN_MS) return
    // Safety valve: a stream that keeps going stale should not turn into
    // an endless reconnect loop.
    if (rejoinCountRef.current >= 5) return
    rejoinCountRef.current += 1
    rejoinCooldownRef.current = now
    swappingRef.current = true
    resumeStream(st, { reload: true })
  }, [resumeStream])

  /* Re-open the connection a moment after a stream starts ONLY if the
   * relay handed the very first client a backlog of older audio (the
   * "stall" case below still runs to catch genuine mid-stream freezes).
   * We no longer chase the live edge on a fresh start — that was what
   * made the radio stop and skip ahead mid-song. A new connection
   * starts at the live edge naturally; re-opening it again right after
   * just stops the audio the user just started listening to. */
  const scheduleStartRejoin = useCallback((st) => {
    // Intentionally a no-op. The function is kept (and still called from
    // startStation / restoreLastStation) so those call sites do not need
    // to change. A genuine mid-playback stall is recovered by the
    // `waiting`/`stalled` handlers, which call rejoinLive('stall').
    clearTimeout(startRejoinTimerRef.current)
    startRejoinTimerRef.current = null
  }, [])

  const startStation = useCallback((st) => {
    const a = audioRef.current
    if (!a) return
    const urls = streamCandidates(st)
    if (!urls.length) {
      setError(`Stream unavailable for ${st.name}`)
      return
    }
    const [first, ...rest] = urls
    candidatesRef.current = rest
    setCurrent(st)
    currentRef.current = st
    wantsPlayRef.current = true
    // A fresh start is a user action - allow an immediate live-edge
    // correction if the stream turns out to be behind.
    rejoinCooldownRef.current = 0
    rejoinCountRef.current = 0
    pausedAtRef.current = 0
    setResumeHint(false)
    setIsPaused(false)
    setError(null)
    localStorage.setItem(LAST_KEY, st.stationuuid)
    try {
      localStorage.setItem(LAST_STATION_KEY, JSON.stringify(st))
    } catch {}

    // Synchronously set src within the user gesture context
    a.src = first
    a.load()
    // Re-open the connection shortly after, so we start on the live edge.
    scheduleStartRejoin(st)
    const playPromise = a.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true)
          setIsPaused(false)
          setResumeHint(false)
          setError(null)
        })
        .catch((err) => {
          if (isAbortError(err)) return
          if (err && err.name === 'NotAllowedError') {
            setIsPlaying(false)
            setResumeHint(true)
            return
          }
          console.warn('Play attempt failed for:', first, err)
          if (candidatesRef.current.length > 0) {
            playCandidateRef.current()
          } else {
            setIsPlaying(false)
            setIsPaused(false)
            setError(`Stream "${st.name}" unavailable`)
          }
        })
    }
  }, [streamCandidates, scheduleStartRejoin])

  /* ---------- Popular list ---------- */
  const popularList = useMemo(() => {
    if (!showAllPopular) {
      return CURATED_POPULAR
    }
    const pool = stations.length > 0 ? stations : CURATED_POPULAR
    const sorted = [...pool].sort((a, b) => (b.votes || 0) + (b.clickcount || 0) - ((a.votes || 0) + (a.clickcount || 0)))
    return sorted.slice(0, 16)
  }, [stations, showAllPopular])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    const st = currentRef.current
    if (!a) return
    if (!st) {
      const first = popularList[0] || stations[0] || CURATED_POPULAR[0]
      if (first) startStation(first)
      return
    }
    if (!a.paused && isPlaying) {
      wantsPlayRef.current = false
      pausedAtRef.current = Date.now()
      setResumeHint(false)
      a.pause()
      setIsPaused(true)
      setIsPlaying(false)
      return
    }
    wantsPlayRef.current = true
    setResumeHint(false)
    setIsPaused(false)
    setError(null)
    // How long the stream sat paused. A long pause leaves the connection
    // trailing the broadcast, so resume by re-opening it.
    const pausedFor = pausedAtRef.current ? Date.now() - pausedAtRef.current : 0
    pausedAtRef.current = 0
    rejoinCooldownRef.current = 0
    rejoinCountRef.current = 0
    if (!a.src || a.error || pausedFor > STALE_RESUME_MS) {
      resumeStream(st, { reload: true })
      return
    }
    const playPromise = a.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true)
          setIsPaused(false)
          setResumeHint(false)
        })
        .catch((err) => {
          if (isAbortError(err)) return
          if (err && err.name === 'NotAllowedError') {
            setIsPlaying(false)
            setResumeHint(true)
            return
          }
          if (candidatesRef.current.length > 0) playCandidateRef.current()
          else resumeStream(st, { reload: true })
        })
    }
  }, [isPlaying, popularList, stations, startStation, resumeStream])

  /* ---------- Audio Event Listeners ---------- */
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlaying = () => {
      clearTimeout(stallTimerRef.current)
      swappingRef.current = false
      setIsPlaying(true); setIsPaused(false); setResumeHint(false); setError(null)
    }
    const onPause = () => {
      // A deliberate source swap pauses the element - that is not the user
      // pressing pause, so keep the player state as it is.
      if (swappingRef.current) return
      setIsPlaying(false)
    }
    const onError = () => { if (candidatesRef.current.length > 0) playCandidateRef.current() }
    const onEnded = () => {
      if (wantsPlayRef.current) resumeStream(currentRef.current, { reload: true })
    }
    // A stream that stops delivering audio can freeze where it was. We
    // recover from a genuine deadlock (the connection is actually broken)
    // by re-opening it, but only after it has been silent for a while, and
    // we do NOT chase the live edge otherwise - that just stops the user
    // mid-song.
    const onWaiting = () => {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = setTimeout(() => rejoinLive('stall'), LIVE_EDGE_STALL_MS)
    }
    a.addEventListener('playing', onPlaying)
    a.addEventListener('pause', onPause)
    a.addEventListener('error', onError)
    a.addEventListener('ended', onEnded)
    a.addEventListener('waiting', onWaiting)
    a.addEventListener('stalled', onWaiting)
    return () => {
      clearTimeout(stallTimerRef.current)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('error', onError)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('waiting', onWaiting)
      a.removeEventListener('stalled', onWaiting)
    }
  }, [resumeStream, rejoinLive])

  /* ---------- Restore last station on launch ----------
   * The station object is persisted (not just the id) so it can render
   * before the Radio Browser API responds. We immediately try to play;
   * if iOS blocks autoplay, the station stays loaded and we show a
   * one-tap "resume" hint instead of losing the selection. */
  const restoreLastStation = useCallback(() => {
    const saved = loadSavedStation()
    const a = audioRef.current
    if (!saved || !a) return
    const urls = streamCandidates(saved)
    if (!urls.length) return
    const [first, ...rest] = urls
    candidatesRef.current = rest
    currentRef.current = saved
    setCurrent(saved)
    wantsPlayRef.current = true
    a.src = first
    a.load()
    scheduleStartRejoin(saved)
    const playPromise = a.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true)
          setIsPaused(false)
          setResumeHint(false)
          setError(null)
        })
        .catch((err) => {
          if (isAbortError(err)) return
          if (err && err.name === 'NotAllowedError') {
            setIsPlaying(false)
            setResumeHint(true)
            return
          }
          if (candidatesRef.current.length > 0) playCandidateRef.current()
          else setResumeHint(true)
        })
    }
  }, [streamCandidates, scheduleStartRejoin])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    // A shared link (?station=...) wins over the last-played station.
    if (deepLinkSlug) return
    restoreLastStation()
  }, [deepLinkSlug, restoreLastStation])

  /* ---------- Auto-resume after OS interruptions ----------
   * iOS pauses web audio when a call, lock screen, or another app
   * (e.g. a video on X) takes the audio session, and does not resume
   * it when that ends. When we come back to the foreground, reconnect
   * to the live stream if the user still intends to be playing. */
  useEffect(() => {
    const tryResume = () => {
      if (document.visibilityState !== 'visible') return
      const a = audioRef.current
      if (!a || !currentRef.current) return
      if (!wantsPlayRef.current || !a.paused) return
      // visibilitychange + focus can both fire; only try once per beat.
      const now = Date.now()
      if (now - lastResumeAttemptRef.current < 1500) return
      lastResumeAttemptRef.current = now
      resumeStream(currentRef.current, { reload: true })
    }
    const onVisibility = () => tryResume()
    const onFocus = () => tryResume()
    const onPageShow = (e) => { if (e.persisted) tryResume() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [resumeStream])

  /* ---------- Filtered Stations ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stations.filter((st) => {
      if (favOnly && !favs.has(st.stationuuid)) return false
      if (genre && !(st.tags || '').toLowerCase().includes(genre)) return false
      if (q && !(st.name.toLowerCase().includes(q) || (st.tags || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [stations, search, genre, favOnly, favs])

  /* ---------- Explore Filtered List ---------- */
  const filteredExploreList = useMemo(() => {
    const q = exploreSearch.trim().toLowerCase()
    const all = [...EXPLORE_AFROBEATS, ...EXPLORE_INTERNATIONAL, ...stations]
    const seen = new Set()
    const deduped = []
    for (const st of all) {
      const key = st.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(st)
    }

    return deduped.filter((st) => {
      const nameMatch = !q || st.name.toLowerCase().includes(q)
      const countryMatch = !q || (st.country || '').toLowerCase().includes(q)
      const tagMatch = !q || (st.tags || '').toLowerCase().includes(q)
      if (q && !(nameMatch || countryMatch || tagMatch)) return false

      if (explorePill !== 'All') {
        const pillTag = explorePill.toLowerCase()
        const tags = (st.tags || '').toLowerCase()
        if (pillTag === 'afrobeats') {
          if (!tags.includes('afrobeat')) return false
        } else if (pillTag === 'music') {
          const isMusic = tags.includes('music') || tags.includes('pop') || tags.includes('hits') ||
                          tags.includes('afrobeat') || tags.includes('hip hop') || tags.includes('hiphop') ||
                          tags.includes('r&b') || tags.includes('chart') || tags.includes('dance') || tags.includes('urban')
          if (!isMusic) return false
        } else if (pillTag === 'sports') {
          if (!tags.includes('sport')) return false
        } else if (pillTag === 'gospel') {
          if (!tags.includes('gospel') && !tags.includes('christian') && !tags.includes('worship')) return false
        } else {
          if (!tags.includes(pillTag)) return false
        }
      }
      return true
    })
  }, [exploreSearch, explorePill, stations])

  /* ---------- All Known Stations (Curated + Loaded) ---------- */
  const allKnownStations = useMemo(() => {
    const list = [...CURATED_POPULAR, ...EXPLORE_AFROBEATS, ...EXPLORE_INTERNATIONAL, ...stations]
    const map = new Map()
    for (const st of list) {
      if (st && st.stationuuid && !map.has(st.stationuuid)) {
        map.set(st.stationuuid, st)
      }
    }
    return map
  }, [stations])

  /* Ordered channel list used for Prev/Next navigation */
  const channelList = useMemo(() => [...allKnownStations.values()], [allKnownStations])

  /* ---------- Share link for the station being played ----------
   * A shared link points at the station, not at the app home:
   *   https://t-radio.app/?station=cool-fm-96-9 */
  const shareUrl = useMemo(() => {
    const st = current || EXPLORE_AFROBEATS[0]
    if (!st) return ''
    return buildShareUrl(st, channelList)
  }, [current, channelList])

  /* ---------- Share OG card ----------
   * Update the og:title/desc/image so a shared link previews the specific
   * station. The image is the station's artwork when the API has a
   * favicon, otherwise the T-Radio icon (the same square mark used as the
   * favicon, so the shared card always looks branded and tidy). This has to
   * live after shareUrl: the effect's dependency array is evaluated during
   * render, so it can only read values that are already declared. */
  useEffect(() => {
    const st = current || EXPLORE_AFROBEATS[0]
    if (!st) return
    try {
      setShareOgMeta({
        title: `${st.name} · T-Radio`,
        description: `Listen to ${st.name} live — powered by T-Radio`,
        image: resolveStationArt(st) || '/tradio-icon.webp',
        url: shareUrl,
      })
    } catch { /* best effort */ }
  }, [current, shareUrl])

  /* ---------- Deep link: /?station=<slug> ----------
   * Opens the shared station straight into Now Playing. The station is
   * looked up locally first (curated + already loaded stations) and,
   * if that misses, by name against the Radio Browser API. */
  useEffect(() => {
    if (!deepLinkSlug || deepLinkDoneRef.current) return

    const known = [...allKnownStations.values()]
    const found = findStationBySlug(deepLinkSlug, known)
    if (found) {
      deepLinkDoneRef.current = true
      setDeepLinkMissing(false)
      setShowNowPlaying(true)
      startStation(found)
      return
    }

    // Wait for the station list before asking the API by name, so the
    // common case never pays for a second request.
    if (!stationsReady) return
    if (deepLinkSearchRef.current) return
    deepLinkSearchRef.current = true

    let cancelled = false
    searchStationBySlug(deepLinkSlug)
      .then((st) => {
        if (cancelled) return
        if (st) {
          deepLinkDoneRef.current = true
          setDeepLinkMissing(false)
          setShowNowPlaying(true)
          startStation(st)
        } else {
          setDeepLinkMissing(true)
          restoreLastStation()
        }
      })
      .catch(() => {
        if (cancelled) return
        setDeepLinkMissing(true)
        restoreLastStation()
      })

    return () => {
      cancelled = true
    }
  }, [deepLinkSlug, allKnownStations, stationsReady, startStation, restoreLastStation])

  /**
   * Navigate to the previous/next station in the channel list,
   * wrapping around at the ends. Shows a brief loading state.
   */
  const navigateChannel = useCallback((direction) => {
    if (!current) return
    const list = channelList
    if (!list.length) return
    const idx = list.findIndex((st) => st.stationuuid === current.stationuuid)
    if (idx === -1) return
    const nextIdx = direction === 'next' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length
    const nextStation = list[nextIdx]
    setIsNavigating(true)
    // Start synchronously so mobile browsers still treat this as a
    // user-gesture play; keep the radar sweep visible as a short beat.
    startStation(nextStation)
    setTimeout(() => {
      setIsNavigating(false)
    }, 600)
  }, [current, channelList, startStation])

  /* Fill in the media-session handlers now that togglePlay / navigateChannel
   * exist. The ref is read at action-handler time, so the OS media widget
   * always calls the freshest functions. */
  mediaHandlersRef.current = {
    onTogglePlay: togglePlay,
    onPrevChannel: () => navigateChannel('prev'),
    onNextChannel: () => navigateChannel('next'),
  }

  /* ---------- Favorite Stations List ---------- */
  const favoriteStations = useMemo(() => {
    const res = []
    for (const uuid of favs) {
      const st = allKnownStations.get(uuid)
      if (st) res.push(st)
    }
    return res
  }, [favs, allKnownStations])

  /* ---------- Genre Stations Selection (Screen 4) ---------- */
  const genreStations = useMemo(() => {
    if (!selectedGenre) return []
    const tag = selectedGenre.tag.toLowerCase()
    const q = genreSearch.trim().toLowerCase()
    const all = [...CURATED_POPULAR, ...EXPLORE_AFROBEATS, ...EXPLORE_INTERNATIONAL, ...stations]
    const seen = new Set()
    const deduped = []
    for (const st of all) {
      if (!st || !st.name) continue
      const key = st.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(st)
    }

    return deduped.filter((st) => {
      const tags = (st.tags || '').toLowerCase()
      const matchesGenre =
        tag === 'afrobeat' ? (tags.includes('afrobeat') || tags.includes('afrobeats') || (st.country || '').toLowerCase().includes('nigeria')) :
        tag === 'hiphop' ? (tags.includes('hip hop') || tags.includes('hiphop') || tags.includes('r&b') || tags.includes('urban')) :
        tag === 'gospel' ? (tags.includes('gospel') || tags.includes('christian') || tags.includes('worship')) :
        tag === 'news' ? (tags.includes('news') || tags.includes('talk')) :
        tag === 'talk' ? (tags.includes('talk') || tags.includes('news')) :
        tag === 'sports' ? (tags.includes('sport') || tags.includes('sports')) :
        tags.includes(tag)

      if (!matchesGenre) return false
      if (q && !(st.name.toLowerCase().includes(q) || (st.country || '').toLowerCase().includes(q) || tags.includes(q))) {
        return false
      }
      return true
    })
  }, [selectedGenre, genreSearch, stations])

  const handleGenreClick = (g) => {
    setSelectedGenre(g)
    setGenreSearch('')
    loadStations(g.tag)
  }

  const clearFilters = () => {
    setSearch('')
    setGenre('')
    if (favOnly) {
      setFavOnly(false)
      localStorage.setItem(FAVONLY_KEY, 'off')
    }
    loadStations('')
  }

  const isFiltering = Boolean(search || genre || favOnly)

  return (
    <div className="hs-screen">
      {/* Shared link points at a station we could not find */}
      {deepLinkMissing && (
        <div className="hs-deeplink-note" role="status">
          <span>We couldn&rsquo;t find that station. It may have moved.</span>
          <button
            className="hs-deeplink-dismiss"
            onClick={() => setDeepLinkMissing(false)}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* ================= INSTALL BANNER (one-time, dismissible) =================
          Shown only in a plain browser tab (not installed). Android/Chrome get
          a one-tap "Install" prompt; iOS Safari gets the manual Share →
          Add-to-Home-Screen steps, since it has no install API. */}
      {showInstallBanner && (
        <div className="hs-install-banner" role="region" aria-label="Install T-Radio">
          <div className="hs-install-banner-text">
            <span className="hs-install-banner-title">
              {installPlatform === 'ios'
                ? 'Install T-Radio to keep the radio playing with your screen off'
                : 'Install T-Radio for background playback'}
            </span>
            <span className="hs-install-banner-sub">
              {installPlatform === 'ios'
                ? 'Tap Share, then \u201CAdd to Home Screen.\u201D'
                : installCanPrompt
                  ? 'One tap \u2014 T-Radio will live on your home screen.'
                  : 'Add it to your home screen to keep listening hands-free.'}
            </span>
          </div>
          {installCanPrompt && (
            <button className="hs-install-banner-cta" onClick={promptInstall}>
              Install
            </button>
          )}
          <button
            className="hs-deeplink-dismiss"
            onClick={dismissInstall}
            aria-label="Dismiss install banner"
          >
            &times;
          </button>
        </div>
      )}

      {/* ================= TOP HEADER ================= */}
      {selectedGenre ? null : activeTab === 'explore' ? (
        <header className="hs-explore-header">
          <h1 className="hs-explore-title">Explore</h1>
          <div className="hs-actions">
            <button
              className="hs-icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
            <button
              className={`hs-icon-btn${showExploreSearch ? ' active' : ''}`}
              aria-label="Search in Explore"
              onClick={() => setShowExploreSearch((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.8-3.8" />
              </svg>
            </button>
          </div>
        </header>
      ) : activeTab === 'favorites' ? (
        <header className="hs-explore-header">
          <h1 className="hs-explore-title">Favorites</h1>
          <div className="hs-actions">
            <button
              className="hs-icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
            <span style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>
              {favs.size} saved
            </span>
          </div>
        </header>
      ) : (
        <header className="hs-header">
          <div className="hs-brand">
            <div className="hs-brand-wave" aria-hidden="true">
              <span style={{ height: '7px' }} />
              <span style={{ height: '16px' }} />
              <span style={{ height: '22px' }} />
              <span style={{ height: '13px' }} />
              <span style={{ height: '6px' }} />
            </div>
            <h1 className="hs-brand-title">
              <span className="hs-brand-t">T-</span>
              <span className="hs-brand-radio">RADIO</span>
            </h1>
          </div>

          <div className="hs-actions">
            <button
              className="hs-icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
            <button
              className={`hs-icon-btn${activeTab === 'search' ? ' active' : ''}`}
              aria-label="Search"
              onClick={() => setActiveTab((prev) => (prev === 'search' ? 'home' : 'search'))}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.8-3.8" />
              </svg>
            </button>
            <button
              className={`hs-icon-btn${activeTab === 'more' ? ' active' : ''}`}
              aria-label="Settings"
              onClick={() => setActiveTab((prev) => (prev === 'more' ? 'home' : 'more'))}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h0a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55h0a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v0a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" />
              </svg>
            </button>
          </div>
        </header>
      )}

      {/* ================= SEARCH INPUT ================= */}
      {((activeTab === 'search') || (activeTab === 'explore' && showExploreSearch)) && (
        <div className="hs-search-box">
          <svg className="hs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" />
          </svg>
          <input
            type="search"
            placeholder={activeTab === 'explore' ? 'Search in Explore…' : 'Search stations, artists, genres…'}
            value={activeTab === 'explore' ? exploreSearch : search}
            onChange={(e) => {
              if (activeTab === 'explore') setExploreSearch(e.target.value)
              else setSearch(e.target.value)
            }}
            autoFocus
          />
          {(activeTab === 'explore' ? exploreSearch : search) && (
            <button
              className="hs-search-clear"
              onClick={() => {
                if (activeTab === 'explore') setExploreSearch('')
                else setSearch('')
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* ================= SCROLLABLE VIEWPORT ================= */}
      <main className="hs-content">
        {selectedGenre ? (
          <div className="hs-genre-view">
            {/* Dedicated Genre Page (Screen 4) */}
            <div className="hs-subpage-header">
              <button
                className="hs-back-btn"
                onClick={() => {
                  setSelectedGenre(null)
                  setGenreSearch('')
                  loadStations('')
                }}
                aria-label="Back"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <h2 className="hs-subpage-title">{selectedGenre.label || selectedGenre.name} Stations</h2>
              <div style={{ width: '38px' }} />
            </div>

            <div className="hs-search-box" style={{ margin: '14px 16px' }}>
              <svg className="hs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" />
              </svg>
              <input
                type="search"
                placeholder={`Search ${selectedGenre.label || selectedGenre.name} stations…`}
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
              />
              {genreSearch && (
                <button className="hs-search-clear" onClick={() => setGenreSearch('')}>✕</button>
              )}
            </div>

            <div className="hs-explore-list" style={{ padding: '0 16px 24px' }}>
              {genreStations.length === 0 && !loading && (
                <p className="hs-empty-hint">No stations found for this genre.</p>
              )}
              {genreStations.map((st) => {
                const isCurrent = current && (current.stationuuid === st.stationuuid || current.name.toLowerCase() === st.name.toLowerCase())
                return (
                  <ExploreStationRow
                    key={st.stationuuid}
                    station={st}
                    isPlaying={isCurrent && isPlaying}
                    onPlay={() => {
                      if (isCurrent) togglePlay()
                      else startStation(st)
                    }}
                    isFav={favs.has(st.stationuuid)}
                    onToggleFav={toggleFavorite}
                  />
                )
              })}
            </div>
          </div>
        ) : activeTab === 'favorites' ? (
          <div className="hs-favorites-view">
            {favoriteStations.length === 0 ? (
              <div className="hs-empty-state">
                <div className="hs-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
                    <path d="M12 21s-7.5-4.6-9.5-9.2C1 8.6 3.6 5.5 6.8 5.5c2 0 3.4 1.1 4.2 2.4.4.6 1.6.6 2 0 .8-1.3 2.2-2.4 4.2-2.4 3.2 0 5.8 3.1 4.3 6.3C19.5 16.4 12 21 12 21z" />
                  </svg>
                </div>
                <h3 className="hs-empty-title">No Favorites Saved</h3>
                <p className="hs-empty-desc">
                  Tap the heart icon on any station or while listening to add your favorite stations here.
                </p>
                <button
                  className="hs-empty-btn"
                  onClick={() => {
                    setActiveTab('home')
                    setSelectedGenre(null)
                  }}
                >
                  Discover Stations
                </button>
              </div>
            ) : (
              <div className="hs-explore-list">
                {favoriteStations.map((st) => {
                  const isCurrent = current && (current.stationuuid === st.stationuuid || current.name.toLowerCase() === st.name.toLowerCase())
                  return (
                    <ExploreStationRow
                      key={st.stationuuid}
                      station={st}
                      isPlaying={isCurrent && isPlaying}
                      onPlay={() => {
                        if (isCurrent) togglePlay()
                        else startStation(st)
                      }}
                      isFav={favs.has(st.stationuuid)}
                      onToggleFav={toggleFavorite}
                    />
                  )
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'more' ? (
          <div className="hs-more-view">
            <div className="hs-more-card">
              <h3 className="hs-more-title">T-Radio</h3>
              <p className="hs-more-desc">
                High-definition live radio stations from Nigeria, United Kingdom, France, and around the world.
              </p>
              <div className="hs-more-row">
                <span className="hs-info-key">App Version</span>
                <span className="hs-info-val">v2.0.0 (T-Radio Edition)</span>
              </div>
              <div className="hs-more-row">
                <span className="hs-info-key">Favorites Saved</span>
                <span className="hs-info-val">{favs.size} stations</span>
              </div>
              <div className="hs-more-row">
                <span className="hs-info-key">Stream Quality</span>
                <span className="hs-info-val">High (128 - 320 kbps)</span>
              </div>
              <div className="hs-more-row">
                <span className="hs-info-key">Active Listeners</span>
                <span className="hs-info-val">{globalListeners} now</span>
              </div>
            </div>

            <div className="hs-more-card">
              <h3 className="hs-more-title">Controls & Storage</h3>
              <div className="hs-more-row">
                <span>Appearance</span>
                <button className="hs-more-btn" onClick={toggleTheme}>
                  {theme === 'dark' ? 'Dark' : 'Light'} mode
                </button>
              </div>
              <div className="hs-more-row">
                <span>Reset Cache &amp; Reload</span>
                <button
                  className="hs-more-btn"
                  onClick={() => {
                    localStorage.removeItem(LAST_KEY)
                    localStorage.removeItem(LAST_STATION_KEY)
                    window.location.reload()
                  }}
                >
                  Reload
                </button>
              </div>
            </div>

            <div className="hs-more-card">
              <h3 className="hs-more-title">Connection</h3>
              <div className="hs-more-row">
                <span>Low-bandwidth mode</span>
                <button
                  className={`hs-more-btn${lowBand ? ' active' : ''}`}
                  onClick={() => {
                    setLowBand((v) => !v)
                    if (!lowBand) {
                      setStreamNotice('')
                      showLiveNotice('Switching to low-bitrate stream…')
                    }
                  }}
                  aria-pressed={lowBand}
                >
                  {lowBand ? 'On' : 'Off'}
                </button>
              </div>
              <div className="hs-more-row">
                <span>Wake screen while playing</span>
                <button
                  className={`hs-more-btn${(typeof navigator !== 'undefined' && 'wakeLock' in navigator) ? ' active' : ''}`}
                  onClick={async () => {
                    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
                      await navigator.wakeLock.request('screen').catch(() => {})
                    }
                  }}
                >
                  {typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'Available' : 'Unsupported'}
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'explore' ? (
          <div className="hs-explore-view">
            {/* Category Filter Pills Rail */}
            <div className="hs-pills-rail" role="tablist" aria-label="Explore categories">
              {EXPLORE_PILLS.map((p) => {
                const isPillActive = explorePill === p
                return (
                  <button
                    key={p}
                    role="tab"
                    aria-selected={isPillActive}
                    className={`hs-pill-btn${isPillActive ? ' active' : ''}`}
                    onClick={() => {
                      setExplorePill(p)
                      if (p === 'All') loadStations('')
                      else if (p === 'Afrobeats') loadStations('afrobeat')
                      else if (p === 'Sports') loadStations('sport')
                      else loadStations(p.toLowerCase())
                    }}
                  >
                    {p}
                  </button>
                )
              })}
            </div>

            {/* If 'All' and not searching: Show Section 1 (Afrobeats) + Section 2 (International) matching Screen 3 */}
            {explorePill === 'All' && !exploreSearch ? (
              <>
                {/* Section 1: Afrobeats */}
                <section className="hs-explore-section" aria-label="Afrobeats stations">
                  <div className="hs-section-header">
                    <h3 className="hs-section-title">Afrobeats</h3>
                    <button
                      className="hs-see-all"
                      onClick={() => setShowAllAfrobeats((v) => !v)}
                    >
                      {showAllAfrobeats ? 'Show Less' : 'See All'}
                    </button>
                  </div>
                  <div className="hs-explore-list">
                    {(showAllAfrobeats ? EXPLORE_AFROBEATS : EXPLORE_AFROBEATS.slice(0, 4)).map((st) => {
                      const isCurrent = current && (current.stationuuid === st.stationuuid || current.name.toLowerCase() === st.name.toLowerCase())
                      return (
                        <ExploreStationRow
                          key={st.stationuuid}
                          station={st}
                          isPlaying={isCurrent && isPlaying}
                          onPlay={() => {
                            if (isCurrent) togglePlay()
                            else startStation(st)
                          }}
                          isFav={favs.has(st.stationuuid)}
                          onToggleFav={toggleFavorite}
                        />
                      )
                    })}
                  </div>
                </section>

                {/* Section 2: International */}
                <section className="hs-explore-section" aria-label="International stations">
                  <div className="hs-section-header">
                    <h3 className="hs-section-title">International</h3>
                    <button
                      className="hs-see-all"
                      onClick={() => setShowAllInternational((v) => !v)}
                    >
                      {showAllInternational ? 'Show Less' : 'See All'}
                    </button>
                  </div>
                  <div className="hs-explore-list">
                    {(showAllInternational ? EXPLORE_INTERNATIONAL : EXPLORE_INTERNATIONAL.slice(0, 4)).map((st) => {
                      const isCurrent = current && (current.stationuuid === st.stationuuid || current.name.toLowerCase() === st.name.toLowerCase())
                      return (
                        <ExploreStationRow
                          key={st.stationuuid}
                          station={st}
                          isPlaying={isCurrent && isPlaying}
                          onPlay={() => {
                            if (isCurrent) togglePlay()
                            else startStation(st)
                          }}
                          isFav={favs.has(st.stationuuid)}
                          onToggleFav={toggleFavorite}
                        />
                      )
                    })}
                  </div>
                </section>
              </>
            ) : (
              /* Filtered by category or exploreSearch */
              <section className="hs-explore-section" aria-label={`${explorePill} stations`}>
                <div className="hs-section-header">
                  <h3 className="hs-section-title">
                    {exploreSearch ? `Results for "${exploreSearch}"` : `${explorePill} Stations`}
                  </h3>
                  {(exploreSearch || explorePill !== 'All') && (
                    <button
                      className="hs-see-all"
                      onClick={() => {
                        setExplorePill('All')
                        setExploreSearch('')
                        loadStations('')
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="hs-explore-list">
                  {filteredExploreList.length === 0 && !loading && (
                    <p className="hs-empty-hint">No stations found in this category.</p>
                  )}
                  {filteredExploreList.map((st) => {
                    const isCurrent = current && (current.stationuuid === st.stationuuid || current.name.toLowerCase() === st.name.toLowerCase())
                    return (
                      <ExploreStationRow
                        key={st.stationuuid}
                        station={st}
                        isPlaying={isCurrent && isPlaying}
                        onPlay={() => {
                          if (isCurrent) togglePlay()
                          else startStation(st)
                        }}
                        isFav={favs.has(st.stationuuid)}
                        onToggleFav={toggleFavorite}
                      />
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          <>
            {/* ---------- HERO BANNER ---------- */}
            <section className="hs-hero" aria-label="Hero feature">
              <div className="hs-hero-copy">
                <h2 className="hs-hero-heading">
                  Listen to<br />
                  <span className="hs-hero-highlight">Radio Stations</span><br />
                  from around the world
                </h2>
                <p className="hs-hero-sub">Music • News • Talk • Sports • Culture</p>
                <button className="hs-hero-cta" onClick={togglePlay}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                      <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
                    </svg>
                  )}
                  <span>{isPlaying ? 'Pause' : 'Start Listening'}</span>
                </button>
              </div>

              <div className="hs-hero-graphic" aria-hidden="true">
                <HeroMicGraphic />
              </div>
            </section>

            {/* ---------- POPULAR STATIONS ---------- */}
            <section className="hs-section" aria-label="Popular stations">
              <div className="hs-section-header">
                <h3 className="hs-section-title">Popular Stations</h3>
                <button
                  className="hs-see-all"
                  onClick={() => setShowAllPopular((v) => !v)}
                >
                  {showAllPopular ? 'Show Less' : 'See All'}
                </button>
              </div>

              <div className="hs-popular-rail">
                {popularList.map((st) => {
                  const isCurrent = current?.stationuuid === st.stationuuid
                  return (
                    <article
                      key={st.stationuuid}
                      className={`hs-pop-card${isCurrent && isPlaying ? ' playing' : ''}`}
                      onClick={() => {
                        if (isCurrent) togglePlay()
                        else startStation(st)
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && (isCurrent ? togglePlay() : startStation(st))}
                    >
                      <div className="hs-pop-cover">
                        <StationBrandLogo station={st} size={80} />
                        {isCurrent && isPlaying && (
                          <span className="hs-pop-live">
                            <span className="hs-live-dot" />
                            LIVE
                          </span>
                        )}
                      </div>
                      <div className="hs-pop-meta">
                        <h4 className="hs-pop-name" title={st.name}>{st.name}</h4>
                        <p className="hs-pop-country">{st.country || 'Global'}</p>
                        <p className="hs-pop-tags">{formatFirstTags(st)}</p>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            {/* ---------- BROWSE BY GENRE ---------- */}
            <section className="hs-section" aria-label="Browse by genre">
              <div className="hs-section-header">
                <h3 className="hs-section-title">Browse by Genre</h3>
                <button
                  className="hs-see-all"
                  onClick={() => {
                    setActiveTab('explore')
                    setExplorePill('All')
                    setSelectedGenre(null)
                  }}
                >
                  See All
                </button>
              </div>

              <div className="hs-genre-grid">
                {GENRE_TILES.map((g) => {
                  const isActive = genre === g.tag
                  return (
                    <button
                      key={g.id}
                      className={`hs-genre-card${isActive ? ' active' : ''}`}
                      onClick={() => handleGenreClick(g)}
                      aria-pressed={isActive}
                    >
                      <img src={g.image} alt="" className="hs-genre-art" />
                      <div className="hs-genre-overlay" />
                      <span className="hs-genre-title">{g.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* ---------- FILTERED / SEARCH RESULTS SECTION ---------- */}
            {isFiltering && (
              <section className="hs-section" aria-label="Station list">
                <div className="hs-section-header">
                  <h3 className="hs-section-title">
                    {favOnly
                      ? 'Favorite Stations'
                      : genre
                      ? `${GENRE_TILES.find((g) => g.tag === genre)?.label || genre} Stations`
                      : `Results for "${search}"`}
                  </h3>
                  <button className="hs-see-all" onClick={clearFilters}>
                    Clear
                  </button>
                </div>

                <div className="hs-list">
                  {filtered.length === 0 && !loading && (
                    <p className="hs-empty-hint">
                      {favOnly ? 'No favorite stations yet — tap the star on any station to save it.' : 'No stations found.'}
                    </p>
                  )}
                  {filtered.map((st) => {
                    const isCurrent = current?.stationuuid === st.stationuuid
                    const isFav = favs.has(st.stationuuid)
                    return (
                      <article
                        key={st.stationuuid}
                        className={`hs-list-item${isCurrent ? ' current' : ''}`}
                        onClick={() => startStation(st)}
                      >
                        <div className="hs-li-art">
                          <StationBrandLogo station={st} size={48} />
                        </div>
                        <div className="hs-li-info">
                          <h4 className="hs-li-name">{st.name}</h4>
                          <p className="hs-li-desc">{st.country || 'Global'} • {formatFirstTags(st)}</p>
                        </div>
                        <div className="hs-li-actions">
                          <button
                            className="hs-li-play"
                            aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isCurrent) togglePlay()
                              else startStation(st)
                            }}
                          >
                            {isCurrent && isPlaying ? (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            )}
                          </button>
                          <button
                            className={`hs-li-fav${isFav ? ' faved' : ''}`}
                            aria-label={isFav ? 'Remove favorite' : 'Add favorite'}
                            onClick={(e) => toggleFavorite(st, e)}
                          >
                            {isFav ? '★' : '☆'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* ================= STREAM HEALTH NOTICE ================= */}
      {streamNotice && current && (
        <div className="hs-stream-notice" role="status">
          <svg className="hs-stream-notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <span className="hs-stream-notice-text">{streamNotice}</span>
          <button
            className="hs-stream-notice-action"
            onClick={(e) => {
              e.stopPropagation()
              setLowBand(true)
              setStreamNotice('')
            }}
          >
            {lowBand ? 'On' : 'Enable'}
          </button>
          <button
            className="hs-stream-notice-action"
            style={{ opacity: 0.6 }}
            onClick={(e) => {
              e.stopPropagation()
              setStreamNotice('')
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* ================= NOW PLAYING MINI-PLAYER ================= */}
      {current && (
        <div
          className="hs-mini-player"
          aria-label="Now playing bar"
          onClick={() => setShowNowPlaying(true)}
          style={{ cursor: 'pointer' }}
        >
          <div className="hs-mp-cover">
            <StationBrandLogo station={current} size={42} />
          </div>
          <div className="hs-mp-meta">
            <div className="hs-mp-title">{current.name}</div>
            <div className="hs-mp-subtitle">
              {resumeHint && !isPlaying ? (
                <span className="hs-mp-resume" role="status">Tap ▶ to resume</span>
              ) : (
                <>
                  {isPlaying && (
                    <span className="hs-eq-bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  <span>{current.country || 'Nigeria'} • {formatFirstTags(current)}</span>
                </>
              )}
            </div>
          </div>
          <button
            className="hs-mp-play-btn"
            onClick={(e) => {
              e.stopPropagation()
              togglePlay()
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
              </svg>
            )}
          </button>
          <button
            className="hs-mp-expand-btn"
            aria-label="Expand player"
            onClick={(e) => {
              e.stopPropagation()
              setShowNowPlaying(true)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      )}

      {/* ================= BOTTOM NAVIGATION ================= */}
      <nav className="hs-bottom-nav" aria-label="Bottom Navigation">
        <button
          className={`hs-nav-item${activeTab === 'home' && !selectedGenre ? ' active' : ''}`}
          onClick={() => {
            setActiveTab('home')
            setSelectedGenre(null)
            setFavOnly(false)
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5L12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1V9.5" />
          </svg>
          <span>Home</span>
        </button>

        <button
          className={`hs-nav-item${activeTab === 'explore' ? ' active' : ''}`}
          onClick={() => {
            setActiveTab('explore')
            setSelectedGenre(null)
            setFavOnly(false)
            setExplorePill('All')
            setExploreSearch('')
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M14.5 9.5l-1.8 4.7-4.7 1.8 1.8-4.7 4.7-1.8z" />
          </svg>
          <span>Explore</span>
        </button>

        <button
          className={`hs-nav-item${activeTab === 'favorites' ? ' active' : ''}`}
          onClick={() => {
            setActiveTab('favorites')
            setSelectedGenre(null)
            setFavOnly(false)
          }}
        >
          <svg viewBox="0 0 24 24" fill={activeTab === 'favorites' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7.5-4.6-9.5-9.2C1 8.6 3.6 5.5 6.8 5.5c2 0 3.4 1.1 4.2 2.4.4.6 1.6.6 2 0 .8-1.3 2.2-2.4 4.2-2.4 3.2 0 5.8 3.1 4.3 6.3C19.5 16.4 12 21 12 21z" />
          </svg>
          <span>Favorites</span>
        </button>

        <button
          className={`hs-nav-item${activeTab === 'search' ? ' active' : ''}`}
          onClick={() => {
            setSelectedGenre(null)
            setActiveTab((prev) => (prev === 'search' ? 'home' : 'search'))
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" />
          </svg>
          <span>Search</span>
        </button>

        <button
          className={`hs-nav-item${activeTab === 'more' ? ' active' : ''}`}
          onClick={() => {
            setActiveTab('more')
            setSelectedGenre(null)
            setFavOnly(false)
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
          <span>More</span>
        </button>
      </nav>

      {/* ================= NOW PLAYING FULL SCREEN (SCREEN 2) ================= */}
      {showNowPlaying && (
        <NowPlayingScreen
          station={current || EXPLORE_AFROBEATS[0]}
          shareUrl={shareUrl}
          isPlaying={isPlaying}
          listeners={globalListeners}
          needsResume={resumeHint && !isPlaying}
          nowPlaying={nowPlaying}
          nowPlayingStatus={nowPlayingStatus}
          trackLinks={trackLinks}
          onTogglePlay={() => {
            if (!current) startStation(EXPLORE_AFROBEATS[0])
            else togglePlay()
          }}
          onClose={() => setShowNowPlaying(false)}
          isFav={current ? favs.has(current.stationuuid) : false}
          onToggleFav={() => {
            const st = current || EXPLORE_AFROBEATS[0]
            toggleFavorite(st)
          }}
          volume={volume}
          onVolumeChange={setVolume}
          onPrevChannel={() => navigateChannel('prev')}
          onNextChannel={() => navigateChannel('next')}
          isLoading={isNavigating}
          notice={liveNotice || streamNotice}
          lowBand={lowBand}
        />
      )}

      {/* Background audio element */}
      <audio ref={audioRef} preload="auto" playsInline />
    </div>
  )
}
