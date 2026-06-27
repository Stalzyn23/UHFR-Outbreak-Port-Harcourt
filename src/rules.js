import { classes, difficulty, faceClaims, locations, npcs, phases, spawnLocations } from "./data.js";

const roomKey = (code) => `uhfr-room:${code.toUpperCase()}`;
export const playerRelationshipStatuses = ["neutral", "acquaintance", "friend", "lover", "mutual-partners", "enemy", "adversary"];

export function createRoom(code) {
  return {
    code: code.toUpperCase(),
    phase: "normalcy",
    clock: { day: 1, time: "15:20" },
    timeline: { progress: 0, turn: 0, lastAdvancedBy: null, lastAdvancedAt: null },
    recaps: [],
    players: {},
    relationships: {},
    playerRelationships: {},
    contactRequests: [],
    logs: [],
    globalEvents: [],
    bases: {},
    research: { cureProgress: 0, leads: [] },
    resources: {
      power: "stable",
      network: "working",
      clinicSupplies: 6,
      fuel: 3
    },
    locks: {}
  };
}

export function ensureRoomState(room) {
  room.timeline ||= { progress: 0, turn: 0, lastAdvancedBy: null, lastAdvancedAt: null };
  room.timeline.lastRecapProgress ||= 0;
  room.globalEvents ||= [];
  room.recaps ||= [];
  room.bases ||= {};
  room.research ||= { cureProgress: 0, leads: [] };
  room.resources ||= {};
  room.relationships ||= {};
  room.playerRelationships ||= {};
  room.contactRequests ||= [];
  room.logs ||= [];
  room.players ||= {};
  for (const player of Object.values(room.players)) {
    player.level ||= 1;
    player.xp ||= 0;
    player.phoneNumber ||= generatePhoneNumber();
    player.contacts ||= {};
    player.sex = ["male", "female"].includes(player.sex) ? player.sex : "female";
    player.lastActiveAt ||= null;
    player.core ||= { health: 100, stamina: 92, stress: 18, hunger: 35, thirst: 40, morale: 64, infection: 0 };
    player.stats ||= { ...(classes[player.classId]?.stats || classes.survivor.stats) };
    player.inventory ||= [...(classes[player.classId]?.inventory || classes.survivor.inventory)];
  }
  return room;
}

export function loadRoom(code) {
  const saved = localStorage.getItem(roomKey(code));
  return saved ? JSON.parse(saved) : createRoom(code);
}

export function saveRoom(room) {
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
}

export function createPlayer({ name, age, sex, classId, faceClaimId, faceClaimImage }) {
  const safeClassId = classes[classId] ? classId : "survivor";
  const safeFaceClaimId = faceClaims.some((face) => face.id === faceClaimId) ? faceClaimId : "medical-student";
  const safeName = String(name || "").trim().slice(0, 48) || "Unnamed Survivor";
  const numericAge = Number(age);
  const safeAge = Number.isFinite(numericAge) ? Math.min(80, Math.max(16, numericAge)) : 18;
  const safeSex = ["male", "female"].includes(sex) ? sex : "female";
  const klass = classes[safeClassId];
  const id = crypto.randomUUID();
  const locationId = spawnLocations[Math.floor(Math.random() * spawnLocations.length)];
  return {
    id,
    name: safeName,
    age: safeAge,
    sex: safeSex,
    classId: safeClassId,
    faceClaimId: safeFaceClaimId,
    faceClaimImage: typeof faceClaimImage === "string" && faceClaimImage.startsWith("data:image/") && faceClaimImage.length < 260000
      ? faceClaimImage
      : null,
    phoneNumber: generatePhoneNumber(),
    contacts: {},
    level: 1,
    xp: 0,
    lastActiveAt: null,
    locationId,
    lastKnownLocation: locationId,
    travelGoal: null,
    route: [],
    routeStep: 0,
    core: { health: 100, stamina: 92, stress: 18, hunger: 35, thirst: 40, morale: 64, infection: 0 },
    stats: { ...klass.stats },
    inventory: [...klass.inventory]
  };
}

function generatePhoneNumber() {
  return `080${Math.floor(10000000 + Math.random() * 90000000)}`;
}

export function addPlayer(room, player) {
  placePlayerForRoomSpawn(room, player);
  room.players[player.id] = player;
  room.logs.push({
    id: crypto.randomUUID(),
    type: "system",
    scope: "private",
    playerId: player.id,
    locationId: player.locationId,
    text: `You enter the current UHFR timeline at ${locations[player.locationId].name}.`
  });
  return room;
}

function placePlayerForRoomSpawn(room, player) {
  const existing = Object.values(room.players || {});
  if (!existing.length) return;

  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const anchorRoutes = (locations[anchor.locationId]?.routes || []).filter((id) => spawnLocations.includes(id));
  const clusteredLocations = [anchor.locationId, ...anchorRoutes];

  if (clusteredLocations.length && Math.random() < 0.68) {
    player.locationId = clusteredLocations[Math.floor(Math.random() * clusteredLocations.length)];
    player.lastKnownLocation = player.locationId;
    player.travelGoal = null;
    player.route = [];
    player.routeStep = 0;
  }
}

export function applyRpEffects(room, playerId, text, sceneText = "") {
  const player = room.players[playerId];
  if (!player) return [];
  const lower = text.toLowerCase();
  const sceneLower = sceneText.toLowerCase();
  const combined = `${lower} ${sceneLower}`;
  const notes = [];

  player.core.stamina = Math.max(0, player.core.stamina - 2);

  const eatingIntent = /\b(eat|eats|ate|chew|swallow|take a bite|start eating|finish eating|accept (the )?(food|meal|plate)|eat it|eat some|drink garri)\b/.test(lower);
  const foodPresent = /(food|meal|rice|beans|plantain|bread|snack|biscuit|plate|swallow|garri|yam|suya|meat pie)/.test(combined);
  if (eatingIntent && foodPresent) {
    const before = player.core.hunger;
    player.core.hunger = Math.max(0, player.core.hunger - 18);
    player.core.morale = Math.min(100, player.core.morale + 4);
    notes.push(`Food helped. Hunger ${before} -> ${player.core.hunger}.`);
  }

  const drinkingIntent = /\b(drink|drinks|drank|sip|gulp|rehydrate|take a sip|drink it|drink some)\b/.test(lower);
  const drinkPresent = /(water|sachet|bottle|juice|zobo|drink|pure water)/.test(combined);
  if (drinkingIntent && drinkPresent) {
    const before = player.core.thirst;
    player.core.thirst = Math.max(0, player.core.thirst - 18);
    notes.push(`You rehydrated. Thirst ${before} -> ${player.core.thirst}.`);
  }

  if (/(rest|sleep|sit down|sit for a while|catch my breath|lie down|relax)/.test(lower)) {
    const before = player.core.stamina;
    player.core.stamina = Math.min(100, player.core.stamina + 18);
    player.core.stress = Math.max(0, player.core.stress - 6);
    notes.push(`You recovered a little. Stamina ${before} -> ${player.core.stamina}.`);
  }

  const pickupIntent = /(pick|take|grab|collect|keep|carry|pocket|pack|lift|stash|put .* bag|put .* pocket)/.test(lower);
  const found = pickupIntent ? (findCarryableResource(lower) || findCarryableResource(sceneLower)) : null;
  if (found && !player.inventory.includes(found)) {
    player.inventory.push(found);
    notes.push(`${found} added to inventory.`);
  }

  return notes;
}

function findCarryableResource(lower) {
  const resources = [
    ["phone charger", /(phone charger|charger)/],
    ["batteries", /(battery|batteries)/],
    ["water sachet", /(water sachet|pure water|sachet water)/],
    ["bottled water", /(bottled water|water bottle)/],
    ["snack", /(snack|biscuit|crackers)/],
    ["medical supplies", /(medical supplies|bandage|gauze|paracetamol|first aid kit)/],
    ["keys", /(key|keys|keycard|access card)/],
    ["radio", /\bradio\b/],
    ["fuel", /\bfuel\b|petrol|diesel/],
    ["torch", /(torch|flashlight)/],
    ["crowbar", /\bcrowbar\b/],
    ["kitchen knife", /(kitchen knife|knife)/],
    ["documents", /(document|file|folder|record|lab note|paperwork)/]
  ];
  return resources.find(([, pattern]) => pattern.test(lower))?.[0] || null;
}

export function sameLocationPlayers(room, player) {
  return Object.values(room.players).filter((other) => other.locationId === player.locationId);
}

export function playerRelationshipKey(fromId, toId) {
  return `${fromId}:${toId}`;
}

export function getPlayerRelationship(room, fromId, toId) {
  return room.playerRelationships?.[playerRelationshipKey(fromId, toId)]?.status || "neutral";
}

export function setPlayerRelationship(room, fromId, toId, status) {
  if (fromId === toId) return { ok: false, reason: "You cannot set a relationship with yourself." };
  if (!room.players[fromId] || !room.players[toId]) return { ok: false, reason: "Player not found." };
  if (!playerRelationshipStatuses.includes(status)) return { ok: false, reason: "Invalid relationship status." };
  room.playerRelationships ||= {};
  const key = playerRelationshipKey(fromId, toId);
  room.playerRelationships[key] = {
    fromId,
    toId,
    status,
    updatedAt: new Date().toISOString()
  };
  return { ok: true, relationship: room.playerRelationships[key] };
}

export function visibleLogs(room, player) {
  return room.logs.filter((log) => {
    if (log.scope === "global") return true;
    if (log.scope === "direct") return (log.participants || []).includes(player.id);
    if (log.scope === "private") return log.playerId === player.id;
    return log.locationId === player.locationId;
  });
}

export function npcAt(locationId) {
  const id = locations[locationId]?.npc;
  return id ? { id, ...npcs[id] } : null;
}

export function routeBetween(start, goal, room = null) {
  if (start === goal) return [start];
  const queue = [[start]];
  const seen = new Set([start]);

  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of locations[last].routes) {
      if (room && next !== goal && !isLocationAvailable(room, next)) continue;
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === goal) return nextPath;
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return [];
}

export function setTravelGoal(room, playerId, goalId) {
  const player = room.players[playerId];
  if (!isLocationAvailable(room, goalId)) return { ok: false, reason: "That route is not available in the current timeline yet." };
  const route = routeBetween(player.locationId, goalId, room);
  if (!route.length) return { ok: false, reason: "No known route from here." };
  player.travelGoal = goalId;
  player.route = route;
  player.routeStep = 0;
  return {
    ok: true,
    result: "travel-goal-set",
    text: `You choose a route toward ${locations[goalId].name}.`
  };
}

export function isLocationAvailable(room, locationId) {
  const location = locations[locationId];
  if (!location) return false;
  if (location.known) return true;
  if (!location.minPhase) return false;
  return phases.indexOf(room.phase) >= phases.indexOf(location.minPhase);
}

export function continueTravel(room, playerId) {
  const player = room.players[playerId];
  if (!player.travelGoal || !player.route.length) {
    return { ok: false, reason: "No travel goal is set." };
  }
  const next = player.route[player.routeStep + 1];
  if (!next) {
    player.travelGoal = null;
    player.route = [];
    player.routeStep = 0;
    return { ok: false, reason: "You are already at your destination." };
  }

  player.locationId = next;
  player.lastKnownLocation = next;
  player.routeStep += 1;
  player.core.stamina = Math.max(0, player.core.stamina - 4);
  player.core.thirst = Math.min(100, player.core.thirst + 2);

  const arrived = next === player.travelGoal;
  if (arrived) {
    player.travelGoal = null;
    player.route = [];
    player.routeStep = 0;
  }

  return {
    ok: true,
    result: arrived ? "arrived" : "route-step",
    locationId: next,
    text: `You move toward ${locations[next].name}.`
  };
}

export function relationshipFor(room, playerId, npcId) {
  const key = `${playerId}:${npcId}`;
  if (!room.relationships[key]) {
    room.relationships[key] = {
      familiarity: 0,
      trust: 0,
      suspicion: 0,
      interactionCount: 0,
      lastInteractionTurn: 0,
      notes: []
    };
  }
  return room.relationships[key];
}

export function interactWithNpc(room, playerId, npcId, type) {
  const player = room.players[playerId];
  const npc = npcs[npcId];
  if (!npc || npc.location !== player.locationId) return { ok: false, reason: "That NPC is not here." };

  const rel = relationshipFor(room, playerId, npcId);
  rel.familiarity += 1;
  rel.interactionCount += 1;
  rel.lastInteractionTurn = room.logs.length + 1;
  if (type === "observe") rel.suspicion = Math.max(0, rel.suspicion - 1);
  if (type === "talk" || type === "ask") rel.trust += player.stats.charisma >= 12 ? 1 : 0;

  return { ok: true, npc: { id: npcId, ...npc }, relation: rel, interactionType: type };
}

export function validateCustomAction(room, playerId, text) {
  const player = room.players[playerId];
  const lower = text.toLowerCase();
  const phaseIndex = phases.indexOf(room.phase);
  let skill = "luck";
  let level = "basic";
  let requiredClass = null;
  let requiredTools = [];

  if (/(repair|generator|rewire|electric|engine|lock)/.test(lower)) {
    skill = "dexterity";
    level = /silent|advanced|full|rebuild/.test(lower) ? "advanced" : "trained";
    requiredClass = "mechanic";
    requiredTools = ["multi-tool"];
  } else if (/(treat|diagnose|stabilize|clinic|wound|fever)/.test(lower)) {
    skill = "intelligence";
    level = /surgery|cure|antidote/.test(lower) ? "expert" : "trained";
    requiredClass = "medic";
    requiredTools = ["basic first aid"];
  } else if (/(sneak|run|scout|route|avoid|climb)/.test(lower)) {
    skill = /notice|watch|listen/.test(lower) ? "perception" : "speed";
    level = "trained";
    requiredClass = "scout";
  } else if (/(fight|hold|barricade|push|drag|restrain)/.test(lower)) {
    skill = "strength";
    level = phaseIndex >= 3 ? "skilled" : "trained";
    requiredClass = "fighter";
  } else if (/(calm|convince|persuade|organize|negotiate|recruit|community)/.test(lower)) {
    skill = "charisma";
    level = "trained";
    requiredClass = "negotiator";
  } else if (/(base|safehouse|secure|fortify|barricade|shelter)/.test(lower)) {
    skill = /barricade|fortify/.test(lower) ? "strength" : "intelligence";
    level = phaseIndex >= 4 ? "skilled" : "trained";
    requiredClass = /barricade|fortify/.test(lower) ? "fighter" : null;
    requiredTools = /fortify|repair|reinforce/.test(lower) ? ["multi-tool"] : [];
  } else if (/(cure|sample|virus|antidote|research|vaccine|lab)/.test(lower)) {
    skill = "intelligence";
    level = phaseIndex >= 4 ? "expert" : "advanced";
    requiredClass = "medic";
    requiredTools = ["basic first aid"];
  }

  const target = difficulty[level].target;
  const hasClass = !requiredClass || player.classId === requiredClass || level === "basic";
  const hasTools = requiredTools.every((item) => player.inventory.includes(item));
  const stressPenalty = player.core.stress > 60 ? 3 : player.core.stress > 35 ? 1 : 0;
  const fatiguePenalty = player.core.stamina < 25 ? 4 : player.core.stamina < 50 ? 2 : 0;
  const score = player.stats[skill] + player.level * 2 - stressPenalty - fatiguePenalty;
  const allowed = hasClass && hasTools && score >= target;

  player.core.stamina = Math.max(0, player.core.stamina - 6);
  player.core.stress = Math.min(100, player.core.stress + (allowed ? 2 : 7));
  if (allowed) applyLongTermProgress(room, player, lower);

  return {
    ok: true,
    allowed,
    skill,
    level,
    target,
    score,
    requiredClass,
    requiredTools,
    reason: allowed
      ? "The rules engine approves the attempt."
      : `Blocked or failed: needs ${difficulty[level].label}${requiredClass ? ` ${classes[requiredClass].label}` : ""}${requiredTools.length ? ` and ${requiredTools.join(", ")}` : ""}.`
  };
}

function applyLongTermProgress(room, player, lower) {
  if (/(base|safehouse|secure|fortify|barricade|shelter)/.test(lower)) {
    room.bases ||= {};
    const base = room.bases[player.locationId] || { level: 0, supplies: 0, community: 0, notes: [] };
    base.level = Math.min(5, base.level + 1);
    base.notes.push(`${player.name} improved security at ${locations[player.locationId].name}.`);
    room.bases[player.locationId] = base;
  }
  if (/(recruit|community|organize survivors|settlement)/.test(lower)) {
    room.bases ||= {};
    const base = room.bases[player.locationId] || { level: 0, supplies: 0, community: 0, notes: [] };
    base.community = Math.min(30, base.community + 2);
    base.notes.push(`${player.name} brought people into the local survival network.`);
    room.bases[player.locationId] = base;
  }
  if (/(cure|sample|virus|antidote|research|vaccine)/.test(lower)) {
    room.research ||= { cureProgress: 0, leads: [] };
    room.research.cureProgress = Math.min(100, room.research.cureProgress + 8);
    room.research.leads.push(`${player.name} advanced a cure lead at ${locations[player.locationId].name}.`);
  }
}

export function advanceTimeline(room, playerId, effort = 1, reason = "activity") {
  const player = room.players[playerId];
  if (!player) return null;
  room.timeline ||= { progress: 0, turn: 0, lastAdvancedBy: null, lastAdvancedAt: null };
  const nextTurn = Number(room.timeline.turn || 0) + 1;
  player.xp = Number(player.xp || 0) + effort * 5;
  player.lastActiveAt = new Date().toISOString();
  player.level = Math.max(1, Math.floor(player.xp / 35) + 1);
  const turnFatigue = Math.floor(nextTurn / 8);
  const stressGain = Math.max(1, Math.ceil(effort / 2) + Math.floor(nextTurn / 10));
  player.core.stamina = Math.max(0, player.core.stamina - Math.max(1, effort + turnFatigue));
  player.core.stress = Math.min(100, player.core.stress + stressGain);
  if (effort >= 3 || nextTurn % 4 === 0) player.core.hunger = Math.min(100, player.core.hunger + 1);
  if (effort >= 2 || nextTurn % 3 === 0) player.core.thirst = Math.min(100, player.core.thirst + 1);
  room.timeline.progress += effort;
  room.timeline.turn = nextTurn;
  room.timeline.lastAdvancedBy = player.id;
  room.timeline.lastAdvancedAt = player.lastActiveAt;
  return maybeAdvancePhase(room, reason);
}

export function maybeAdvancePhase(room, reason = "activity") {
  room.timeline ||= { progress: 0, turn: 0, lastAdvancedBy: null, lastAdvancedAt: null };
  room.bases ||= {};
  room.research ||= { cureProgress: 0, leads: [] };
  const count = room.timeline.progress;
  const current = phases.indexOf(room.phase);
  const nextIndex = count >= 55 ? 4 : count >= 34 ? 3 : count >= 20 ? 2 : count >= 9 ? 1 : 0;
  if (nextIndex > current) {
    room.phase = phases[nextIndex];
    room.globalEvents.push({ phase: room.phase, at: room.logs.length, reason });
    room.logs.push({
      id: crypto.randomUUID(),
      type: "world",
      scope: "global",
      text: phaseAnnouncement(room.phase)
    });
    return room.phase;
  }
  return null;
}

function phaseAnnouncement(phase) {
  if (phase === "unease") return "Across UHFR, phones start buzzing harder than normal. Nobody calls it an emergency yet.";
  if (phase === "disruption") return "A power flicker moves through campus. Conversations pause, then return too loudly.";
  if (phase === "local-danger") return "The first confirmed violent incident stops being a rumor. Campus security starts sealing routes, and people begin choosing sides.";
  if (phase === "open-outbreak") return "UHFR is no longer the edge of the story. The outbreak has spilled into Port Harcourt, and survival now means routes, bases, communities, and cure leads.";
  return "The timeline shifts.";
}

export function appendLog(room, log) {
  room.logs.push({ id: crypto.randomUUID(), ...log });
}
