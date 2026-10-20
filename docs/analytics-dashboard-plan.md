# T-Radio Analytics Dashboard — Build Plan (living document)

> **Status:** 🟡 Planning complete — awaiting go-ahead on decisions (§2)
> **Created:** 2026-10-20
> **Last updated:** 2026-10-20
> **Owner:** —

## Progress at a glance

| Phase | Status |
|---|---|
| 1. Data layer | ⬜ not started |
| 2. Dashboard UI | ⬜ not started |
| 3. Security | ⬜ not started |
| 4. Deploy + verify | ⬜ not started |
| 5. Polish / hardening | 🟨 1 of 6 done (presence tracking pre-existed) |

This file is the single source of truth for the analytics dashboard build.
**Any agent continuing this work must:**
1. Read §1 (current state) and §2 (decisions) first.
2. Tick checkboxes as work completes — do not delete them.
3. Update the "Progress at a glance" table above.
4. Append a dated entry to §9 (Handoff log) describing what changed and what's next.

---

## 1. Current state of the codebase (as of 2026-10-20)

Verified by reading the source, not assumed.

| Fact | Detail |
|---|---|
| Stack | Vite 8 + React 19, plain JSX (no TypeScript) |
| Routing | **None.** `src/App.jsx` renders `<HomeScreen />` directly |
| Firebase SDK | `firebase` v13 |
| Firebase config | `src/firebase.js`, reads `import.meta.env.VITE_FIREBASE_*` |
| Secrets | `.env` is gitignored and never committed (verified against full git history) |
| Deploy config | **None found** — no `vercel.json`, `netlify.toml`, or `firebase.json` |
| Lint | `npm run lint` (oxlint) |
| Build | `npm run build` (vite) |
| Existing analytics | GA4 via `logAppEvent()` in `src/firebase.js` |
| Existing counters | **Presence-based** `listeners/active/{sessionId}` in RTDB (see below) |
| Station count | 55 hardcoded (curated + explore lists) + up to 150 from Radio Browser API |

### Existing listener tracking — how it works today

`src/useListenerCount.js` was **already migrated to presence** (see §9, 2026-10-20).
The old `+1 / -1` counters (`listeners/total`, `listeners/{stationId}`) are **no
longer written** — do not read them, they are stale/dead data.

Current schema:

```
listeners/active/{sessionId} = { stationId, updatedAt }
```

- `sessionId` is a per-tab UUID (`crypto.randomUUID()`).
- `trackPlay(stationId)` writes the session record and arms `onDisconnect().remove()`.
- `trackStop()` debounces 120 ms, cancels `onDisconnect`, then removes the record.
- On `.info/connected` reconnect it re-arms presence.
- `beforeunload` also removes the record.

Exports:

- `useSessionListener()` → `{ count, trackPlay, trackStop }`.
  `count` = `Object.keys(listeners/active).length`.
- `useStationListener(stationId)` → `{ count }`, computed by scanning
  `listeners/active` and counting records whose `stationId` matches.
  It also writes into `[data-station-listener-count]` DOM nodes.
  Currently **unused** by the UI (global count replaced it).

### Implications for the dashboard

- "Active per channel" must be **derived by scanning** `listeners/active`
  and grouping by `stationId` — there is no per-station counter any more.
- The dashboard needs **read access to `listeners/active`**, which contains
  a session id and station id only (no PII). Keep it that way.
- Scanning is fine at this scale (tens to low thousands of sessions).
  If it ever grows, add a server-side aggregation or Cloud Function.

### Known bug still open

`src/useListenerCount.js` imports `useRef` but no longer uses it (lint warning).
Harmless, but clean it up when touching the file.

---

## 2. Decisions

### Confirmed by user
_None yet._

### Pending — recommended defaults in bold

| # | Decision | Options | Recommendation | Status |
|---|---|---|---|---|
| D1 | Deploy target | Vercel / Netlify / Firebase Hosting / local only | **Vercel** | ⬜ pending |
| D2 | Dashboard auth | Firebase Auth / Vercel password / client-side password / local only | **Firebase Auth (email+password)** | ⬜ pending |
| D3 | Date ranges | Today / 7d / 30d / all-time | **All four** | ⬜ pending |
| D4 | GA4 integration | First-party RTDB only / also GA4 Data API | **RTDB only** (GA4 needs a server + service account) | ⬜ pending |
| D5 | Data retention | Forever / prune after 90 days | **Prune daily buckets after 90 days** | ⬜ pending |

> **Next agent:** if the user says "go with defaults", mark D1–D5 as
> `✅ confirmed` with the recommended value and begin Phase 1.

### Blocking prerequisite

- ⬜ **Verify RTDB security rules.** If the project is still on Firebase *test mode*,
  those rules expired ~30 days after creation and **all tracking is silently failing**.
  Check Firebase Console → Realtime Database → Rules. Do this **before** trusting any number.

---

## 3. Metrics to display

| Metric | Definition | Source |
|---|---|---|
| Active listeners now | Tabs currently playing, app-wide | RTDB `listeners/active` (exists) |
| Active per channel | Tabs playing each station | Derived by scanning `listeners/active` |
| Total visitors | Unique devices that ever opened the app | New: `stats/visitorIds` |
| Visitors today | Unique devices today | New: `stats/daily/{date}/visitors` |
| Total plays | Times any station was started | New: `stats/playsTotal` |
| Most listened channel | Station with most plays (all-time + 7d) | New: `stats/plays/{stationId}` |
| Top 10 channels | Ranked list with share % | Derived |
| Plays trend | Daily plays, last 14 days | New: `stats/daily/{date}/playsTotal` |

---

## 4. Data model (Realtime Database)

```
stats/
  playsTotal                    number
  plays/{stationId}             number
  stationMeta/{stationId}       { name, country, tags }   ← so the dashboard can label bars
  visitorsTotal                 number
  visitorIds/{visitorId}        timestamp                 ← dedupes a device
  daily/{YYYY-MM-DD}/
    visitors                    number
    playsTotal                  number
    plays/{stationId}           number

listeners/active/{sessionId}    { stationId, updatedAt }  (EXISTS — presence)
```

Daily buckets use **UTC dates** so trends are stable across timezones.

> ⚠️ `listeners/total` and `listeners/{stationId}` are **legacy and no longer written**.
> Ignore them; they may still hold old values.

---

## 5. Phases

### Phase 1 — Data layer
- [ ] Add `tradio.visitorId` UUID to `localStorage` on first load
- [ ] Increment `stats/visitorIds/{id}` via **transaction** (once per device)
- [ ] Increment `stats/visitorsTotal` + `stats/daily/{date}/visitors` on first visit of the day
- [ ] Bump `stats/plays/{id}`, `stats/playsTotal`, `stats/daily/{date}/playsTotal` on **new station start only**
- [ ] Write `stats/stationMeta/{id}` on first play (name, country, tags)
- [ ] Add 30s debounce per station so rapid taps don't double-count
- [ ] Confirm resumes/reconnects do **not** increment plays
- [ ] `npm run lint && npm run build` passes

**Verify:** play 3 stations, open Firebase Console → `stats/` shows plays=3 and correct per-station split.

### Phase 2 — Dashboard UI
- [ ] Decide route style (D1): hash `#/admin` (no server config) vs path `/admin` (needs rewrite)
- [ ] Add route branch in `src/App.jsx`
- [ ] **Lazy-load** the dashboard so it stays out of the main bundle
- [ ] KPI cards: Active now · Visitors today · Total visitors · Total plays · Top channel
- [ ] Top 10 channels: horizontal bars + share %
- [ ] Plays trend: 14-day area/line chart
- [ ] Live listeners by station: live bars via `onValue`
- [ ] Table: station · plays · share · last played
- [ ] Range toggle: Today / 7d / 30d / All-time
- [ ] Auto-refresh via `onValue` subscriptions (no polling)
- [ ] Charts hand-rolled in SVG/CSS — do **not** add a chart library unless asked
- [ ] Responsive: works at 375 px and 1440 px
- [ ] Dark + light theme match app tokens

**Verify:** numbers match Firebase Console; dashboard bundle is a separate chunk in build output.

### Phase 3 — Security
- [ ] Add `firebase.json` + `.firebaserc` with RTDB rules
- [ ] Rules: `listeners/*` and `stats/*` writable by app, **reads of `stats` admin-only**
- [ ] Wire Firebase Auth (email/password) if D2 = Firebase Auth
- [ ] Dashboard renders nothing until authenticated
- [ ] Confirm an unauthenticated client **cannot** read `stats` (test from console)
- [ ] Store admin credentials outside the repo

**Verify:** logged-out browser gets permission-denied on `stats` read.

### Phase 4 — Deploy + verify
- [ ] Deploy to chosen host (D1)
- [ ] Add `VITE_FIREBASE_*` env vars in host dashboard, then **redeploy** (Vite inlines at build time)
- [ ] Confirm `[T-Radio] Firebase initialised ✓` in production console
- [ ] Generate real traffic, confirm counters move
- [ ] Confirm dashboard totals match Firebase Console
- [ ] Document the live URL in §9

### Phase 5 — Polish / hardening
- [x] Replace `+1/-1` listeners with `onDisconnect().remove()` presence *(done 2026-10-20, before this plan was written — see §1)*
- [ ] Remove unused `useRef` import in `src/useListenerCount.js`
- [ ] CSV export of the station table
- [ ] Retention pruning after 90 days (D5)
- [ ] Empty states ("No plays yet") and loading skeletons
- [ ] Error state when Firebase is unreachable

---

## 6. Known limitations (set expectations)

- **Client counters are approximate.** Ad blockers, offline use, and force-kills cause undercounting. True accuracy needs server-side events.
- **"Visitors" ≠ GA4 users.** Different definitions, different numbers. This is a first-party counter, not a GA4 replacement.
- **Most-listened comes from RTDB, not GA4.** GA4 events are not queryable from the browser; that needs the GA4 Data API + a service account.
- **Free tier is plenty.** RTDB Spark: 1 GB storage, 10 GB/month transfer. This dashboard uses a tiny fraction.
- **Client-side passwords are not security.** Anyone can read the JS bundle. Use real auth (D2).

---

## 7. Files expected to change

| File | Change |
|---|---|
| `src/firebase.js` | Export helpers for stats writes |
| `src/HomeScreen.jsx` | Call play-counter on station start |
| `src/useListenerCount.js` | Presence tracking (**already done**); drop unused `useRef` |
| `src/App.jsx` | Route branch for dashboard |
| `src/AnalyticsDashboard.jsx` | **New** — dashboard screen |
| `src/AnalyticsDashboard.css` | **New** — dashboard styles |
| `src/useAnalyticsStats.js` | **New** — RTDB subscription hook |
| `firebase.json`, `.firebaserc` | **New** — rules + project config |

---

## 8. Verification commands

```bash
npm run lint     # oxlint — must be clean of NEW warnings
npm run build    # vite build — must succeed
npm run dev      # manual check at localhost
```

Baseline lint warnings that already exist (do **not** treat as regressions):
- `src/firebase.js:24` unused param `k`
- `src/useListenerCount.js:1` unused `useRef`
- `src/NowPlayingScreen.jsx:6` only-export-components
- `src/HomeScreen.jsx:14` unused `heroMicSvg`
- `src/HomeScreen.jsx:461` unused `error`
- `src/HomeScreen.jsx:466` unused `isPaused`
- `src/StationBrandLogo.jsx:58` set-state-in-effect

---

## 9. Handoff log

> Append a new entry at the **top** of this list after each work session.
> Include: date, agent, phases touched, what changed, what's next, any blockers.

### 2026-10-20 — Planning session
- Wrote this plan. No code changed.
- Established current-state facts in §1 by reading the source.
- **Discovered uncommitted work in `src/useListenerCount.js`:** the listener
  tracking had already been migrated from `+1/-1` counters to
  `listeners/active/{sessionId}` presence with `onDisconnect().remove()`.
  This was **not** written by this session — treated as user/parallel-agent work
  and left untouched. §1, §3, §4, §5 and §8 were updated to match reality.
- Consequence recorded: there are **no per-station counters any more**; the
  dashboard must derive "active per channel" by scanning `listeners/active`.
- **Next:** user must answer D1–D5 (or say "go with defaults"), then start Phase 1.
- **Blockers:** decisions pending; RTDB rules unverified; the presence change is
  uncommitted in git.

