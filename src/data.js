export const phases = ["normalcy", "unease", "disruption", "local-danger", "open-outbreak"];

export const classes = {
  medic: {
    label: "Medic",
    summary: "Diagnosis, treatment, stabilizing injuries.",
    stats: { perception: 11, dexterity: 9, intelligence: 15, luck: 8, speed: 8, strength: 7, charisma: 10 },
    inventory: ["phone", "clinic ID", "basic first aid"]
  },
  scout: {
    label: "Scout",
    summary: "Movement, route reading, watchfulness.",
    stats: { perception: 15, dexterity: 13, intelligence: 9, luck: 11, speed: 15, strength: 8, charisma: 8 },
    inventory: ["phone", "campus map", "torch"]
  },
  fighter: {
    label: "Fighter",
    summary: "Physical defense, barricades, confrontation.",
    stats: { perception: 9, dexterity: 10, intelligence: 7, luck: 8, speed: 10, strength: 16, charisma: 7 },
    inventory: ["phone", "sports tape", "metal water bottle"]
  },
  security: {
    label: "Security",
    summary: "Campus access, crowd control, radios, route authority.",
    stats: { perception: 13, dexterity: 10, intelligence: 9, luck: 8, speed: 10, strength: 13, charisma: 11 },
    inventory: ["phone", "radio", "security ID", "baton"]
  },
  negotiator: {
    label: "Negotiator",
    summary: "Calming people, persuasion, managing panic.",
    stats: { perception: 10, dexterity: 8, intelligence: 11, luck: 10, speed: 8, strength: 7, charisma: 16 },
    inventory: ["phone", "SUG contact list", "notebook"]
  },
  mechanic: {
    label: "Mechanic",
    summary: "Repairs, tools, generators, campus infrastructure.",
    stats: { perception: 10, dexterity: 14, intelligence: 12, luck: 8, speed: 8, strength: 11, charisma: 7 },
    inventory: ["phone", "multi-tool", "insulation tape"]
  },
  survivor: {
    label: "Regular Survivor",
    summary: "Flexible, ordinary, no specialist edge.",
    stats: { perception: 10, dexterity: 10, intelligence: 10, luck: 12, speed: 10, strength: 10, charisma: 10 },
    inventory: ["phone", "snack", "water sachet"]
  }
};

export const faceClaims = [
  { id: "medical-student", label: "Medical Student", accent: "#f3fbff", image: "./assets/face-claims/medical-student.svg" },
  { id: "campus-athlete", label: "Campus Athlete", accent: "#e9fff2", image: "./assets/face-claims/campus-athlete.svg" },
  { id: "sug-organizer", label: "SUG Organizer", accent: "#fff7d7", image: "./assets/face-claims/sug-organizer.svg" },
  { id: "security-cadet", label: "Security Cadet", accent: "#eef1f6", image: "./assets/face-claims/security-cadet.svg" },
  { id: "engineering-student", label: "Engineering Student", accent: "#f4f0ff", image: "./assets/face-claims/engineering-student.svg" },
  { id: "final-year", label: "Final Year Student", accent: "#fff0e8", image: "./assets/face-claims/final-year.svg" },
  { id: "fresh-student", label: "Fresh Student", accent: "#eaf7ff", image: "./assets/face-claims/fresh-student.svg" },
  { id: "lab-assistant", label: "Lab Assistant", accent: "#edfdf7", image: "./assets/face-claims/lab-assistant.svg" },
  { id: "campus-vendor", label: "Campus Vendor", accent: "#fff1df", image: "./assets/face-claims/campus-vendor.svg" },
  { id: "lecturer", label: "Lecturer", accent: "#f5f5f0", image: "./assets/face-claims/lecturer.svg" }
];

export const locations = {
  "main-gate": { name: "UHFR Main Gate", known: true, pressure: 1, routes: ["security-post", "back-gate", "rumuokoro-junction"] },
  "security-post": { name: "Security Post", known: true, pressure: 1, routes: ["main-gate", "admin-road"], npc: "chief-okoro" },
  "admin-road": { name: "Admin Road", known: true, pressure: 1, routes: ["security-post", "admin-block", "main-walkway"] },
  "admin-block": { name: "Admin Block", known: true, pressure: 1, routes: ["admin-road", "library"], npc: "favour-nwosu" },
  "main-walkway": { name: "Main Campus Walkway", known: true, pressure: 1, routes: ["admin-road", "lecture-hall", "cafeteria", "medical-faculty"] },
  "lecture-hall": { name: "Lecture Hall Complex", known: true, pressure: 1, routes: ["main-walkway", "library"] },
  "library": { name: "Library", known: true, pressure: 1, routes: ["lecture-hall", "admin-block", "medical-faculty"] },
  "medical-faculty": { name: "Medical Faculty", known: true, pressure: 1, routes: ["main-walkway", "library", "campus-clinic", "research-lab"], npc: "dr-ebi" },
  "campus-clinic": { name: "Campus Clinic", known: true, pressure: 2, routes: ["medical-faculty", "hostel-road"], npc: "nurse-boma" },
  "research-lab": { name: "Research Lab Complex", known: false, minPhase: "unease", pressure: 2, routes: ["medical-faculty", "generator-yard"], npc: "timi-adewale" },
  "hostel-road": { name: "Hostel Road", known: true, pressure: 1, routes: ["campus-clinic", "male-hostel", "female-hostel", "sports-field"] },
  "male-hostel": { name: "Male Hostel", known: true, pressure: 1, routes: ["hostel-road"] },
  "female-hostel": { name: "Female Hostel", known: true, pressure: 1, routes: ["hostel-road"], npc: "chidera" },
  "cafeteria": { name: "Cafeteria", known: true, pressure: 1, routes: ["main-walkway", "chapel-mosque"], npc: "mama-t" },
  "sports-field": { name: "Sports Field", known: true, pressure: 1, routes: ["hostel-road", "car-park"] },
  "chapel-mosque": { name: "Chapel/Mosque Area", known: true, pressure: 1, routes: ["cafeteria", "staff-quarters"] },
  "staff-quarters": { name: "Staff Quarters", known: false, pressure: 1, routes: ["chapel-mosque", "car-park"] },
  "car-park": { name: "Car Park", known: true, pressure: 1, routes: ["sports-field", "staff-quarters", "back-gate"], npc: "goodluck" },
  "back-gate": { name: "Back Gate", known: false, pressure: 1, routes: ["car-park", "main-gate", "creek-road"] },
  "generator-yard": { name: "Generator Yard", known: false, minPhase: "unease", pressure: 2, routes: ["research-lab"] },
  "rumuokoro-junction": { name: "Rumuokoro Junction", known: false, minPhase: "local-danger", pressure: 3, routes: ["main-gate", "mile-3-market", "teaching-hospital", "waterworks"] },
  "mile-3-market": { name: "Mile 3 Market", known: false, minPhase: "local-danger", pressure: 4, routes: ["rumuokoro-junction", "abandoned-pharmacy", "old-warehouse"] },
  "teaching-hospital": { name: "Port Harcourt Teaching Hospital", known: false, minPhase: "disruption", pressure: 4, routes: ["rumuokoro-junction", "cdc-field-unit"] },
  "abandoned-pharmacy": { name: "Abandoned Pharmacy", known: false, minPhase: "open-outbreak", pressure: 4, routes: ["mile-3-market", "old-warehouse"] },
  "old-warehouse": { name: "Old Warehouse", known: false, minPhase: "open-outbreak", pressure: 3, routes: ["mile-3-market", "abandoned-pharmacy", "creek-road"] },
  "creek-road": { name: "Creek Road", known: false, minPhase: "open-outbreak", pressure: 4, routes: ["back-gate", "old-warehouse", "radio-station"] },
  "radio-station": { name: "Community Radio Station", known: false, minPhase: "open-outbreak", pressure: 3, routes: ["creek-road", "waterworks"] },
  "waterworks": { name: "Port Harcourt Waterworks", known: false, minPhase: "open-outbreak", pressure: 3, routes: ["rumuokoro-junction", "radio-station", "safehouse-site"] },
  "safehouse-site": { name: "Unfinished Staff Estate", known: false, minPhase: "open-outbreak", pressure: 2, routes: ["waterworks", "cdc-field-unit"] },
  "cdc-field-unit": { name: "Emergency Disease Control Field Unit", known: false, minPhase: "open-outbreak", pressure: 5, routes: ["teaching-hospital", "safehouse-site"] }
};

export const spawnLocations = [
  "campus-clinic",
  "medical-faculty",
  "main-walkway",
  "lecture-hall",
  "library",
  "cafeteria",
  "hostel-road",
  "female-hostel",
  "male-hostel",
  "security-post",
  "car-park"
];

export const npcs = {
  "nurse-boma": {
    name: "Nurse Boma",
    role: "Campus clinic nurse",
    location: "campus-clinic",
    voice: "professional English",
    stressVoice: "mild Pidgin",
    bias: "protective",
    public: "She keeps her clinic neat and her tone measured, even when the waiting bench fills up.",
    normalcyHook: "A student has been coughing in a way she does not like.",
    privateNotes: "She received a quiet call from Research Lab Complex this morning."
  },
  "dr-ebi": {
    name: "Dr. Ebi Alabo",
    role: "Medical lecturer",
    location: "medical-faculty",
    voice: "quiet formal",
    stressVoice: "professional English",
    bias: "neutral",
    public: "A careful lecturer with tired eyes and a habit of pausing before difficult answers.",
    normalcyHook: "He cancelled a tutorial without giving the class a proper reason.",
    privateNotes: "He suspects the lab incident is being contained badly."
  },
  "chief-okoro": {
    name: "Chief Okoro",
    role: "Senior campus security guard",
    location: "security-post",
    voice: "official command",
    stressVoice: "strong Pidgin",
    bias: "suspicious",
    public: "His radio is always close to his mouth, and his eyes scan bags before faces.",
    normalcyHook: "He has been instructed to stop people asking about the back gate.",
    privateNotes: "Admin told him to log strange clinic movement but not spread alarm."
  },
  "favour-nwosu": {
    name: "Favour Nwosu",
    role: "SUG organizer",
    location: "admin-block",
    voice: "campus slang",
    stressVoice: "panicked local",
    bias: "friendly",
    public: "Favour knows who is angry, who is missing, and which WhatsApp group is loudest.",
    normalcyHook: "She is trying to confirm why two class reps stopped replying.",
    privateNotes: "She has screenshots of staff messages about a clinic restriction."
  },
  "mama-t": {
    name: "Mama T",
    role: "Cafeteria vendor",
    location: "cafeteria",
    voice: "warm elder",
    stressVoice: "strong Pidgin",
    bias: "friendly",
    public: "She serves rice with one eye on her pot and the other on everybody's business.",
    normalcyHook: "She noticed a regular student refusing food and shivering badly.",
    privateNotes: "She heard cleaners arguing about a locked lab corridor."
  },
  goodluck: {
    name: "Goodluck",
    role: "Campus shuttle driver",
    location: "car-park",
    voice: "streetwise",
    stressVoice: "strong Pidgin",
    bias: "suspicious",
    public: "He leans against his shuttle like he owns the road and distrusts free questions.",
    normalcyHook: "He says security delayed him near the back gate.",
    privateNotes: "He saw a bloodied staff member rushed through a side route."
  },
  chidera: {
    name: "Chidera",
    role: "Hostel resident",
    location: "female-hostel",
    voice: "campus slang",
    stressVoice: "panicked local",
    bias: "fearful",
    public: "She keeps checking her phone and flinches whenever the corridor gets loud.",
    normalcyHook: "Her roommate has not returned from the clinic.",
    privateNotes: "Her roommate sent a voice note about someone biting a porter."
  },
  "timi-adewale": {
    name: "Timi Adewale",
    role: "Lab assistant",
    location: "research-lab",
    voice: "quiet formal",
    stressVoice: "professional English",
    bias: "neutral",
    public: "He speaks softly and looks like he has already decided which truths are dangerous.",
    normalcyHook: "He is trying to leave the lab complex without being noticed.",
    privateNotes: "He knows sample storage failed for twenty minutes."
  }
};

export const difficulty = {
  basic: { target: 8, label: "Basic" },
  trained: { target: 13, label: "Trained" },
  skilled: { target: 18, label: "Skilled" },
  advanced: { target: 25, label: "Advanced" },
  expert: { target: 34, label: "Expert" },
  master: { target: 45, label: "Master" }
};
