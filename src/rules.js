import { classes, difficulty, locations, npcs, phases, spawnLocations } from "./data.js";

const roomKey = (code) => `uhfr-room:${code.toUpperCase()}`;

export function createRoom(code) {
  return {
    code: code.toUpperCase(),
    phase: "normalcy",
    clock: { day: 1, time: "15:20" },
    players: {},
    relationships: {},
    logs: [],
    globalEvents: [],
    resources: {
      power: "stable",
      network: "working",
      clinicSupplies: 6,
      fuel: 3
    },
    locks: {}
  };
}

export function loadRoom(code) {
  const saved = localStorage.getItem(roomKey(code));
  return saved ? JSON.parse(saved) : createRoom(code);
}

export function saveRoom(room) {
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
}

export function createPlayer({ name, age, classId, faceClaimId }) {
  const klass = classes[classId];
  const id = crypto.randomUUID();
  const locationId = spawnLocations[Math.floor(Math.random() * spawnLocations.length)];
  return {
    id,
    name: name.trim(),
    age: Number(age),
    classId,
    faceClaimId,
    level: 1,
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

export function addPlayer(room, player) {
  room.players[player.id] = player;
  room.logs.push({
    id: crypto.randomUUID(),
    type: "system",
    scope: "private",
    playerId: player.id,
    locationId: player.locationId,
    text: `${player.name} enters the current UHFR timeline at ${locations[player.locationId].name}.`
  });
  return room;
}

export function sameLocationPlayers(room, player) {
  return Object.values(room.players).filter((other) => other.locationId === player.locationId);
}

export function visibleLogs(room, player) {
  return room.logs.filter((log) => {
    if (log.scope === "global") return true;
    if (log.scope === "private") return log.playerId === player.id;
    return log.locationId === player.locationId;
  });
}

export function npcAt(locationId) {
  const id = locations[locationId]?.npc;
  return id ? { id, ...npcs[id] } : null;
}

export function routeBetween(start, goal) {
  if (start === goal) return [start];
  const queue = [[start]];
  const seen = new Set([start]);

  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const next of locations[last].routes) {
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
  const route = routeBetween(player.locationId, goalId);
  if (!route.length) return { ok: false, reason: "No known route from here." };
  player.travelGoal = goalId;
  player.route = route;
  player.routeStep = 0;
  return {
    ok: true,
    result: "travel-goal-set",
    text: `${player.name} studies the known campus paths toward ${locations[goalId].name}.`
  };
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
    text: `${player.name} moves to ${locations[next].name}.`
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
  } else if (/(calm|convince|persuade|organize|negotiate)/.test(lower)) {
    skill = "charisma";
    level = "trained";
    requiredClass = "negotiator";
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

export function maybeAdvancePhase(room) {
  const count = room.logs.filter((log) => log.type !== "system").length;
  const current = phases.indexOf(room.phase);
  const nextIndex = count >= 18 ? 2 : count >= 9 ? 1 : 0;
  if (nextIndex > current) {
    room.phase = phases[nextIndex];
    room.globalEvents.push({ phase: room.phase, at: room.logs.length });
    room.logs.push({
      id: crypto.randomUUID(),
      type: "world",
      scope: "global",
      text: room.phase === "unease"
        ? "Across UHFR, phones start buzzing harder than normal. Nobody calls it an emergency yet."
        : "A power flicker moves through campus. Conversations pause, then return too loudly."
    });
  }
}

export function appendLog(room, log) {
  room.logs.push({ id: crypto.randomUUID(), ...log });
  maybeAdvancePhase(room);
}
