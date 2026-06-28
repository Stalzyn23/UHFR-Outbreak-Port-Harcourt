import { locations, npcs } from "./data.js";
import { visibleLogs } from "./rules.js";

const phaseTone = {
  normalcy: "Keep campus life ordinary. Use gossip, routine, small unease. Do not show zombies, hordes, gunfire, or mass panic.",
  unease: "The outbreak is already global, but UHFR is still pretending it is outside. Let wrongness leak in through coughs, calls, nervous staff, and rumors.",
  disruption: "An already-bitten person has entered UHFR and reaches class. Systems can fail: locked doors, flickering power, confused crowds, missing staff.",
  "local-danger": "Direct danger may happen in one place. Keep information local unless broadcast.",
  "open-outbreak": "Full survival pressure is allowed: infected attacks, barricades, scarcity, factions."
};

export function buildGmPayload(room, player, event, visiblePlayers, playerRelationships = {}) {
  const location = locations[player.locationId];
  const npcId = location.npc;
  const npc = npcId ? npcs[npcId] : null;
  return {
    system: "You are the AI GM for UHFR: Outbreak Port Harcourt. Narrate and roleplay only. Never mutate stats, inventory, XP, location, relationships, resources, death, injury, mission state, or world phase. Use approved mechanical result as fact.",
    phase: room.phase,
    phaseRule: phaseTone[room.phase],
    timeline: room.timeline,
    bases: room.bases,
    research: room.research,
    player: {
      name: player.name,
      sex: player.sex,
      age: player.age,
      classId: player.classId,
      level: player.level,
      xp: player.xp,
      location: location.name,
      stats: player.stats,
      core: player.core,
      inventory: player.inventory
    },
    sameLocationPlayers: visiblePlayers.map((p) => ({ name: p.name, classId: p.classId })),
    playerRelationships,
    recentVisibleStory: visibleLogs(room, player)
      .slice(-12)
      .map((log) => ({
        type: log.type,
        scope: log.scope,
        text: log.text
      })),
    npc: npc && {
      name: npc.name,
      role: npc.role,
      voice: npc.voice,
      stressVoice: npc.stressVoice,
      bias: npc.bias,
      public: npc.public,
      normalcyHook: npc.normalcyHook
    },
    privateNpcNotesAvailableToGmButNeverQuote: npc?.privateNotes,
    approvedMechanicalEvent: event
  };
}

export function localGmNarration(payload) {
  const { phase, player, npc, approvedMechanicalEvent: event } = payload;
  const place = player.location;

  if (event.kind === "spawn") {
    if (place === "Lecture Hall Complex") {
      return `You are in class when the unease finally finds a door. The lecturer is still trying to hold the room together, but phones keep lighting under desks with clips from outside Port Harcourt: airports, markets, hospitals, people running before anyone agrees what they are running from. Then the back door opens. A student stumbles in late, sweating through his shirt, one hand clamped around a bite mark he is trying badly to hide.`;
    }
    return `You come into UHFR at ${place}. The campus is not collapsing yet, but the world outside is already sending warnings through phones, staff whispers, and nervous security movement. Something dangerous has found its way toward campus, and people are still calling it rumor because rumor is easier to survive for one more minute.`;
  }

  if (event.kind === "rp") {
    if (npc && /nurse boma|dr\.?|chief|favour|mama|goodluck|chidera|timi|ask|tell|talk|aunty|sir|ma/i.test(event.text)) {
      return npcReply(npc, phase, event.text);
    }
    return ambientRpReply(place, phase, event.text);
  }

  if (event.kind === "player-message") {
    return `The GM watches the conversation without stepping over it. The next interruption will come from the room, an NPC, or the pressure outside.`;
  }

  if (event.kind === "call") {
    return `The call carries ${player.name}'s voice through the unstable network toward ${event.recipientName}. The words land with a slight delay, but they land: this is no longer shared space, it is shared risk, threaded through a device that could fail at any moment.`;
  }

  if (event.kind === "npc") {
    return npcReply(event.npc, phase, event.interactionType);
  }

  if (event.kind === "travel") {
    if (!event.ok) return `${event.reason} You pause where you are, forced to rethink the route instead of forcing the scene to obey.`;
    return `${event.text} The route changes the story around you: familiar campus noise thins for a few steps, then returns in fragments. A cleaner drags a bucket past without greeting anyone, two students argue over a message they both claim not to believe, and somewhere ahead a security radio crackles once before going quiet.`;
  }

  if (event.kind === "custom") {
    if (event.allowed) {
      return `You try it, and the moment holds. The attempt is within your reach: ${event.reason} It does not solve everything, but it changes what is possible here.`;
    }
    return `You start to act, then the limits become clear. ${event.reason} The scene does not bend just because the idea is bold; UHFR makes you pay attention to tools, timing, fatigue, and what your character can actually do.`;
  }

  return `The GM watches the scene at ${place}, waiting for the next move.`;
}

function ambientRpReply(place, phase, text) {
  const quoted = text.length > 130 ? `${text.slice(0, 127)}...` : text;
  if (phase === "normalcy") {
    return `Your RP lands in the ordinary noise of ${place}: "${quoted}" A couple of students glance over, not alarmed exactly, but curious in that campus way where gist travels faster than footsteps. Someone nearby checks their phone again, frowns, and turns the screen face-down. The day keeps pretending to be normal, but it has started listening back.`;
  }
  if (phase === "unease") {
    return `Your words move through ${place} and come back changed. A student answers too quickly, another avoids your eyes, and one phone buzzes three times in a row before its owner silences it. Nobody says panic. Everybody hears it anyway.`;
  }
  if (phase === "disruption") {
    return `The scene answers your RP with friction. A door shuts somewhere it should not, the lights dip hard enough to pull a sound from the room, and people start measuring each other by usefulness instead of friendliness.`;
  }
  return `Your RP pushes the moment forward, and ${place} pushes back. The choice is no longer just what you say, but who hears it, who believes it, and what it costs to stay here.`;
}

function npcReply(npc, phase, seed) {
  const stress = phase === "normalcy" ? npc.voice : npc.stressVoice;
  if (npc.name === "Nurse Boma") {
    return phase === "normalcy"
      ? `Nurse Boma looks up from the clinic register. "Lower your voice small, please. I have students waiting." Her expression softens, but her pen stops moving. "What exactly did you see?"`
      : `Nurse Boma shuts the drawer with more force than she means to. "No crowding here, please. If you know something, talk now."`;
  }
  if (npc.name === "Chief Okoro") {
    return phase === "normalcy"
      ? `Chief Okoro studies you before answering. "Officially, nothing is happening. Unofficially, students should stop roaming where they have no business."`
      : `Chief Okoro grips his radio. "My friend, move with sense. I no get time for stubbornness today."`;
  }
  if (npc.name === "Mama T") {
    return `Mama T lowers her serving spoon. "My child, campus mouth is never quiet, but today own is different. Eat if you can. Empty stomach no dey help fear."`;
  }
  if (npc.name === "Favour Nwosu") {
    return `Favour flicks through her phone. "See, I am not saying panic. I am saying people are deleting messages, and that one is not normal."`;
  }
  if (npc.name === "Goodluck") {
    return `Goodluck gives a short laugh without humor. "You people like question. If you want leave campus later, better know who has key and who is forming big man."`;
  }
  if (npc.name === "Chidera") {
    return `Chidera hugs her phone to her chest. "Please, I do not want wahala. My roommate said clinic, then voice note cut. Since then, nothing."`;
  }
  if (npc.name === "Dr. Ebi Alabo") {
    return `Dr. Ebi Alabo removes his glasses slowly. "Speculation is dangerous. So is silence. Tell me only what you can verify."`;
  }
  if (npc.name === "Timi Adewale") {
    return `Timi glances toward the corridor before speaking. "I cannot discuss lab matters in the open. That is not refusal. That is survival."`;
  }
  return `${npc.name} answers in ${stress}, careful not to say too much too quickly.`;
}
