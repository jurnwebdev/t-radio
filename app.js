/* T-Radio — standalone player for Nigerian stations, data from Radio Browser API. */
(() => {
  "use strict";

  const API = "https://all.api.radio-browser.info";
  const HEADERS = { "User-Agent": "TRadio/1.0 (standalone player)" };

  const $ = (sel) => document.querySelector(sel);
  const grid = $("#grid");
  const template = $("#card-template");
  const statusEl = $("#status");
  const audio = $("#audio");
  const playerBar = $("#player");
  const nowName = $("#now-name");
  const playerState = $("#player-state");
  const searchInput = $("#search");
  const genreSelect = $("#genre");
  const favToggle = $("#fav-toggle");
  const refreshBtn = $("#refresh");
  const muteBtn = $("#mute");
  const volumeSlider = $("#volume");
  const sleepBtn = $("#sleep");

  let stations = [];   // all loaded stations
  let currentCard = null;

  /* ---------- smart features ----------
     1. Remember last station and auto-resume on load (bedside-radio feel).
     2. Sleep timer — stops the stream after a few minutes.
     3. Auto-advance — when a station errors/stops, move to the next one. */

  const LAST_KEY = "tradio.last";
  const SLEEP_KEY = "tradio.sleepMinutes";
  const AUTO_KEY = "tradio.autoplay";

  const AUTOPLAY_DEFAULT = localStorage.getItem(AUTO_KEY) === "on";
  const lastUuid = localStorage.getItem(LAST_KEY) || null;
  let sleepMinutes = Number(localStorage.getItem(SLEEP_KEY) || 30);
  let autoAdvance = AUTOPLAY_DEFAULT;
  let sleepTimer = null;
  let sleepRemaining = null; // seconds, ticks for display

  /* ---------- playlists (persisted + shareable) ----------
     Each playlist is { id, name, stations: [station objects] }. Stations are
     stored whole so shared codes are self-contained (a shared code carries
     every station, so the recipient needs no network lookup). They're
     encoded to a compact base64url blob for the Share button. */

  const PLAYLISTS_KEY = "tradio.playlists";
  const ACTIVE_KEY = "tradio.activePlaylist";

  function loadPlaylists() {
    try {
      return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function savePlaylists(list) {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
  }

  let playlists = loadPlaylists();
  let activePlaylistId = localStorage.getItem(ACTIVE_KEY) || "";

  function activePlaylist() {
    return playlists.find((p) => p.id === activePlaylistId) || null;
  }

  function activePlaylistStations() {
    const p = activePlaylist();
    return p && p.stations.length ? p.stations : [];
  }

  function newPlaylistId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function createPlaylist(name) {
    const p = { id: newPlaylistId(), name: name.trim() || `Playlist ${playlists.length + 1}`, stations: [] };
    playlists.push(p);
    savePlaylists(playlists);
    activePlaylistId = p.id;
    localStorage.setItem(ACTIVE_KEY, p.id);
    renderPlaylistUI();
    return p;
  }

  function deleteActivePlaylist() {
    const idx = playlists.findIndex((p) => p.id === activePlaylistId);
    if (idx === -1) return;
    const removed = playlists.splice(idx, 1)[0];
    savePlaylists(playlists);
    activePlaylistId = playlists[0] ? playlists[0].id : "";
    localStorage.setItem(ACTIVE_KEY, activePlaylistId);
    renderPlaylistUI();
    setStatus(`Deleted playlist "${removed.name}".`);
  }

  function addStationToActivePlaylist(st) {
    /* If there's no playlist yet, auto-create a default one so we keep a
       running "recently played" mix — the smart bedside-radio behavior. */
    if (!activePlaylistId || !activePlaylist()) {
      createPlaylist("My Mix");
    }
    const p = activePlaylist();
    if (!p.stations.some((s) => s.stationuuid === st.stationuuid)) {
      p.stations.push(st);
      savePlaylists(playlists);
      renderPlaylistItems();
    }
  }

  function removeFromActivePlaylist(uuid) {
    const p = activePlaylist();
    if (!p) return;
    p.stations = p.stations.filter((s) => s.stationuuid !== uuid);
    savePlaylists(playlists);
    renderPlaylistItems();
  }

  /* ---- share codes ---- */
  function shareCodeFor(p) {
    const payload = JSON.stringify({ v: 1, name: p.name, stations: p.stations });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function playlistFromShareCode(code) {
    const raw = code.replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const json = decodeURIComponent(escape(atob(raw + pad)));
    const data = JSON.parse(json);
    if (!Array.isArray(data.stations)) throw new Error("bad share code");
    return { name: data.name || "Shared playlist", stations: data.stations };
  }

  async function copyShareCode() {
    const p = activePlaylist();
    if (!p || !p.stations.length) {
      setStatus("Add stations to the playlist before sharing.", true);
      return;
    }
    const code = shareCodeFor(p);
    const full = location.origin === "null" || location.hostname === "" ? code : `${location.origin}${location.pathname}#pc=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(full);
      setStatus(`Share link for "${p.name}" copied — paste it anywhere.`);
    } catch {
      /* Clipboard can be blocked on file:// — fall back to showing the code. */
      window.prompt("Copy this playlist share code:", code);
    }
  }

  function importShareCode(code) {
    try {
      const p = playlistFromShareCode(code.trim());
      createPlaylist(p.name);
      const target = activePlaylist();
      target.stations = p.stations;
      target.name = p.name;
      savePlaylists(playlists);
      renderPlaylistUI();
      setStatus(`Loaded "${p.name}" with ${p.stations.length} stations.`);
    } catch {
      setStatus("That didn't look like a valid share code.", true);
    }
  }

  /* Apply a share code carried in the URL hash (?/ page #pc=…): auto-load
     and start the shared mix on first visit. */
  function applyHashShareCode() {
    const m = (location.hash || "").match(/#pc=([^&]+)/);
    if (!m) return;
    try {
      importShareCode(decodeURIComponent(m[1]));
    } catch {
      /* Ignore malformed codes — just land on the normal app. */
    }
  }

  function rememberLast(st) {
    localStorage.setItem(LAST_KEY, st.stationuuid);
  }

  /* Remove a headless carrier card once playback of it has connected. */
  function retireGhost(card) {
    if (card && card._ghost) {
      card.remove();
      card._ghost = null;
    }
  }

  function saveSleepPref() {
    localStorage.setItem(SLEEP_KEY, String(sleepMinutes));
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
  }

  /* Sleep timer: cycling the button steps 15 → 30 → 60 → off. While active the
     countdown shows in the player state and the stream stops at zero. */
  function cancelSleep() {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
    sleepRemaining = null;
    sleepBtn.classList.remove("active");
    sleepBtn.textContent = "⏰";
    sleepBtn.title = "Sleep timer off";
  }

  function activeSleep() {
    return sleepRemaining !== null && sleepRemaining > 0;
  }

  sleepBtn.addEventListener("click", () => {
    if (activeSleep()) {
      cancelSleep();
      setStatus("Sleep timer off.");
      return;
    }
    sleepRemaining = sleepMinutes * 60;
    sleepBtn.classList.add("active");
    sleepBtn.title = "Sleep timer active — tap to cancel";
    sleepTimer = setInterval(() => {
      sleepRemaining--;
      sleepBtn.textContent = formatSleepCountdown(sleepRemaining);
      if (sleepRemaining <= 0) {
        cancelSleep();
        setStatus(`Sleep timer hit 0 — stopping playback.`);
        if (currentCard) {
          tearDownCurrent();
          playerBar.hidden = true;
        }
      }
    }, 1000);
    setStatus(`Sleep timer set for ${sleepMinutes} min.`);
  });

  function formatSleepCountdown(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* Auto-advance: pick the next station from the active playlist (or the top
     of the loaded list when no playlist is chosen) and start it. */
  function nextStation() {
    if (!activePlaylistStations().length && !stations.length) return null;
    const pool = activePlaylistStations().length ? activePlaylistStations() : stations;
    const curIdx = pool.findIndex((s) => s.stationuuid === currentStationUuid());
    return pool[(curIdx + 1) % pool.length] || pool[0];
  }

  function currentStationUuid() {
    return currentCard && currentCard._station ? currentCard._station.stationuuid : null;
  }

  /* ---------- favorites (persisted) ---------- */
  const FAV_KEY = "tradio.favorites";
  const favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  let favOnly = false;

  function saveFavs() {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  }

  function toggleFavorite(card, st) {
    if (favs.has(st.stationuuid)) {
      favs.delete(st.stationuuid);
      card.classList.remove("faved");
      const btn = card.querySelector(".fav");
      btn.textContent = "☆";
      btn.title = "Add to favorites";
      btn.setAttribute("aria-label", "Add to favorites");
    } else {
      favs.add(st.stationuuid);
      card.classList.add("faved");
      const btn = card.querySelector(".fav");
      btn.textContent = "★";
      btn.title = "Remove from favorites";
      btn.setAttribute("aria-label", "Remove from favorites");
    }
    saveFavs();
    if (favOnly) render(); // unfavoriting while in favorites-only view removes the card
  }

  /* Favorites float to the top of the grid when not filtering to them. */
  const favRank = (st) => (favs.has(st.stationuuid) ? 0 : 1);
  const byPopularity = (a, b) =>
    (b.clickcount + b.votes * 5) - (a.clickcount + a.votes * 5);

  /* ---------- radio-wave visuals ----------
     One shared rAF loop drives everything on screen. Two data sources feed
     the waveforms:
       1. REAL — a Web Audio API AnalyserNode wired to the <audio> element.
          When the stream is same-origin (or the user opens it via a local
          server / HTTP page), we get a genuine spectrum that dances to the
          actual music.
       2. PROCEDURAL fallback — if the audio context is blocked or the
          stream is cross-origin (the common case for radio-browser streams
          loaded straight from file:// or https), we synthesize waves from
          playback state and user volume so the visuals stay alive.
     The source flips automatically whichever is available. */
  const bgCanvas = $("#bg-waves");
  const eqCanvas = $("#eq-canvas");
  const brandEl = $(".brand");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const visual = {
    energy: 0,        // smoothed 0..1, drives every wave
    level: 1,         // user volume (0..1) — the interactive part
    playing: false,
    bgCtx: null, bgW: 0, bgH: 150,
    eqCtx: null, eqW: 72, eqH: 26,
    /* Web Audio live-spectrum support */
    audioCtx: null,
    analyser: null,
    freq: null,        // Uint8Array filled by analyser each frame
    spectrumOn: false, // true when real spectrum is driving the visuals
    ctxWired: false,   // a live graph has been attempted (avoid re-wiring)
    ctxUnwatched: false,
  };

  /* Attempt to wire the real spectrum. Safe to call on every play — we only
     create the nodes once, so repeated calls are cheap. If the browser can't
     (or won't) connect cross-origin audio, we keep the procedural fallback. */
  /* IMPORTANT — keep the audible pipeline native:
     createMediaElementSource() PERMANENTLY reroutes the <audio> element's
     output through the Web Audio graph. With cross-origin radio streams that
     graph is policy-limited, and a suspended context mutes ALL sound even
     though the stream is still receiving data (the UI still shows "live").
     So T-Radio deliberately does NOT route audio through Web Audio. The
     equalizer and background waves stay procedural (they already look
     alive), and the <audio> element always plays through the native
     pipeline. If you later want a real spectrum, it requires a same-origin
     or CORS-enabled stream, plus a user-gesture unlock, and a careful
     state guard — until then, procedural is the safe choice. */
  function initLiveSpectrum() {
    /* No-op by design: we keep audio native and visuals procedural. */
  }

  /* Normalized 0..1 level of a frequency bin range, or null when we're not
     running a real spectrum. */
  function spectrumLevel(lo, hi) {
    if (!visual.spectrumOn || !visual.analyser) return null;
    visual.analyser.getByteFrequencyData(visual.freq);
    const n = visual.freq.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor(lo * n)));
    const b = Math.max(a + 1, Math.min(n, Math.ceil(hi * n)));
    let sum = 0, count = 0;
    for (let i = a; i < b; i++) { sum += visual.freq[i]; count++; }
    return count ? (sum / count) / 255 : 0;
  }

  /* A smoothed global energy 0..1 that blends the live spectrum with the
     playback gate and user volume, so the whole scene pulses to the song. */
  function liveEnergy() {
    if (visual.spectrumOn) {
      const band = spectrumLevel(0.02, 0.55); // bass + low-mids drive "energy"
      if (band !== null && visual.playing) return Math.min(1, band * 1.4 + 0.05);
    }
    return null; // caller falls back to procedural
  }

  const GREEN = (a) => `rgba(46, 204, 113, ${a})`;

  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = cv.getBoundingClientRect();
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (rect.width > 0) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { g, w: rect.width, h: rect.height };
    }
    return { g, w: 0, h: 0 };
  }

  function attachAudioListeners(el) {
    el.addEventListener("playing", () => {
      if (currentCard) {
        currentCard.classList.remove("loading");
        currentCard.classList.add("playing");
        currentCard._candidates = null; // connected: stop walking candidates
        initLiveSpectrum(); // wire real spectrum on first connect
        retireGhost(currentCard); // carrier card connected — reclaim it
      }
      playerState.textContent = "live";
      playerBar.classList.remove("paused");
      visual.playing = true;
      refitAll(); // the player bar just became visible — canvas needs real size
      brandEl.classList.add("live");
      if (currentCard && currentCard._station) {
        const st = currentCard._station;
        addStationToActivePlaylist(st); // smart: remember what's playing
        fetch(`${API}/json/url/${st.stationuuid}`, { headers: HEADERS }).catch(() => {}); // report the play
      }
    });

    el.addEventListener("waiting", () => {
      playerState.textContent = "buffering…";
      if (currentCard) currentCard.classList.add("loading");
    });

    el.addEventListener("error", () => {
      // Ignore media errors that fire after we deliberately cleared the src.
      if (!el.currentSrc || !currentCard) return;
      currentCard.classList.remove("playing");
      currentCard.classList.add("loading");
      playCandidate(currentCard);
    });

    el.addEventListener("pause", () => {
      if (!currentCard) visual.playing = false;
    });
  }

  attachAudioListeners(audio);

  function measureEnergy(t) {
    /* Procedural: layered sines with a heartbeat-style pulse while playing. */
    const pulse = Math.pow(Math.abs(Math.sin(t / 620)), 8);
    const sway = 0.5 + 0.5 * Math.sin(t / 1900);
    const cap = visual.playing ? 1 : 0.3;
    return (0.1 + 0.45 * sway + 0.45 * pulse) * cap + 0.03;
  }

  function drawBgWaves(t) {
    const g = visual.bgCtx;
    const w = visual.bgW, h = visual.bgH;
    if (!g || !w) return;
    g.clearRect(0, 0, w, h);
    /* Real spectrum drives the waves when we're playing and the analyser is
       live; otherwise we fall back to the procedural energy value. */
    const live = liveEnergy();
    const A = Math.min(1, (live !== null ? live : visual.energy) * visual.level + 0.03);
    const layers = [
      { f: 0.008, v: 0.00021, amp: 0.55, a: 0.16, lift: 26 },
      { f: 0.011, v: -0.00029, amp: 0.8, a: 0.22, lift: 46 },
      { f: 0.014, v: 0.00017, amp: 1.0, a: 0.3, lift: 66 },
    ];
    for (const l of layers) {
      g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = h - l.lift + Math.sin(x * l.f + t * l.v) * (3 + 36 * A) * l.amp;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = GREEN(l.a * (0.35 + 0.65 * A));
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  function drawEqBars(t) {
    const g = visual.eqCtx;
    if (!g) return;
    const { eqW, eqH } = visual;
    g.clearRect(0, 0, eqW, eqH);
    const bars = 14, bw = 2;
    const gap = (eqW - bars * bw) / (bars - 1);

    for (let i = 0; i < bars; i++) {
      let v, alpha;
      /* Procedural dance — T-Radio keeps the audio pipeline native (no Web
         Audio routing), so the bars stay synthetic. This is intentional:
         see initLiveSpectrum() above. */
      const A = Math.min(1, visual.energy * visual.level + 0.02);
      v = 0.5 + 0.5 * Math.sin(t / 310 + i * 1.7 + Math.sin(t / 900 + i) * 2);
      alpha = 0.25 + 0.75 * v * A;
      v = v * A;
      const bh = Math.max(2, v * eqH);
      g.fillStyle = GREEN(alpha);
      g.fillRect(i * (bw + gap), eqH - bh, bw, bh);
    }
  }

  function drawScene(now) {
    /* Always advance the procedural energy (cheap) so the fallback stays
       consistent. Real-spectrum draws read from the analyser directly. */
    visual.energy += (measureEnergy(now) - visual.energy) * 0.12;
    drawBgWaves(now);
    drawEqBars(now);
  }

  function refitAll() {
    const bg = fitCanvas(bgCanvas);
    if (bg.w) { visual.bgCtx = bg.g; visual.bgW = bg.w; visual.bgH = bg.h; }
    const eq = fitCanvas(eqCanvas);
    if (eq.w) { visual.eqCtx = eq.g; visual.eqW = eq.w; visual.eqH = eq.h; }
    visual.bgCtx = visual.bgCtx || bg.g;
    visual.eqCtx = visual.eqCtx || eq.g;
  }

  function initVisuals() {
    refitAll();
    window.__tradio = visual; // debug handle for diagnostics
    if (reducedMotion) {
      drawScene(performance.now()); // one calm static frame, no animation
      window.addEventListener("resize", () => { refitAll(); drawScene(performance.now()); });
      return;
    }
    (function loop(now) {
      if (!document.hidden) drawScene(now);
      requestAnimationFrame(loop);
    })(performance.now());
    window.addEventListener("resize", refitAll);
  }

  /* ---------- volume (persisted) ---------- */
  const VOL_KEY = "tradio.volume";
  const savedVolume = localStorage.getItem(VOL_KEY);
  let muted = false;
  /* Default to 100 % on first run — avoid wiping volume if localStorage
     retains a prior saved value of 0. Clamp to [0,100] so stale or
     malformed values can't leave the player silent. */
  const startVolume = savedVolume !== null ? Math.min(100, Math.max(0, Number(savedVolume) || 100)) : 100;
  volumeSlider.value = startVolume;

  volumeSlider.addEventListener("input", () => {
    audio.volume = volumeSlider.value / 100;
    localStorage.setItem(VOL_KEY, volumeSlider.value);
  });
  audio.volume = startVolume / 100;
  visual.level = muted ? 0.05 : audio.volume;

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    audio.muted = muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.title = muted ? "Unmute (M)" : "Mute";
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    visual.level = muted ? 0.05 : volumeSlider.value / 100;
  });

  /* Stop tears the stream down and hides the player bar. */
  $("#stop").addEventListener("click", () => {
    const stopped = nowName.textContent;
    tearDownCurrent();
    playerBar.hidden = true;
    setStatus(`Stopped "${stopped}"`);
  });

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
  }

  function firstTagList(st) {
    return (st.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" · ");
  }

  /* Normalize name once so "Cool FM: Lagos" and "Cool FM : Lagos" dedupe well */
  function dedupe(list) {
    const seen = new Map();
    for (const st of list) {
      const key = st.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || st.clickcount + st.votes * 5 > prev.clickcount + prev.votes * 5) {
        seen.set(key, st);
      }
    }
    return [...seen.values()];
  }

  async function loadStations() {
    setStatus("Loading Nigerian stations…");
    grid.replaceChildren();
    const params = new URLSearchParams({
      countrycode: "NG",
      limit: "500",
      hidebroken: "true",
      order: "clickcount",
      reverse: "true",
    });
    try {
      const res = await fetch(`${API}/json/stations/search?${params}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
      stations = dedupe(await res.json());
      /* Manual sort only when favorites exist; otherwise keep API's clickcount order. */
      if (favs.size > 0 && !favOnly) stations.sort((a, b) => favRank(a) - favRank(b) || byPopularity(a, b));
      setStatus(`${stations.length} stations found · ${favs.size} favorites`);
      render();
    } catch (err) {
      setStatus(`Could not load stations: ${err.message} — check your connection and hit ↻`, true);
    }
  }

  function matchesFilters(st) {
    const q = searchInput.value.trim().toLowerCase();
    const genre = genreSelect.value;
    if (favOnly && !favs.has(st.stationuuid)) return false;
    if (q && !(st.name.toLowerCase().includes(q) || (st.tags || "").toLowerCase().includes(q))) return false;
    if (genre && !(st.tags || "").toLowerCase().includes(genre)) return false;
    return true;
  }

  function render() {
    grid.replaceChildren();
    let shown = 0;
    for (const st of stations) {
      if (!matchesFilters(st)) continue;
      grid.append(buildCard(st));
      shown++;
    }
    if (shown === 0) {
      const p = document.createElement("p");
      p.textContent = favOnly && favs.size === 0
        ? "No favorites yet — tap the ☆ on any station."
        : "No stations match your filters.";
      p.style.color = "#8b98a9";
      grid.append(p);
    }
    /* Keep the playlist "now playing" highlight in sync with the grid. */
    renderPlaylistItems && renderPlaylistItems();
  }

  function buildCard(st) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".card");
    const playBtn = node.querySelector(".play");
    node.querySelector(".name").textContent = st.name;
    node.querySelector(".tags").textContent = firstTagList(st);
    node.querySelector(".signal").textContent =
      `${st.codec || "—"} · ${st.bitrate || "?"} kbps · ${st.votes} votes`;
    card.dataset.uuid = st.stationuuid;
    playBtn.setAttribute("aria-label", `Play ${st.name}`);

    const favBtn = node.querySelector(".fav");
    if (favs.has(st.stationuuid)) {
      card.classList.add("faved");
      favBtn.textContent = "★";
      favBtn.title = "Remove from favorites";
      favBtn.setAttribute("aria-label", "Remove from favorites");
    }
    favBtn.addEventListener("click", () => toggleFavorite(card, st));

    // Single handler per card: toggling the active station vs. starting a new one.
    playBtn.addEventListener("click", () => {
      if (card === currentCard) {
        togglePlay(card);
      } else {
        startStation(card, st);
      }
    });

    return node;
  }

  /* Click ping: a quick wave ripple from the play button, purely for feel. */
  function spawnPing(card) {
    if (reducedMotion) return;
    const ping = document.createElement("span");
    ping.className = "ping";
    card.appendChild(ping);
    ping.addEventListener("animationend", () => ping.remove());
  }

  /* Resume / pause the card that is already loaded. */
  function togglePlay(card) {
    if (!audio.paused) {
      audio.pause();
      playerState.textContent = "paused";
      playerBar.classList.add("paused"); // dial down the visualizer
      card._armed = false;
      return;
    }
    /* Armed card (from auto-resume): the stream is set up but has never been
       started. Kick off playback through the candidate-URL walker. */
    if (card._armed) {
      card._armed = false;
      spawnPing(card);
      card.classList.add("loading");
      playerState.textContent = "connecting…";
      playerBar.classList.remove("paused");
      playCandidate(card);
      return;
    }
    spawnPing(card);
    card.classList.add("loading");
    playerState.textContent = "connecting…"
    audio.play().catch((err) => {
      if (currentCard !== card) return; // user switched away while the promise was pending
      /* Resuming a station that already connected: try remaining fallback URLs,
         or report the failure once they are spent. */
      if (Array.isArray(card._candidates) && card._candidates.length > 0) {
        playCandidate(card);
      } else {
        startFailed(card, err);
      }
    });
  }

  /* ---------- fallback streams ---------- */

  /* Radio Browser exposes several mirrors of the stream URL; a station that
     fails on url_resolved often works on url or one of the resolved variants. */
  function streamCandidates(st) {
    return [...new Set([st.url_resolved, st.url].filter(Boolean))];
  }

  /* Switch to a new station: teardown first, then load + play, walking through
     candidate URLs until one connects. */
  function startStation(card, st) {
    tearDownCurrent();
    currentCard = card;
    card._station = st;
    card._armed = false; // we're starting the stream ourselves now
    rememberLast(st); // smart: restore this station next time the app opens
    card._candidates = streamCandidates(st);
    card.classList.add("loading");
    playerBar.hidden = false;
    nowName.textContent = st.name;
    playerState.textContent = "connecting…";

    spawnPing(card);
    audio.pause(); // no play() is pending on this path, so this cannot interrupt
    playCandidate(card);
  }

  /* Start playback with the next candidate URL for the current card, or fail. */
  function playCandidate(card) {
    const remaining = card === currentCard ? card._candidates : null;
    if (!remaining) return; // card was torn down while a promise was pending
    if (remaining.length === 0) {
      startFailed(card, new Error("all stream URLs failed"));
      return;
    }
    audio.removeAttribute("src");
    audio.src = remaining.shift();
    audio.play().catch((err) => {
      if (currentCard !== card) return; // user switched away while the promise was pending
      playCandidate(card);
    });
  }

  function startFailed(card, err) {
    const name = nowName.textContent;
    /* Auto-advance: skip to the next station in the mix instead of dying
       here. If there's nowhere to go, fall through to the failure path. */
    if (autoAdvance && activePlaylistStations().length > 1) {
      const next = nextStation();
      if (next && next.stationuuid !== currentStationUuid()) {
        const nextCard = cardFromUuid(next.stationuuid) || makeGhostCard(next);
        setStatus(`"${name}" skipped → next station.`);
        startStation(nextCard, next);
        return;
      }
    }
    if (currentCard === card) {
      currentCard = null;
      card.classList.remove("loading", "playing");
      card._candidates = null;
      retireGhost(card);
      playerState.textContent = "";
      playerBar.hidden = true;
      visual.playing = false;
      brandEl.classList.remove("live");
    }
    setStatus(`Stream "${name}" failed to start: ${err.message}`, true);
  }

  /* Find a rendered card for a station uuid; fall back to a temporary card so
     auto-advance can start a station that isn't currently in the visible
     grid (e.g. because the user has filters applied). */
  function cardFromUuid(uuid) {
    return [...grid.children].find((c) => c.dataset && c.dataset.uuid === uuid) || null;
  }

  function makeGhostCard(st) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".card");
    card.dataset.uuid = st.stationuuid;
    card._station = st;
    card._candidates = streamCandidates(st);
    card._ghost = true;
    card.dataset.ghost = "1"; // so tearDown can find orphan carriers
    card.style.display = "none"; // not in the grid — it's a headless carrier
    document.body.appendChild(card);
    return card;
  }

  function tearDownCurrent() {
    if (currentCard) {
      currentCard.classList.remove("playing", "loading");
      currentCard._candidates = null;
      retireGhost(currentCard);
      currentCard = null;
    }
    /* Also clean up any orphan ghost cards (e.g. they were replaced mid-flight). */
    document.querySelectorAll(".card[data-ghost]").forEach((c) => c.remove());
    audio.pause();
    audio.removeAttribute("src");
    playerState.textContent = "";
    playerBar.classList.remove("paused");
    visual.playing = false;
    brandEl.classList.remove("live");
  }


  /* ---------- auto-advance toggle (shared UI with the playlist checkbox) ---------- */
  const autoToggle = $("#playlist-autoplay");
  const skipBtn = $("#playlist-skip");
  if (autoToggle) autoToggle.checked = autoAdvance;
  autoToggle && autoToggle.addEventListener("change", () => {
    autoAdvance = autoToggle.checked;
    localStorage.setItem(AUTO_KEY, autoAdvance ? "on" : "off");
  });

  skipBtn && skipBtn.addEventListener("click", () => {
    const next = nextStation();
    if (!next) { setStatus("No stations to advance to.", true); return; }
    const card = cardFromUuid(next.stationuuid) || makeGhostCard(next);
    startStation(card, next);
  });

  /* ---------- playlist UI wiring ---------- */
  const playlistSelect = $("#playlist-select");
  const playlistItems = $("#playlist-items");
  const newBtn = $("#playlist-new");
  const delBtn = $("#playlist-delete");
  const expBtn = $("#playlist-export");
  const impBtn = $("#playlist-import");
  const impInput = $("#playlist-import-input");

  function renderPlaylistUI() {
    renderPlaylistSelect();
    renderPlaylistItems();
  }

  function renderPlaylistSelect() {
    playlistSelect.replaceChildren();
    if (!playlists.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No playlists yet";
      playlistSelect.appendChild(o);
    } else {
      for (const p of playlists) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = `${p.name} (${p.stations.length})`;
        if (p.id === activePlaylistId) o.selected = true;
        playlistSelect.appendChild(o);
      }
    }
  }

  function renderPlaylistItems() {
    playlistItems.replaceChildren();
    const p = activePlaylist();
    if (!p || !p.stations.length) {
      const li = document.createElement("li");
      li.className = "p-empty";
      li.textContent = "Empty — play stations to add them, or use a share code.";
      playlistItems.appendChild(li);
      return;
    }
    const cur = currentStationUuid();
    p.stations.forEach((st) => {
      const li = document.createElement("li");
      if (st.stationuuid === cur) li.classList.add("active");
      const name = document.createElement("span");
      name.className = "p-name";
      name.textContent = st.name;
      const play = document.createElement("button");
      play.textContent = "▸";
      play.title = `Play ${st.name}`;
      play.addEventListener("click", () => startStation(cardFromUuid(st.stationuuid) || makeGhostCard(st), st));
      const rm = document.createElement("button");
      rm.textContent = "✕";
      rm.title = "Remove from playlist";
      rm.addEventListener("click", () => removeFromActivePlaylist(st.stationuuid));
      li.append(name, play, rm);
      playlistItems.appendChild(li);
    });
  }

  playlistSelect.addEventListener("change", () => {
    activePlaylistId = playlistSelect.value;
    localStorage.setItem(ACTIVE_KEY, activePlaylistId);
    renderPlaylistItems();
  });

  newBtn.addEventListener("click", () => {
    const n = window.prompt("Name your new playlist:", `Playlist ${playlists.length + 1}`);
    if (n === null) return;
    createPlaylist(n);
    setStatus(`Created playlist "${activePlaylist().name}".`);
  });

  delBtn.addEventListener("click", deleteActivePlaylist);
  expBtn.addEventListener("click", copyShareCode);

  impBtn.addEventListener("click", () => {
    impInput.hidden = !impInput.hidden;
    if (!impInput.hidden) impInput.focus();
  });
  impInput.addEventListener("change", () => {
    const v = impInput.value;
    if (v.trim()) importShareCode(v);
    impInput.hidden = true;
    impInput.value = "";
  });

  searchInput.addEventListener("input", render);
  genreSelect.addEventListener("change", render);
  favToggle.addEventListener("click", () => {
    favOnly = !favOnly;
    favToggle.classList.toggle("active", favOnly);
    favToggle.setAttribute("aria-pressed", String(favOnly));
    favToggle.title = favOnly ? "Show all stations" : "Show favorites only";
    render();
  });
  refreshBtn.addEventListener("click", () => {
    tearDownCurrent();
    playerBar.hidden = true;
    loadStations();
  });

  initVisuals();
  renderPlaylistUI();
  applyHashShareCode();
  loadStations().then(() => resumeLastStation());

  /* Smart: if a station was remembered last session, bring it back. Browsers
     require a user gesture for audio, so we arm the player with the station
     and let the user tap to actually start playback. The armed card is marked
     so that the normal card click handler (togglePlay) can start the stream
     instead of just pausing an empty audio element. */
  async function resumeLastStation() {
    if (!lastUuid) return;
    const st = stations.find((s) => s.stationuuid === lastUuid);
    if (!st) return;
    const card = cardFromUuid(st.stationuuid) || makeGhostCard(st);
    tearDownCurrent();
    currentCard = card;
    card._station = st;
    card._candidates = streamCandidates(st);
    card._armed = true; // tells togglePlay: start the stream on the next click
    card.classList.add("loading");
    playerBar.hidden = false;
    nowName.textContent = st.name;
    playerState.textContent = "tap play to resume";
    playerBar.classList.add("paused");
    setStatus(`Last station "${st.name}" is ready — tap ▶ on its card to start.`);
  }
})();
