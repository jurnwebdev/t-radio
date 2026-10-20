/* ----------------------------------------------------------------
 * stationSlug — friendly, URL-safe identifiers for stations.
 *
 * A shared link looks like:
 *   https://t-radio.app/?station=cool-fm-96-9
 *
 * The slug is derived from the station name so it stays short and
 * readable ("cool-fm-96-9" instead of a 32-char uuid or a stream URL).
 * The Radio Browser uuid is used as a fallback and is still accepted
 * when resolving, so older/hand-made links keep working.
 * ---------------------------------------------------------------- */

/** Lowercase, hyphenated, ASCII-only. */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: "Café" -> "cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Base slug for a station: its name, e.g. "Cool FM 96.9" -> "cool-fm-96-9". */
export function stationSlug(station) {
  if (!station) return ''
  return slugify(station.name) || slugify(station.stationuuid)
}

/* Two-letter codes for the countries a station is likely to be in.
 * Keeps a disambiguated slug short: "capital-fm-gb", not
 * "capital-fm-united-kingdom". Unknown countries fall back to their
 * full slug. */
const COUNTRY_CODES = {
  nigeria: 'ng',
  'united-kingdom': 'gb',
  uk: 'gb',
  'united-states': 'us',
  usa: 'us',
  france: 'fr',
  germany: 'de',
  ireland: 'ie',
  spain: 'es',
  italy: 'it',
  'south-africa': 'za',
  ghana: 'gh',
  kenya: 'ke',
  uganda: 'ug',
  tanzania: 'tz',
  zimbabwe: 'zw',
  zambia: 'zm',
  jamaica: 'jm',
  canada: 'ca',
  australia: 'au',
  'new-zealand': 'nz',
  brazil: 'br',
  india: 'in',
  'sri-lanka': 'lk',
  portugal: 'pt',
  netherlands: 'nl',
  belgium: 'be',
  switzerland: 'ch',
  austria: 'at',
  sweden: 'se',
  norway: 'no',
  denmark: 'dk',
  finland: 'fi',
  poland: 'pl',
  turkey: 'tr',
  egypt: 'eg',
  morocco: 'ma',
  algeria: 'dz',
  tunisia: 'tn',
  senegal: 'sn',
  'cote-divoire': 'ci',
  cameroon: 'cm',
  ethiopia: 'et',
  rwanda: 'rw',
  namibia: 'na',
  botswana: 'bw',
  mozambique: 'mz',
  angola: 'ao',
  'czech-republic': 'cz',
  greece: 'gr',
  hungary: 'hu',
  romania: 'ro',
  bulgaria: 'bg',
  ukraine: 'ua',
  israel: 'il',
  lebanon: 'lb',
  jordan: 'jo',
  'saudi-arabia': 'sa',
  uae: 'ae',
  qatar: 'qa',
  kuwait: 'kw',
  oman: 'om',
  cyprus: 'cy',
  iceland: 'is',
  malta: 'mt',
  croatia: 'hr',
  serbia: 'rs',
  slovenia: 'si',
  slovakia: 'sk',
  lithuania: 'lt',
  latvia: 'lv',
  estonia: 'ee',
  china: 'cn',
  japan: 'jp',
  'south-korea': 'kr',
  philippines: 'ph',
  indonesia: 'id',
  malaysia: 'my',
  singapore: 'sg',
  thailand: 'th',
  vietnam: 'vn',
  pakistan: 'pk',
  bangladesh: 'bd',
  mexico: 'mx',
  argentina: 'ar',
  chile: 'cl',
  colombia: 'co',
  peru: 'pe',
  venezuela: 've',
  cuba: 'cu',
  haiti: 'ht',
  'dominican-republic': 'do',
  'trinidad-and-tobago': 'tt',
}

/** Short, URL-safe country tag used to disambiguate duplicate names. */
export function countrySlug(country) {
  const c = slugify(country)
  if (!c) return ''
  return COUNTRY_CODES[c] || c
}

/**
 * Slug for `station` that identifies it within `pool`.
 *
 * Names repeat across countries ("Capital FM" in Lagos and in London),
 * so a name that maps to more than one distinct stream gets the country
 * appended: "capital-fm-nigeria".
 */
export function uniqueStationSlug(station, pool = []) {
  const base = stationSlug(station)
  if (!base) return ''

  const streams = new Set()
  for (const st of pool || []) {
    if (stationSlug(st) !== base) continue
    streams.add(st.url || st.url_resolved || '')
  }
  if (streams.size <= 1) return base

  const country = countrySlug(station.country || '')
  return country ? `${base}-${country}` : base
}

/**
 * Find the station a `?station=` value points at.
 * Accepts the friendly slug, the country-suffixed slug, or a raw uuid.
 */
export function findStationBySlug(slug, list = []) {
  const s = String(slug || '').trim().toLowerCase()
  if (!s) return null

  const byUuid = list.find((st) => String(st.stationuuid || '').toLowerCase() === s)
  if (byUuid) return byUuid

  const byCountry = list.find((st) => {
    const country = countrySlug(st.country || '')
    return country && `${stationSlug(st)}-${country}` === s
  })
  if (byCountry) return byCountry

  return list.find((st) => stationSlug(st) === s) || null
}

/** The shareable deep link for a station. */
export function buildShareUrl(station, pool = [], origin = '') {
  const base = String(
    origin || (typeof window !== 'undefined' ? window.location.origin : ''),
  ).replace(/\/+$/, '')
  const slug = uniqueStationSlug(station, pool)
  if (!base || !slug) return base
  return `${base}/?station=${encodeURIComponent(slug)}`
}
