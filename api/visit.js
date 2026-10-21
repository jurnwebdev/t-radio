// Vercel Serverless Function — GET /api/visit?id=<visitorId>
//
// Records the time a device visited and geolocates it by IP (country +
// city), so the owner dashboard can show *when* and *where* visits
// happened. The caller (useStatsTracker) writes the result to Firebase
// RTDB — this function has no Firebase SDK and stores nothing itself.
//
// Why server-side: the browser does not know its own public IP, and a
// client-side geo lookup would leak the IP to a third party on every
// visit. Here the IP is seen only inside Vercel's network.
//
// Cost control:
//   - one geolocation lookup per IP per UTC day — the cache below is
//     in-memory and shared across all requests in a function instance.
//   - the response is CDN-cached (s-maxage=300), so repeated requests
//     within 5 minutes cost nothing.
//
// ipwho.is: free, no API key, 1,000 req/s + 100k requests/month.
// We use far less: ~one request per day per IP.

const GEO_TIMEOUT_MS = 5000
const CACHE_SECONDS = 300
const EMPTY_GEO = { country: '', countryCode: '', city: '', region: '', continent: '' }

/* ip_day → geo result. Bounded by the 2-day pruning pass below. */
const geoCache = new Map()

/** Resolve a country/city for an IP, caching per (ip, UTC day). */
async function geoForIp(ip) {
  const day = new Date().toISOString().slice(0, 10)
  const key = ip + '_' + day
  const cached = geoCache.get(key)
  if (cached) return cached

  let result
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS)
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)
    if (res.ok) {
      const body = await res.json()
      if (body && body.success) {
        result = {
          ...EMPTY_GEO,
          country: body.country || '',
          countryCode: (body.country_code || '').toUpperCase(),
          city: body.city || '',
          region: body.region || '',
          continent: body.continent || '',
        }
      } else {
        result = { ...EMPTY_GEO }
      }
    } else {
      result = { ...EMPTY_GEO }
    }
  } catch {
    /* geolocation is best-effort: the visit still records a timestamp */
    result = { ...EMPTY_GEO }
  }

  // Bound the cache: prune entries from before 2 days ago; worst case, clear.
  if (geoCache.size > 5000) {
    const cutoffDay = new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10)
    for (const [k, v] of geoCache) {
      if (!v || !v.day || v.day < cutoffDay) geoCache.delete(k)
    }
    if (geoCache.size > 5000) geoCache.clear()
  }
  geoCache.set(key, { ...result, day })
  return result
}

function send(res, status, body, cacheSeconds) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${cacheSeconds}, max-age=0, must-revalidate`,
  )
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end()
    return
  }

  let parsed
  try {
    parsed = new URL(req.originalUrl || req.url || '/', 'http://localhost')
  } catch {
    send(res, 400, { ok: false, reason: 'bad request' }, 0)
    return
  }

  const visitorId = parsed.searchParams.get('id') || ''
  if (!visitorId) {
    send(res, 400, { ok: false, reason: 'missing id param' }, 0)
    return
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.headers['cf-connecting-ip'] || '').trim() ||
    (req.socket && req.socket.remoteAddress) ||
    ''

  const geo = await geoForIp(ip)
  const result = {
    ok: true,
    ts: Date.now(),
    visitorId,
    ...geo,
    geoSource: ip ? 'ip' : 'none',
  }
  send(res, 200, result, CACHE_SECONDS)
}
