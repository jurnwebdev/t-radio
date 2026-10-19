import { useState, useEffect } from 'react'

export function FallbackStationLogo({ name = 'Radio', size = 56 }) {
  // Generate consistent pleasant dark gradient from station name
  const initials = name
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || 'TR'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1B263B 0%, #0D1524 100%)',
        borderRadius: 'inherit',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          fontSize: size * 0.36,
          fontWeight: 800,
          color: '#FFC107',
          letterSpacing: '-0.5px',
          textShadow: '0 2px 6px rgba(0,0,0,0.5)',
        }}
      >
        {initials}
      </div>
      <div
        style={{
          display: 'flex',
          gap: '2px',
          alignItems: 'center',
          marginTop: '4px',
        }}
      >
        <span style={{ width: '3px', height: '8px', background: '#FFC107', borderRadius: '1px', opacity: 0.6 }} />
        <span style={{ width: '3px', height: '14px', background: '#FFC107', borderRadius: '1px' }} />
        <span style={{ width: '3px', height: '10px', background: '#FFC107', borderRadius: '1px', opacity: 0.8 }} />
        <span style={{ width: '3px', height: '5px', background: '#FFC107', borderRadius: '1px', opacity: 0.5 }} />
      </div>
    </div>
  )
}

export function StationBrandLogo({ station, size = 64 }) {
  const [imgError, setImgError] = useState(false)
  useEffect(() => { setImgError(false) }, [station?.stationuuid, station?.favicon])

  if (!station) return <FallbackStationLogo size={size} />

  const name = (station.name || '').toLowerCase()

  // BBC Radio 1
  if (name.includes('bbc') && (name.includes('radio 1') || name.includes('1xtra') || name.includes('bbc 1'))) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#000000" />
        <g fill="#FFFFFF" transform="translate(18, 22)">
          {/* BBC 3 boxes */}
          <rect x="0" y="0" width="18" height="18" fill="#FFF"/>
          <text x="9" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">B</text>
          <rect x="22" y="0" width="18" height="18" fill="#FFF"/>
          <text x="31" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">B</text>
          <rect x="44" y="0" width="18" height="18" fill="#FFF"/>
          <text x="53" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">C</text>
        </g>
        <text x="50" y="66" fill="#FFFFFF" fontSize="14" fontWeight="800" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">RADIO</text>
        <circle cx="50" cy="82" r="8" fill="#FF0000" />
        <text x="50" y="86" fill="#FFFFFF" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">1</text>
      </svg>
    )
  }

  // Capital FM
  if (name.includes('capital')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <rect x="14" y="24" width="72" height="18" rx="4" fill="#0B2341" />
        <text x="50" y="37" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">95-106</text>
        <text x="50" y="64" fill="#E61E2B" fontSize="17" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="-0.5">CAPITAL</text>
        <text x="50" y="80" fill="#0B2341" fontSize="14" fontWeight="800" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">FM</text>
      </svg>
    )
  }

  // Kiss FM
  if (name.includes('kiss')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <path d="M22,35 L38,50 L22,65" fill="#7B1FA2" />
        <text x="55" y="58" fill="#7B1FA2" fontSize="23" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">KISS</text>
      </svg>
    )
  }

  // Lagos Talks 91.3 FM
  if (name.includes('lagos talks') || (name.includes('lagos') && name.includes('talks'))) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <text x="50" y="34" fill="#D32F2F" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">LAGOS</text>
        <text x="50" y="50" fill="#0288D1" fontSize="14" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">TALKS</text>
        <rect x="18" y="58" width="64" height="22" rx="11" fill="#D32F2F" />
        <text x="50" y="73" fill="#FFFFFF" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">91.3 FM</text>
      </svg>
    )
  }

  // The Beat 99.9 FM
  if (name.includes('the beat') || name.includes('beat 99.9') || name.includes('beat fm')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <g transform="rotate(-3 50 50)">
          <rect x="14" y="14" width="72" height="72" rx="14" fill="#D32F2F" />
          <text x="50" y="36" fill="#FFFFFF" fontSize="13" fontWeight="700" textAnchor="middle" fontFamily="sans-serif" fontStyle="italic">the</text>
          <text x="50" y="56" fill="#000000" fontSize="21" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="-1">beat</text>
          <text x="50" y="76" fill="#FFFFFF" fontSize="14" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">99.9 FM</text>
        </g>
      </svg>
    )
  }

  // Cool FM 96.9
  if (name.includes('cool fm')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <text x="44" y="52" fill="#0288D1" fontSize="22" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif" letterSpacing="-1">cool</text>
        <circle cx="74" cy="45" r="9" fill="#E53935" />
        <text x="74" y="49" fill="#FFF" fontSize="8" fontWeight="800" textAnchor="middle" fontFamily="sans-serif">FM</text>
        <text x="50" y="76" fill="#37474F" fontSize="11" fontWeight="800" textAnchor="middle" fontFamily="sans-serif">96.9</text>
      </svg>
    )
  }

  // Wazobia FM
  if (name.includes('wazobia')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <circle cx="50" cy="50" r="34" fill="#E8F5E9" />
        <text x="50" y="50" fill="#2E7D32" fontSize="15" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif">Wazobia</text>
        <text x="50" y="68" fill="#FF8F00" fontSize="12" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">95.1 FM</text>
      </svg>
    )
  }

  // Naija FM
  if (name.includes('naija fm')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#FFFFFF" />
        <text x="50" y="48" fill="#1B5E20" fontSize="17" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">Naija FM</text>
        <rect x="26" y="58" width="48" height="16" rx="4" fill="#FF6D00" />
        <text x="50" y="70" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">102.7</text>
      </svg>
    )
  }

  // Soundcity
  if (name.includes('soundcity')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#111827" />
        <text x="50" y="45" fill="#EC4899" fontSize="12" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">SOUND</text>
        <text x="50" y="62" fill="#38BDF8" fontSize="14" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">CITY</text>
        <text x="50" y="78" fill="#FFFFFF" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="sans-serif">RADIO</text>
      </svg>
    )
  }

  // Nigeria Info 99.3 FM
  if (name.includes('nigeria info') || (name.includes('nigeria') && name.includes('info'))) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#0A3A20" />
        <text x="50" y="36" fill="#4ADE80" fontSize="12" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">NIGERIA</text>
        <text x="50" y="56" fill="#FFFFFF" fontSize="19" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">INFO</text>
        <rect x="22" y="66" width="56" height="18" rx="9" fill="#E11D48" />
        <text x="50" y="79" fill="#FFFFFF" fontSize="11" fontWeight="800" textAnchor="middle" fontFamily="sans-serif">99.3 FM</text>
      </svg>
    )
  }

  // Heart UK
  if (name.includes('heart')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#E11D48" />
        <path d="M50,30 C45,22 32,22 26,29 C20,36 21,46 27,53 L50,75 L73,53 C79,46 80,36 74,29 C68,22 55,22 50,30 Z" fill="#FFFFFF" opacity="0.22" />
        <text x="50" y="58" fill="#FFFFFF" fontSize="22" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif" letterSpacing="-0.5">heart</text>
      </svg>
    )
  }

  // LagosJump Radio
  if (name.includes('lagosjump') || name.includes('lagos jump')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#0F172A" />
        <circle cx="50" cy="50" r="38" fill="none" stroke="#FFC107" strokeWidth="2" strokeDasharray="4 3" />
        <text x="50" y="42" fill="#FFFFFF" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">LAGOS</text>
        <text x="50" y="62" fill="#FFC107" fontSize="17" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif">JUMP</text>
        <text x="50" y="78" fill="#38BDF8" fontSize="9" fontWeight="800" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">RADIO</text>
      </svg>
    )
  }

  // Metro FM Lagos
  if (name.includes('metro')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#1E1B4B" />
        <text x="50" y="46" fill="#38BDF8" fontSize="17" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">METRO</text>
        <rect x="22" y="56" width="56" height="20" rx="6" fill="#F59E0B" />
        <text x="50" y="70" fill="#0F172A" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">97.7 FM</text>
      </svg>
    )
  }

  // BBC World Service
  if (name.includes('bbc') && (name.includes('world') || name.includes('ws'))) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#000000" />
        <g fill="#FFFFFF" transform="translate(18, 20)">
          <rect x="0" y="0" width="18" height="18" fill="#FFF"/>
          <text x="9" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">B</text>
          <rect x="22" y="0" width="18" height="18" fill="#FFF"/>
          <text x="31" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">B</text>
          <rect x="44" y="0" width="18" height="18" fill="#FFF"/>
          <text x="53" y="14" fill="#000" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">C</text>
        </g>
        <rect x="12" y="50" width="76" height="20" rx="4" fill="#DC2626" />
        <text x="50" y="64" fill="#FFFFFF" fontSize="9" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">WORLD SERVICE</text>
      </svg>
    )
  }

  // RFI (Radio France Internationale)
  if (name.includes('rfi')) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect width="100" height="100" rx="16" fill="#E11D48" />
        <text x="50" y="64" fill="#FFFFFF" fontSize="32" fontWeight="900" fontStyle="italic" textAnchor="middle" fontFamily="sans-serif" letterSpacing="-1">rfi</text>
      </svg>
    )
  }

  // If station has favicon and no error, load image
  const favicon = station.favicon || station.favicon_url || station.logo
  if (favicon && !imgError) {
    return (
      <img
        src={favicon}
        alt={station.name}
        onError={() => setImgError(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 'inherit',
          display: 'block',
          background: '#0D1524',
        }}
        loading="lazy"
      />
    )
  }

  // Fallback
  return <FallbackStationLogo name={station.name} size={size} />
}
