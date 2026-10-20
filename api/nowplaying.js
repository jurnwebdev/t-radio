// Vercel Serverless Function — GET /api/nowplaying?url=<encoded stream url>
//
// Reads the ICY (Shoutcast/Icecast) metadata embedded in an internet radio
// stream and returns the current StreamTitle, split into artist + title.
//
// Why a server: the browser's <audio> element exposes no API for ICY
// metadata, and most station servers send no CORS headers, so fetch() from
// the client is blocked. A few KB are read per request and the connection is
// dropped immediately — this does NOT proxy or relay audio.
//
// Cache-Control lets Vercel's CDN absorb the traffic: 1,000 listeners on the
// same station produce ~1 upstream request per 25s, not 1,000.

const MAX_BYTES = 128 * 1024 // give up if no title within this much audio
const MAX_BLOCKS = 8 // metadata blocks to inspect (ads often leave them empty)
const TIMEOUT_MS = 8000
const USER_AGENT = 'TRadioNowPlaying/1.0 (+https://github.com/jurnwebdev/t-radio)'

/** Reject obviously internal targets (basic SSRF guard). */
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::') return true

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  }
  return false
}

/** Extract StreamTitle and split the common "Artist - Title" convention. */
function parseStreamTitle(text) {
  // StreamTitle values may contain apostrophes ("It Wasn't Me"), so a naive
  // '...' capture truncates. The field ends at a quote followed by ';' or EOS.
  const start = text.search(/StreamTitle\s*=\s*'/i)
  let raw = ''
  if (start !== -1) {
    const valueStart = text.indexOf("'", start) + 1
    const terminator = text.indexOf("';", valueStart)
    raw = terminator !== -1
      ? text.slice(valueStart, terminator)
      : text.slice(valueStart, text.lastIndexOf("'"))
  } else {
    const m = text.match(/StreamTitle\s*=\s*"([^"]*)"/i)
    if (!m) return null
    raw = m[1]
  }

  raw = raw
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .trim()
  if (!raw) return null

  let artist = ''
  let title = raw
  for (const sep of [' - ', ' – ', ' — ', ' | ']) {
    const idx = raw.indexOf(sep)
    if (idx > 0 && idx < raw.length - sep.length) {
      artist = raw.slice(0, idx).trim()
      title = raw.slice(idx + sep.length).trim()
      break
    }
  }
  if (!title) return null
  return { artist, title, raw }
}

/** Some stations put their own name in StreamTitle instead of a song. */
function isStationNamePlayholder(title, icyName, stationName) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const t = norm(title)
  if (!t) return false

  const liveStripped = t.replace(/live$/, '')
  const n = norm(icyName)
  const sn = norm(stationName)

  for (const ref of [n, sn]) {
    if (!ref) continue
    if (liveStripped === ref.replace(/live$/, '')) return true
    // "BBC World Service Online" vs "BBC Radio" — share a distinctive token.
    if (ref.length >= 3 && t.includes(ref)) return true
    if (ref.length >= 3 && ref.includes(liveStripped)) return true
  }

  // No reference name available: a bare "... Live" with no artist is a station ID.
  if (!n && !sn && /live$/.test(liveStripped)) return true
  return false
}

async function readIcyTitle(streamUrl, stationName) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let reader = null

  try {
    const res = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!res.ok || !res.body) {
      return { available: false, reason: `upstream http ${res.status}` }
    }

    const metaint = Number(res.headers.get('icy-metaint'))
    if (!Number.isFinite(metaint) || metaint <= 0) {
      return { available: false, reason: 'stream sends no icy metadata' }
    }
    const icyName = res.headers.get('icy-name') || ''

    reader = res.body.getReader()

    /** reader.read() with a hard deadline so a silent stream can't stall us. */
    const readWithDeadline = (ms) =>
      Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('read deadline'), { name: 'AbortError' })), ms),
        ),
      ])

    let audioLeft = metaint
    let needLen = true
    let metaLen = 0
    let metaChunks = []
    let metaRead = 0
    let blocks = 0
    let placeholders = 0
    let bytes = 0

    while (true) {
      const { value, done } = await readWithDeadline(placeholders > 0 ? 1200 : 5000)
      if (done) break

      bytes += value.length
      if (bytes > MAX_BYTES) return { available: false, reason: 'no title within budget' }

      let i = 0
      while (i < value.length) {
        if (audioLeft > 0) {
          const take = Math.min(audioLeft, value.length - i)
          audioLeft -= take
          i += take
          continue
        }

        if (needLen) {
          metaLen = value[i] * 16
          i += 1
          needLen = false
          metaChunks = []
          metaRead = 0
          if (metaLen === 0) {
            blocks += 1
            if (blocks >= MAX_BLOCKS) return { available: false, reason: 'no title in metadata' }
            needLen = true
            audioLeft = metaint
          }
          continue
        }

        const take = Math.min(metaLen - metaRead, value.length - i)
        metaChunks.push(value.subarray(i, i + take))
        metaRead += take
        i += take

        if (metaRead === metaLen) {
          const text = Buffer.concat(metaChunks.map((c) => Buffer.from(c)))
            .toString('utf8')
            .replace(/\u0000+$/g, '')
            .trim()
          const parsed = parseStreamTitle(text)
          if (parsed) {
            // Skip metadata that is really the station's own name, not a song.
            if (!isStationNamePlayholder(parsed.title, icyName, stationName)) {
              const { raw: _raw, ...clean } = parsed
              return { available: true, ...clean, source: 'icy' }
            }
            // Same placeholder 3 times in a row = this station just IDs itself.
            // Stop scanning so we don't burn the full timeout on every poll.
            placeholders += 1
            if (placeholders >= 3) {
              return { available: false, reason: 'no song titles, station identifiers only' }
            }
          }

          blocks += 1
          if (blocks >= MAX_BLOCKS) return { available: false, reason: 'no title in metadata' }
          needLen = true
          audioLeft = metaint
        }
      }
    }

    return { available: false, reason: 'stream ended before metadata' }
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError')
    return { available: false, reason: aborted ? 'upstream timeout' : 'upstream unreachable' }
  } finally {
    clearTimeout(timer)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        /* already closed */
      }
    }
  }
}

function send(res, status, body, cacheSeconds) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=60`)
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
    send(res, 400, { available: false, reason: 'bad request' }, 0)
    return
  }

  const stream = parsed.searchParams.get('url')
  if (!stream) {
    send(res, 400, { available: false, reason: 'missing url param' }, 0)
    return
  }

  let target
  try {
    target = new URL(stream)
  } catch {
    send(res, 400, { available: false, reason: 'invalid url' }, 0)
    return
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    send(res, 400, { available: false, reason: 'unsupported protocol' }, 0)
    return
  }

  if (isBlockedHost(target.hostname)) {
    send(res, 400, { available: false, reason: 'host not allowed' }, 0)
    return
  }

  if (req.method === 'HEAD') {
    send(res, 200, { available: false, reason: 'head' }, 0)
    return
  }

  const result = await readIcyTitle(target.toString(), parsed.searchParams.get('name') || '')
  send(res, 200, result, result.available ? 25 : 60)
}
