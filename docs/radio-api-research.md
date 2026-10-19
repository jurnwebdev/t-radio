# Nigerian Online Radio — API Research (verified live on 2026-10-19)

## Recommendation: Radio Browser API (free, open source, no API key)

The community directory at radio-browser.info has a fully free REST API with Nigerian
stations. Everything below was tested live with `curl` and returned valid data.

### Base URLs

```
https://all.api.radio-browser.info   # round-robins over all healthy servers (recommended)
https://de1.radio-browser.info       # ⚠️ DELETED — returns NXDOMAIN as of Oct 2026
https://nl1.radio-browser.info       # ⚠️ DELETED — returns NXDOMAIN as of Oct 2026
```

Docs: https://api.radio-browser.info/ — always send a descriptive `User-Agent` header
(the project asks for one identifying your app, e.g. `MyNaijaRadio/1.0`).

### Verified capabilities

- **CORS: `access-control-allow-origin: *`** — safe to call directly from a browser / Next.js client.
- **No authentication, no rate limit documented** (be a good citizen: cache, don't poll).
- Dataset: ~62k stations globally, ~240 countries (live `/json/stats`).

## Key endpoints

### 1. Search stations (the main one)

```bash
curl "https://all.api.radio-browser.info/json/stations/search?countrycode=NG&limit=20&hidebroken=true&order=clickcount&reverse=true" \
  -H "User-Agent: MyNaijaRadio/1.0"
```

Useful parameters (all optional, combinable):

| Param | Meaning |
|---|---|
| `countrycode=NG` | Nigeria (exact ISO code; `country` is deprecated) |
| `tag=afrobeats` / `tagList=afrobeats,gospel` | filter by genre tag |
| `name=cool` | name contains (quoted with `"cool fm"` = exact phrase) |
| `language=yoruba` / `igbo` / `hausa` | local-language stations |
| `has_geo_info=true` | stations with lat/lon |
| `order=clickcount\|votes\|name\|bitrate\|lastcheckok&reverse=true` | sorting |
| `limit` + `offset` | pagination (offset-based) |
| `hidebroken=true` | only stations that passed the last server check |
| `is_https=true` | **important**: HTTPS streams only, avoids mixed-content on your site |

Returns JSON station objects. Important fields:
`stationuuid`, `name`, `url_resolved` (use THIS for playback), `url`, `codec`,
`bitrate`, `tags`, `votes`, `clickcount`, `favicon`, `homepage`, `lastcheckok`,
`lastchecktime`, `languageroots`.

### 2. Report a play (keeps popularity fresh)

Call once per user play — the station's click counter feeds `order=clickcount`:

```bash
curl "https://all.api.radio-browser.info/json/url/{stationuuid}" \
  -H "User-Agent: MyNaijaRadio/1.0"    # verified: HTTP 200
```

### 3. Vote for a station (one vote/day per IP+station)

```bash
curl "https://all.api.radio-browser.info/json/vote/{stationuuid}" -H "User-Agent: MyNaijaRadio/1.0"
```

### 4. Browse helpers

```bash
curl "https://all.api.radio-browser.info/json/tags?order=countries&hidebroken=true"      # genres
curl "https://all.api.radio-browser.info/json/languages?order=stationcount&hidebroken=true" # languages
curl "https://all.api.radio-browser.info/json/countries"                                  # country counts
```

## Sample of real Nigerian stations (top by clicks, live query)

| Station | Stream URL | Codec | Tags |
|---|---|---|---|
| Cool FM: Lagos | `https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969` | MP3 128k | — |
| LagosJump Radio | `https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3` | MP3 192k | afrobeats |
| Wazobia FM: Lagos | `https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951` | MP3 128k | — |
| Nigerian Gospel Music Radio | `http://stream.zeno.fm/3fmqr74a7f8uv` | MP3 192k | christian, gospel |
| Konga 103.7 FM | `https://lunar.citrus3.com:8124/stream` | MP3 96k | business, hits |
| MajorFM | `http://stream.zeno.fm/pkza99xshkhvv` | MP3 128k | hiphop, jazz, r&b |
| GoRadio ng | `https://online.goradio.com.ng/listen/gr/radio.mp3` | MP3 192k | afrobeat, highlife, rnb |
| Nigeria Info (Lagos) | `https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993` | MP3 128k | — |
| Bond 92.9 FM | `https://go.webgateready.com/bondfm` | MP3 64k | — |
| METRO FM Lagos | `https://go.webgateready.com/metrofm/radio.mp3` | MP3 64k | — |
| Air Radio | `https://stream.zeno.fm/xu7hp12tzv8uv` | MP3 128k | — |
| Air Gospel | `https://stream.zeno.fm/qkgrhugy908uv` | MP3 128k | — |
| Metro 97.7 FM | `https://go.webgateready.com/metrofm` | MP3 64k | — |
| Fresh 105.9 FM Ibadan | `https://stream.zenolive.com/e9x2n97b9uduv` | AAC 128k | ibadan, news, yoruba |
| Afrofusion Gospel Radio | `https://a10.asurahosting.com:7120/radio.mp3` | MP3 128k | afrobeats, gospel |
| Afrobeats Gospel Radio | `https://stream.zeno.fm/zyd9stmdlnlvv` | MP3 128k | afrobeats, gospel |
| Adamimogo FM | `http://stream.zeno.fm/sywy4vua6zhvv` | MP3 128k | — |

Query used: `/json/stations/search?countrycode=NG&limit=20&hidebroken=true&order=clickcount&reverse=true`

## Gotchas found during testing

1. **Old mirror hostnames are dead.** `de1`/`nl1`/`at1` `.radio-browser.info` no longer resolve
   (NXDOMAIN verified). Use `all.api.radio-browser.info`.
2. **Mixed content:** many streams are plain `http://` (Zeno.fm ones above). Browsers block
   these on HTTPS pages. Filter with `is_https=true`, or proxy through your server.
3. **Coverage gaps:** the directory is community-maintained, so big brands like Beat 99.9 FM,
   BBC Pidgin etc. may be missing or stale. Streams sometimes change hosts — always play
   `url_resolved`, and keep a `lastcheckok`-ordered fallback.
4. **Duplicates:** same station appears under several entries (see Konga/Metro above).
   Dedupe by normalized name + homepage in your app.
5. Playback itself is just an `<audio src>`/HLS stream — the API only supplies URLs,
   it does not proxy audio.

## Alternatives considered

- **RapidAPI "50K Radio Stations"** — paid quota, dominates with the same data as Radio Browser. Not worth it.
- **Zeno.fm** — hosts many of the streams above but has no public station-directory API for developers.
- **Shoutcast/icecast public directories (`yp.shoutcast.com`)** — free XML/JSON directory, but mostly international and allows NG filtering only by genre scrambles. Weak for Nigeria.
- **Manual list of FM stations' own stream URLs** — most reliable for flagship stations, but you maintain it. Can be merged with Radio Browser later.
