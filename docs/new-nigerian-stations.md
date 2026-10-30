# New Nigerian station candidates for TRadio

Scraped from Radio Browser (`countrycode=NG`, ordered by votes) on 2026-10-30,
minus the stations TRadio already carries (Cool FM, Wazobia, Nigeria Info,
Beat FM, Naija FM, LagosJump, Metro FM). Every URL below was verified live
(HTTP 200, audio content-type) on 2026-10-30.

## Verified working — recommended adds

| Station | What it is | Codec | Stream URL | Votes |
|---|---|---|---|---|
| RFI Hausa | International news in Hausa | MP3 96k | `http://live02.rfi.fr/rfihaoussa-96k.mp3` | 4823 |
| Nigerian Gospel Music Radio | Gospel music | MP3 192k | `http://stream.zeno.fm/3fmqr74a7f8uv` | 2810 |
| Radio East | Music/talk, eastern Nigeria | MP3 128k | `http://stream.zeno.fm/7f4w4us5wp8uv` | 2095 |
| MajorFM | DJ mixes, hiphop, electro | MP3 128k | `http://stream.zeno.fm/pkza99xshkhvv` | 1907 |
| Splash FM 105.5 | Ibadan mainstream | MP3 | `https://edge.mixlr.com/channel/cfeki` | 1872 |
| Urban Radio Enugu | Enugu urban | MP3 | `https://edge.mixlr.com/channel/cfldr` | 1504 |
| Inform Me Radio | Business/family/farming talk | MP3 64k | `https://stream.zeno.fm/ta1fke6sz1zuv` | 1459 |
| Gospotainment Radio | Gospel + afrobeats | MP3 128k | `https://radio.gotright.net/radio/8000/radio.mp3` | 1146 |
| Nagari Radio | Hausa-focused | MP3 128k | `https://stream.zeno.fm/287z97ksdg8uv` | 1099 |
| Afrobeats Gospel Radio | Afrobeats + gospel | MP3 128k | `https://stream.zeno.fm/zyd9stmdlnlvv` | 972 |
| Yes FM 101.7 | Music | MP3 64k | `https://stream.zeno.fm/kqgbf9g3mfhvv` | 922 |
| RadioTiwa | Talk & speech | MP3 128k | `https://stream.zeno.fm/tvqvamkwe5zuv` | 809 |
| Adamimogo FM | Yoruba gospel/general | MP3 128k | `https://stream.zeno.fm/sywy4vua6zhvv` | 736 |
| Awoko Radio | African pop | MP3 128k | `http://node-05.zeno.fm/tqq99en94v8uv` | 677 |
| GanGan Radio | Traditional/African music | MP3 128k | `https://stream.zeno.fm/9reuhyz8up8uv` | 648 |
| Praiseworld Radio | Gospel | AAC 192k | `https://streaming.radio.co/s7dc18f0ad/listen` | 460 |
| Splash FM Abeokuta | Ogun state mainstream | MP3 128k | `https://stream.zeno.fm/m9x6zr5trp8uv` | 448 |
| Blast 98.3 FM | Music | AAC 128k | `https://stream.zeno.fm/94a8u4h2uhhvv` | 265 |
| Air Gospel | Gospel | MP3 128k | `https://stream.zeno.fm/qkgrhugy908uv` | 213 |
| Fresh 105.9 FM Ibadan | Ibadan music/news/Yoruba | AAC 128k | `https://stream.zeno.fm/e9x2n97b9uduv` | 128 |
| Trove Radio | Gospel/hiphop/jazz | MP3 128k | `https://stream.zeno.fm/c4ghegiwnkcvv` | 103 |
| Domi Radio | Abuja-based | AAC+ 128k | `https://domimedia.org/stream` | 79 |
| Softlife Afrofusion | Afro R&B/fusion | MP3 128k | `https://a10.asurahosting.com:7540/radio.mp3` | 63 |
| GoRadio ng | Afrobeats/gospel/highlife | MP3 192k | `https://online.goradio.com.ng/listen/gr/radio.mp3` | 40 |
| Vybz 94.5 FM | Music | MP3 128k | `https://mpc.my-control-panel.eu/stream/8138` | 32 |

## Notes

- **RFI Hausa** is technically a Niger/France-based Hausa service but has the
  highest vote count of any Nigeria-tagged station; include it if the app
  wants Hausa-language news.
- **Green Radio Uganda** and **HOD RADIO** appeared in the Nigeria tag but are
  not Nigerian stations (Uganda / diaspora). Excluded from the list above.
- Several high-vote entries were duplicates of each other (e.g. "Yes FM
  101.7" and "YES 101.7 FM" share one stream; "GoRadio" and "GoRadio ng"
  likewise). Deduplicated.
- Zeno.fm URLs redirect (302) to their CDN; browsers follow redirects
  automatically, so they work as-is in an `<audio>` element.
- Konga 103.7 FM's stream returned 404 — excluded.
- Genre fit for the Explore pills: Afrobeats → MajorFM, Softlife Afrofusion,
  GoRadio; Gospel → Nigerian Gospel Music Radio, Gospotainment, Praiseworld,
  Afrobeats Gospel, Air Gospel; News/Talk → RFI Hausa, RadioTiwa, Inform Me.
