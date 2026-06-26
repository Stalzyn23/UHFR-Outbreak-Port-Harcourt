import { classes, faceClaims, locations } from "./data.js";
import { npcAt, sameLocationPlayers, visibleLogs } from "./rules.js";

const app = document.querySelector("#app");
let view = "landing";
let room = null;
let currentPlayerId = localStorage.getItem("uhfr-current-player");
let draft = { roomCode: localStorage.getItem("uhfr-room-code") || "", name: "", age: "", classId: "medic", faceClaimId: "medical-student" };
let openDrawer = null;
let actionsOpen = false;
let audioOn = false;
let busy = false;
let networkInfo = null;
let pollTimer = null;
let storyAutoScroll = true;
let storyScrollTop = 0;
let audioEngine = null;
let lastSeenLogCount = 0;
let lastRoomSignature = "";
let storyScrollActiveUntil = 0;

init();

async function init() {
  networkInfo = await api("/api/network").catch(() => null);
  if (draft.roomCode && currentPlayerId) {
    const loaded = await loadRoom(draft.roomCode);
    if (loaded?.players?.[currentPlayerId]) view = loaded.started ? "game" : "lobby";
  }
  startPolling();
  render();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!room?.code || busy) return;
    if (view !== "lobby" && view !== "game") return;
    if (isTyping()) return;
    if (Date.now() < storyScrollActiveUntil && !storyAutoScroll) return;
    const before = roomSignature(room);
    const next = await loadRoom(room.code, false);
    const after = roomSignature(next);
    if (next && after !== before && after !== lastRoomSignature) {
      lastRoomSignature = after;
      render();
    }
  }, 1600);
}

async function loadRoom(code, shouldRender = true) {
  const data = await api(`/api/rooms/${encodeURIComponent(code.toUpperCase())}`);
  room = data.room;
  draft.roomCode = room.code;
  localStorage.setItem("uhfr-room-code", room.code);
  if (shouldRender) render();
  return room;
}

function render() {
  if (view === "landing") return renderLanding();
  if (view === "character") return renderCharacter();
  if (view === "lobby") return renderLobby();
  return renderGame();
}

function mount(html) {
  app.innerHTML = html;
  bindCommon();
}

function renderLanding() {
  mount(`
    <main class="landing">
      <section class="hero">
        <div class="heroShade"></div>
        <div class="heroContent">
          <p class="kicker">University of Health and Facility Research</p>
          <h1>UHFR: Outbreak Port Harcourt</h1>
          <p class="heroCopy">A multiplayer Nigerian campus RP survival story where the collapse starts quietly, before anyone agrees to call it a collapse.</p>
          ${networkInfo ? `<p class="lanHint">Phone access on same Wi-Fi: ${networkInfo.addresses.map((ip) => `http://${ip}:${networkInfo.port}`).join(" or ") || "no LAN address detected"}</p>` : ""}
          <form class="joinCard" data-action="start-character">
            <label>Room code
              <input name="roomCode" maxlength="12" placeholder="e.g. BOMA12" value="${escapeAttr(draft.roomCode)}" required />
            </label>
            <button type="submit">Continue</button>
          </form>
        </div>
      </section>
    </main>
  `);
}

function renderCharacter() {
  mount(`
    <main class="setupShell">
      <section class="setupPanel">
        <button class="ghostButton" data-action="back-landing" title="Back">&larr;</button>
        <div>
          <p class="kicker">Room ${escapeHtml(draft.roomCode.toUpperCase())}</p>
          <h2>Create your survivor</h2>
        </div>
        <form class="characterForm" data-action="join-lobby">
          <label>In-game name
            <input name="name" placeholder="e.g. Bari Tamuno" value="${escapeAttr(draft.name)}" required />
          </label>
          <label>Age
            <input name="age" type="number" min="16" max="80" value="${escapeAttr(draft.age)}" required />
          </label>
          <div class="pickGrid">
            ${Object.entries(classes).map(([id, item]) => `
              <label class="pick ${draft.classId === id ? "selected" : ""}">
                <input type="radio" name="classId" value="${id}" ${draft.classId === id ? "checked" : ""} />
                <strong>${item.label}</strong>
                <span>${item.summary}</span>
              </label>
            `).join("")}
          </div>
          <div class="faceGrid">
            ${faceClaims.map((face) => `
              <label class="face ${draft.faceClaimId === face.id ? "selected" : ""}" style="--face:${face.accent}">
                <input type="radio" name="faceClaimId" value="${face.id}" ${draft.faceClaimId === face.id ? "checked" : ""} />
                <span class="portrait"><img src="${face.image}" alt="${escapeAttr(face.label)} face claim" loading="lazy" /></span>
                <b>${face.label}</b>
              </label>
            `).join("")}
          </div>
          <button type="submit">${busy ? "Joining..." : "Join session"}</button>
        </form>
      </section>
    </main>
  `);
}

function renderLobby() {
  const players = Object.values(room.players);
  mount(`
    <main class="lobby">
      <section class="lobbyPanel">
        <div class="lobbyTop">
          <div>
            <p class="kicker">Waiting area | Room ${room.code}</p>
            <h2>UHFR pre-session lobby</h2>
          </div>
          <button data-action="start-game">${busy ? "Starting..." : "Start game"}</button>
        </div>
        <div class="lobbyBody">
          <div class="survivorList">
            ${players.map((p) => playerCard(p, true)).join("")}
          </div>
          <div class="chatBox">
            <div class="chatLog">
              ${(room.lobbyChat || []).map((m) => `<p><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</p>`).join("") || `<p class="muted">Players can talk freely here until the game starts.</p>`}
            </div>
            <form class="chatInput" data-action="lobby-chat">
              <input name="message" placeholder="Talk in lobby..." autocomplete="off" />
              <button>Send</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  `);
}

function renderGame() {
  const player = room?.players?.[currentPlayerId];
  if (!player) {
    view = "landing";
    currentPlayerId = null;
    localStorage.removeItem("uhfr-current-player");
    return render();
  }
  const loc = locations[player.locationId];
  const npc = npcAt(player.locationId);
  const sameHere = sameLocationPlayers(room, player);
  const logs = visibleLogs(room, player).slice(-60);
  const faceImage = faceClaims.find((face) => face.id === player.faceClaimId)?.image;
  const suggested = room.suggestedActions?.[player.id] || [];
  rememberStoryScroll();
  mount(`
    <main class="gameShell">
      <aside class="rail">
        <button class="avatarButton" data-drawer="profile" title="Profile">${faceImage ? `<img src="${faceImage}" alt="${escapeAttr(player.name)}" />` : initials(player.name)}</button>
        <button data-action="toggle-audio" title="Audio">${audioOn ? "♪" : "♪"}</button>
        <button data-drawer="stats" title="Class stats">ST</button>
        <button data-drawer="world" title="World">WD</button>
        <button data-drawer="survivors" title="Survivors">SV</button>
        <button data-drawer="inventory" title="Inventory">IV</button>
        <button data-drawer="pressure" title="Location pressure">!</button>
      </aside>
      <section class="playArea">
        <header class="topStrip">
          <div class="coreStats">
            <span title="Health">&#9829; ${player.core.health}</span>
            <span title="Stamina">&#9889; ${player.core.stamina}</span>
            <span title="Hunger">&#9673; ${player.core.hunger}</span>
            <span title="Thirst">&#9679; ${player.core.thirst}</span>
            <span title="Stress">&#9672; ${player.core.stress}</span>
            <span title="Infection">&#9763; ${player.core.infection}</span>
          </div>
          <div class="topIcons">
            <button data-action="toggle-audio" title="Audio">${audioOn ? "ON" : "OFF"}</button>
            <button data-drawer="map" title="Map">MAP</button>
          </div>
        </header>
        <section class="storyPanel">
          <div class="sceneHeader">
            <div>
              <p class="kicker">${room.phase} | Day ${room.clock.day}, ${room.clock.time}</p>
              <h2>${loc.name}</h2>
            </div>
            <span>${sameHere.length} here</span>
          </div>
          <div class="storyFeed">
            ${logs.map((log) => storyLine(log)).join("")}
            ${busy ? `<article class="line system"><p>GM is thinking...</p></article>` : ""}
          </div>
        </section>
        <section class="timerBar"><span style="width:${Math.min(100, 18 + room.logs.length * 3)}%"></span></section>
        <section class="actionFold ${actionsOpen ? "open" : ""}">
          <button class="foldHead" data-action="toggle-actions">${actionsOpen ? "Hide actions" : "Actions"}</button>
          <div class="actions">
            ${actionButtons(player, npc, suggested)}
          </div>
        </section>
        <form class="rpBox" data-action="rp-submit">
          <textarea name="rp" placeholder="Write your RP post..." rows="2" ${busy ? "disabled" : ""}></textarea>
          <button ${busy ? "disabled" : ""}>Submit</button>
        </form>
      </section>
      ${drawer(player, loc, npc)}
    </main>
  `);
  const feed = document.querySelector(".storyFeed");
  if (feed) {
    feed.addEventListener("scroll", rememberStoryScroll, { passive: true });
    feed.addEventListener("touchstart", markStoryScrollActive, { passive: true });
    feed.addEventListener("touchmove", markStoryScrollActive, { passive: true });
    feed.addEventListener("wheel", markStoryScrollActive, { passive: true });
    requestAnimationFrame(() => {
      if (storyAutoScroll) {
        feed.scrollTop = feed.scrollHeight;
      } else {
        feed.scrollTop = Math.min(storyScrollTop, Math.max(0, feed.scrollHeight - feed.clientHeight));
      }
    });
  }
  if (audioOn && room.logs.length > lastSeenLogCount) {
    playAudioSting(room.logs.at(-1)?.type);
  }
  lastSeenLogCount = room.logs.length;
  lastRoomSignature = roomSignature(room);
}

function actionButtons(player, npc, suggested = []) {
  const destinationOptions = Object.entries(locations)
    .filter(([, loc]) => loc.known)
    .map(([id, loc]) => `<button data-action="set-travel" data-location="${id}">Go: ${loc.name}</button>`)
    .join("");

  return `
    ${suggested.length ? `
      <div class="suggestedActions">
        <p>Possible actions</p>
        ${suggested.map((item) => suggestedButton(item)).join("")}
      </div>
    ` : ""}
    ${player.travelGoal ? `<button data-action="continue-travel">Continue toward ${locations[player.travelGoal].name}</button>` : ""}
    ${npc ? `
      <button data-action="npc-talk" data-npc="${npc.id}" data-kind="talk">Talk to ${npc.name}</button>
      <button data-action="npc-talk" data-npc="${npc.id}" data-kind="ask">Ask ${npc.name}</button>
      <button data-action="npc-talk" data-npc="${npc.id}" data-kind="observe">Observe ${npc.name}</button>
    ` : ""}
    <details>
      <summary>Set travel goal</summary>
      <div class="destinationGrid">${destinationOptions}</div>
    </details>
    <form class="customAction" data-action="custom-action">
      <input name="custom" placeholder="Custom mechanical action..." ${busy ? "disabled" : ""} />
      <button ${busy ? "disabled" : ""}>Try</button>
    </form>
  `;
}

function suggestedButton(item) {
  const attrs = [
    `data-action="${escapeAttr(item.action)}"`,
    item.npcId ? `data-npc="${escapeAttr(item.npcId)}"` : "",
    item.kind ? `data-kind="${escapeAttr(item.kind)}"` : "",
    item.locationId ? `data-location="${escapeAttr(item.locationId)}"` : "",
    item.text ? `data-text="${escapeAttr(item.text)}"` : ""
  ].filter(Boolean).join(" ");
  return `<button ${attrs}>${escapeHtml(item.label)}</button>`;
}

function drawer(player, loc, npc) {
  if (!openDrawer) return "";
  const known = Object.entries(locations).filter(([, item]) => item.known);
  const relation = npc ? room.relationships[`${player.id}:${npc.id}`] : null;
  const content = {
    profile: `<h3>${escapeHtml(player.name)}</h3><p>${classes[player.classId].label}, age ${player.age}</p><p class="muted">${faceClaims.find((f) => f.id === player.faceClaimId)?.label}</p>`,
    stats: `<h3>Class stats</h3>${Object.entries(player.stats).map(([k, v]) => `<p><b>${label(k)}</b><span>${v}</span></p>`).join("")}`,
    world: `<h3>World</h3><p><b>Phase</b><span>${room.phase}</span></p><p><b>Power</b><span>${room.resources.power}</span></p><p><b>Network</b><span>${room.resources.network}</span></p><p><b>OpenAI GM</b><span>${networkInfo?.openai ? "enabled" : "fallback"}</span></p>`,
    survivors: `<h3>Survivors</h3>${Object.values(room.players).map((p) => `<p><b>${escapeHtml(p.name)}</b><span>${p.locationId === player.locationId ? "with you" : "unknown / last seen"}</span></p>`).join("")}`,
    inventory: `<h3>Inventory</h3>${player.inventory.map((i) => `<p><b>${escapeHtml(i)}</b></p>`).join("")}`,
    pressure: `<h3>${loc.name}</h3><p><b>Pressure</b><span>${loc.pressure}/5</span></p>${npc ? `<p><b>Nearby</b><span>${npc.name}</span></p>${relation ? `<p><b>Trust</b><span>${relation.trust}</span></p>` : ""}` : `<p class="muted">No important NPC in sight.</p>`}`,
    map: `<h3>Known map</h3>${known.map(([id, item]) => `<button class="mapRow" data-action="set-travel" data-location="${id}">${item.name}${id === player.locationId ? " | here" : ""}</button>`).join("")}`
  }[openDrawer] || "";

  return `<aside class="drawer"><button class="drawerClose" data-drawer="${openDrawer}">x</button>${content}</aside>`;
}

function storyLine(log) {
  const cls = `line ${log.type || "world"}`;
  return `<article class="${cls}"><p>${escapeHtml(log.text)}</p></article>`;
}

function playerCard(player, showLocation) {
  const image = faceClaims.find((face) => face.id === player.faceClaimId)?.image;
  return `<article class="playerCard"><span>${image ? `<img src="${image}" alt="${escapeAttr(player.name)}" />` : initials(player.name)}</span><div><b>${escapeHtml(player.name)}</b><small>${classes[player.classId].label}${showLocation ? ` | ${locations[player.locationId].name}` : ""}</small></div></article>`;
}

function bindCommon() {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction(form.dataset.action, form);
    });
  });
  document.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button));
  });
  document.querySelectorAll("button[data-drawer]").forEach((button) => {
    button.addEventListener("click", () => {
      openDrawer = openDrawer === button.dataset.drawer ? null : button.dataset.drawer;
      render();
    });
  });
  document.querySelectorAll("input[type=radio]").forEach((input) => {
    input.addEventListener("change", () => {
      const form = input.closest("form");
      if (form) {
        const data = new FormData(form);
        draft.name = String(data.get("name") || draft.name || "");
        draft.age = String(data.get("age") || draft.age || "");
      }
      draft[input.name] = input.value;
      render();
    });
  });
  document.querySelectorAll("input[name=roomCode], input[name=name], input[name=age]").forEach((input) => {
    input.addEventListener("input", () => {
      draft[input.name] = input.name === "roomCode" ? input.value.toUpperCase() : input.value;
    });
  });
}

async function handleAction(action, el) {
  if (busy && !["toggle-audio", "toggle-actions"].includes(action)) return;
  try {
    if (action === "start-character") {
      const data = new FormData(el);
      draft.roomCode = String(data.get("roomCode") || "").trim().toUpperCase();
      await loadRoom(draft.roomCode, false);
      view = "character";
      render();
      return;
    }
    if (action === "back-landing") view = "landing";
    if (action === "join-lobby") await joinLobby(el);
    if (action === "lobby-chat") await postAction("lobby-chat", { text: String(new FormData(el).get("message") || "").trim() });
    if (action === "start-game") {
      await postAction("start", {});
      view = "game";
    }
    if (action === "toggle-audio") await setAudio(!audioOn);
    if (action === "toggle-actions") actionsOpen = !actionsOpen;
    if (action === "rp-submit") await postAction("rp", { text: String(new FormData(el).get("rp") || "").trim() });
    if (action === "npc-talk") await postAction("npc", { npcId: el.dataset.npc, kind: el.dataset.kind });
    if (action === "set-travel") await postAction("travel-goal", { locationId: el.dataset.location });
    if (action === "continue-travel") await postAction("continue-travel", {});
    if (action === "custom-action") await postAction("custom", { text: String(new FormData(el).get("custom") || "").trim() });
    if (action === "suggested-custom") await postAction("custom", { text: el.dataset.text || "" });
    if (["npc-talk", "set-travel", "continue-travel", "custom-action", "suggested-custom"].includes(action)) {
      actionsOpen = false;
      if (action === "set-travel") openDrawer = null;
    }
    render();
  } catch (error) {
    alert(error.message || "Something went wrong.");
    render();
  }
}

async function joinLobby(form) {
  const data = new FormData(form);
  draft = {
    ...draft,
    name: String(data.get("name") || "").trim(),
    age: String(data.get("age") || ""),
    classId: String(data.get("classId") || draft.classId),
    faceClaimId: String(data.get("faceClaimId") || draft.faceClaimId)
  };
  await withBusy(async () => {
    const data = await api(`/api/rooms/${encodeURIComponent(draft.roomCode)}/join`, {
      method: "POST",
      body: draft
    });
    room = data.room;
    currentPlayerId = data.playerId;
    localStorage.setItem("uhfr-current-player", currentPlayerId);
    localStorage.setItem("uhfr-room-code", room.code);
    view = "lobby";
  });
}

async function postAction(action, body) {
  if (!room?.code) return;
  storyAutoScroll = true;
  await withBusy(async () => {
    const data = await api(`/api/rooms/${encodeURIComponent(room.code)}/${action}`, {
      method: "POST",
      body: { playerId: currentPlayerId, ...body }
    });
    room = data.room;
  });
}

async function withBusy(fn) {
  busy = true;
  render();
  try {
    await fn();
  } finally {
    busy = false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function initials(text) {
  return text.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";
}

function label(text) {
  return text.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function isTyping() {
  const active = document.activeElement;
  return active && ["INPUT", "TEXTAREA"].includes(active.tagName);
}

function rememberStoryScroll() {
  const feed = document.querySelector(".storyFeed");
  if (!feed) return;
  storyScrollTop = feed.scrollTop;
  storyAutoScroll = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 28;
  if (!storyAutoScroll) markStoryScrollActive();
}

function markStoryScrollActive() {
  storyScrollActiveUntil = Date.now() + 3500;
}

function roomSignature(value) {
  if (!value) return "";
  const player = value.players?.[currentPlayerId];
  return JSON.stringify({
    code: value.code,
    started: value.started,
    phase: value.phase,
    logs: value.logs?.length || 0,
    lastLog: value.logs?.at(-1)?.id || "",
    players: Object.keys(value.players || {}).length,
    lobbyChat: value.lobbyChat?.length || 0,
    location: player?.locationId,
    travelGoal: player?.travelGoal,
    stats: player?.core,
    suggested: value.suggestedActions?.[currentPlayerId]?.map((item) => item.label).join("|") || ""
  });
}

async function setAudio(next) {
  audioOn = next;
  if (audioOn) {
    audioEngine ||= createAudioEngine();
    await audioEngine.start();
  } else {
    audioEngine?.stop();
  }
}

function playAudioSting(type) {
  if (!audioOn || !audioEngine) return;
  if (type === "gm" || type === "world") audioEngine.sting(type);
}

function createAudioEngine() {
  let ctx;
  let master;
  let nodes = [];

  function makeNoiseBuffer(context, seconds = 2) {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  return {
    async start() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      ctx ||= new AudioCtor();
      await ctx.resume();
      this.stop();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);

      const drone = ctx.createOscillator();
      const droneGain = ctx.createGain();
      drone.type = "sine";
      drone.frequency.value = 54;
      droneGain.gain.value = 0.22;
      drone.connect(droneGain).connect(master);
      drone.start();

      const pulse = ctx.createOscillator();
      const pulseGain = ctx.createGain();
      pulse.type = "triangle";
      pulse.frequency.value = 0.42;
      pulseGain.gain.value = 0.045;
      pulse.connect(pulseGain).connect(master);
      pulse.start();

      const noise = ctx.createBufferSource();
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      noise.buffer = makeNoiseBuffer(ctx, 3);
      noise.loop = true;
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.value = 720;
      noiseGain.gain.value = 0.055;
      noise.connect(noiseFilter).connect(noiseGain).connect(master);
      noise.start();

      nodes = [drone, pulse, noise, master];
    },
    stop() {
      for (const node of nodes) {
        try {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        } catch {}
      }
      nodes = [];
    },
    sting(type) {
      if (!ctx || !master) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === "world" ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(type === "world" ? 96 : 146, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(type === "world" ? 44 : 72, ctx.currentTime + 0.9);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.05);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 1.1);
    }
  };
}
