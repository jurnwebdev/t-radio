import './RadarSweep.css'

export function RadarSweep({ className = '', label = 'Loading…' }) {
  return (
    <div className={`rs-overlay ${className}`} role="status" aria-label={label}>
      <div className="rs-radar">
        {/* Rotating white sweep (conic gradient) */}
        <div className="rs-sweep" />

        {/* Concentric rings */}
        <div className="rs-ring rs-ring-outer" />
        <div className="rs-ring rs-ring-middle" />
        <div className="rs-ring rs-ring-inner" />

        {/* Crosshair ticks */}
        <span className="rs-tick rs-tick-n" />
        <span className="rs-tick rs-tick-e" />
        <span className="rs-tick rs-tick-s" />
        <span className="rs-tick rs-tick-w" />

        {/* Center dot */}
        <div className="rs-center" />
      </div>

      <span className="rs-label">{label}</span>
    </div>
  )
}
