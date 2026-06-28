import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { locations, phases } from "./src/data.js";
import {
  addPlayer,
  advanceTimeline,
  appendLog,
  applyRpEffects,
  consumeInventoryItem,
  continueTravel,
  createPlayer,
  createRoom,
  ensureRoomState,
  getPlayerRelationship,
  interactWithNpc,
  isLocationAvailable,
  sameLocationPlayers,
  setPlayerRelationship,
  setTravelGoal,
  validateCustomAction
} from "./src/rules.js";
import { buildGmPayload, localGmNarration } from "./src/gm.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || join(root, "data");
const statePath = join(dataDir, "rooms.json");
await loadDotEnv();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

let rooms = await loadRooms();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`UHFR running locally at http://localhost:${port}`);
  for (const address of lanAddresses()) {
    console.log(`Phone/LAN access: http://${address}:${port}`);
  }
  console.log(process.env.OPENAI_API_KEY ? "OpenAI GM: enabled" : "OpenAI GM: fallback mode (set OPENAI_API_KEY to enable)");
});

async function routeApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, openai: Boolean(process.env.OPENAI_API_KEY), rooms: Object.keys(rooms).length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/network") {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
    const publicUrl = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
    sendJson(res, 200, { port, addresses: lanAddresses(), publicUrl, openai: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }

  if (parts[1] !== "rooms" || !parts[2]) {
    sendJson(res, 404, { error: "Unknown API route" });
    return;
  }

  const code = parts[2].toUpperCase();
  const action = parts[3] || "";

  if (req.method === "GET" && !action) {
    if (!rooms[code]) {
      sendJson(res, 200, { room: null });
      return;
    }
    sendJson(res, 200, { room: getRoom(code) });
    return;
  }

  const body = await readBody(req);
  const room = getRoom(code);

  if (req.method === "POST" && action === "join") {
    const player = createPlayer(body);
    addPlayer(room, player);
    appendSceneImage(room, player.locationId, "private", player.id);
    room.lobbyChat ||= [];
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, player, "spawn");
    await persistRooms();
    sendJson(res, 200, { room, playerId: player.id });
    return;
  }

  if (req.method === "POST" && action === "lobby-chat") {
    const player = room.players[body.playerId];
    if (!player) return sendJson(res, 404, { error: "Player not found" });
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: "Message is required" });
    room.lobbyChat ||= [];
    room.lobbyChat.push({ id: crypto.randomUUID(), name: player.name, text });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "exit") {
    const player = room.players[body.playerId];
    if (!player) return sendJson(res, 404, { error: "Player not found" });
    const save = body.save !== false;
    if (save) {
      player.lastActiveAt = new Date().toISOString();
      appendLog(room, {
        type: "system",
        scope: "private",
        playerId: player.id,
        locationId: player.locationId,
        text: `${player.name}'s session is saved at ${locations[player.locationId].name}.`
      });
    } else {
      removePlayerFromRoom(room, player.id);
    }
    await persistRooms();
    sendJson(res, 200, { room, saved: save });
    return;
  }

  if (req.method === "POST" && action === "start") {
    for (const [locationId, players] of groupPlayersByLocation(room)) {
      if (room.logs.some((log) => log.type === "gm" && log.eventKind === "spawn" && log.locationId === locationId)) continue;
      appendSceneImage(room, locationId, "location");
      const text = await gmText(room, players[0], { kind: "spawn", sharedScene: true, players: players.map((item) => item.name) });
      appendLog(room, { type: "gm", eventKind: "spawn", scope: "location", locationId, text });
      updateSuggestedForLocation(room, locationId, "spawn", text);
    }
    room.started = true;
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  const player = room.players[body.playerId];
  if (!player) return sendJson(res, 404, { error: "Player not found" });

  if (req.method === "POST" && action === "rp") {
    const text = String(body.text || "").trim().slice(0, 2400);
    if (!text) return sendJson(res, 400, { error: "RP text is required" });
    appendLog(room, { type: "player", scope: "location", playerId: player.id, locationId: player.locationId, text: `${player.name}: ${text}` });
    const effects = applyRpEffects(room, player.id, text, recentSceneText(room, player));
    for (const note of effects) {
      appendLog(room, { type: "system", scope: "private", playerId: player.id, locationId: player.locationId, text: note });
    }
    const gm = await gmText(room, player, { kind: "rp", text });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text: gm });
    await advanceAndMaybeRecap(room, player, 1, "rp");
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "rp", gm);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "player-message") {
    const recipient = room.players[body.recipientId];
    const text = String(body.text || "").trim().slice(0, 900);
    if (!recipient) return sendJson(res, 404, { error: "Recipient not found" });
    if (recipient.locationId !== player.locationId) return sendJson(res, 400, { error: "That player is not in your current space." });
    if (!text) return sendJson(res, 400, { error: "Message is required" });
    appendLog(room, {
      type: "player",
      scope: "location",
      playerId: player.id,
      locationId: player.locationId,
      text: `${player.name} to ${recipient.name}: ${text}`
    });
    await advanceAndMaybeRecap(room, player, 1, "player-message");
    updateSuggestedForLocation(room, player.locationId, "player-message", text);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "private-rp") {
    const recipient = room.players[body.recipientId];
    const text = String(body.text || "").trim().slice(0, 2400);
    if (!recipient) return sendJson(res, 404, { error: "Recipient not found" });
    if (recipient.locationId !== player.locationId) return sendJson(res, 400, { error: "That player is not in your current space." });
    if (Number(player.age) < 18 || Number(recipient.age) < 18) return sendJson(res, 400, { error: "Private adult RP requires both characters to be adults." });
    if (!text) return sendJson(res, 400, { error: "Private RP text is required." });
    appendLog(room, {
      type: "player",
      scope: "direct",
      privateRp: true,
      participants: [player.id, recipient.id],
      playerId: player.id,
      locationId: player.locationId,
      text: `${player.name} privately to ${recipient.name}: ${text}`
    });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "set-relationship") {
    const target = room.players[body.targetId];
    if (!target) return sendJson(res, 404, { error: "Target player not found." });
    const result = setPlayerRelationship(room, player.id, target.id, String(body.status || "neutral"));
    if (!result.ok) return sendJson(res, 400, { error: result.reason });
    appendLog(room, {
      type: "system",
      scope: "private",
      playerId: player.id,
      locationId: player.locationId,
      text: `You now regard ${target.name} as ${relationshipLabel(result.relationship.status)}.`
    });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "use-item") {
    const item = String(body.item || "").trim().slice(0, 80);
    if (!item || !player.inventory.includes(item)) return sendJson(res, 400, { error: "That item is not in your inventory." });
    const result = consumeInventoryItem(room, player.id, item);
    appendLog(room, { type: "system", scope: "private", playerId: player.id, locationId: player.locationId, text: result.text });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "share-number") {
    const recipient = room.players[body.recipientId];
    if (!recipient) return sendJson(res, 404, { error: "Recipient not found" });
    if (recipient.id === player.id) return sendJson(res, 400, { error: "You already know your own number." });
    if (recipient.locationId !== player.locationId) return sendJson(res, 400, { error: "You must be in the same space to offer your number." });
    if (!hasCommunicationDevice(player)) return sendJson(res, 400, { error: "You need a phone or radio to share a contact." });
    if (!hasCommunicationDevice(recipient)) return sendJson(res, 400, { error: `${recipient.name} has no usable communication device.` });
    if (player.contacts?.[recipient.id]) return sendJson(res, 400, { error: "You already have that contact." });
    room.contactRequests ||= [];
    const existing = room.contactRequests.find((request) => request.fromId === player.id && request.toId === recipient.id);
    if (!existing) {
      room.contactRequests.push({ id: crypto.randomUUID(), fromId: player.id, toId: recipient.id, status: "pending", createdAt: new Date().toISOString() });
    }
    appendLog(room, {
      type: "system",
      scope: "direct",
      participants: [player.id, recipient.id],
      locationId: player.locationId,
      text: `${player.name} offers to share an in-game contact number with ${recipient.name}.`
    });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "respond-contact") {
    const request = (room.contactRequests || []).find((item) => item.id === body.requestId && item.toId === player.id && item.status === "pending");
    if (!request) return sendJson(res, 404, { error: "Contact request not found." });
    const requester = room.players[request.fromId];
    if (!requester) return sendJson(res, 404, { error: "Requesting player is no longer in the room." });
    const accepted = body.accept !== false;
    request.status = accepted ? "accepted" : "declined";
    request.resolvedAt = new Date().toISOString();
    if (accepted) {
      requester.contacts ||= {};
      player.contacts ||= {};
      requester.contacts[player.id] = { name: player.name, number: player.phoneNumber, method: "phone", addedAt: request.resolvedAt };
      player.contacts[requester.id] = { name: requester.name, number: requester.phoneNumber, method: "phone", addedAt: request.resolvedAt };
    }
    appendLog(room, {
      type: "system",
      scope: "direct",
      participants: [requester.id, player.id],
      locationId: player.locationId,
      text: accepted
        ? `${player.name} accepts ${requester.name}'s contact exchange. They can now call each other while devices and network allow it.`
        : `${player.name} declines ${requester.name}'s contact exchange.`
    });
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "call-player") {
    const recipient = room.players[body.recipientId];
    const text = String(body.text || "").trim().slice(0, 900);
    if (!recipient) return sendJson(res, 404, { error: "Recipient not found" });
    if (!text) return sendJson(res, 400, { error: "Call message is required." });
    if (!hasCommunicationDevice(player)) return sendJson(res, 400, { error: "You need a phone or radio to call." });
    if (!hasCommunicationDevice(recipient)) return sendJson(res, 400, { error: `${recipient.name} has no usable communication device.` });
    if (!player.contacts?.[recipient.id]) return sendJson(res, 400, { error: "You do not have that player's number." });
    if (!communicationsOnline(room)) return sendJson(res, 400, { error: "The communication network is not working right now." });
    appendLog(room, {
      type: "player",
      scope: "direct",
      participants: [player.id, recipient.id],
      playerId: player.id,
      locationId: player.locationId,
      text: `${player.name} calls ${recipient.name}: ${text}`
    });
    const gm = await gmText(room, player, { kind: "call", recipientName: recipient.name, text });
    appendLog(room, { type: "gm", scope: "direct", participants: [player.id, recipient.id], playerId: player.id, locationId: player.locationId, text: gm });
    await advanceAndMaybeRecap(room, player, 1, "call");
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, player, "call", gm);
    room.suggestedActions[recipient.id] = suggestActions(room, recipient, "call", gm);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "npc") {
    const result = interactWithNpc(room, player.id, body.npcId, body.kind);
    if (!result.ok) return sendJson(res, 400, { error: result.reason });
    const text = await gmText(room, player, { kind: "npc", ...result });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text });
    await advanceAndMaybeRecap(room, player, 2, "npc");
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "npc", text);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "travel-goal") {
    const result = setTravelGoal(room, player.id, body.locationId);
    appendLog(room, { type: result.ok ? "system" : "gm", scope: "private", playerId: player.id, locationId: player.locationId, text: result.ok ? result.text : result.reason });
    if (result.ok) {
      const travel = continueTravel(room, player.id);
      if (travel.ok) {
        appendSceneImage(room, room.players[player.id].locationId, "private", player.id);
        const text = await gmText(room, room.players[player.id], { kind: "travel", ...travel });
        appendLog(room, { type: "gm", scope: "private", playerId: player.id, locationId: room.players[player.id].locationId, text });
        await advanceAndMaybeRecap(room, player, 2, "travel");
      }
    }
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, room.players[player.id], "travel-goal");
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "continue-travel") {
    const result = continueTravel(room, player.id);
    const text = await gmText(room, room.players[player.id], { kind: "travel", ...result });
    if (result.ok) appendSceneImage(room, room.players[player.id].locationId, "private", player.id);
    appendLog(room, { type: "gm", scope: "private", playerId: player.id, locationId: room.players[player.id].locationId, text });
    if (result.ok) await advanceAndMaybeRecap(room, player, 2, "travel");
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, room.players[player.id], "travel", text);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "custom") {
    const text = String(body.text || "").trim().slice(0, 1200);
    if (!text) return sendJson(res, 400, { error: "Custom action is required" });
    appendLog(room, { type: "player", scope: "location", playerId: player.id, locationId: player.locationId, text: `${player.name} attempts: ${text}` });
    const result = validateCustomAction(room, player.id, text);
    const gm = await gmText(room, player, { kind: "custom", text, ...result });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text: gm });
    await advanceAndMaybeRecap(room, player, result.allowed ? 3 : 1, "custom");
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "custom", gm);
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  sendJson(res, 404, { error: "Unknown room action" });
}

function groupPlayersByLocation(room) {
  const groups = new Map();
  for (const player of Object.values(room.players)) {
    if (!groups.has(player.locationId)) groups.set(player.locationId, []);
    groups.get(player.locationId).push(player);
  }
  return groups.entries();
}

function updateSuggestedForLocation(room, locationId, reason, sceneText = "") {
  room.suggestedActions ||= {};
  for (const player of Object.values(room.players).filter((item) => item.locationId === locationId)) {
    room.suggestedActions[player.id] = suggestActions(room, player, reason, sceneText);
  }
}

async function advanceAndMaybeRecap(room, player, effort, reason) {
  const phaseChanged = advanceTimeline(room, player.id, effort, reason);
  await maybeCreateRecap(room, player, reason, phaseChanged);
}

async function maybeCreateRecap(room, player, reason, phaseChanged) {
  room.timeline ||= { progress: 0, turn: 0, lastAdvancedBy: null, lastAdvancedAt: null, lastRecapProgress: 0 };
  room.recaps ||= [];
  const progress = room.timeline.progress || 0;
  const intervalHit = progress > 0 && progress - (room.timeline.lastRecapProgress || 0) >= 12;
  if (!phaseChanged && !intervalHit) return;

  const episodeNumber = room.recaps.length + 1;
  const kind = phaseChanged ? "phase" : "episode";
  const title = phaseChanged
    ? `${relationshipLabel(room.phase)} Checkpoint`
    : `Episode ${episodeNumber} Recap`;
  const text = await recapText(room, player, { kind, reason, episodeNumber, phaseChanged });
  const image = recapImageDataUrl(room, episodeNumber, kind);
  const recap = {
    id: crypto.randomUUID(),
    episodeNumber,
    kind,
    phase: room.phase,
    progress,
    createdAt: new Date().toISOString(),
    title,
    text
  };
  room.recaps.push(recap);
  room.timeline.lastRecapProgress = progress;
  appendLog(room, {
    type: "recap",
    scope: "global",
    eventKind: "recap",
    audioCue: "recap",
    image,
    title,
    text
  });
}

async function recapText(room, player, meta) {
  const fallback = () => localRecap(room, meta);
  if (!process.env.OPENAI_API_KEY) return fallback();
  const story = room.logs
    .filter((log) => ["player", "gm", "world", "system"].includes(log.type) && !log.privateRp)
    .slice(-24)
    .map((log) => `${log.type.toUpperCase()}: ${log.text}`)
    .join("\n");
  const players = Object.values(room.players).map((item) => ({
    name: item.name,
    classId: item.classId,
    sex: item.sex,
    level: item.level,
    location: locations[item.locationId]?.name,
    core: item.core
  }));
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              "Write a cinematic episode recap for UHFR: Outbreak Port Harcourt.",
              "Use a movie-trailer recap voice from the combined POV of all players.",
              "Include intense actions, meaningful dialogue echoes, relationships, betrayals, clues, and unresolved hooks.",
              "Do not quote or summarize privateRp/direct intimate content.",
              "Keep it 2-4 compact paragraphs and end with a hook into the next phase or episode."
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({
              phase: room.phase,
              clock: room.clock,
              timeline: room.timeline,
              recapMeta: meta,
              players,
              relationships: room.playerRelationships || {},
              research: room.research,
              bases: room.bases,
              recentStory: story
            }, null, 2)
          }
        ],
        temperature: 0.85,
        max_output_tokens: 520
      })
    });
    if (!response.ok) {
      console.error("OpenAI recap error", response.status, await response.text());
      return fallback();
    }
    const data = await response.json();
    return extractResponseText(data) || fallback();
  } catch (error) {
    console.error("OpenAI recap request failed", error.message);
    return fallback();
  }
}

function localRecap(room, meta) {
  const names = Object.values(room.players).map((player) => player.name).join(", ") || "the survivors";
  const recent = room.logs
    .filter((log) => ["player", "gm", "world"].includes(log.type) && !log.privateRp)
    .slice(-6)
    .map((log) => log.text)
    .join(" ");
  return `${meta.kind === "phase" ? "The timeline turns." : `Episode ${meta.episodeNumber} closes like a held breath.`} ${names} have pushed UHFR into ${room.phase}, carrying every choice, argument, clue, and risk forward. ${recent || "The campus still pretends to be ordinary, but the silence has started keeping score."}\n\nNow the next stretch opens with pressure already waiting: who gets trusted, who gets used, and what truth arrives too late?`;
}

function recapImageDataUrl(room, episodeNumber, kind) {
  const colors = {
    normalcy: ["#162820", "#f1bd55", "#e7efe6"],
    unease: ["#1e2d35", "#d6a24a", "#c3d3d3"],
    disruption: ["#302638", "#d45c48", "#e2d7cb"],
    "local-danger": ["#351d22", "#d45c48", "#f1bd55"],
    "open-outbreak": ["#111010", "#982c2c", "#d8d2c2"]
  }[room.phase] || ["#162820", "#f1bd55", "#e7efe6"];
  const title = `${kind === "phase" ? "PHASE" : "EPISODE"} ${episodeNumber}`;
  const subtitle = `${room.phase.toUpperCase()} | DAY ${room.clock.day}, ${room.clock.time}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" role="img" aria-label="Episode recap">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset=".62" stop-color="#090d0d"/><stop offset="1" stop-color="#000"/></linearGradient>
      <filter id="grain"><feTurbulence baseFrequency="0.75" numOctaves="3"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="640" height="300" fill="url(#bg)"/>
    <path d="M0 210 C100 160 180 230 290 180 S520 145 640 198 L640 300 L0 300Z" fill="#101818" opacity=".96"/>
    <path d="M46 238 H594" stroke="${colors[1]}" stroke-width="3" opacity=".7"/>
    <circle cx="506" cy="76" r="38" fill="${colors[1]}" opacity=".28"/>
    <rect x="72" y="92" width="118" height="104" rx="5" fill="${colors[2]}" opacity=".16"/>
    <rect x="222" y="72" width="172" height="132" rx="5" fill="${colors[2]}" opacity=".12"/>
    <rect x="426" y="112" width="92" height="88" rx="5" fill="${colors[2]}" opacity=".1"/>
    <text x="42" y="58" fill="${colors[1]}" font-family="Arial, sans-serif" font-size="17" font-weight="700">${escapeXml(subtitle)}</text>
    <text x="42" y="104" fill="#f7f3ea" font-family="Arial, sans-serif" font-size="44" font-weight="900">${escapeXml(title)}</text>
    <text x="42" y="138" fill="#d8d2c2" font-family="Arial, sans-serif" font-size="20" font-weight="700">Previously on UHFR: Outbreak Port Harcourt</text>
    <rect width="640" height="300" filter="url(#grain)" opacity=".07"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function removePlayerFromRoom(room, playerId) {
  const player = room.players[playerId];
  if (!player) return;
  appendLog(room, {
    type: "system",
    scope: "location",
    playerId,
    locationId: player.locationId,
    text: `${player.name} leaves the current UHFR timeline.`
  });
  delete room.players[playerId];
  if (room.suggestedActions) delete room.suggestedActions[playerId];
  room.contactRequests = (room.contactRequests || []).filter((request) => request.fromId !== playerId && request.toId !== playerId);
  for (const key of Object.keys(room.playerRelationships || {})) {
    const relationship = room.playerRelationships[key];
    if (relationship.fromId === playerId || relationship.toId === playerId) delete room.playerRelationships[key];
  }
  for (const other of Object.values(room.players)) {
    if (other.contacts) delete other.contacts[playerId];
  }
  for (const key of Object.keys(room.relationships || {})) {
    if (key.startsWith(`${playerId}:`)) delete room.relationships[key];
  }
  for (const key of Object.keys(room.locks || {})) {
    if (room.locks[key]?.playerId === playerId) delete room.locks[key];
  }
}

function hasCommunicationDevice(player) {
  return (player.inventory || []).some((item) => ["phone", "radio"].includes(item));
}

function relationshipLabel(status) {
  return status.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function communicationsOnline(room) {
  return room.resources?.network !== "down";
}

function appendSceneImage(room, locationId, scope, playerId = null) {
  const location = locations[locationId];
  const key = `${room.phase}:${locationId}:${room.logs.filter((log) => log.type === "scene-image" && log.locationId === locationId).length}`;
  appendLog(room, {
    type: "scene-image",
    scope,
    playerId,
    locationId,
    text: `${location.name} scene`,
    image: sceneImageSrc(locationId, location, room.phase, key)
  });
}

function sceneImageSrc(locationId, location, phase, key) {
  const assetPath = join(root, "assets", "locations", `${locationId}.png`);
  if (existsSync(assetPath)) return `/assets/locations/${locationId}.png`;
  return sceneImageDataUrl(location, phase, key);
}

function sceneImageDataUrl(location, phase, key) {
  const colors = {
    normalcy: ["#21372f", "#f1bd55", "#d7e5d7"],
    unease: ["#26353d", "#d6a24a", "#b8c6c6"],
    disruption: ["#332f3d", "#d45c48", "#ddd2c6"],
    "local-danger": ["#3b2426", "#d45c48", "#f1bd55"],
    "open-outbreak": ["#1a1718", "#9c2f2f", "#d8d2c2"]
  }[phase] || ["#21372f", "#f1bd55", "#d7e5d7"];
  const seed = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const sunX = 35 + (seed % 80);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 260" role="img" aria-label="${escapeXml(location.name)}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="#080d0d"/></linearGradient>
      <filter id="grain"><feTurbulence baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="640" height="260" fill="url(#g)"/>
    <circle cx="${sunX}" cy="58" r="26" fill="${colors[1]}" opacity=".82"/>
    <path d="M0 190 C120 150 180 205 310 166 S520 150 640 184 L640 260 L0 260Z" fill="#101818" opacity=".94"/>
    <path d="M70 172 L150 110 L245 172 Z M260 174 L352 94 L472 174 Z" fill="${colors[2]}" opacity=".18"/>
    <rect x="90" y="135" width="110" height="72" rx="4" fill="#dfe8df" opacity=".22"/>
    <rect x="250" y="126" width="170" height="86" rx="5" fill="#f4efe4" opacity=".18"/>
    <path d="M20 220 H620" stroke="${colors[1]}" stroke-width="3" opacity=".6"/>
    <text x="28" y="236" fill="#f7f3ea" font-family="Arial, sans-serif" font-size="24" font-weight="700">${escapeXml(location.name)}</text>
    <text x="28" y="42" fill="#f1bd55" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(phase.toUpperCase())}</text>
    <rect width="640" height="260" filter="url(#grain)" opacity=".06"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

function suggestActions(room, player, reason, sceneText = "") {
  const location = locations[player.locationId];
  const actions = [];
  const scene = `${sceneText} ${recentSceneText(room, player)}`.toLowerCase();

  if (player.travelGoal) {
    actions.push({ label: `Continue toward ${locations[player.travelGoal].name}`, action: "continue-travel" });
  }

  for (const action of sceneActions(scene, player, location, room)) actions.push(action);

  if (location?.npc && actions.length < 6) {
    actions.push({ label: `Talk to ${npcLabel(location.npc)}`, action: "npc-talk", npcId: location.npc, kind: "talk" });
    actions.push({ label: `Ask ${npcLabel(location.npc)} what they know`, action: "npc-talk", npcId: location.npc, kind: "ask" });
  }

  if (sameLocationPlayers(room, player).length > 1) {
    actions.push({ label: "Signal another player quietly", action: "suggested-custom", text: "quietly signal a nearby player and coordinate without drawing the room's attention" });
  }

  const routeLimit = actions.length >= 5 ? 1 : 2;
  for (const routeId of (location?.routes || []).filter((id) => isLocationAvailable(room, id)).slice(0, routeLimit)) {
    if (isLocationAvailable(room, routeId)) {
      actions.push({ label: `Head toward ${locations[routeId].name}`, action: "set-travel", locationId: routeId });
    }
  }

  if (phases.indexOf(room.phase) >= phases.indexOf("local-danger") && player.locationId === "main-gate") {
    actions.push({ label: "Push beyond UHFR", action: "set-travel", locationId: "rumuokoro-junction" });
  }
  if (phases.indexOf(room.phase) >= phases.indexOf("open-outbreak")) {
    actions.push({ label: "Look for a defensible base", action: "suggested-custom", text: "search this area for a defensible place to secure as a base" });
    actions.push({ label: "Recruit survivors carefully", action: "suggested-custom", text: "organize trustworthy survivors into a small community network" });
    actions.push({ label: "Search for cure leads", action: "suggested-custom", text: "search for samples, records, or medical leads that could help fight the virus" });
  }

  if (actions.length < 4) {
    actions.push({ label: "Read the room", action: "suggested-custom", text: "study the room for the person, exit, or clue everyone else is missing" });
    actions.push({ label: "Make a risky choice", action: "suggested-custom", text: "make a bold choice that could help me or make the situation worse" });
  }

  return dedupeActions(actions).slice(0, 7);
}

function recentSceneText(room, player) {
  return room.logs
    .filter((log) => !log.privateRp && (log.scope === "global" || log.locationId === player.locationId || log.playerId === player.id))
    .slice(-5)
    .map((log) => log.text || "")
    .join(" ");
}

function sceneActions(scene, player, location, room) {
  const actions = [];
  if (player.locationId === "lecture-hall" && phases.indexOf(room.phase) <= phases.indexOf("disruption")) {
    actions.push({ label: "Watch the bitten student", action: "suggested-custom", text: "watch the late student closely and look for signs of a hidden bite or fever" });
    actions.push({ label: "Warn the lecturer quietly", action: "suggested-custom", text: "quietly warn the lecturer that the late student may be sick or bitten" });
    actions.push({ label: "Move toward the exit", action: "suggested-custom", text: "shift toward the classroom exit without causing panic" });
    actions.push({ label: "Confront him openly", action: "suggested-custom", text: "openly confront the late student about the bite and risk causing panic" });
  }
  if (player.classId === "security" && /(bite|bitten|student|class|crowd|door|gate|radio|security)/.test(scene)) {
    actions.push({ label: "Radio for campus lockdown", action: "suggested-custom", text: "use my security radio to request a quiet lockdown and medical backup" });
    actions.push({ label: "Control the exit", action: "suggested-custom", text: "control the nearest exit and keep the crowd from crushing each other" });
  }
  if (player.classId === "mechanic" && /(power|generator|light|flicker|lab|yard|radio|door|lock)/.test(scene)) {
    actions.push({ label: "Check the power fault", action: "suggested-custom", text: "inspect the power fault and look for a safe way to keep lights or doors working" });
    actions.push({ label: "Find a tool route", action: "suggested-custom", text: "look for a maintenance route or tool access that others would miss" });
  }
  if (/(bite|bitten|blood|sweat|stagger|stumble|wound|fever|shaking)/.test(scene)) {
    actions.push({ label: "Identify the bite", action: "suggested-custom", text: "look for the bite and judge how dangerous the person is without touching them" });
    actions.push({ label: "Separate him from the class", action: "suggested-custom", text: "try to separate the bitten student from the rest of the class without triggering panic" });
    actions.push({ label: "Pretend nothing is wrong", action: "suggested-custom", text: "pretend nothing is wrong and let the situation keep moving, even if that is dangerous" });
  }
  if (/(how do you respond|waiting for your take|looks at you expectantly|asks you|question)/.test(scene)) {
    actions.push({ label: "Tell them what you know", action: "suggested-custom", text: "answer honestly and tell them what I know" });
    actions.push({ label: "Ask what they heard first", action: "suggested-custom", text: "ask them what they heard first before revealing anything" });
    actions.push({ label: "Downplay it to avoid panic", action: "suggested-custom", text: "downplay the rumor to avoid starting panic" });
  }
  if (/(food|eat|rice|beans|plantain|cafeteria|offered|meal|mama t)/.test(scene)) {
    actions.push({ label: "Eat and recover", action: "suggested-custom", text: "eat the food and take a moment to recover" });
    actions.push({ label: "Ask why they are offering it", action: "suggested-custom", text: "ask why the food is being offered and watch their reaction" });
    actions.push({ label: "Refuse and keep moving", action: "suggested-custom", text: "refuse the food and keep moving" });
  }
  if (/(cough|fever|sick|clinic|nurse|blood|vomit|case|infection)/.test(scene)) {
    actions.push({ label: "Keep safe distance", action: "suggested-custom", text: "keep a safe distance and watch for symptoms" });
    actions.push({ label: "Offer help carefully", action: "suggested-custom", text: "offer help without exposing myself unnecessarily" });
    actions.push({ label: "Hide the concern", action: "suggested-custom", text: "pretend not to notice the symptoms and see who reacts" });
  }
  if (/(locked|door|gate|key|security|blocked|corridor)/.test(scene)) {
    actions.push({ label: "Check the route quietly", action: "suggested-custom", text: "check the blocked route quietly for another way through" });
    actions.push({ label: "Force the issue", action: "suggested-custom", text: "force the issue even if it draws attention" });
  }
  if (/(crowd|students|panic|argue|group|hostel gossip|rumor)/.test(scene)) {
    actions.push({ label: "Calm the group", action: "suggested-custom", text: "try to calm the group and keep the conversation useful" });
    actions.push({ label: "Listen for the useful rumor", action: "suggested-custom", text: "stay quiet and listen for the most useful rumor" });
    actions.push({ label: "Say the wrong thing", action: "suggested-custom", text: "say something blunt that could make the group turn on me" });
  }
  if (/(phone|whatsapp|message|call|buzz|network)/.test(scene) || player.inventory.includes("phone")) {
    actions.push({ label: "Check phone messages", action: "suggested-custom", text: "check my phone messages and campus chats for updates" });
  }
  if (/(sachet|bottle|water|charger|battery|radio|keys|keycard|documents|folder|medical supplies|bandage|torch|crowbar)/.test(scene)) {
    actions.push({ label: "Pick up useful supplies", action: "suggested-custom", text: "pick up any useful supplies I can realistically carry" });
  }
  if (location?.pressure >= 2) {
    actions.push({ label: "Leave before it worsens", action: "suggested-custom", text: "leave before this place gets worse" });
  }
  return actions;
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.label}:${action.action}:${action.text || action.locationId || action.npcId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function npcLabel(npcId) {
  return npcId.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

async function gmText(room, player, event) {
  const visiblePlayers = sameLocationPlayers(room, player);
  const playerRelationships = Object.fromEntries(
    visiblePlayers
      .filter((other) => other.id !== player.id)
      .map((other) => [other.name, {
        fromPlayer: getPlayerRelationship(room, player.id, other.id),
        towardPlayer: getPlayerRelationship(room, other.id, player.id)
      }])
  );
  const payload = buildGmPayload(room, player, event, visiblePlayers, playerRelationships);
  const fallback = () => localGmNarration(payload);
  if (!process.env.OPENAI_API_KEY) return fallback();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          { role: "system", content: gmSystemPrompt() },
          { role: "user", content: JSON.stringify(payload, null, 2) }
        ],
        temperature: 0.9,
        max_output_tokens: 420
      })
    });

    if (!response.ok) {
      console.error("OpenAI GM error", response.status, await response.text());
      return fallback();
    }

    const data = await response.json();
    return extractResponseText(data) || fallback();
  } catch (error) {
    console.error("OpenAI GM request failed", error.message);
    return fallback();
  }
}

function gmSystemPrompt() {
  return [
    "You are the AI GM for UHFR: Outbreak Port Harcourt, a story-first multiplayer RP survival game.",
    "Narrate the living world and roleplay NPCs in grounded Nigerian campus tone.",
    "React directly to the player's exact RP line or approved action. Continue the scene forward.",
    "Respect the player's sex as character context for address, social expectations, safety concerns, NPC assumptions, hostel access, and relationship dynamics. Use it naturally and avoid stereotypes or reducing characters to sex.",
    "Use playerRelationships as story context. Friends, lovers, mutual partners, enemies, and adversaries can influence trust, jealousy, protection, manipulation, betrayal, alliances, NPC pressure, and plot twists. Do not mechanically force a relationship change; only narrate plausible social pressure.",
    "The story can grow beyond UHFR into Port Harcourt: streets, hospitals, markets, safehouses, communities, hostile groups, resources, and cure investigation are valid once the timeline and routes allow it.",
    "Respect shared timeline progression. Active players may push the world phase forward and gain XP/levels; inactive players return to the current world state, not the moment they left.",
    "You may creatively propose base-building, community management, cure leads, rescue routes, factions, and outside locations, but only narrate them through approved mechanics and available routes.",
    "The outbreak did not begin at UHFR. It is already happening in parts of Nigeria and the world; UHFR enters the crisis when an already-bitten person gets onto campus and reaches class.",
    "The campaign starts in unease, not normalcy. Most non-security/non-mechanic players begin in a classroom where the bitten-person incident can break the illusion of campus routine.",
    "When multiple players are in the same location, treat them as sharing one scene. Give one consistent narration for everyone there; NPC dialogue must not contradict itself across players.",
    "Player-to-player messages in the same location are in-scene conversation, but do not paraphrase or narrate every line they say. Observe silently unless the environment, an NPC, or a consequence needs to interrupt.",
    "You may logically bring an NPC into a scene only if their location, role, route, or reason for being nearby makes sense. Do not teleport important NPCs without plausible cause.",
    "Use the current outbreak phase strictly. In unease, allow rumors, global clips, a hidden bite, sickness, and denial; avoid instant hordes or full collapse until later phases.",
    "You may use subtle unease, gossip, clinic tension, phone messages, staff nerves, crowd behavior, and location texture.",
    "Never mutate mechanics. Do not decide stats, inventory, XP, travel, injury, death, relationships, resources, mission state, or phase.",
    "If approvedMechanicalEvent says a custom action failed or was blocked, narrate that limit clearly and dramatically without rewarding success.",
    "If an NPC is present, speak as that NPC using their voice style. Pidgin must be natural, readable, and NPC-appropriate, never parody.",
    "This is adult RP, so mature romance, attraction, flirtation, relationship tension, consent conversations, and non-graphic intimacy are allowed when all characters are adults.",
    "Do not write explicit sexual content or graphic erotic detail. If a scene becomes sexual, handle it with consent-aware implication, emotional focus, or fade to black, then return to consequences, relationship memory, and story pressure.",
    "Explicit intimate writing between consenting adult players may happen in private direct player logs outside GM narration. Do not narrate, continue, summarize, quote, judge, or embellish those private explicit exchanges.",
    "Keep responses to 1-4 compact paragraphs. End with a pressure point, question, clue, or immediate next beat when useful.",
    "Never reveal private GM notes directly; transform them into hints only when the scene plausibly allows it."
  ].join("\n");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function getRoom(code) {
  rooms[code] ||= createRoom(code);
  ensureRoomState(rooms[code]);
  rooms[code].lobbyChat ||= [];
  return rooms[code];
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root) || !isPublicAssetPath(requested)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function isPublicAssetPath(pathname) {
  return pathname === "/index.html" || pathname.startsWith("/src/") || pathname.startsWith("/assets/");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function loadRooms() {
  if (!existsSync(statePath)) return {};
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    for (const room of Object.values(saved)) ensureRoomState(room);
    return saved;
  } catch {
    return {};
  }
}

async function loadDotEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const content = await readFile(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

async function persistRooms() {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(rooms, null, 2));
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
