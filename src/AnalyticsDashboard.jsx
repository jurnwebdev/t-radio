// tradio-pwa/src/AnalyticsDashboard.jsx
// T-Radio owner dashboard — live KPIs, channel rankings, daily trend.
//
// Data sources (all first-party RTDB, no polling — onValue streams):
//   listeners/active          → who is listening right now, per station
//   listeners/stats/*         → plays, visitors, per-station counters, daily buckets
//
// The screen is deliberately compact: it sits in the same 440px phone frame
// as the app so it looks native in the PWA and stays usable at 375px.

import { useEffect, useMemo, useState } from 'react'
import {
  useActiveCount,
  useListenersByStation,
  useStatsCounters,
  useDailySeries,
  useLastActiveByStation,
} from './useAnalyticsStats'
import './AnalyticsDashboard.css'

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All-time' },
]

const TREND_DAYS = 14

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '0'
  return n.toLocaleString('en-US')
}

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortDate(d) {
  // d = YYYY-MM-DD (UTC) → "Oct 07"
  const dt = new Date(d + 'T00:00:00Z')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/* ---------- SVG area chart (hand-rolled, no libs) ---------- */
function TrendChart({ series, range }) {
  const data = useMemo(() => {
    if (!series) return []
    if (range === 'today') return []
    const days = range === '7d' ? 7 : 30
    return series.slice(-days)
  }, [series, range])

  if (!data.length) {
    return (
      <div className="dash-empty" data-testid="trend-empty">
        {range === 'today' ? 'Trend shows at least 2 days — pick 7d or 30d.' : 'No plays recorded yet.'}
      </div>
    )
  }

  const W = 392
  const H = 116
  const PAD = { l: 6, r: 6, t: 14, b: 18 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const max = Math.max(1, ...data.map((d) => d.playsTotal))
  const step = data.length > 1 ? innerW / (data.length - 1) : 0

  const pts = data.map((d, i) => {
    const x = PAD.l + i * step
    const y = PAD.t + innerH - (d.playsTotal / max) * innerH
    return { x, y, d, i }
  })

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${(PAD.l + (data.length - 1) * step).toFixed(1)},${(PAD.t + innerH).toFixed(1)} L${PAD.l},${(PAD.t + innerH).toFixed(1)} Z`

  // X labels: first, middle, last (avoid crowding at 375px)
  const labelIdx = data.length <= 7
    ? data.map((_, i) => i)
    : [0, Math.floor((data.length - 1) / 2), data.length - 1]

  const hover = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round((px - PAD.l) / (step || 1))
    const clamped = Math.max(0, Math.min(data.length - 1, i))
    svg.dataset.active = clamped
    const el = svg.querySelector('[data-tip]')
    if (el) el.setAttribute('data-tip', data[clamped].date)
  }

  return (
    <div className="dash-trend">
      <svg
        className="dash-trend-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily plays, last ${data.length} days`}
        onMouseMove={hover}
        onMouseLeave={(e) => delete e.currentTarget.dataset.active}
      >
        <defs>
          <linearGradient id="dashTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* horizontal gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + innerH * (1 - f)}
            y2={PAD.t + innerH * (1 - f)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}

        <path d={area} fill="url(#dashTrendFill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* data points */}
        {pts.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r="2.4" fill="var(--accent)" />
        ))}

        {/* x labels */}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={pts[i].x}
            y={H - 4}
            fontSize="9"
            fill="var(--sub)"
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          >
            {shortDate(data[i].date)}
          </text>
        ))}
      </svg>
      <div className="dash-trend-meta">
        <span>{shortDate(data[0].date)} → {shortDate(data[data.length - 1].date)}</span>
        <span className="dash-trend-total">{fmt(data.reduce((s, d) => s + d.playsTotal, 0))} plays</span>
      </div>
    </div>
  )
}

/* ---------- Horizontal bar row ---------- */
function BarRow({ rank, name, value, max, sub, live = false }) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, (value / max) * 100) : 0
  return (
    <div className={`dash-bar-row${value > 0 ? '' : ' zero'}`}>
      <span className="dash-bar-rank">{rank}</span>
      <div className="dash-bar-labels">
        <span className="dash-bar-name" title={name}>{name}</span>
        {sub && <span className="dash-bar-sub">{sub}</span>}
      </div>
      <div className="dash-bar-track">
        <div
          className={`dash-bar-fill${live ? ' live' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="dash-bar-value">{fmt(value)}</span>
    </div>
  )
}

export default function AnalyticsDashboard({ onBack }) {
  const [range, setRange] = useState('7d')

  /* The dashboard replaces HomeScreen, so the theme attribute on <html>
     may not be set yet when this lazy screen mounts. Apply the saved
     theme to keep the dashboard matching the radio's dark/light mode. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tradio.theme')
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved)
      }
    } catch {}
  }, [])

  const activeNow = useActiveCount()
  const byStation = useListenersByStation()
  const stats = useStatsCounters() // { playsTotal, visitorsTotal, plays, stationMeta, daily?, ... }
  const daily = useDailySeries(TREND_DAYS)
  const lastActive = useLastActiveByStation()

  const ready = stats !== null
  const totalPlays = stats?.playsTotal || 0
  const totalVisitors = stats?.visitorsTotal || 0
  const today = daily?.[daily.length - 1]

  /* ---- derive KPI values per range ---- */
  const rangeVisitors = range === 'today' ? (today?.visitors || 0) : totalVisitors
  const rangePlays = useMemo(() => {
    if (range === 'today') return totalPlays
    if (!daily) return totalPlays
    const days = range === '7d' ? 7 : 30
    // daily series only covers TREND_DAYS; "all" falls back to total
    const slice = daily.slice(-days)
    const fromDaily = slice.reduce((s, d) => s + (d.playsTotal || 0), 0)
    return fromDaily || totalPlays
  }, [range, daily, totalPlays])

  /* ---- top channels ---- */
  const topChannels = useMemo(() => {
    if (!stats?.plays) return []
    const plays = stats.plays
    const meta = stats.stationMeta || {}
    const rows = Object.keys(plays).map((sid) => ({
      id: sid,
      name: meta[sid]?.name || sid,
      value: plays[sid] || 0,
      live: (byStation[sid] || 0) > 0,
      liveCount: byStation[sid] || 0,
      lastActive: lastActive[sid],
    }))
    rows.sort((a, b) => b.value - a.value)
    return rows.slice(0, 10)
  }, [stats, byStation, lastActive])

  /* Plays within the selected range (today/7d/30d from daily buckets;
     "All-time" uses the global total). */
  const rangeTopChannels = useMemo(() => {
    if (range === 'all' || !daily) return topChannels
    const days = range === '7d' ? 7 : 30
    const slice = daily.slice(-days)
    const dailyByStation = {}
    for (const d of slice) {
      for (const [sid, n] of Object.entries(d.plays || {})) {
        dailyByStation[sid] = (dailyByStation[sid] || 0) + (n || 0)
      }
    }
    if (!Object.keys(dailyByStation).length) return []
    return Object.keys(dailyByStation)
      .map((sid) => ({
        id: sid,
        name: stats.stationMeta?.[sid]?.name || sid,
        value: dailyByStation[sid],
        live: (byStation[sid] || 0) > 0,
        liveCount: byStation[sid] || 0,
        lastActive: lastActive[sid],
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [range, daily, topChannels, stats, byStation, lastActive])

  const rangeTopChannel = rangeTopChannels[0]
  const rangeTopMax = rangeTopChannel?.value || 1

  /* Total plays within the selected range (for share %). */
  const rangeTotalPlays =
    range === 'all' || !daily
      ? totalPlays
      : daily.slice(-(range === '7d' ? 7 : 30)).reduce((s, d) => s + (d.playsTotal || 0), 0)

  /* ---- live listeners now ---- */
  const liveNowRows = useMemo(() => {
    const meta = stats?.stationMeta || {}
    const rows = Object.keys(byStation)
      .map((sid) => ({
        id: sid,
        name: meta[sid]?.name || sid,
        value: byStation[sid],
      }))
      .sort((a, b) => b.value - a.value)
    return rows.slice(0, 8)
  }, [byStation, stats])

  const liveNowMax = liveNowRows[0]?.value || 0

  return (
    <div className="dash-screen">
      {/* ---- Header ---- */}
      <header className="dash-header">
        <button className="dash-back" onClick={onBack} aria-label="Back to the radio">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Radio
        </button>
        <div className="dash-title">
          <h1>T-Radio · Analytics</h1>
          <p>Live owner dashboard</p>
        </div>
        <span className={`dash-live-dot${activeNow > 0 ? ' on' : ''}`} title="Listening now">
          <i />
          {activeNow}
        </span>
      </header>

      <div className="dash-scroll">
        {/* ---- Range toggle ---- */}
        <div className="dash-ranges" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              className={`dash-range${range === r.id ? ' active' : ''}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {!ready ? (
          <div className="dash-skeletons" aria-busy="true">
            <div className="dash-kpi-grid">
              {[...Array(5)].map((_, i) => <div key={i} className="dash-kpi-skel" />)}
            </div>
            <div className="dash-card-skel" />
            <div className="dash-card-skel" />
          </div>
        ) : (
          <>
            {/* ---- KPI cards ---- */}
            <section className="dash-kpis" aria-label="Key metrics">
              <article className="dash-kpi">
                <span className="dash-kpi-label">Listening now</span>
                <span className="dash-kpi-value accent">{fmt(activeNow)}</span>
                <span className="dash-kpi-foot">across all channels</span>
              </article>
              <article className="dash-kpi">
                <span className="dash-kpi-label">{range === 'today' ? 'Visitors today' : 'Visitors'}</span>
                <span className="dash-kpi-value">{fmt(rangeVisitors)}</span>
                <span className="dash-kpi-foot">unique devices</span>
              </article>
              <article className="dash-kpi">
                <span className="dash-kpi-label">{range === 'all' ? 'Total plays' : `Plays (${range})`}</span>
                <span className="dash-kpi-value">{fmt(range === 'all' ? totalPlays : rangePlays)}</span>
                <span className="dash-kpi-foot">station starts</span>
              </article>
              <article className="dash-kpi wide">
                <span className="dash-kpi-label">Most listened {range === 'all' ? 'channel' : 'channel · ' + RANGES.find((r) => r.id === range).label.toLowerCase()}</span>
                <span className="dash-kpi-top" title={rangeTopChannel?.name || '—'}>
                  {rangeTopChannel?.name || (rangeTotalPlays ? '—' : 'No plays yet')}
                </span>
                {rangeTopChannel && (
                  <span className="dash-kpi-foot">
                    {fmt(rangeTopChannel.value)} plays · {rangeTotalPlays ? Math.round((rangeTopChannel.value / rangeTotalPlays) * 100) : 0}% of {range === 'all' ? 'all-time' : range}
                  </span>
                )}
              </article>
            </section>

            {/* ---- Live listeners by station ---- */}
            <section className="dash-card" aria-label="Listeners by station">
              <h2 className="dash-card-title">Listening by station <span className="dash-live-tag">LIVE</span></h2>
              {liveNowRows.length === 0 ? (
                <p className="dash-empty">Nobody is listening right now.</p>
              ) : (
                <div className="dash-bars">
                  {liveNowRows.map((row, i) => (
                    <BarRow key={row.id} rank={i + 1} name={row.name} value={row.value} max={liveNowMax} live sub={`${row.value} tab${row.value === 1 ? '' : 's'}`} />
                  ))}
                </div>
              )}
            </section>

            {/* ---- Top channels (range) ---- */}
            <section className="dash-card" aria-label="Top channels">
              <h2 className="dash-card-title">
                Top channels {range === 'all' ? '(all-time)' : `(${RANGES.find((r) => r.id === range)?.label.toLowerCase()})`}
              </h2>
              {rangeTopChannels.length === 0 ? (
                <p className="dash-empty">No plays yet — start a station in the radio tab.</p>
              ) : (
                <div className="dash-bars">
                  {rangeTopChannels.map((row, i) => (
                    <BarRow
                      key={row.id}
                      rank={i + 1}
                      name={row.name}
                      value={row.value}
                      max={rangeTopMax}
                      sub={row.live ? `● ${row.liveCount} listening` : lastActive[row.id] ? `last ${timeAgo(lastActive[row.id])}` : undefined}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ---- Daily trend ---- */}
            <section className="dash-card" aria-label="Plays trend">
              <h2 className="dash-card-title">Plays · last {range === '7d' ? 7 : 30} days</h2>
              <TrendChart series={daily} range={range} />
            </section>

            {/* ---- Station table ---- */}
            <section className="dash-card" aria-label="Station table">
              <h2 className="dash-card-title">All stations</h2>
              {rangeTopChannels.length === 0 ? (
                <p className="dash-empty">No data yet.</p>
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th>Plays</th>
                      <th>Share</th>
                      <th>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangeTopChannels.map((row) => (
                      <tr key={row.id}>
                        <td className="dash-table-name" title={row.id}>{row.name}</td>
                        <td>{fmt(row.value)}</td>
                        <td>{rangeTotalPlays ? Math.round((row.value / rangeTotalPlays) * 100) : 0}%</td>
                        <td className="dash-table-last">{lastActive[row.id] ? timeAgo(lastActive[row.id]) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <p className="dash-footnote">
              First-party counters — ad blockers and offline use cause some
              undercounting. "Visitors" are unique devices (localStorage), not
              GA4 users. Data lives in <code>listeners/stats</code> (the
              top-level <code>stats</code> tree is locked by RTDB rules).
            </p>
          </>
        )}
      </div>
    </div>
  )
}
