import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { locations } from "./src/data.js";
import {
  addPlayer,
  appendLog,
  continueTravel,
  createPlayer,
  createRoom,
  interactWithNpc,
  sameLocationPlayers,
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
  const room = getRoom(code);

  if (req.method === "GET" && !action) {
    sendJson(res, 200, { room });
    return;
  }

  const body = await readBody(req);

  if (req.method === "POST" && action === "join") {
    const player = createPlayer(body);
    addPlayer(room, player);
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

  if (req.method === "POST" && action === "start") {
    for (const [locationId, players] of groupPlayersByLocation(room)) {
      if (room.logs.some((log) => log.type === "gm" && log.eventKind === "spawn" && log.locationId === locationId)) continue;
      appendSceneImage(room, locationId, "location");
      const text = await gmText(room, players[0], { kind: "spawn", sharedScene: true, players: players.map((item) => item.name) });
      appendLog(room, { type: "gm", eventKind: "spawn", scope: "location", locationId, text });
      updateSuggestedForLocation(room, locationId, "spawn");
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
    const gm = await gmText(room, player, { kind: "rp", text });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text: gm });
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "rp");
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
    const gm = await gmText(room, player, { kind: "player-message", recipientName: recipient.name, text });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text: gm });
    updateSuggestedForLocation(room, player.locationId, "player-message");
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "npc") {
    const result = interactWithNpc(room, player.id, body.npcId, body.kind);
    if (!result.ok) return sendJson(res, 400, { error: result.reason });
    const text = await gmText(room, player, { kind: "npc", ...result });
    appendLog(room, { type: "gm", scope: "location", playerId: player.id, locationId: player.locationId, text });
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "npc");
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "travel-goal") {
    const result = setTravelGoal(room, player.id, body.locationId);
    appendLog(room, { type: result.ok ? "system" : "gm", scope: "private", playerId: player.id, locationId: player.locationId, text: result.ok ? result.text : result.reason });
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, player, "travel-goal");
    await persistRooms();
    sendJson(res, 200, { room });
    return;
  }

  if (req.method === "POST" && action === "continue-travel") {
    const result = continueTravel(room, player.id);
    const text = await gmText(room, room.players[player.id], { kind: "travel", ...result });
    if (result.ok) appendSceneImage(room, room.players[player.id].locationId, "private", player.id);
    appendLog(room, { type: "gm", scope: "private", playerId: player.id, locationId: room.players[player.id].locationId, text });
    room.suggestedActions ||= {};
    room.suggestedActions[player.id] = suggestActions(room, room.players[player.id], "travel");
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
    room.suggestedActions ||= {};
    updateSuggestedForLocation(room, player.locationId, "custom");
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

function updateSuggestedForLocation(room, locationId, reason) {
  room.suggestedActions ||= {};
  for (const player of Object.values(room.players).filter((item) => item.locationId === locationId)) {
    room.suggestedActions[player.id] = suggestActions(room, player, reason);
  }
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
    image: sceneImageDataUrl(location, room.phase, key)
  });
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

function suggestActions(room, player, reason) {
  const location = locations[player.locationId];
  const actions = [];

  if (player.travelGoal) {
    actions.push({ label: `Continue toward ${locations[player.travelGoal].name}`, action: "continue-travel" });
  }

  if (location?.npc) {
    actions.push({ label: `Talk to ${npcLabel(location.npc)}`, action: "npc-talk", npcId: location.npc, kind: "talk" });
    actions.push({ label: `Ask ${npcLabel(location.npc)} what they know`, action: "npc-talk", npcId: location.npc, kind: "ask" });
  }

  actions.push({ label: "Watch the surroundings", action: "suggested-custom", text: "watch the surroundings carefully for anything unusual" });
  actions.push({ label: "Check phone messages", action: "suggested-custom", text: "check my phone messages and campus chats for updates" });

  if (sameLocationPlayers(room, player).length > 1) {
    actions.push({ label: "Support nearby player", action: "suggested-custom", text: "quietly support the nearby player and compare what we noticed" });
  }

  for (const routeId of (location?.routes || []).slice(0, 3)) {
    if (locations[routeId]?.known) {
      actions.push({ label: `Head toward ${locations[routeId].name}`, action: "set-travel", locationId: routeId });
    }
  }

  if (reason === "custom" || reason === "rp") {
    actions.push({ label: "Push the scene carefully", action: "suggested-custom", text: "take a careful next step without drawing unnecessary attention" });
  }

  return actions.slice(0, 7);
}

function npcLabel(npcId) {
  return npcId.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

async function gmText(room, player, event) {
  const payload = buildGmPayload(room, player, event, sameLocationPlayers(room, player));
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
    "When multiple players are in the same location, treat them as sharing one scene. Give one consistent narration for everyone there; NPC dialogue must not contradict itself across players.",
    "Player-to-player messages in the same location are in-scene conversation. Narrate the exchange so all same-location players understand what was said, and let the conversation influence the next pressure point.",
    "You may logically bring an NPC into a scene only if their location, role, route, or reason for being nearby makes sense. Do not teleport important NPCs without plausible cause.",
    "Use the current outbreak phase strictly. In normalcy, do not introduce zombies, hordes, gunfire, mass panic, or open collapse.",
    "You may use subtle unease, gossip, clinic tension, phone messages, staff nerves, crowd behavior, and location texture.",
    "Never mutate mechanics. Do not decide stats, inventory, XP, travel, injury, death, relationships, resources, mission state, or phase.",
    "If approvedMechanicalEvent says a custom action failed or was blocked, narrate that limit clearly and dramatically without rewarding success.",
    "If an NPC is present, speak as that NPC using their voice style. Pidgin must be natural, readable, and NPC-appropriate, never parody.",
    "This is adult RP, so mature romance, attraction, flirtation, relationship tension, consent conversations, and non-graphic intimacy are allowed when all characters are adults.",
    "Do not write explicit sexual content or graphic erotic detail. If a scene becomes sexual, handle it with consent-aware implication, emotional focus, or fade to black, then return to consequences, relationship memory, and story pressure.",
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
    return JSON.parse(await readFile(statePath, "utf8"));
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
