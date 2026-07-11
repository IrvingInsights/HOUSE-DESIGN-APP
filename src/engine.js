// Design engine: tables, spec logic, deriveDesign, detectIssues, planners (moved verbatim from main.jsx, JOB 0 split).
import {
  OPENING_TYPES, FRAME_TYPES, resolveFrameType, FLOORING_TYPES, resolveFlooring, SUBFLOOR_TYPES, resolveSubfloor, INSULATION_TYPES,
  resolveInsulation, footprintPolygon, footprintEdges, hasCustomFootprint, polygonArea, polygonPerimeter, expandFootprint, rectInFootprint,
  basementInfo, BASEMENT_LEVEL, PARTITION_TYPES, CLADDING_TYPES
} from '../backend/bim-core.mjs';
import { Box, Building2, ClipboardCheck, Leaf, PenTool, Sparkles, Tractor, TreePine, Wrench } from 'lucide-react';

export const MM_PER_FOOT = 304.8;
export const DASHBOARD_STORAGE_KEY = 'natural-building-design-dashboard-state-v1';
export const DEFAULT_PROMPT = '';
export const DEFAULT_EXPERT_QUESTION = 'What should I worry about before taking this design further?';
export const DEFAULT_CHAT_MESSAGES = [];
export const WELCOME_CHAT_TEXT = 'Tell me what to change, attach sketches, or choose an expert/team target and ask for plain-language advice.';
export const DEFAULT_SITE_PAD_EXTENSION_FT = 64;
export const DEFAULT_OUTDOOR_GRID_SIZE_FT = 240;
export const OUTDOOR_SPACE_TYPES = new Set(['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead']);

export const expertCouncil = [
  { id: 'designer', name: 'Designer', icon: PenTool, concern: 'flow, proportion, daylight, human comfort' },
  { id: 'artist', name: 'Artist', icon: Sparkles, concern: 'composition, material contrast, visual calm' },
  { id: 'engineer', name: 'Engineer', icon: Wrench, concern: 'load paths, spans, lateral logic, constructability' },
  { id: 'architect', name: 'Architect', icon: Building2, concern: 'code readiness, envelope, room adjacency, documentation' },
  { id: 'sculptor', name: 'Sculptor', icon: Box, concern: 'massing, voids, roof form, approach sequence' },
  { id: 'natural', name: 'Natural Builder', icon: Leaf, concern: 'low-toxicity assemblies, hygrothermal durability, repairability' },
  { id: 'permaculture', name: 'Permaculture', icon: TreePine, concern: 'sun, water, wind, edge, soil, microclimate' },
  { id: 'homestead', name: 'Homestead/Farm', icon: Tractor, concern: 'mud, tools, storage, animals, food systems' },
  { id: 'pm', name: 'Project Manager', icon: ClipboardCheck, concern: 'scope, sequencing, budgets, unresolved decisions' }
];

export const addToTargets = [
  { value: 'auto', label: 'Auto' },
  { value: 'house', label: 'Whole house' },
  { value: 'selected', label: 'Selected item' },
  { value: 'openings', label: 'Windows / doors' },
  { value: 'roof', label: 'Roof' },
  { value: 'assemblies', label: 'Assemblies' },
  { value: 'site', label: 'Site' },
  { value: 'outputs', label: 'Outputs' }
];

export const elementLibrary = [
  {
    category: 'Ancient and Historic Forms',
    items: [
      { name: 'Courtyard House', kind: 'site', note: 'Historic hot-climate pattern for shade, privacy, stack ventilation, and protected outdoor living.', w: 18, d: 18, type: 'living' },
      { name: 'Earth-Sheltered Berm', kind: 'earthwork', note: 'Ancient and modern thermal-buffering strategy; requires waterproofing, drainage, retaining design, and radon review.', w: 22, d: 8, type: 'storage' },
      { name: 'Wofati-Inspired Shelter', kind: 'earthwork', note: 'Mike Oehler / annualized thermal inertia lineage; conceptual only until drainage, structure, and moisture risks are engineered.', w: 20, d: 16, type: 'storage' },
      { name: 'Roundhouse / Yurt Bay', kind: 'structure', note: 'Circular or radial plan tradition for efficient enclosure and wind response; needs careful joinery and egress detailing.', w: 16, d: 16, type: 'living' },
      { name: 'Dogtrot Breezeway', kind: 'passive', note: 'Historic hot-humid passive cooling form with shaded cross-ventilated outdoor circulation.', w: 12, d: 18, type: 'living' }
    ]
  },
  {
    category: 'Natural Wall Systems',
    items: [
      { name: 'Straw Bale Wall Assembly', kind: 'wall', note: 'High-insulation agricultural wall system; protect from bulk water, use capillary breaks, lime/clay plaster, and structural detailing.', w: 14, d: 2, type: 'storage' },
      { name: 'Cob Thermal Wall', kind: 'wall', note: 'Monolithic earth wall tradition with high thermal mass; best with boots, hat, seismic review, and drying-aware details.', w: 12, d: 2, type: 'storage' },
      { name: 'Rammed Earth Wall', kind: 'wall', note: 'Ancient compressed-earth wall with mass and durability; needs soil testing, reinforcement, moisture base, and engineering.', w: 14, d: 2, type: 'storage' },
      { name: 'Hemp-Lime Wall', kind: 'wall', note: 'Vapor-open bio-composite infill with hygrothermal buffering; usually non-structural around a frame.', w: 14, d: 2, type: 'storage' },
      { name: 'Light Straw-Clay Infill', kind: 'wall', note: 'Timber-frame infill with low embodied energy; depends on drying, plaster, and frame protection.', w: 14, d: 2, type: 'storage' },
      { name: 'Cordwood Wall', kind: 'wall', note: 'Stacked wood masonry tradition; beautiful but detail carefully for shrinkage, insulation, and moisture.', w: 12, d: 2, type: 'storage' }
    ]
  },
  {
    category: 'Structure and Roof',
    items: [
      { name: 'Timber Frame Bay', kind: 'structure', note: 'Durable historic heavy-timber structure; joinery, lateral bracing, and load paths need explicit review.', w: 12, d: 12, type: 'living' },
      { name: 'Reciprocal Roof', kind: 'roof', note: 'Ancient circular roof logic with interlocking rafters; striking but requires careful thrust and connection analysis.', w: 16, d: 16, type: 'living' },
      { name: 'Living Roof Zone', kind: 'roof', note: 'Vegetated roof for water buffering and habitat; heavy, so structure, membrane, drainage, and root barrier matter.', w: 18, d: 12, type: 'plant' },
      { name: 'Deep Eave / Veranda', kind: 'passive', note: 'Historic climate-control element for shade, wall protection, and outdoor work.', w: 20, d: 8, type: 'living' }
    ]
  },
  {
    category: 'Thermal and Energy',
    items: [
      { name: 'Masonry Heater Core', kind: 'thermal', note: 'High-mass clean-burn heat storage; requires foundation support, clearances, flue path, and specialist design.', w: 5, d: 4, type: 'service' },
      { name: 'Rocket Mass Heater Bench', kind: 'thermal', note: 'Natural-building thermal bench concept; code acceptance varies and must be locally verified.', w: 10, d: 3, type: 'living' },
      { name: 'Trombe Wall', kind: 'passive', note: 'Solar thermal mass wall from passive-solar practice; tune glazing, vents, shading, and overheating control.', w: 12, d: 2, type: 'living' },
      { name: 'Sunspace / Solarium', kind: 'passive', note: 'Buffer space for winter gain and plants; isolate thermally so it does not overheat or overcool the house.', w: 14, d: 8, type: 'plant' }
    ]
  },
  {
    category: 'Water, Food, Homestead',
    items: [
      { name: 'Rainwater Cistern', kind: 'water', note: 'Water resilience element; size by roof area, rainfall, demand, filtration, overflow, and freeze protection.', w: 8, d: 8, type: 'service' },
      { name: 'Greywater Reed Bed', kind: 'water', note: 'Landscape treatment concept; legal approval, soils, setbacks, and maintenance drive feasibility.', w: 16, d: 8, type: 'plant' },
      { name: 'Root Cellar', kind: 'storage', note: 'Ancient food-storage strategy using earth temperature and humidity; detail ventilation, drainage, and access.', w: 10, d: 8, type: 'storage' },
      { name: 'Attached Greenhouse', kind: 'plant', note: 'Food and season-extension space; keep thermal/moisture isolation from living areas.', w: 12, d: 10, type: 'plant' },
      { name: 'Outdoor Kitchen / Summer Kitchen', kind: 'homestead', note: 'Historic hot-season cooking and preservation workspace; pair with shade, water, storage, and fire safety.', w: 14, d: 10, type: 'service' },
      { name: 'Food Forest Edge', kind: 'landscape', note: 'Permaculture perennial edge: canopy, shrub, herb, groundcover, root, vine, and fungi layers.', w: 24, d: 10, type: 'plant' }
    ]
  }
];

export const seedSpec = {
  projectName: 'Untitled Natural Building Study',
  revision: 1,
  shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofPitch: 0.32, roofType: 'gable', southWallHeightFt: 10, northWallHeightFt: 10, padExtensionFt: DEFAULT_SITE_PAD_EXTENSION_FT },
  walls: {},
  site: { climate: 'mixed humid', north: 'top', wind: 'west', solar: 'south' },
  elements: [],
  rooms: [
    { id: 'great', name: 'Great Room', x: 0, y: 12, w: 20, d: 16, type: 'living', floor: 'earthen lime slab' },
    { id: 'kitchen', name: 'Kitchen', x: 20, y: 12, w: 16, d: 16, type: 'service', floor: 'sealed cork' },
    { id: 'bed1', name: 'Primary Bedroom', x: 0, y: 0, w: 14, d: 12, type: 'sleeping', floor: 'wood' },
    { id: 'bath', name: 'Bath Core', x: 14, y: 0, w: 8, d: 12, type: 'wet', floor: 'tile' },
    { id: 'mud', name: 'Mud/Laundry', x: 22, y: 0, w: 8, d: 12, type: 'service', floor: 'tile' },
    { id: 'office', name: 'Study / Guest', x: 30, y: 0, w: 6, d: 12, type: 'work', floor: 'wood' }
  ],
  openings: [
    { type: 'door', wall: 'south', x: 8, widthFt: 3, label: 'Main Entry' },
    { type: 'door', wall: 'east', y: 5, widthFt: 3, label: 'Farm Service' },
    { type: 'window', wall: 'south', x: 25, widthFt: 6, label: 'Kitchen Solar Window' },
    { type: 'window', wall: 'north', x: 6, widthFt: 5, label: 'Bedroom Egress' },
    { type: 'window', wall: 'west', y: 18, widthFt: 6, label: 'Great Room View' }
  ],
  systems: {
    structure: 'wood frame over insulated slab with continuous air barrier',
    envelope: 'vapor-open wall, rainscreen cladding, raised heel roof trusses',
    water: 'roof catchment, greywater-ready wet core, freeze-protected hose bib',
    energy: 'south glazing, balanced ventilation, wood/electric hybrid heat'
  },
  notes: 'A compact professional schematic home with farm entry, wet core, south-facing commons, natural materials, and BIM-ready object hierarchy.'
};

export function loadSavedDashboardState() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed?.spec?.shell || !Array.isArray(parsed.spec.rooms)) return null;
    if (!Number.isFinite(Number(parsed.spec.shell.padExtensionFt)) || Number(parsed.spec.shell.padExtensionFt) < 32) {
      parsed.spec.shell.padExtensionFt = DEFAULT_SITE_PAD_EXTENSION_FT;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function compactHistoryForStorage(history) {
  return history.slice(0, 30).map((entry) => ({
    spec: entry.spec,
    selectedRoom: entry.selectedRoom
  }));
}

export function compactChatForStorage(messages) {
  return messages
    .filter((message) => message.text !== WELCOME_CHAT_TEXT)
    .slice(-40)
    .map(({ role, speaker, text }) => ({ role, speaker, text }));
}

export function cleanSavedChatMessages(messages) {
  return (messages || DEFAULT_CHAT_MESSAGES).filter((message) => message.text !== WELCOME_CHAT_TEXT);
}

export const workflowStages = [
  'Intake',
  'Site and constraints',
  'Program / room list',
  'Concept options',
  'Floor plan development',
  '3D / BIM modeling',
  'Rendering',
  'Drawing package',
  'Review',
  'Professional handoff'
];

export function createProjectBrain(spec) {
  return {
    stage: '3D / BIM modeling',
    masterDesignBrief: {
      summary: spec.notes,
      goals: [
        'Design a natural-building residence with professional-grade schematic outputs.',
        'Maintain BIM-ready object hierarchy and export path.',
        'Support homestead, site, and natural-building decisions alongside the house model.'
      ],
      mustHaves: ['editable BIM model', 'natural materials', 'revision history', 'professional handoff package'],
      constraints: ['professional review required before permit or construction use']
    },
    requirements: [
      { id: 'req-natural', text: 'Use vapor-open natural building assemblies where appropriate.', status: 'active', priority: 'high', linkedObjects: ['systems.envelope'] },
      { id: 'req-bim', text: 'Keep rooms, walls, openings, roof, pad, and site elements as selectable BIM objects.', status: 'active', priority: 'high', linkedObjects: ['model'] }
    ],
    constraints: [
      { id: 'con-review', type: 'professional', text: 'Outputs are professional-grade drafts for licensed review, not stamped construction documents.', severity: 'high' },
      { id: 'con-orientation', type: 'modeling', text: 'Coordinate convention: north is Y/Z 0; south is shell depth.', severity: 'high' }
    ],
    decisions: [
      { id: 'dec-seed', text: 'Use a compact natural-building schematic as the starting design state.', rationale: 'Gives the app a complete initial BIM object hierarchy.', revision: spec.revision }
    ],
    openQuestions: [
      { id: 'q-jurisdiction', text: 'What jurisdiction, code year, snow/wind/seismic criteria, frost depth, and soil assumptions apply?', blockingLevel: 'professional handoff', status: 'open' }
    ],
    taskQueue: [
      { id: 'task-code-basis', title: 'Set local code/design criteria', stage: 'Site and constraints', status: 'open', priority: 'high' },
      { id: 'task-output-review', title: 'Review generated drawing package against handoff checklist', stage: 'Review', status: 'open', priority: 'medium' }
    ],
    assetLibrary: [],
    aiSessionHistory: [],
    modelFileVersions: [
      { id: `version-${spec.revision}`, revision: spec.revision, label: 'Initial schematic state', changedObjects: [], createdAt: new Date().toISOString() }
    ],
    outputReview: {
      readiness: 'schematic',
      missing: ['jurisdiction criteria', 'structural calculations', 'MEP coordination', 'final window/door specs'],
      lastReviewedRevision: spec.revision
    },
    professionalHandoffChecklist: [
      { id: 'handoff-code', text: 'Code and jurisdiction basis documented', status: 'missing' },
      { id: 'handoff-structure', text: 'Structural load path and calculation package prepared', status: 'missing' },
      { id: 'handoff-envelope', text: 'Natural wall sections and moisture details documented', status: 'draft' },
      { id: 'handoff-schedules', text: 'Room, opening, assembly, and output schedules reviewed', status: 'draft' }
    ]
  };
}

export function ensureProjectBrain(brain, spec) {
  const base = createProjectBrain(spec);
  if (!brain) return base;
  return {
    ...base,
    ...brain,
    masterDesignBrief: { ...base.masterDesignBrief, ...(brain.masterDesignBrief || {}) },
    outputReview: { ...base.outputReview, ...(brain.outputReview || {}) },
    requirements: Array.isArray(brain.requirements) ? brain.requirements : base.requirements,
    constraints: Array.isArray(brain.constraints) ? brain.constraints : base.constraints,
    decisions: Array.isArray(brain.decisions) ? brain.decisions : base.decisions,
    openQuestions: Array.isArray(brain.openQuestions) ? brain.openQuestions : base.openQuestions,
    taskQueue: Array.isArray(brain.taskQueue) ? brain.taskQueue : base.taskQueue,
    assetLibrary: Array.isArray(brain.assetLibrary) ? brain.assetLibrary : base.assetLibrary,
    aiSessionHistory: Array.isArray(brain.aiSessionHistory) ? brain.aiSessionHistory : base.aiSessionHistory,
    modelFileVersions: Array.isArray(brain.modelFileVersions) ? brain.modelFileVersions : base.modelFileVersions,
    professionalHandoffChecklist: Array.isArray(brain.professionalHandoffChecklist) ? brain.professionalHandoffChecklist : base.professionalHandoffChecklist
  };
}

export function updateProjectBrainAfterOperation(brain, spec, event) {
  const next = structuredClone(ensureProjectBrain(brain, spec));
  const now = new Date().toISOString();
  const actions = event.actions || [];
  const promptText = event.prompt || 'Manual model change';
  next.aiSessionHistory = [
    {
      id: `session-${Date.now()}`,
      prompt: promptText,
      source: event.source || 'local',
      revisionBefore: event.beforeRevision,
      revisionAfter: event.afterRevision,
      operationCount: actions.length,
      summary: actions[0] || event.summary || 'Design state updated.',
      createdAt: now
    },
    ...(next.aiSessionHistory || [])
  ].slice(0, 40);
  if (actions.length) {
    next.decisions = [
      {
        id: `decision-${Date.now()}`,
        text: actions[0],
        rationale: `Applied from: ${promptText}`,
        revision: event.afterRevision,
        affectedObjects: event.changedIds || [],
        source: event.source || 'planner',
        createdAt: now
      },
      ...(next.decisions || [])
    ].slice(0, 60);
    next.modelFileVersions = [
      {
        id: `version-${event.afterRevision}-${Date.now()}`,
        revision: event.afterRevision,
        label: actions[0],
        changedObjects: event.changedIds || [],
        createdAt: now
      },
      ...(next.modelFileVersions || [])
    ].slice(0, 80);
  }
  const issueTasks = (event.issues || [])
    .filter((issue) => issue.severity !== 'pass')
    .map((issue, index) => ({
      id: `task-${event.afterRevision}-${index}-${slugify(issue.title)}`,
      title: issue.title,
      stage: 'Review',
      status: 'open',
      priority: issue.severity === 'critical' ? 'high' : 'medium',
      description: issue.fix
    }));
  next.taskQueue = [...issueTasks, ...(next.taskQueue || [])]
    .filter((task, index, all) => all.findIndex((item) => item.id === task.id || item.title === task.title) === index)
    .slice(0, 80);
  next.outputReview = {
    ...(next.outputReview || {}),
    readiness: event.issues?.some((issue) => issue.severity === 'critical') ? 'blocked schematic' : 'schematic',
    lastReviewedRevision: event.afterRevision,
    missing: [
      ...new Set([
        ...(next.outputReview?.missing || []),
        ...((event.issues || []).filter((issue) => issue.severity !== 'pass').map((issue) => issue.title))
      ])
    ].slice(0, 12)
  };
  return next;
}

export function buildContextPacket(spec, projectBrain, selected, exactTask = '') {
  const brain = ensureProjectBrain(projectBrain, spec);
  const selectedSummary = selected ? `${selected.name} (${selected.category || selected.type || 'object'})` : 'none';
  return {
    projectSummary: brain.masterDesignBrief.summary,
    currentStage: brain.stage,
    currentDesignState: {
      projectName: spec.projectName,
      revision: spec.revision,
      shell: spec.shell,
      selected: selectedSummary,
      roomCount: spec.rooms.length,
      elementCount: (spec.elements || []).length,
      openingCount: (spec.openings || []).length,
      systems: spec.systems
    },
    relevantDecisions: (brain.decisions || []).slice(0, 5),
    relevantConstraints: (brain.constraints || []).slice(0, 5),
    openQuestions: (brain.openQuestions || []).filter((question) => question.status !== 'closed').slice(0, 5),
    exactTask: exactTask || 'Awaiting user design operation.',
    expectedOutput: 'Validated structured BIM operations plus updated project logs.',
    doNotChange: ['Do not change unrelated rooms or site elements.', 'Do not invent geometry from images without traceable information.']
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function padExtension(shell = {}) {
  return Math.max(0, Number(shell.padExtensionFt ?? DEFAULT_SITE_PAD_EXTENSION_FT));
}

export function sitePadRect(spec) {
  const shell = spec.shell || {};
  const saved = shell.sitePad;
  if (saved && Number.isFinite(Number(saved.w)) && Number.isFinite(Number(saved.d))) {
    return {
      x: Number(saved.x || 0),
      y: Number(saved.y || 0),
      w: Math.max(1, Number(saved.w)),
      d: Math.max(1, Number(saved.d)),
      h: Number(saved.h || 0.45)
    };
  }
  const pad = padExtension(shell);
  return {
    x: -pad,
    y: -pad,
    w: Number(shell.widthFt || 36) + pad * 2,
    d: Number(shell.depthFt || 28) + pad * 2,
    h: 0.45
  };
}

export function objectBounds(spec, object) {
  const pad = padExtension(spec.shell);
  const gridSize = Number(spec.shell?.outdoorGridSizeFt || DEFAULT_OUTDOOR_GRID_SIZE_FT);
  const isPlacedElement = Boolean((spec.elements || []).some((element) => element.id === object?.id));
  const isOutdoorSpace = OUTDOOR_SPACE_TYPES.has(object?.type) || OUTDOOR_SPACE_TYPES.has(object?.category);
  const margin = isPlacedElement || isOutdoorSpace ? Math.max(gridSize / 2, pad + 24) : Math.max(16, pad * 0.25);
  return {
    minX: -margin,
    minY: -margin,
    maxX: spec.shell.widthFt + margin,
    maxY: spec.shell.depthFt + margin
  };
}

export function clampObjectPosition(spec, object, x, y) {
  const bounds = objectBounds(spec, object);
  const w = Math.max(0, Number(object?.w || 0));
  const d = Math.max(0, Number(object?.d || 0));
  return {
    x: clamp(Math.round(x * 10) / 10, bounds.minX, Math.max(bounds.minX, bounds.maxX - w)),
    y: clamp(Math.round(y * 10) / 10, bounds.minY, Math.max(bounds.minY, bounds.maxY - d))
  };
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function feetToMm(value) {
  return Math.round(value * MM_PER_FOOT);
}

export function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'space';
}

export function findRoom(spec, label) {
  const normalized = normalizeDesignLabel(label);
  return spec.rooms.find((room) => {
    const name = normalizeDesignLabel(room.name);
    const id = normalizeDesignLabel(room.id);
    const nameTokens = name.split(/\s+/).filter((token) => token.length > 2);
    const labelTokens = normalized.split(/\s+/).filter((token) => token.length > 2);
    const tokenMatch = labelTokens.length > 0 && labelTokens.every((token) => nameTokens.includes(token) || id.includes(token));
    return name.includes(normalized) || id.includes(normalized) || normalized.includes(name) || normalized.includes(id) || tokenMatch;
  });
}

export function titleCase(value) {
  return value
    .replace(/[-_/]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function cleanDesignPhrase(value) {
  return value
    .toLowerCase()
    .replace(/\b(please|can you|could you|would you|i want|we need|need|want|include|create|build|place|put|add|make|set|resize|change|revise|design|a|an|the|some|more|with|and|into|for|to|at|room|space|area|zone)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDesignLabel(value) {
  return value
    .toLowerCase()
    .replace(/\bbederoom\b/g, 'bedroom')
    .replace(/\bbr\b/g, 'bedroom')
    .replace(/\bprimary bed\b/g, 'primary bedroom')
    .replace(/\bmaster\b/g, 'primary')
    .replace(/\s+/g, ' ')
    .trim();
}

export function roomProfile(name) {
  const text = name.toLowerCase();
  if (/bath|toilet|shower|powder|wet|mechanical|utility/.test(text)) return { type: 'wet', floor: 'tile', w: 8, d: 8 };
  if (/kitchen/.test(text)) return { type: 'service', floor: 'sealed cork', w: 14, d: 12 };
  if (/pantry|storage|cellar|closet/.test(text)) return { type: 'storage', floor: 'sealed earth', w: 8, d: 10 };
  if (/mud|laundry|farm entry|service entry/.test(text)) return { type: 'service', floor: 'tile', w: 10, d: 10 };
  if (/bed|sleep|bunk/.test(text)) return { type: 'sleeping', floor: 'wood', w: 12, d: 12 };
  if (/office|study|studio|work/.test(text)) return { type: 'work', floor: 'wood', w: 10, d: 10 };
  if (/greenhouse|sunspace|solarium|plant/.test(text)) return { type: 'plant', floor: 'drainable pavers', w: 12, d: 10 };
  if (/porch|veranda|deck|breezeway/.test(text)) return { type: 'living', floor: 'decking', w: 16, d: 8 };
  if (/garden|food forest|orchard|yard|outdoor/.test(text)) return { type: 'garden', floor: 'soil / planting beds', w: 20, d: 16 };
  if (/chicken|goat|dog|animal|paddock|run|coop/.test(text)) return { type: 'animal', floor: 'compacted earth / pasture', w: 16, d: 12 };
  return { type: 'living', floor: 'wood', w: 10, d: 10 };
}

export function targetLocationForPhrase(spec, object, phrase) {
  const text = normalizeDesignLabel(phrase);
  const isElement = Boolean((spec.elements || []).some((element) => element.id === object?.id));
  const houseMaxX = Math.max(0, spec.shell.widthFt - object.w);
  const houseMaxY = Math.max(0, spec.shell.depthFt - object.d);
  let x = object.x;
  let y = object.y;

  if (/\b(ne|northeast|north east)\b/.test(text)) {
    x = houseMaxX;
    y = 0;
  } else if (/\b(nw|northwest|north west)\b/.test(text)) {
    x = 0;
    y = 0;
  } else if (/\b(se|southeast|south east)\b/.test(text)) {
    x = houseMaxX;
    y = houseMaxY;
  } else if (/\b(sw|southwest|south west)\b/.test(text)) {
    x = 0;
    y = houseMaxY;
  } else {
    if (/\bnorth\b/.test(text)) y = 0;
    if (/\bsouth\b/.test(text)) y = houseMaxY;
    if (/\beast\b/.test(text)) x = houseMaxX;
    if (/\bwest\b/.test(text)) x = 0;
    if (/\bcenter|middle\b/.test(text)) {
      x = houseMaxX / 2;
      y = houseMaxY / 2;
    }
  }

  if (isElement && /\b(outside|outdoor|yard|site|garden|landscape|beyond|of house|of building)\b/.test(text)) {
    const hasNorth = /\bnorth\b|\bn\b/.test(text);
    const hasSouth = /\bsouth\b|\bs\b/.test(text);
    const hasEast = /\beast\b|\be\b/.test(text);
    const hasWest = /\bwest\b|\bw\b/.test(text);
    if (hasNorth) y = -object.d - 2;
    if (hasSouth) y = spec.shell.depthFt + 2;
    if (hasEast) x = spec.shell.widthFt + 2;
    if (hasWest) x = -object.w - 2;
    if (!hasNorth && !hasSouth && !hasEast && !hasWest) y = spec.shell.depthFt + 2;
  }

  const coordinateMatch = text.match(/(?:to|at)\s*x?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s+)\s*y?\s*(-?\d+(?:\.\d+)?)/);
  if (coordinateMatch) {
    x = Number(coordinateMatch[1]);
    y = Number(coordinateMatch[2]);
  }

  return clampObjectPosition(spec, object, x, y);
}

export function dimensionsFromText(text, fallback) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?/);
  if (!match) return fallback;
  return { w: Number(match[1]), d: Number(match[2]) };
}

export function isDrawingReferenceIntent(text) {
  return /\b(per|from|based on|match|trace|shown in|according to)\s+(?:the\s+)?(?:drawing|drawings|sketch|sketches|image|images|photo|photos|plan|plans)\b/.test(text)
    || /\b(?:drawing|drawings|sketch|sketches|image|images|photo|photos|plan|plans)\b/.test(text) && /\b(?:window|windows|door|doors|opening|openings|wall|walls|trace|match)\b/.test(text);
}

export function isOpeningIntent(text) {
  return /\b(window|windows|door|doors|slider|sliders|sliding door|opening|openings|glazing|egress)\b/.test(text);
}

export function hasOpeningPlacementData(text) {
  return /\b(north|south|east|west|n|s|e|w)\b/.test(text)
    && (
      /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide|window|door|slider|opening)/.test(text)
      || /\badd\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s+(?:north|south|east|west|n|s|e|w)\s+(?:window|door|slider|opening)\b/.test(text)
    );
}

export function isRoofIntent(text) {
  return /\b(roof|shed roof|lean[-\s=]*to|single slope|mono[-\s]*pitch|roofline|rafter|pitch)\b/.test(text);
}

export function roofProfile(shell = {}) {
  const roofType = shell.roofType || 'gable';
  const southWallHeightFt = Number(shell.southWallHeightFt || shell.wallHeightFt || 10);
  const northWallHeightFt = Number(shell.northWallHeightFt || shell.wallHeightFt || 10);
  const highWallHeightFt = Math.max(southWallHeightFt, northWallHeightFt, Number(shell.wallHeightFt || 10));
  const lowWallHeightFt = Math.min(southWallHeightFt, northWallHeightFt);
  const riseFt = Math.abs(southWallHeightFt - northWallHeightFt);
  const pitch = roofType === 'shed' && shell.depthFt ? riseFt / shell.depthFt : Number(shell.roofPitch || 0.32);
  const highSide = southWallHeightFt >= northWallHeightFt ? 'south' : 'north';
  return { roofType, southWallHeightFt, northWallHeightFt, highWallHeightFt, lowWallHeightFt, riseFt, pitch, highSide };
}

// Storeys: 1 = single storey, 1.5 = loft with knee walls, 2 = full two storey.
// Per-side wall heights describe the ground storey; extraFt is added on top of
// every side so the shed/loft trick (tall north, short south) still works upstairs.
export function storeyInfo(shell = {}) {
  const storeys = Math.min(3, Math.max(1, Number(shell.storeys || 1)));
  const baseWallFt = Number(shell.wallHeightFt || 10);
  // Upper storeys carry their OWN height (shell.upperStoreyHeightFt) — a 10'
  // ground floor under an 8' second storey is normal construction. Absent =
  // same as the ground (legacy designs unchanged).
  const upperFt = Math.min(14, Math.max(6, Number(shell.upperStoreyHeightFt || baseWallFt)));
  return { storeys, baseWallFt, upperFt, extraFt: (storeys - 1) * upperFt };
}

// The extent of an upper storey: a 'floor' plate element at that level defines
// how much of the footprint the storey covers (a second storey over only one
// side of the building). No plate = the full footprint (legacy designs).
export function upperPlateRect(spec, level = 2) {
  const plate = (spec.elements || []).find((element) => element.category === 'floor' && Number(element.level || 1) === level);
  if (!plate) return null;
  return {
    id: plate.id,
    x: Number(plate.x) || 0,
    y: Number(plate.y) || 0,
    w: Number(plate.w) || Number(spec.shell.widthFt) || 36,
    d: Number(plate.d) || Number(spec.shell.depthFt) || 28
  };
}

// How many floors the plan has = whichever is larger: the storeys setting, or
// the highest floor any room actually lives on.
export function floorCount(spec) {
  const byStoreys = Math.ceil(Number(spec.shell?.storeys || 1));
  const byRooms = Math.max(1, ...(spec.rooms || []).map((r) => Number(r.level || 1)));
  return Math.max(1, byStoreys, byRooms);
}

export function floorLabel(spec, floor) {
  if (floor === BASEMENT_LEVEL) return 'Basement';
  if (floor === 1) return 'Ground';
  if (floor === 2 && Number(spec.shell?.storeys) === 1.5) return 'Loft';
  const ord = { 2: '2nd', 3: '3rd', 4: '4th' };
  return `${ord[floor] || floor + 'th'} floor`;
}

export const UTILITY_DEFAULTS = {
  waterSource: 'well',
  tankGal: 0,
  wasteMethod: 'septic',
  wellSepticFt: 120,
  powerMode: 'offgrid',
  heatSource: 'wood_stove',
  foundationType: 'rubble',
  stemwallHeightFt: 1.5,
  diyWalls: false,
  diyRoof: false,
  diyHeat: false,
  diyFoundation: false
};

// Per-side roof overhang: shell.overhangFt is the global value, optional
// shell.overhangs.{north,south,east,west} break it open per side.
export function resolveOverhangs(shell = {}) {
  const all = Math.min(12, Math.max(0, Number(shell.overhangFt ?? 2)));
  const per = shell.overhangs || {};
  const sides = {
    north: per.north !== undefined ? Number(per.north) : all,
    south: per.south !== undefined ? Number(per.south) : all,
    east: per.east !== undefined ? Number(per.east) : all,
    west: per.west !== undefined ? Number(per.west) : all
  };
  return { ...sides, all, min: Math.min(sides.north, sides.south, sides.east, sides.west), split: Boolean(shell.overhangs) };
}

// Homestead elements the Outdoors page can toggle on and off (costs from the
// prototype's site engine; sizes are sensible plan-view defaults).
export const OUTDOOR_ITEMS = [
  { key: 'garden', name: 'Kitchen Garden', cost: 1200, w: 16, d: 10, h: 0.8, category: 'garden', note: 'Raised beds by the kitchen door.' },
  { key: 'greenhouse', name: 'Greenhouse', cost: 6000, w: 12, d: 8, h: 8, category: 'plant', note: 'Attach to the south wall to share heat.' },
  { key: 'root_cellar', name: 'Root Cellar', cost: 4000, w: 8, d: 10, h: 3, category: 'earthwork', note: 'Buried or north bank; cool and dark.' },
  { key: 'cistern', name: 'Cistern', cost: 3500, w: 6, d: 6, h: 4, category: 'water', note: 'Buried or shaded; size for the dry spell.' },
  { key: 'coop', name: 'Chicken Coop', cost: 1800, w: 8, d: 6, h: 6, category: 'animal', note: 'Away from the well, downwind of the house.' },
  { key: 'shed', name: 'Tool Shed', cost: 3500, w: 10, d: 8, h: 8, category: 'storage', note: 'Simple pole structure.' },
  { key: 'workshop', name: 'Workshop', cost: 9000, w: 16, d: 12, h: 9, category: 'structure', note: 'Power and light; separate for noise and dust.' },
  { key: 'sauna', name: 'Sauna', cost: 5500, w: 8, d: 8, h: 8, category: 'structure', note: 'Fire safety and a cool-down; near water is nice.' },
  { key: 'orchard', name: 'Orchard', cost: 1800, w: 30, d: 20, h: 1, category: 'landscape', note: 'Rows on contour; mind frost pockets.' },
  { key: 'pond', name: 'Pond', cost: 6000, w: 20, d: 16, h: 0.5, category: 'water', note: 'Fire reserve and habitat; watch setbacks.' }
];

// Outbuildings — sizable, constructable structures placed on the site (distinct
// from the fixed Outdoors homestead items). Each drops a real element you resize
// in the plan/model and cost by its construction.
// Foundation RUNS: strips of foundation placed under a SPECIFIC line — a
// load-bearing interior wall (the classic: the wall between the house and an
// attached greenhouse), a mass heater, a future addition. Placed like
// fixtures (elements, category 'foundation'), dragged into position on the
// plan, costed by the foot. Independent of the perimeter foundation type.
export const FOUNDATION_RUN_TYPES = {
  rubble: { label: 'Rubble trench', costLf: 22, stemCostLfFt: 0, carbonLf: 6, note: 'Drained gravel trench — carries a wall with almost no concrete.' },
  'rubble-stem': { label: 'Rubble trench + stem wall', costLf: 26, stemCostLfFt: 18, carbonLf: 10, note: 'The full natural detail: drained trench below, masonry stem above splash height. What a bale or cob wall wants.' },
  stemwall: { label: 'Stem wall on footing', costLf: 20, stemCostLfFt: 18, carbonLf: 18, note: 'Concrete footing and stem — conventional and strong.' },
  thickened: { label: 'Thickened slab edge / grade beam', costLf: 24, stemCostLfFt: 0, carbonLf: 22, note: 'For slab foundations: a deepened, reinforced strip under the load.' }
};
export const FOUNDATION_RUN_PRESETS = [
  { name: 'Rubble trench run', construction: 'rubble', w: 12, d: 1.5, h: 0.3 },
  { name: 'Trench + stem run', construction: 'rubble-stem', w: 12, d: 1.5, h: 1.5 },
  { name: 'Stem wall run', construction: 'stemwall', w: 12, d: 1.5, h: 1.5 },
  { name: 'Grade beam run', construction: 'thickened', w: 12, d: 1.5, h: 0.2 }
];

export const OUTBUILDING_CONSTRUCTION = {
  shed: { label: 'Simple shed frame', costPsf: 45 },
  pole: { label: 'Pole barn', costPsf: 40 },
  stick: { label: 'Stick frame', costPsf: 90 },
  timber: { label: 'Timber frame', costPsf: 130 },
  strawbale: { label: 'Straw bale', costPsf: 110 },
  cordwood: { label: 'Cordwood', costPsf: 95 }
};
export const OUTBUILDING_PRESETS = [
  { name: 'Shed', w: 10, d: 8, h: 8, construction: 'shed' },
  { name: 'Workshop', w: 16, d: 12, h: 9, construction: 'stick' },
  { name: 'Studio', w: 14, d: 12, h: 9, construction: 'timber' },
  { name: 'Barn', w: 24, d: 18, h: 14, construction: 'pole' },
  { name: 'Garage', w: 20, d: 12, h: 9, construction: 'stick' },
  { name: 'Guest cabin', w: 14, d: 12, h: 10, construction: 'timber' },
  { name: 'Greenhouse', w: 12, d: 8, h: 8, construction: 'shed' },
  { name: 'Sauna', w: 8, d: 8, h: 8, construction: 'timber' }
];

export function outdoorItemPresent(spec, item) {
  return (spec.elements || []).some((element) => element.name === item.name);
}

// Interior fixtures & equipment that live inside the house as placed objects —
// draggable in the 2D plan and rendered in 3D. The heater name follows the
// chosen heat source so "the heater" is a real object you can position.
export const HEATER_NAMES = { rocket_mass: 'Rocket Mass Heater', masonry: 'Masonry Heater', wood_stove: 'Wood Stove', minisplit: 'Mini-Split Unit' };
export const HEATER_SIZES = { rocket_mass: [6, 3], masonry: [4, 4], wood_stove: [3, 2.5], minisplit: [3, 1] };
export function interiorFixtures(spec) {
  const heat = (spec.utilities || {}).heatSource || 'wood_stove';
  const [hw, hd] = HEATER_SIZES[heat] || [3, 2.5];
  return [
    { key: 'heater', name: HEATER_NAMES[heat] || 'Heater', category: 'thermal', w: hw, d: hd, h: heat === 'masonry' ? 7 : 4 },
    { key: 'tank', name: 'Water Tank', category: 'water', w: 4, d: 4, h: 5 },
    { key: 'stairs', name: 'Stairs', category: 'structure', w: 3.5, d: 10, h: 8 },
    { key: 'counter', name: 'Kitchen Counter', category: 'structure', w: 8, d: 2, h: 3 },
    { key: 'bath', name: 'Bath Fixtures', category: 'water', w: 5, d: 3, h: 2.5 },
    { key: 'closet', name: 'Built-in Storage', category: 'storage', w: 6, d: 2, h: 7 }
  ];
}

// Common first-floor rooms with sensible default footprints — the quick-add
// palette on the Rooms page.
export const ROOM_PRESETS = [
  { name: 'Great Room', type: 'living', w: 18, d: 16 },
  { name: 'Kitchen', type: 'service', w: 14, d: 12 },
  { name: 'Dining', type: 'living', w: 12, d: 12 },
  { name: 'Bedroom', type: 'sleeping', w: 12, d: 12 },
  { name: 'Bathroom', type: 'wet', w: 8, d: 8 },
  { name: 'Office', type: 'work', w: 10, d: 10 },
  { name: 'Mudroom', type: 'service', w: 8, d: 8 },
  { name: 'Pantry', type: 'storage', w: 8, d: 6 }
];

// Button label for each one-click flag fix (keyed by issue.fixId). Absence of a
// fixId means the flag needs human judgment and shows prose guidance only.
export const FIX_LABELS = {
  'give-shed-fall': 'Drain it north (2′ fall)',
  'enclose-rooms': 'Grow the walls to enclose them',
  'add-wet-core': 'Add a bathroom',
  'add-mudroom': 'Add a mudroom',
  'add-south-entry': 'Add a south door',
  'add-south-glass': 'Add south glazing',
  'add-stair': 'Add a stair',
  'raise-stemwall': 'Raise stem wall to 18″',
  'add-stemwall': 'Add an 18″ stem wall',
  'well-septic': 'Set 100 ft separation',
  'deepen-overhang': 'Deepen overhangs to 2 ft',
  'reduce-south-overhang': 'Trim south overhang to 2.5 ft',
  'thicken-bale-wall': 'Thicken the wall',
  'set-stick-frame': 'Add a stick frame'
};

// Give a new room a non-colliding display name (Bedroom, Bedroom 2, ...).
export function uniqueRoomName(spec, base) {
  const existing = new Set((spec.rooms || []).map((room) => room.name));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

// Shelf-pack rooms into a non-overlapping floor plan and report the footprint
// they need. Largest-first, left-to-right rows that wrap; a small gap stands
// in for interior partitions, a margin for the exterior wall. Returns each
// room's new x/y plus the width/depth the shell needs to hold them.
export function packRooms(rooms, shellW) {
  const gap = 0.5;
  const margin = 1;
  const usableW = Math.max(4, shellW - margin * 2);
  const order = [...rooms].sort((a, b) => (Number(b.w) * Number(b.d)) - (Number(a.w) * Number(a.d)));
  const placed = [];
  let cursorX = margin;
  let cursorY = margin;
  let rowDepth = 0;
  let maxRowRight = margin;
  for (const room of order) {
    const w = Number(room.w) || 10;
    const d = Number(room.d) || 10;
    if (cursorX > margin && cursorX + w > margin + usableW) {
      cursorX = margin;
      cursorY += rowDepth + gap;
      rowDepth = 0;
    }
    placed.push({ id: room.id, x: Math.round(cursorX * 10) / 10, y: Math.round(cursorY * 10) / 10 });
    cursorX += w + gap;
    rowDepth = Math.max(rowDepth, d);
    maxRowRight = Math.max(maxRowRight, cursorX - gap);
  }
  return {
    placed,
    neededW: Math.ceil(maxRowRight + margin),
    neededD: Math.ceil(cursorY + rowDepth + margin)
  };
}

// Room-noun -> preset for the local chat fast-path. Superset of ROOM_PRESETS.
// Trailing s? on each so plurals match ("two bedrooms"). Most specific first;
// the generic room/space entry is last so "dining room" resolves to Dining.
export const ROOM_SYNONYMS = [
  { re: /\b(great rooms?|living rooms?|family rooms?|lounges?|parlors?)\b/, name: 'Living Room', type: 'living', w: 18, d: 16 },
  { re: /\b(primary bedrooms?|master bedrooms?|main bedrooms?)\b/, name: 'Primary Bedroom', type: 'sleeping', w: 14, d: 12 },
  { re: /\b(bedrooms?|bed rooms?|bedrms?|guest rooms?)\b/, name: 'Bedroom', type: 'sleeping', w: 12, d: 12 },
  { re: /\b(kitchens?|kitchenettes?)\b/, name: 'Kitchen', type: 'service', w: 14, d: 12 },
  { re: /\b(dining rooms?|dinings?|breakfast nooks?)\b/, name: 'Dining', type: 'living', w: 12, d: 12 },
  { re: /\b(bathrooms?|bath rooms?|baths?|powder rooms?|powders?|toilets?|washrooms?|ensuites?|en-suites?)\b/, name: 'Bathroom', type: 'wet', w: 8, d: 8 },
  { re: /\b(mudrooms?|mud rooms?|boot rooms?)\b/, name: 'Mudroom', type: 'service', w: 8, d: 8 },
  { re: /\b(laundry|laundries|utility rooms?|utilities|utility)\b/, name: 'Laundry', type: 'service', w: 8, d: 8 },
  { re: /\b(offices?|study|studies|studios?|dens?|workrooms?|work rooms?)\b/, name: 'Office', type: 'work', w: 10, d: 10 },
  { re: /\b(pantry|pantries|larders?)\b/, name: 'Pantry', type: 'storage', w: 8, d: 6 },
  { re: /\b(closets?|storages?|store rooms?|storerooms?)\b/, name: 'Closet', type: 'storage', w: 6, d: 5 },
  { re: /\b(mechanicals?|mech rooms?|plant rooms?|equipment rooms?)\b/, name: 'Mechanical', type: 'wet', w: 8, d: 8 },
  { re: /\b(greenhouses?|sunrooms?|sun rooms?|solariums?|conservatories|conservatory)\b/, name: 'Sunroom', type: 'plant', w: 12, d: 10 },
  { re: /\b(porches|porch|verandas?|decks?)\b/, name: 'Porch', type: 'living', w: 16, d: 8 },
  { re: /\b(nurseries|nursery|kids rooms?|childrens rooms?)\b/, name: 'Nursery', type: 'sleeping', w: 10, d: 10 },
  { re: /\b(rooms?|spaces?)\b/, name: 'Room', type: 'living', w: 12, d: 12 }
];

export const WORD_COUNTS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, another: 1 };

// Parse a plain "add a bedroom" / "add two bedrooms 12x14 and a kitchen" chat
// line into room specs — the instant local path that skips the slow planner.
// Returns null if the text isn't a simple add-room request (so it falls
// through to the full planner / Gemini).
export function parseLocalRoomAdds(text) {
  const t = String(text || '').toLowerCase().trim();
  // Must be an additive request, and must NOT ask for anything the layout
  // engine can't do (walls, roof, systems, moves, stacking, per-room placement).
  if (!/\b(add|put in|include|give me|need|want|create|place)\b/.test(t)) return null;
  if (/\b(wall|roof|window|door|foundation|solar|water|septic|move|resize|remove|delete|rotate|loft|tower|storey|story|upstairs|level|above|below|next to|beside|between|north|south|east|west|corner)\b/.test(t)) return null;

  const rooms = [];
  const nameCount = {};
  // Split on "and"/commas so "a kitchen and two bedrooms" yields both.
  const clauses = t.replace(/\badd\b|\bplease\b|\bi\b|\bwould like\b|\bto the (house|plan|design)\b/g, ' ').split(/\s*(?:,|;|\band\b|\bplus\b|\balso\b)\s*/);
  for (const clause of clauses) {
    const match = ROOM_SYNONYMS.find((syn) => syn.re.test(clause));
    if (!match) continue;
    // count: number word or digit before the noun
    let count = 1;
    const numMatch = clause.match(/\b(\d+)\b/);
    const wordMatch = clause.match(/\b(a|an|one|two|three|four|five|six|another)\b/);
    // A dimension like 12x14 also has digits — don't read those as counts.
    const dimMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/);
    if (numMatch && !(dimMatch && dimMatch[0].includes(numMatch[1]))) count = clamp(Number(numMatch[1]), 1, 8);
    else if (wordMatch) count = WORD_COUNTS[wordMatch[1]] || 1;
    const w = dimMatch ? clamp(Number(dimMatch[1]), 4, 60) : match.w;
    const d = dimMatch ? clamp(Number(dimMatch[2]), 4, 60) : match.d;
    for (let i = 0; i < count; i += 1) {
      nameCount[match.name] = (nameCount[match.name] || 0) + 1;
      rooms.push({ name: match.name, type: match.type, w, d });
    }
  }
  return rooms.length ? rooms : null;
}

export function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.d + gap && a.y + a.d + gap > b.y;
}

// Find the first free spot for a w×d room inside the shell that doesn't collide
// with existing rooms — so adding a room never has to disturb the others.
export function findFreeSpot(shellW, shellD, rooms, w, d, footprint = null) {
  const margin = 1;
  const gap = 0.5;
  for (let y = margin; y + d <= shellD - margin + 0.01; y += 1) {
    for (let x = margin; x + w <= shellW - margin + 0.01; x += 1) {
      const cand = { x, y, w, d };
      if (rooms.some((r) => rectsOverlap(cand, r, gap))) continue;
      // On an L/U footprint the spot must sit inside the outline, not the notch.
      if (footprint && !rectInFootprint(footprint, { x: x - 0.5, y: y - 0.5, w: w + 1, d: d + 1 })) continue;
      return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
    }
  }
  return null;
}

// Place one or more NEW rooms without moving any existing room: each drops into
// the first free gap; if none fits, the house grows (down, and wider if the
// room itself is too wide) and the room lands in the new space. Returns add ops
// + any shell-grow ops, plus whether it grew.
export function planNewRoomPlacements(spec, newRooms, level = 1) {
  // Only rooms on the SAME floor collide — each storey packs independently.
  const virtualRooms = (spec.rooms || []).filter((r) => Number(r.level || 1) === level).map((r) => ({ x: Number(r.x), y: Number(r.y), w: Number(r.w), d: Number(r.d) }));
  const taken = new Set((spec.rooms || []).map((r) => r.name));
  let shellW = Number(spec.shell.widthFt);
  let shellD = Number(spec.shell.depthFt);
  const startW = shellW;
  const startD = shellD;
  const addOps = [];
  const names = [];
  for (const nr of newRooms) {
    let name = nr.name;
    let n = 2;
    while (taken.has(name)) { name = `${nr.name} ${n}`; n += 1; }
    taken.add(name);
    names.push(name);
    const fpForSpots = hasCustomFootprint(spec) && shellW === Number(spec.shell.widthFt) && shellD === Number(spec.shell.depthFt) ? footprintPolygon(spec) : null;
    let spot = findFreeSpot(shellW, shellD, virtualRooms, nr.w, nr.d, fpForSpots);
    if (!spot) {
      if (nr.w > shellW - 2) shellW = clamp(Math.ceil(nr.w + 2), 18, 120);
      const bottom = virtualRooms.length ? Math.max(...virtualRooms.map((r) => r.y + r.d)) : 1;
      const y = Math.round((bottom + 0.5) * 2) / 2;
      shellD = clamp(Math.max(shellD, Math.ceil(y + nr.d + 1)), 18, 80);
      spot = { x: 1, y };
    }
    virtualRooms.push({ x: spot.x, y: spot.y, w: nr.w, d: nr.d });
    addOps.push({ type: 'add_room', name, category: nr.type, w: nr.w, d: nr.d, x: spot.x, y: spot.y, level });
  }
  const growOps = [];
  if (shellW !== startW) growOps.push({ type: 'set_shell', field: 'widthFt', value: String(shellW) });
  if (shellD !== startD) growOps.push({ type: 'set_shell', field: 'depthFt', value: String(shellD) });
  return { ops: [...growOps, ...addOps], names, grew: growOps.length > 0, newW: shellW, newD: shellD };
}

// Interior partitions implied by the room layout: where two rooms on one floor
// sit edge-to-edge, a thin wall belongs on the shared line — with a 3' doorway
// so the plan stays walkable. Skips lines a partition already covers. Returns
// add_element ops (ONE dispatch — never N calls on stale state).
export function derivePartitionOps(spec, level = 1) {
  const rooms = (spec.rooms || []).filter((r) => Number(r.level || 1) === level);
  const existing = (spec.elements || []).filter((e) => e.category === 'partition' && Number(e.level || 1) === level);
  const bInfo = basementInfo(spec.shell);
  const baseWallFt = Number(spec.shell.wallHeightFt || 10);
  const wallH = level === BASEMENT_LEVEL ? Math.max(6, bInfo.heightFt - 0.3) : Math.max(7, baseWallFt - 0.5);
  const z = level === BASEMENT_LEVEL ? -bInfo.heightFt + 0.1 : level > 1 ? (level - 1) * baseWallFt + 0.45 : 0;
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
  const ops = [];
  const placedRects = [];
  const shared = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const A = rooms[i];
      const B = rooms[j];
      let rect = null;
      // Vertical shared line (east face of one meets west face of the other).
      const vPairs = [[A.x + A.w, B.x], [B.x + B.w, A.x]];
      for (const [edge, face] of vPairs) {
        if (Math.abs(edge - face) <= 1.2) {
          const [s0, s1] = shared(A.y, A.y + A.d, B.y, B.y + B.d);
          if (s1 - s0 >= 4) rect = { x: (edge + face) / 2 - 0.225, y: s0 + 0.25, w: 0.45, d: (s1 - s0) - 0.5 };
        }
      }
      // Horizontal shared line (south face meets north face).
      const hPairs = [[A.y + A.d, B.y], [B.y + B.d, A.y]];
      for (const [edge, face] of hPairs) {
        if (!rect && Math.abs(edge - face) <= 1.2) {
          const [s0, s1] = shared(A.x, A.x + A.w, B.x, B.x + B.w);
          if (s1 - s0 >= 4) rect = { x: s0 + 0.25, y: (edge + face) / 2 - 0.225, w: (s1 - s0) - 0.5, d: 0.45 };
        }
      }
      if (!rect) continue;
      const probe = { x: rect.x - 0.5, y: rect.y - 0.5, w: rect.w + 1, d: rect.d + 1 };
      if (existing.some((e) => overlaps(probe, e)) || placedRects.some((r) => overlaps(probe, r))) continue;
      placedRects.push(rect);
      const run = Math.max(rect.w, rect.d);
      ops.push({
        type: 'add_element', category: 'partition', name: `${A.name} / ${B.name} wall`,
        x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10,
        w: Math.round(rect.w * 10) / 10, d: Math.round(rect.d * 10) / 10,
        h: wallH, z, level, construction: 'framed',
        widthFt: 3, positionFt: Math.round(((run - 3) / 2) * 2) / 2,
        reason: `Shared line between ${A.name} and ${B.name}.`
      });
    }
  }
  return ops;
}

// Build the operation list that tidies the current rooms into a plan and grows
// the shell to hold them if needed.
export function arrangeRoomsPlan(spec) {
  const rooms = spec.rooms || [];
  if (!rooms.length) return { ops: [], grew: false, newW: Number(spec.shell.widthFt), newD: Number(spec.shell.depthFt) };
  const curW = Number(spec.shell.widthFt);
  const curD = Number(spec.shell.depthFt);
  // Pack against a target width so wide programs wrap sensibly: keep the
  // current width unless the rooms genuinely need more.
  const firstPass = packRooms(rooms, curW);
  const targetW = Math.max(curW, firstPass.neededW);
  const { placed, neededW, neededD } = packRooms(rooms, targetW);
  const newW = clamp(Math.max(curW, neededW), 18, 120);
  const newD = clamp(Math.max(curD, neededD), 18, 80);
  const ops = [];
  if (newW !== curW) ops.push({ type: 'set_shell', field: 'widthFt', value: String(newW) });
  if (newD !== curD) ops.push({ type: 'set_shell', field: 'depthFt', value: String(newD) });
  for (const p of placed) {
    const room = rooms.find((r) => r.id === p.id);
    if (room) ops.push({ type: 'move_object', targetId: p.id, name: room.name, x: p.x, y: p.y });
  }
  return { ops, grew: newW !== curW || newD !== curD, newW, newD };
}

// Model-view layers: every group in the scene can be shown/hidden in any
// combination for inspection (walls per side, roof, floors, rooms, openings,
// site, element categories), plus x-ray walls. Persisted with the design.
export const DEFAULT_MODEL_LAYERS = {
  wallNorth: true,
  wallSouth: true,
  wallEast: true,
  wallWest: true,
  roof: true,
  upperFloors: true,
  rooms: true,
  openings: true,
  elements: true,
  pad: true,
  ground: true,
  labels: true,
  xray: false,
  explode: false,
  hiddenCats: []
};

// --- Build mode: construction phases + maintenance (salvaged from the
// add-on's constructionTimeline.js, adapted to the current design) ---------
export const BUILD_PHASES_BASE = [
  { id: 'site-prep', title: 'Site Prep & Excavation', weeks: 1.5, costPct: 0.08, inspector: false,
    materials: 'Survey stakes, string lines, geotextile fabric, erosion fencing.',
    tools: 'Transit level, shovel, tape, clearing saw, rental excavator.',
    safety: 'Call 811 before digging. Watch trench edges; high-vis gear.',
    weather: 'Best in dry season — wet clay means mud pits and cave-ins.' },
  { id: 'foundation', title: 'Foundation', weeks: 2.0, costPct: 0.18, inspector: true,
    materials: 'Gravel pack, concrete, rebar, anchor bolts, drain tile.',
    tools: 'Mixer, wheelbarrow, screed boards, compactor.',
    safety: 'Wet concrete burns skin — glasses and boots.',
    weather: 'Above 40°F to cure; protect from heavy rain.' },
  { id: 'framing', title: 'Frame & Raising', weeks: 3.0, costPct: 0.22, inspector: true,
    materials: 'Timber posts and plates, joists, pegs / fasteners.',
    tools: 'Chainsaw, mallet, chisel, come-along, scaffolding.',
    safety: 'Fall hazard above 6 ft — harness up. Mind raising trajectories.',
    weather: 'Avoid high winds; wet timber is slick.' },
  { id: 'walls', title: 'Wall Raising', weeks: 2.5, costPct: 0.15, inspector: false,
    materials: 'Dry bales, pins, mesh, clay slip.',
    tools: 'Bale needle, tamper, chainsaw, plaster hawk.',
    safety: 'Heavy repetitive lifting; N95 for straw dust.',
    weather: 'CRITICAL: bales stay bone dry — tarps always ready.' },
  { id: 'roofing', title: 'Roof Framing & Cladding', weeks: 2.0, costPct: 0.14, inspector: true,
    materials: 'Rafters, sheathing, underlayment, metal cladding, flashing.',
    tools: 'Circular saw, drill, tin snips, harness.',
    safety: 'High fall risk — inspect lines daily.',
    weather: 'Never on a wet or windy roof.' },
  { id: 'utilities', title: 'Rough Plumbing & Electrical', weeks: 2.0, costPct: 0.11, inspector: true,
    materials: 'PEX, PVC waste lines, conduit, wire, boxes.',
    tools: 'Pipe cutter, crimper, strippers, multimeter.',
    safety: 'Lock out the main. Never handle live circuits.',
    weather: 'Sheltered work once the roof is on.' },
  { id: 'plaster', title: 'Plaster & Finishes', weeks: 3.0, costPct: 0.12, inspector: false,
    materials: 'Lime binder, sifted sand, clay, chopped straw.',
    tools: 'Mortar mixer, hawk, trowels, spray bottles.',
    safety: 'Lime is caustic — goggles and thick gloves.',
    weather: 'Warm, draft-free curing; no freezing, no fast drying.' },
  { id: 'occupancy', title: 'Final Inspection & Handover', weeks: 1.0, costPct: 0.0, inspector: true,
    materials: 'CO/smoke detectors, water test kits, permit package.',
    tools: 'Multimeter, flashlight, the paperwork.',
    safety: 'Confirm egress routes are clear.',
    weather: 'None.' }
];

export const MAINTENANCE_TASKS = [
  { interval: 'Annual', title: 'Rubble trench drain flushing', desc: 'Flush the perimeter drain with a hose to clear silt.', when: (spec, u) => u.foundationType === 'rubble' },
  { interval: 'Annual', title: 'Roof flashing check', desc: 'Inspect cladding joints and flue flashing before winter.', when: () => true },
  { interval: 'Annual', title: 'Plaster crack patching', desc: 'Patch hairline cracks in exterior lime plaster.', when: (spec) => WALL_SIDES.some((side) => resolveWallSide(spec, side).assemblyKey !== 'framed') },
  { interval: '5-year', title: 'Lime-wash refresh', desc: 'Fresh breathable coating on exposed natural walls.', when: (spec) => WALL_SIDES.some((side) => resolveWallSide(spec, side).assemblyKey !== 'framed') },
  { interval: '10-year', title: 'Battery health check', desc: 'Full load diagnostic on the solar bank; inspect terminals.', when: (spec, u) => u.powerMode === 'offgrid' }
];

// Adapt the base phases to what this design actually is.
export function buildTimeline(spec, derived) {
  const phases = structuredClone(BUILD_PHASES_BASE);
  const u = derived.utilities;
  const foundation = phases.find((phase) => phase.id === 'foundation');
  if (u.foundationType === 'slab') {
    foundation.title = 'Insulated Slab Pour';
    foundation.materials = 'Concrete, wire mesh, vapor barrier, gravel base, EPS boards.';
    foundation.weeks = 1.8;
  } else if (u.foundationType === 'stemwall') {
    foundation.title = `Stem Wall (${derived.stemwallHeightFt}') & Footing`;
    foundation.materials = 'Form plywood, concrete, rebar, footing drains, gravel.';
    foundation.weeks = 2.2;
  } else {
    foundation.title = 'Rubble Trench & Grade Beam';
    foundation.materials = 'Drain rock, drain tile, geotextile, shallow grade beam.';
  }
  const wallsPhase = phases.find((phase) => phase.id === 'walls');
  const assemblies = [...new Set(WALL_SIDES.map((side) => resolveWallSide(spec, side)).filter((r) => !r.omitted).map((r) => r.assembly.label))];
  wallsPhase.title = `Wall Raising — ${assemblies.join(' + ')}`;
  if (assemblies.every((label) => label.includes('Framed'))) {
    wallsPhase.materials = 'Studs/plates, sheathing, dense-pack insulation, membranes.';
    wallsPhase.weather = 'Keep sheathing and insulation dry.';
    wallsPhase.weeks = 2.0;
  }
  const heat = derived.utilities.heatSource;
  if (heat === 'rocket_mass' || heat === 'masonry') {
    phases.splice(phases.findIndex((phase) => phase.id === 'plaster'), 0, {
      id: 'heater', title: heat === 'rocket_mass' ? 'Rocket Mass Heater Build' : 'Masonry Heater Build', weeks: heat === 'rocket_mass' ? 1.5 : 2.5, costPct: 0.0, inspector: true,
      materials: 'Firebrick, cob/mass, barrel or core kit, flue pipe.',
      tools: 'Trowels, level, angle grinder.',
      safety: 'Respect clearances to combustibles; CO detector before first burn.',
      weather: 'Indoor once the roof is on.'
    });
  }
  return phases;
}

// The Build page's materials list. LAW: every system the design PRICES (each
// non-zero derived.cost line) shows up here — with a real quantity where the
// model can compute one, and an honest "not calculated yet" where it can't.
// Four rows under the heading "Materials takeoff" read as a complete list,
// and a list that silently omits the walls of the house breaks trust.
export function materialsTakeoff(spec, derived) {
  const u = derived.utilities;
  const rows = [];
  const covered = new Set();
  const add = (costKey, item, qty, note) => { covered.add(costKey); rows.push([item, qty, note]); };
  const perimeter = 2 * ((Number(spec.shell.widthFt) || 0) + (Number(spec.shell.depthFt) || 0));

  // Foundation
  if (derived.basement?.present) {
    add('foundation', 'Concrete (basement)', `${Math.round((perimeter * derived.basement.heightFt * 0.67 + derived.floor * 0.33) / 27)} yd³`, 'basement walls + slab');
  } else if (u.foundationType === 'rubble') {
    add('foundation', 'Drain rock', `${Math.round(perimeter * 1.5 * 3 / 27)} yd³`, 'perimeter trench 18" × 36"');
  } else if (u.foundationType === 'stemwall') {
    add('foundation', 'Concrete (stem + footing)', `${Math.round((perimeter * derived.stemwallHeightFt * 0.67 + perimeter * 1.33 * 0.83) / 27)} yd³`, `${derived.stemwallHeightFt}' stem on footing`);
  } else if (u.foundationType === 'slab') {
    add('foundation', 'Concrete (slab)', `${Math.round(derived.floor * 0.33 / 27)} yd³`, '4" slab over insulation');
  }
  const runs = (spec.elements || []).filter((el) => el.category === 'foundation');
  if (runs.length) {
    const runLf = runs.reduce((sum, el) => sum + Math.max(Number(el.w) || 0, Number(el.d) || 0), 0);
    add('foundation', 'Foundation runs', `${Math.round(runLf)} lf`, 'strips under specific walls');
  }

  // Frame
  if ((derived.cost.frame || 0) > 0) {
    const frame = FRAME_TYPES[derived.frameGround] || FRAME_TYPES['load-bearing'];
    const bay = Number(frameOf(spec).baySpacingFt) || 8;
    if (['timber', 'post-beam', 'pole'].includes(derived.frameGround)) {
      add('frame', `${frame.label} posts`, `~${Math.ceil(perimeter / bay)}`, `one per ${bay}′ bay — full member list: Export → Frame drawings`);
    } else if (['stick', 'double-stud'].includes(derived.frameGround)) {
      add('frame', 'Studs (frame)', `~${Math.ceil(perimeter / 1.33) * Math.max(1, Math.round(derived.storeys || 1)) * (derived.frameGround === 'double-stud' ? 2 : 1)}`, '16" on center — full cut list: Export → Frame drawings');
    } else {
      add('frame', `Frame (${frame.label.toLowerCase()})`, '—', 'not calculated yet — see Export → Frame drawings');
    }
  }

  // Walls — one row per assembly actually on the building, both storeys.
  const sections = getWallSections(spec).filter((wall) => !wall.omitted);
  const areaByAssembly = new Map();
  sections.forEach((wall) => {
    const area = wall.lengthFt * wall.heightFt;
    areaByAssembly.set(wall.assemblyKey, (areaByAssembly.get(wall.assemblyKey) || 0) + area);
  });
  for (const [key, area] of areaByAssembly) {
    const assembly = WALL_ASSEMBLIES[key];
    if (!assembly || area <= 0) continue;
    if (key === 'straw-bale') add('walls', 'Straw bales', `~${Math.ceil(area / 5.5)}`, 'two-string, laid flat — plus 15% spares');
    else if (key === 'glazed') add('walls', 'Glass wall panels', `${Math.round(area)} sf`, 'glazed wall faces');
    else add('walls', `${assembly.label} walls`, `${Math.round(area)} sf`, 'wall face area');
  }
  const plasterFaces = sections.filter((wall) => !['framed', 'sips', 'ply-insulated', 'icf', 'glazed'].includes(wall.assemblyKey))
    .reduce((sum, wall) => sum + wall.lengthFt * wall.heightFt * 2, 0);
  if (plasterFaces > 0) add('walls', 'Plaster (3 coats)', `${Math.round(plasterFaces)} sf`, 'both faces of natural walls');
  const claddingByType = new Map();
  sections.forEach((wall) => {
    const key = resolveWallSide(spec, wall.side, wall.level || 1).cladding || 'render';
    if (key === 'render') return;
    claddingByType.set(key, (claddingByType.get(key) || 0) + wall.lengthFt * wall.heightFt);
  });
  for (const [key, area] of claddingByType) {
    const clad = CLADDING_TYPES[key];
    if (clad && area > 0) add('walls', `Cladding (${clad.label.toLowerCase()})`, `${Math.round(area)} sf`, 'exterior faces');
  }
  const partitionLf = (spec.elements || []).filter((el) => el.category === 'partition')
    .reduce((sum, el) => sum + Math.max(Number(el.w) || 0, Number(el.d) || 0), 0);
  if (partitionLf > 0) add('walls', 'Interior walls', `${Math.round(partitionLf)} lf`, 'partition runs with doorways');

  // Floor assembly
  const subfloor = SUBFLOOR_TYPES[derived.subfloor];
  if (subfloor && derived.subfloor !== 'slab') add('flooring', `Subfloor (${subfloor.label.split(' —')[0]})`, `${Math.round(derived.floor)} sf`, 'ground-floor deck');
  const finish = FLOORING_TYPES[derived.flooring];
  if (finish) add('flooring', `Finish floor (${finish.label.toLowerCase()})`, `${Math.round(derived.heatedFloor)} sf`, 'all heated floors');
  const floorInsul = INSULATION_TYPES[derived.floorInsulation];
  if (floorInsul && derived.floorInsulation !== 'none') add('flooring', `Floor insulation (${floorInsul.label.toLowerCase()})`, `${Math.round(derived.floor)} sf`, 'under the ground floor');

  // Upper floors (storey decks, lofts, towers)
  if ((derived.cost.upperFloors || 0) > 0) {
    add('upperFloors', 'Upper floor structure', `${Math.round(derived.cost.upperFloors / 12)} sf`, 'joists + decking for storeys and lofts');
  }

  // Roof
  add('roof', 'Roof cladding + sheathing', `${Math.round(derived.roofArea)} sf`, 'includes overhangs and pitch');
  const roofInsul = INSULATION_TYPES[derived.roofInsulation];
  if (roofInsul && derived.roofInsulation !== 'none') add('roof', `Roof insulation (${roofInsul.label.toLowerCase()})`, `${Math.round(derived.roofArea)} sf`, `R≈${derived.roofR}`);
  add('roof', 'Roof framing (rafters)', '—', 'not calculated yet — rafters draw in Export → Frame drawings');

  // Windows & doors
  const openings = spec.openings || [];
  const glazedCount = openings.filter((opening) => (OPENING_TYPES[opening.type] || OPENING_TYPES.window).glazed).length;
  const doorCount = openings.length - glazedCount;
  if (glazedCount > 0) add('windows', 'Windows', `${glazedCount}`, 'each with frame, flashing, and sill');
  if (doorCount > 0) add('windows', 'Doors', `${doorCount}`, 'exterior doors and frames');
  add('windows', 'Glazing', `${Math.round(derived.totalGlass)} sf`, u.windowQuality === 'triple' ? 'triple pane' : 'double pane');

  // Heat
  const heatLabels = { rocket_mass: 'Rocket mass heater', masonry: 'Masonry heater', wood_stove: 'Wood stove', minisplit: 'Mini-split heat pump' };
  add('heat', heatLabels[u.heatSource] || 'Heating system', '1', 'plus flue/lineset — clearances on the Heat page');

  // Water
  if (u.waterSource === 'well') add('water', 'Well + pump', '1', 'depth is site-specific — not calculated yet');
  else if (u.waterSource === 'catchment') add('water', 'Rain catchment', `${Math.round(derived.catchmentGpd)} gal/day`, 'gutters + first-flush + filtration');
  else if (u.waterSource === 'spring') add('water', 'Spring development', '1', 'boxes and line — not calculated yet');
  else add('water', 'Water hookup', '1', 'meter + trench to the main');
  if ((Number(u.tankGal) || 0) > 0) add('water', 'Storage tank', `${Number(u.tankGal).toLocaleString()} gal`, 'cistern or above-ground');

  // Waste
  const wasteLabels = { septic: 'Septic system', composting: 'Composting toilet system', reedbed: 'Reed bed + greywater' };
  add('waste', wasteLabels[u.wasteMethod] || 'Waste system', '1', u.wasteMethod === 'septic' ? 'tank + field, sized by perc test — not calculated yet' : 'sized by occupancy');

  // Power
  if (derived.panels > 0) add('power', 'Solar panels', `${derived.panels} × 400 W`, `${derived.batteryKwh > 0 ? `+ ${derived.batteryKwh} kWh battery` : 'grid-tied'}`);
  else add('power', 'Grid connection', '1', 'panel + meter');

  // Outdoors
  const outdoorCount = (spec.elements || []).filter((el) => ['outbuilding', 'garden', 'animal', 'site'].includes(el.category)).length;
  if ((derived.cost.outdoors || 0) > 0) add('outdoors', 'Outdoor structures & site work', `${outdoorCount || '—'} item${outdoorCount === 1 ? '' : 's'}`, 'per-item quantities not calculated yet — priced in Costs');

  // COMPLETENESS SWEEP: any priced system that still has no row gets an honest
  // placeholder — the list never silently omits something the design pays for.
  for (const { key, label } of COST_ROWS) {
    if ((derived.cost[key] || 0) > 0 && !covered.has(key)) {
      rows.push([label, '—', 'not calculated yet — priced in Costs']);
    }
  }
  return rows;
}

export const LAYER_PRESETS = {
  all: { ...DEFAULT_MODEL_LAYERS },
  structure: { ...DEFAULT_MODEL_LAYERS, rooms: false, openings: false, elements: false, labels: false },
  plan: { ...DEFAULT_MODEL_LAYERS, roof: false, upperFloors: false, wallNorth: false, wallSouth: false, wallEast: false, wallWest: false, openings: false },
  interior: { ...DEFAULT_MODEL_LAYERS, roof: false, xray: true },
  site: { ...DEFAULT_MODEL_LAYERS, roof: true, rooms: false, openings: false, labels: false },
  // The raising view: skeleton solid, walls ghosted, skin off — what the
  // frame crew sees the morning the bents go up.
  frame: { ...DEFAULT_MODEL_LAYERS, xray: true, roof: false, rooms: false, openings: false, elements: false, labels: false }
};

// Mirror of bim-core SITE_DEFAULTS — keep in sync (topography fields included).
export const SITE_DEFAULTS = { zip: '', placeName: '', latitudeDeg: 43, rainInYr: 38, slopeFt: 0, slopeDir: 'south', gradeFt: 1.5, contourInterval: 2 };

export function siteOf(spec) {
  return { ...SITE_DEFAULTS, ...(spec.site || {}) };
}

export function utilitiesOf(spec) {
  return { ...UTILITY_DEFAULTS, ...(spec.utilities || {}) };
}

export function frameOf(spec) {
  return { type: 'load-bearing', storeyTypes: {}, ...(spec.frame || {}) };
}

// Which material systems are marked reclaimed / salvaged. Reclaimed materials
// cut cost and (especially) embodied carbon — reused stock carries no new
// manufacturing burden.
export function reclaimedOf(spec) {
  return { frame: false, walls: false, flooring: false, windows: false, roof: false, ...(spec.reclaimed || {}) };
}
export const RECLAIMED_FACTORS = {
  frame: { cost: 0.4, carbon: 0.15 },
  walls: { cost: 0.65, carbon: 0.3 },
  flooring: { cost: 0.45, carbon: 0.25 },
  windows: { cost: 0.4, carbon: 0.35 },
  roof: { cost: 0.6, carbon: 0.3 }
};

// Offline ZIP -> region estimate (the assistant/geocoder refines this later).
export function zipRegionInfo(zip) {
  if (!/^\d{5}$/.test(zip)) return null;
  const regions = {
    0: { name: 'New England / NJ', lat: 42.5, rain: 46 },
    1: { name: 'NY · PA · DE', lat: 41.5, rain: 42 },
    2: { name: 'Mid-Atlantic / Carolinas', lat: 37.5, rain: 45 },
    3: { name: 'Deep South / Florida', lat: 31, rain: 54 },
    4: { name: 'Great Lakes / Ohio Valley', lat: 40, rain: 40 },
    5: { name: 'Upper Midwest / N. Plains', lat: 45, rain: 30 },
    6: { name: 'Central Plains', lat: 39, rain: 38 },
    7: { name: 'South Central / Texas', lat: 31, rain: 40 },
    8: { name: 'Mountain West', lat: 39, rain: 16 },
    9: { name: 'West Coast', lat: 39, rain: 24 }
  };
  return regions[zip[0]] || null;
}

export function directionalHeightFromText(text, directionWords) {
  const directionPattern = directionWords.join('|');
  const afterDirection = new RegExp(`\\b(?:${directionPattern})\\b[^.;\\n]{0,70}?(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')`, 'i');
  const beforeDirection = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')[^.;\\n]{0,70}?\\b(?:${directionPattern})\\b`, 'i');
  return text.match(afterDirection)?.[1] || text.match(beforeDirection)?.[1] || null;
}

export function applyRoofInstruction(spec, text) {
  if (!isRoofIntent(text)) return null;
  const shell = spec.shell;
  const wantsShed = /\b(shed|lean[-\s=]*to|single slope|mono[-\s]*pitch)\b/.test(text);
  const southHeight = directionalHeightFromText(text, ['south', 's']);
  const northHeight = directionalHeightFromText(text, ['north', 'n']);
  const genericHeights = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/g)].map((match) => Number(match[1]));

  if (wantsShed || southHeight || northHeight) shell.roofType = 'shed';
  if (southHeight) shell.southWallHeightFt = clamp(Number(southHeight), 2, 24);
  if (northHeight) shell.northWallHeightFt = clamp(Number(northHeight), 2, 24);
  if (!southHeight && !northHeight && wantsShed && genericHeights.length >= 2) {
    shell.southWallHeightFt = clamp(Math.max(...genericHeights), 7, 24);
    shell.northWallHeightFt = clamp(Math.min(...genericHeights), 7, 24);
  }
  if (wantsShed && (!shell.southWallHeightFt && !shell.northWallHeightFt || Number(shell.southWallHeightFt) === Number(shell.northWallHeightFt))) {
    shell.southWallHeightFt = clamp(Number(shell.wallHeightFt || 10) + 2, 7, 24);
    shell.northWallHeightFt = clamp(Number(shell.wallHeightFt || 10), 7, 24);
  }
  if (shell.roofType === 'shed') {
    if (!shell.southWallHeightFt) shell.southWallHeightFt = Number(shell.wallHeightFt || 10) + 2;
    if (!shell.northWallHeightFt) shell.northWallHeightFt = Number(shell.wallHeightFt || 10);
    const profile = roofProfile(shell);
    shell.wallHeightFt = profile.highWallHeightFt;
    shell.roofPitch = Math.round(profile.pitch * 1000) / 1000;
    shell.roofNote = `${profile.highSide} high shed roof; ${profile.southWallHeightFt}' south wall, ${profile.northWallHeightFt}' north wall; east/west walls follow the roof slope.`;
    spec.systems.structure = `shed / lean-to roof over ${spec.systems.structure}; ${shell.roofNote} Rafters, diaphragm, uplift, and tall-wall bracing require structural sizing.`;
    return `Changed roof to a shed / lean-to roof: south wall ${profile.southWallHeightFt}', north wall ${profile.northWallHeightFt}', roof pitch ${profile.pitch.toFixed(3)} rise/run across the ${shell.depthFt}' depth. East and west wall faces now follow the roof angle in the model.`;
  }
  return null;
}

export function openingRequestNeedsTrace(text) {
  return isOpeningIntent(text) && isDrawingReferenceIntent(text) && !hasOpeningPlacementData(text);
}

export function classifyDesignRequest(prompt, attachedImages = [], addToTarget = 'auto', selectedObject = null) {
  const text = prompt.toLowerCase();
  const missing = [];
  let intent = 'unknown';
  let confidence = 0.32;
  let canApply = false;
  let reason = 'I need a clearer BIM operation before changing the model.';
  let blockGenericRoom = false;
  const targetLabel = addToTargets.find((target) => target.value === addToTarget)?.label || 'Auto';

  if (isOpeningIntent(text) && isDrawingReferenceIntent(text)) {
    intent = 'trace_openings_from_drawing';
    confidence = attachedImages.length ? 0.7 : 0.55;
    blockGenericRoom = true;
    canApply = hasOpeningPlacementData(text);
    if (!attachedImages.length) missing.push('attached drawing/image');
    if (!/\b(north|south|east|west|n|s|e|w)\b/.test(text)) missing.push('wall for each opening');
    if (!/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide|window|door|slider|opening)/.test(text)) missing.push('opening width');
    if (!canApply) reason = 'This asks me to interpret a drawing, but I do not yet have reliable drawing vision/tracing. I should not invent openings.';
  } else if (isOpeningIntent(text)) {
    intent = 'add_or_edit_openings';
    confidence = /\b(north|south|east|west|n|s|e|w)\b/.test(text) ? 0.78 : 0.48;
    canApply = hasOpeningPlacementData(text);
    blockGenericRoom = true;
    if (!/\b(north|south|east|west|n|s|e|w)\b/.test(text)) missing.push('wall');
    if (!/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide|window|door|slider|opening)/.test(text)) missing.push('opening width');
    if (!canApply) reason = 'Openings need wall, type, width, and approximate location before I can place BIM objects.';
  } else if (isRoofIntent(text)) {
    intent = 'set_roof_form';
    confidence = /\b(shed|lean[-\s=]*to|single slope|mono[-\s]*pitch|roof)\b/.test(text) ? 0.82 : 0.62;
    canApply = true;
    blockGenericRoom = true;
    reason = 'The prompt describes roof form or roof/wall heights, so it should update the shell roof system rather than create a room.';
  } else if (matchingLibraryItems(text).some((item) => systemFieldForLibraryItem(item) !== 'notes') && looksLikeSystemChange(text)) {
    intent = 'change_building_system';
    confidence = 0.86;
    canApply = true;
    reason = 'The prompt names a recognized building system and asks to apply it to the house.';
  } else if (/\b(move|relocate|shift)\b/.test(text)) {
    intent = 'move_space_or_element';
    confidence = 0.74;
    canApply = /\b(to|into|onto|at)\b/.test(text);
    if (!canApply) missing.push('target location');
  } else if (/\b(make|resize|set|change)\b/.test(text) && /\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*\d+(?:\.\d+)?/.test(text)) {
    intent = 'resize_space_or_shell';
    confidence = 0.78;
    canApply = true;
  } else if (/\b(add|include|create|build|place|put|need|want)\b/.test(text) && /\b(room|space|area|bedroom|bath|kitchen|pantry|office|study|mud|laundry|porch|greenhouse|cellar)\b/.test(text)) {
    intent = 'add_space_or_program';
    confidence = 0.68;
    canApply = true;
  } else if (/\b(fix|clean|repair|align|normalize|straighten)\b/.test(text) && /\b(layout|room|rooms|band|row|zone|size|sizes)\b/.test(text)) {
    intent = 'repair_layout';
    confidence = 0.72;
    canApply = /\b(n|north)\s*(?:band|row|zone)\b/.test(text);
    if (!canApply) missing.push('specific area or rooms to repair');
  } else if (isDrawingReferenceIntent(text) || attachedImages.length) {
    intent = 'drawing_reference';
    confidence = 0.58;
    blockGenericRoom = true;
    missing.push('traceable instruction or schedule');
    reason = 'Attached drawings can be referenced, but this version cannot convert pixels into BIM geometry without structured inputs.';
  }

  if (addToTarget === 'roof') {
    intent = 'set_roof_form';
    confidence = Math.max(confidence, 0.72);
    blockGenericRoom = true;
    canApply = isRoofIntent(text);
    if (!canApply) {
      reason = 'The target is Roof, but the prompt does not describe a roof type, pitch, or roof/wall height.';
      missing.push('roof type or roof geometry');
    }
  }

  if (addToTarget === 'openings' && !isOpeningIntent(text)) {
    intent = 'add_or_edit_openings';
    confidence = Math.max(confidence, 0.52);
    blockGenericRoom = true;
    canApply = false;
    reason = 'The target is Windows / doors, but the prompt does not name an opening type, wall, and size.';
    missing.push('opening type', 'wall', 'opening width');
  }

  if (addToTarget === 'selected' && selectedObject) {
    reason = `${reason} Target: selected item "${selectedObject.name}".`;
  }

  return { intent, confidence, canApply, missing: [...new Set(missing)], reason, blockGenericRoom, target: targetLabel };
}

export function addOpeningFromText(spec, text) {
  if (!isOpeningIntent(text)) return null;

  const wallMatch = text.match(/\b(north|south|east|west|n|s|e|w)\b/);
  if (!wallMatch) return null;

  const wallNames = { n: 'north', s: 'south', e: 'east', w: 'west' };
  const wall = wallNames[wallMatch[1]] || wallMatch[1];
  const type = /\bdoor|doors|slider|sliders|sliding door\b/.test(text) ? 'door' : 'window';
  const widthMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide|window|door|slider|opening)/)
    || text.match(/(?:window|door|slider|opening)\s*(?:is|at|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide)?/)
    || text.match(/\badd\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s+(?:north|south|east|west|n|s|e|w)\s+(?:window|door|slider|opening)\b/);
  const atMatch = text.match(/\b(?:at|x|y|offset|from)\s*(-?\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\b/);
  const widthFt = clamp(Number(widthMatch?.[1] || (type === 'door' ? 3 : 5)), 2, 16);
  const along = clamp(Number(atMatch?.[1] || (wall === 'north' || wall === 'south' ? spec.shell.widthFt / 2 - widthFt / 2 : spec.shell.depthFt / 2 - widthFt / 2)), 0, Math.max(0, (wall === 'north' || wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt) - widthFt));
  const label = `${titleCase(wall)} ${titleCase(type)} ${spec.openings.filter((opening) => opening.type === type).length + 1}`;
  const opening = wall === 'north' || wall === 'south'
    ? { type, wall, x: Math.round(along * 10) / 10, widthFt, label }
    : { type, wall, y: Math.round(along * 10) / 10, widthFt, label };

  spec.openings.push(opening);
  return opening;
}

export function getWallSections(spec) {
  const layout = {
    north: { name: 'North Wall', lengthFt: spec.shell.widthFt, x: 0, y: 0 },
    south: { name: 'South Wall', lengthFt: spec.shell.widthFt, x: 0, y: spec.shell.depthFt },
    west: { name: 'West Wall', lengthFt: spec.shell.depthFt, x: 0, y: 0 },
    east: { name: 'East Wall', lengthFt: spec.shell.depthFt, x: spec.shell.widthFt, y: 0 }
  };
  const { storeys, extraFt } = storeyInfo(spec.shell);
  // Upper walls ring the storey's EXTENT plate, not necessarily the footprint.
  const plate2 = upperPlateRect(spec, 2);

  // Custom footprint: walls are the POLYGON EDGES (id wall-e0, wall-e1, …).
  // Construction is still keyed by facing (all north-facing edges share the
  // 'north' wall settings), so every editor keeps working through side.
  if (hasCustomFootprint(spec)) {
    const edgeSection = (edge, level) => {
      const r = resolveWallSide(spec, edge.facing, level);
      if (r.omitted) return null;
      const upper = level > 1;
      const heightFt = upper ? extraFt : r.heightFt;
      const name = `${WALL_SIDE_LABELS[edge.facing]} Wall${edge.facingSeq > 1 ? ` ${edge.facingSeq}` : ''}`;
      return {
        id: upper ? `wall-${edge.key}-u` : `wall-${edge.key}`,
        name: upper ? `${name} (upper)` : name,
        side: edge.facing,
        edgeIndex: edge.index,
        edgeKey: edge.key,
        storey: upper ? 'upper' : 'ground',
        level: upper ? 2 : 1,
        lengthFt: edge.lengthFt,
        heightFt,
        x: Math.min(edge.x0, edge.x1),
        y: Math.min(edge.y0, edge.y1),
        x0: edge.x0, y0: edge.y0, x1: edge.x1, y1: edge.y1,
        horizontal: edge.horizontal,
        category: 'wall-section',
        type: 'wall',
        w: edge.horizontal ? edge.lengthFt : r.thicknessFt,
        d: edge.horizontal ? r.thicknessFt : edge.lengthFt,
        h: heightFt,
        assembly: r.assembly.label,
        assemblyKey: r.assemblyKey,
        thicknessFt: r.thicknessFt,
        rValue: r.assembly.rValue,
        interiorFinish: r.interiorFinish,
        exteriorFinish: r.exteriorFinish,
        note: `${r.assembly.label} (R≈${r.assembly.rValue}, ${r.thicknessFt.toFixed(2)}' thick); ${edge.lengthFt}' long, ${heightFt}' ${upper ? 'of upper storey' : 'high'}. One segment of the ${edge.facing}-facing walls — construction is shared across that facing. Move it in the Plan view.`
      };
    };
    const edges = footprintEdges(spec);
    const sections = edges.map((edge) => edgeSection(edge, 1)).filter(Boolean);
    if (storeys > 1 && extraFt > 0) {
      if (plate2) {
        // Upper storey rings its extent plate — a plain rectangle, so the four
        // cardinal upper sections stay exactly as on a legacy design.
        for (const side of WALL_SIDES) {
          const r = resolveWallSide(spec, side, 2);
          if (r.omitted) continue;
          sections.push({
            id: `wall-${side}-u`,
            name: `${layout[side].name} (upper)`,
            side,
            storey: 'upper',
            level: 2,
            lengthFt: side === 'north' || side === 'south' ? plate2.w : plate2.d,
            heightFt: extraFt,
            x: side === 'east' ? plate2.x + plate2.w : plate2.x,
            y: side === 'south' ? plate2.y + plate2.d : plate2.y,
            category: 'wall-section',
            type: 'wall',
            w: side === 'north' || side === 'south' ? plate2.w : r.thicknessFt,
            d: side === 'east' || side === 'west' ? plate2.d : r.thicknessFt,
            h: extraFt,
            assembly: r.assembly.label,
            assemblyKey: r.assemblyKey,
            thicknessFt: r.thicknessFt,
            rValue: r.assembly.rValue,
            interiorFinish: r.interiorFinish,
            exteriorFinish: r.exteriorFinish,
            note: `${r.assembly.label} upper band around the storey extent plate.`
          });
        }
      } else {
        sections.push(...edges.map((edge) => edgeSection(edge, 2)).filter(Boolean));
      }
    }
    return sections;
  }
  const buildSection = (side, level) => {
    const r = resolveWallSide(spec, side, level);
    if (r.omitted) return null;
    const upper = level > 1;
    const heightFt = upper ? extraFt : r.heightFt;
    const base = upper && plate2
      ? {
        name: layout[side].name,
        lengthFt: side === 'north' || side === 'south' ? plate2.w : plate2.d,
        x: side === 'east' ? plate2.x + plate2.w : plate2.x,
        y: side === 'south' ? plate2.y + plate2.d : plate2.y
      }
      : layout[side];
    return {
      id: upper ? `wall-${side}-u` : `wall-${side}`,
      name: upper ? `${base.name} (upper)` : base.name,
      side,
      storey: upper ? 'upper' : 'ground',
      level: upper ? 2 : 1,
      lengthFt: base.lengthFt,
      heightFt,
      x: base.x,
      y: base.y,
      category: 'wall-section',
      type: 'wall',
      w: side === 'north' || side === 'south' ? base.lengthFt : r.thicknessFt,
      d: side === 'east' || side === 'west' ? base.lengthFt : r.thicknessFt,
      h: heightFt,
      assembly: r.assembly.label,
      assemblyKey: r.assemblyKey,
      thicknessFt: r.thicknessFt,
      rValue: r.assembly.rValue,
      interiorFinish: r.interiorFinish,
      exteriorFinish: r.exteriorFinish,
      note: `${r.assembly.label} (R≈${r.assembly.rValue}, ${r.thicknessFt.toFixed(2)}' thick); ${base.lengthFt}' long, ${heightFt}' ${upper ? 'of upper storey' : 'high'}. Interior: ${r.interiorFinish}. Openings on this side: ${spec.openings.filter((opening) => opening.wall === side).length}.`
    };
  };
  const sections = WALL_SIDES.map((side) => buildSection(side, 1)).filter(Boolean);
  if (storeys > 1 && extraFt > 0) {
    sections.push(...WALL_SIDES.map((side) => buildSection(side, 2)).filter(Boolean));
  }
  return sections;
}

export function getSpecialBimObjects(spec) {
  const roof = roofProfile(spec.shell);
  const padRect = sitePadRect(spec);
  const pad = Math.max(
    spec.shell.widthFt - padRect.x - spec.shell.widthFt,
    spec.shell.depthFt - padRect.y - spec.shell.depthFt,
    Math.abs(padRect.x),
    Math.abs(padRect.y),
    0
  );
  const gridSize = Number(spec.shell?.outdoorGridSizeFt || DEFAULT_OUTDOOR_GRID_SIZE_FT);
  return [
    {
      id: 'site-pad',
      name: 'Site Pad',
      category: 'site-pad',
      type: 'site',
      x: padRect.x,
      y: padRect.y,
      w: padRect.w,
      d: padRect.d,
      h: padRect.h,
      note: `Editable physical pad/slab zone at X ${padRect.x}', Y ${padRect.y}', ${padRect.w}' x ${padRect.d}'. This is separate from the fixed reference grid.`
    },
    {
      id: 'outdoor-grid',
      name: 'Outdoor Reference Grid',
      category: 'reference-grid',
      type: 'reference',
      fixed: true,
      x: spec.shell.widthFt / 2 - gridSize / 2,
      y: spec.shell.depthFt / 2 - gridSize / 2,
      w: gridSize,
      d: gridSize,
      h: 0,
      note: `Fixed ${gridSize}' x ${gridSize}' reference grid used for scale and measuring outdoor elements. It does not resize with the pad.`
    },
    {
      id: 'roof-main',
      name: `${titleCase(roof.roofType)} Roof`,
      category: 'roof',
      type: 'roof',
      x: 0,
      y: 0,
      w: spec.shell.widthFt,
      d: spec.shell.depthFt,
      h: roof.highWallHeightFt,
      note: `${roof.roofType} roof; south wall ${roof.southWallHeightFt}', north wall ${roof.northWallHeightFt}', pitch ${roof.pitch.toFixed(3)}.`
    },
    ...(resolveFrameType(spec, 1) !== 'load-bearing' ? [{
      id: 'frame-main',
      name: `${FRAME_TYPES[resolveFrameType(spec, 1)]?.label || 'Frame'} (structure)`,
      category: 'frame',
      type: 'frame',
      x: 0,
      y: 0,
      w: spec.shell.widthFt,
      d: spec.shell.depthFt,
      h: Number(spec.shell.wallHeightFt || 10),
      note: `The structural skeleton — posts every ${Number(spec.frame?.baySpacingFt) || 8}' with plate beams at the eave. Tap it in the model or here to change the system or bay spacing; frame drawings come from Export.`
    }] : []),
    ...(spec.openings || []).map((opening, index) => {
      const horizontal = opening.wall === 'north' || opening.wall === 'south';
      const along = Number(opening.x ?? opening.y ?? 0);
      return {
        id: `opening-${index}`,
        openingIndex: index,
        name: opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)} ${index + 1}`,
        category: 'opening',
        type: opening.type,
        wall: opening.wall,
        x: horizontal ? along : opening.wall === 'east' ? spec.shell.widthFt : 0,
        y: horizontal ? opening.wall === 'north' ? 0 : spec.shell.depthFt : along,
        w: horizontal ? opening.widthFt : 0.3,
        d: horizontal ? 0.3 : opening.widthFt,
        h: opening.type === 'door' ? 7 : 4,
        note: `${opening.widthFt}' ${opening.type} on the ${opening.wall} wall.`
      };
    })
  ];
}

export function nextRoomLocation(spec, width, depth, roomName) {
  const kitchen = findRoom(spec, 'kitchen');
  const bath = findRoom(spec, 'bath');
  const text = roomName.toLowerCase();

  if (/pantry|storage/.test(text) && kitchen) {
    return {
      x: clamp(kitchen.x + kitchen.w - width, 0, Math.max(0, spec.shell.widthFt - width)),
      y: clamp(kitchen.y - depth, 0, Math.max(0, spec.shell.depthFt - depth))
    };
  }
  if (/bath|powder|laundry|mechanical/.test(text) && bath) {
    return {
      x: clamp(bath.x + bath.w, 0, Math.max(0, spec.shell.widthFt - width)),
      y: clamp(bath.y, 0, Math.max(0, spec.shell.depthFt - depth))
    };
  }
  if (/greenhouse|porch|veranda|breezeway|cellar/.test(text)) {
    return {
      x: clamp(spec.shell.widthFt - width - 2, -16, spec.shell.widthFt + 8),
      y: /cellar/.test(text) ? -depth : spec.shell.depthFt
    };
  }

  const gridStep = 2;
  for (let y = 0; y <= Math.max(0, spec.shell.depthFt - depth); y += gridStep) {
    for (let x = 0; x <= Math.max(0, spec.shell.widthFt - width); x += gridStep) {
      const overlaps = spec.rooms.some((room) => (
        x < room.x + room.w &&
        x + width > room.x &&
        y < room.y + room.d &&
        y + depth > room.y
      ));
      if (!overlaps) return { x, y };
    }
  }

  return {
    x: clamp(spec.rooms.length * 3, 0, Math.max(0, spec.shell.widthFt - width)),
    y: clamp(spec.rooms.length * 2, 0, Math.max(0, spec.shell.depthFt - depth))
  };
}

export function allLibraryItems() {
  return elementLibrary.flatMap((group) => group.items.map((item) => ({ ...item, sourceCategory: group.category })));
}

export function libraryAliases() {
  return [
    ['rainwater cistern', ['rainwater', 'rain water', 'water catchment', 'catchment', 'cistern']],
    ['masonry heater core', ['masonry heater', 'heater core', 'thermal mass heater']],
    ['rocket mass heater bench', ['rocket mass', 'rocket heater']],
    ['straw bale wall assembly', ['straw bale', 'strawbale', 'straw wall', 'straw walls', 'straw']],
    ['hemp-lime wall', ['hemp lime', 'hempcrete']],
    ['light straw-clay infill', ['straw clay', 'light clay']],
    ['cob thermal wall', ['cob wall', 'cob']],
    ['rammed earth wall', ['rammed earth']],
    ['attached greenhouse', ['greenhouse']],
    ['root cellar', ['root cellar']],
    ['greywater reed bed', ['greywater', 'reed bed']],
    ['courtyard house', ['courtyard']],
    ['dogtrot breezeway', ['dogtrot', 'breezeway']],
    ['deep eave / veranda', ['deep eave', 'wide eave', 'veranda']],
    ['timber frame bay', ['timber frame', 'post and beam']],
    ['living roof zone', ['living roof', 'green roof']],
    ['trombe wall', ['trombe']]
  ];
}

export function textMatchesLibraryItem(text, item) {
  const itemName = item.name.toLowerCase();
  if (text.includes(itemName)) return true;
  const aliasSet = libraryAliases().find(([name]) => itemName === name);
  return Boolean(aliasSet?.[1].some((alias) => text.includes(alias)));
}

export function matchingLibraryItems(text) {
  const items = allLibraryItems();
  return items.filter((item) => textMatchesLibraryItem(text, item));
}

export function matchingLibraryItem(text) {
  return matchingLibraryItems(text)[0] || null;
}

export function systemFieldForLibraryItem(item) {
  const name = item.name.toLowerCase();
  if (item.kind === 'wall' || /wall|straw|hemp|cob|cordwood|earth/.test(name)) return 'envelope';
  if (item.kind === 'structure' || /timber frame|post and beam|roundhouse|yurt/.test(name)) return 'structure';
  if (item.kind === 'roof' || /roof|eave|veranda/.test(name)) return 'structure';
  if (item.kind === 'thermal' || item.kind === 'passive' || /heater|trombe|sunspace|solar|thermal/.test(name)) return 'energy';
  if (item.kind === 'water' || /water|cistern|greywater|reed/.test(name)) return 'water';
  return 'notes';
}

export function looksLikeSystemChange(text) {
  return /\b(all|whole|change|switch|convert|make|set|use|wall|walls|structure|frame|envelope|assembly|system|roof|energy|water)\b/.test(text);
}

export function appliedSystemText(item) {
  const name = item.name.toLowerCase();
  if (/straw bale/.test(name)) return 'straw bale wall assembly with lime/clay plaster, raised base, capillary break, rainscreen cladding, wide eaves, and engineered lateral/connection detailing';
  if (/light straw-clay/.test(name)) return 'light straw-clay infill in a structural frame with vapor-open plaster, rainscreen drying layer, capillary break, and wide eaves';
  if (/hemp-lime/.test(name)) return 'hemp-lime infill wall assembly around an engineered frame with vapor-open plaster, rainscreen, capillary break, and moisture-safe detailing';
  if (/cob/.test(name)) return 'cob thermal wall strategy with tall foundation boots, generous roof hat, seismic/structural review, and protected drying surfaces';
  if (/rammed earth/.test(name)) return 'rammed earth wall strategy with soil testing, reinforcement, damp-proof base, engineered openings, and erosion protection';
  if (/cordwood/.test(name)) return 'cordwood wall strategy with shrinkage-aware detailing, moisture protection, insulation review, and vapor-open finishes';
  if (/timber frame|post and beam/.test(name)) return 'engineered timber frame / post-and-beam structure with explicit bent layout, bracing, lateral load path, joinery schedule, and infill coordination';
  if (/reciprocal roof/.test(name)) return 'reciprocal roof structure requiring thrust analysis, center-ring/opening detailing, rafter bearing checks, and connection engineering';
  if (/living roof|green roof/.test(name)) return 'living roof assembly requiring structural load design, waterproof membrane, root barrier, drainage mat, overflow path, and maintenance access';
  if (/deep eave|veranda/.test(name)) return 'deep eave / veranda roof protection strategy sized for wall drying, summer shade, entry work, and weather-sheltered circulation';
  if (/masonry heater/.test(name)) return 'masonry heater core with dedicated footing, listed/engineered clearances, outside combustion air, flue path, and backup heat';
  if (/rocket mass/.test(name)) return 'rocket mass heater bench concept pending local code acceptance, combustion safety review, clearances, and specialist design';
  if (/trombe/.test(name)) return 'Trombe wall passive-solar strategy with tuned glazing, vents, shading, thermal mass, and overheating control';
  if (/sunspace|solarium/.test(name)) return 'thermally isolated sunspace/solarium strategy with moisture separation, shading, drainage, and controlled connection to living space';
  if (/rainwater|cistern/.test(name)) return 'rainwater cistern strategy with roof-area sizing, first-flush diversion, filtration, overflow, freeze protection, and service access';
  if (/greywater|reed/.test(name)) return 'greywater reed bed concept subject to local approval, soils, setbacks, maintenance plan, and freeze-season strategy';
  return item.note;
}

export function wallAssemblyProfile(envelopeText = '') {
  const text = envelopeText.toLowerCase();
  if (/straw bale|straw/.test(text)) {
    return {
      key: 'straw-bale',
      label: 'Straw Bale Wall Assembly',
      thicknessFt: 1.6,
      color: 0xd8bf79,
      rgb: [0.82, 0.68, 0.34],
      finish: 'lime/clay plaster, raised base, capillary break, rainscreen, and wide eaves'
    };
  }
  if (/hemp-lime|hemp/.test(text)) {
    return {
      key: 'hemp-lime',
      label: 'Hemp-Lime Wall Assembly',
      thicknessFt: 1.25,
      color: 0xb9c49b,
      rgb: [0.62, 0.71, 0.45],
      finish: 'hemp-lime infill, vapor-open plaster, rainscreen, and engineered frame'
    };
  }
  if (/cob/.test(text)) {
    return {
      key: 'cob',
      label: 'Cob Thermal Wall Assembly',
      thicknessFt: 1.8,
      color: 0xb9835e,
      rgb: [0.62, 0.39, 0.24],
      finish: 'earth mass wall with protected base, roof hat, plaster, and seismic review'
    };
  }
  if (/rammed earth/.test(text)) {
    return {
      key: 'rammed-earth',
      label: 'Rammed Earth Wall Assembly',
      thicknessFt: 1.35,
      color: 0x9d7456,
      rgb: [0.48, 0.34, 0.22],
      finish: 'tested earth wall, damp-proof base, reinforcement, and erosion protection'
    };
  }
  if (/cordwood/.test(text)) {
    return {
      key: 'cordwood',
      label: 'Cordwood Wall Assembly',
      thicknessFt: 1.25,
      color: 0x9b7652,
      rgb: [0.43, 0.31, 0.2],
      finish: 'cordwood masonry with shrinkage-aware detailing and moisture protection'
    };
  }
  return {
    key: 'framed',
    label: 'Framed Vapor-Open Wall Assembly',
    thicknessFt: 0.55,
    color: 0xd9d5c8,
    rgb: [0.78, 0.78, 0.72],
    finish: 'vapor-open wall, rainscreen cladding, and raised heel roof trusses'
  };
}

// --- Per-wall assembly model (kept in sync with backend/bim-core.mjs) --------
export const WALL_SIDES = ['north', 'south', 'east', 'west'];
export const WALL_SIDE_LABELS = { north: 'North', south: 'South', east: 'East', west: 'West' };

export const WALL_ASSEMBLIES = {
  // green: true marks natural / low-carbon methods — the UI shows them with a
  // leaf. Standard options sit alongside: every system offers both.
  'straw-bale':       { key: 'straw-bale',       label: 'Straw Bale',          thicknessFt: 1.6,  color: 0xd8bf79, rValue: 33, finish: 'lime / clay plaster', green: true },
  'hemp-lime':        { key: 'hemp-lime',        label: 'Hemp-Lime',           thicknessFt: 1.25, color: 0xb9c49b, rValue: 22, finish: 'vapor-open plaster', green: true },
  'cob':              { key: 'cob',              label: 'Cob',                 thicknessFt: 1.8,  color: 0xb9835e, rValue: 14, finish: 'earthen plaster', green: true },
  'rammed-earth':     { key: 'rammed-earth',     label: 'Rammed Earth',        thicknessFt: 1.35, color: 0x9d7456, rValue: 12, finish: 'sealed / waxed earth', green: true },
  'cordwood':         { key: 'cordwood',         label: 'Cordwood',            thicknessFt: 1.25, color: 0x9b7652, rValue: 18, finish: 'lime mortar joints', green: true },
  'light-straw-clay': { key: 'light-straw-clay', label: 'Light Straw-Clay',    thicknessFt: 1.0,  color: 0xc6b077, rValue: 20, finish: 'clay plaster', green: true },
  'framed':           { key: 'framed',           label: 'Framed (vapor-open)', thicknessFt: 0.55, color: 0xd9d5c8, rValue: 23, finish: 'plaster / cladding' },
  // Standard/panelized options — light, predictable, fast at height (upper
  // storeys over a natural ground floor are a legitimate hybrid).
  'sips':             { key: 'sips',             label: 'SIPs panel (fast, standard)',            thicknessFt: 0.6, color: 0xd8d5cf, rValue: 24, finish: 'drywall / cladding' },
  'ply-insulated':    { key: 'ply-insulated',    label: 'Marine ply + rigid insulation (panelized)', thicknessFt: 0.5, color: 0xc9b58f, rValue: 18, finish: 'sealed ply / cladding' },
  'icf':              { key: 'icf',              label: 'ICF concrete (standard)',                thicknessFt: 1.0, color: 0xb5b2a8, rValue: 23, finish: 'drywall / parge' },
  // A GLASS WALL — the whole face is glazing in a timber frame (an attached
  // greenhouse's south face), not windows punched into an opaque wall. The
  // engine treats its face area as glass: solar gain, glazing heat loss,
  // glazing-rate cost.
  'glazed':           { key: 'glazed',           label: 'Glazed (glass wall)', thicknessFt: 0.35, color: 0xaecfd8, rValue: 2,  finish: 'timber-framed glazing' }
};

export function wallAssemblyKeyFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/glazed|glass wall|curtain wall|glasshouse/.test(t)) return 'glazed';
  if (/light straw|straw.?clay/.test(t)) return 'light-straw-clay';
  if (/straw bale|strawbale|straw/.test(t)) return 'straw-bale';
  if (/hemp/.test(t)) return 'hemp-lime';
  if (/cob/.test(t)) return 'cob';
  if (/rammed/.test(t)) return 'rammed-earth';
  if (/cordwood/.test(t)) return 'cordwood';
  return 'framed';
}

export function resolveWallSide(spec, side, level = 1) {
  const shell = spec.shell || {};
  const w = (spec.walls || {})[side] || {};
  const assemblyKey = w.assembly && WALL_ASSEMBLIES[w.assembly] ? w.assembly : wallAssemblyKeyFromText(spec.systems?.envelope);
  const assembly = WALL_ASSEMBLIES[assemblyKey] || WALL_ASSEMBLIES.framed;
  const defaultHeight = side === 'south' ? Number(shell.southWallHeightFt || shell.wallHeightFt || 10)
    : side === 'north' ? Number(shell.northWallHeightFt || shell.wallHeightFt || 10)
      : Number(shell.wallHeightFt || 10);
  const omittedSet = new Set(shell.omittedWalls || []);
  const ground = {
    side,
    heightFt: Number(w.heightFt ?? defaultHeight),
    assemblyKey,
    assembly,
    thicknessFt: Number(w.thicknessFt ?? assembly.thicknessFt),
    interiorFinish: w.interiorFinish || assembly.finish,
    exteriorFinish: w.exteriorFinish || 'rainscreen / lime render',
    // Angled greenhouse glazing above the wall (kneewall below, glass to the
    // eave at sunGlazingTiltDeg from vertical, carried by the frame).
    sunGlazing: Boolean(w.sunGlazing),
    sunGlazingTiltDeg: Number(w.sunGlazingTiltDeg ?? 30),
    cladding: CLADDING_TYPES[w.cladding] ? w.cladding : 'render',
    omitted: Boolean(w.omitted) || omittedSet.has(side)
  };
  if (level <= 1) return ground;
  // Upper storeys: spec.wallsUpper per-side overrides fall back to the ground
  // wall — MUST mirror the bim-core copy exactly.
  const u = (spec.wallsUpper || {})[side] || {};
  const upperKey = u.assembly && WALL_ASSEMBLIES[u.assembly] ? u.assembly : ground.assemblyKey;
  const upperAssembly = WALL_ASSEMBLIES[upperKey] || ground.assembly;
  return {
    ...ground,
    level,
    assemblyKey: upperKey,
    assembly: upperAssembly,
    thicknessFt: Number(u.thicknessFt ?? (u.assembly ? upperAssembly.thicknessFt : ground.thicknessFt)),
    interiorFinish: u.interiorFinish || ground.interiorFinish,
    exteriorFinish: u.exteriorFinish || ground.exteriorFinish,
    cladding: CLADDING_TYPES[u.cladding] ? u.cladding : ground.cladding
  };
}

// True when any side carries a per-wall override (drives the "mixed" hint).
export function wallsAreMixed(spec) {
  const resolved = WALL_SIDES.map((side) => resolveWallSide(spec, side));
  const keys = new Set(resolved.map((r) => r.assemblyKey));
  const heights = new Set(resolved.map((r) => Math.round(r.heightFt * 10)));
  return keys.size > 1 || heights.size > 1;
}

export function applyLibraryItemToSystems(spec, item) {
  const field = systemFieldForLibraryItem(item);
  const appliedText = appliedSystemText(item);
  if (field === 'notes') {
    spec.notes = `${spec.notes}\nApplied ${item.name}: ${item.note}`;
    return `Added ${item.name} to the project notes.`;
  }
  spec.systems[field] = appliedText;
  if (field === 'envelope') {
    const profile = wallAssemblyProfile(appliedText);
    return `Changed envelope to ${item.name}. Model updated: exterior wall geometry, material color, BIM wall type, A200 assemblies, A300 wall section, and S100 wall restraint notes now use ${profile.label} (${profile.thicknessFt}' thick, ${profile.finish}).`;
  }
  return `Changed ${field} to ${item.name}.`;
}

export function applyNaturalLanguageDesign(prompt, currentSpec, attachedImages = [], addToTarget = 'auto', selectedObject = null) {
  const text = prompt.toLowerCase();
  const next = structuredClone(currentSpec);
  next.revision += 1;
  next.notes = prompt.trim() || next.notes;
  const actions = [];
  const assumptions = [];
  const changedIds = [];
  const plan = classifyDesignRequest(prompt, attachedImages, addToTarget, selectedObject);

  const shellMatch = text.match(/\b(?:shell|house|footprint|building|plan)\b\s*(?:to|at|is|=|as|:)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?|\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:shell|house|footprint|building|plan)\b/);
  const widthMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:wide|width)/);
  const depthMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:deep|depth)/);
  const heightMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:wall|walls|ceiling|height)/);
  const bedroomMatch = text.match(/(\d+)\s*(?:bed|bedroom)/);
  const bathMatch = text.match(/(\d+)\s*(?:bath|bathroom)/);
  const resizeRoomMatches = [...text.matchAll(/(?:make|resize|set)\s+(?:the\s+)?([a-z][a-z\s/-]*?)\s*(?:room|space|area)?\s*(?:to|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?/g)];
  const removeMatches = [...text.matchAll(/(?:remove|delete)\s+(?:the\s+)?([a-z][a-z\s/-]*?)(?:\s+room|\s+space|\s+area)?(?:\.|,|;|$)/g)];

  if (openingRequestNeedsTrace(text)) {
    assumptions.push(plan.reason);
    assumptions.push('I did not add a fake room or object. Add wall names, opening type, approximate widths, and locations, or use a traced opening schedule, and I will place real BIM openings.');
  }

  const roofScopedToElement = /\b(tower|loft|mezzanine)\b/.test(text)
    && !/\b(?:house|main|whole|building|shell)\s+roof\b|\broof\s+(?:of|on|for)\s+(?:the\s+)?(?:house|main|building|shell)\b/.test(text);
  const roofAction = roofScopedToElement ? null : applyRoofInstruction(next, text);
  if (roofAction) actions.push(roofAction);

  if (/\b(fix|clean|repair|align|normalize|straighten)\b/.test(text) && /\b(n|north)\s*(?:band|row|zone)\b/.test(text) && /\b(room|rooms|size|sizes|layout)\b/.test(text)) {
    const bandRooms = repairNorthBandRooms(next);
    if (bandRooms.length) {
      changedIds.push(...bandRooms.map((room) => room.id));
      actions.push(`Repaired the north room band: aligned ${bandRooms.map((room) => room.name).join(', ')} at Y 0, set a shared ${bandRooms[0].d}' depth, and resized widths to fill the ${next.shell.widthFt}' shell without gaps.`);
    } else {
      assumptions.push('I looked for a north room band but could not find enclosed rooms to repair.');
    }
  }

  if (shellMatch) {
    const shellWidth = Number(shellMatch[1] || shellMatch[3]);
    const shellDepth = Number(shellMatch[2] || shellMatch[4]);
    next.shell.widthFt = clamp(shellWidth, 18, 96);
    next.shell.depthFt = clamp(shellDepth, 18, 80);
    actions.push(`Set the main footprint to ${next.shell.widthFt}' x ${next.shell.depthFt}'.`);
  }
  if (widthMatch) {
    next.shell.widthFt = clamp(Number(widthMatch[1]), 18, 96);
    actions.push(`Set shell width to ${next.shell.widthFt}'.`);
  }
  if (depthMatch) {
    next.shell.depthFt = clamp(Number(depthMatch[1]), 18, 80);
    actions.push(`Set shell depth to ${next.shell.depthFt}'.`);
  }
  if (heightMatch) {
    next.shell.wallHeightFt = clamp(Number(heightMatch[1]), 7, 18);
    actions.push(`Set wall height to ${next.shell.wallHeightFt}'.`);
  }

  for (const match of removeMatches) {
    const room = findRoom(next, match[1]);
    if (room && next.rooms.length > 1) {
      next.rooms = next.rooms.filter((item) => item.id !== room.id);
      changedIds.push(next.rooms[0]?.id || '');
      actions.push(`Removed ${room.name}.`);
    }
  }

  const promptSystemItems = matchingLibraryItems(text).filter((item) => looksLikeSystemChange(text) && systemFieldForLibraryItem(item) !== 'notes');
  for (const item of promptSystemItems) {
    actions.push(applyLibraryItemToSystems(next, item));
  }

  const commandChunks = prompt
    .split(/(?:\.|;|\n|,|\band then\b|\bthen\b|\band\s+(?=add|include|create|build|place|put|need|want|make|set|resize|change|move|relocate|shift)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const chunk of commandChunks) {
    const lowerChunk = chunk.toLowerCase();
    if (!/\b(add|include|create|build|place|put|need|want|make|set|resize|change|move|relocate|shift)\b/i.test(chunk)) continue;
    if (openingRequestNeedsTrace(lowerChunk)) continue;

    const move = lowerChunk.match(/(?:move|relocate|shift)\s+(?:the\s+)?(.+?)\s+(?:to|into|onto|at)\s+(?:the\s+)?(.+)$/);
    if (move) {
      const roomLabel = normalizeDesignLabel(move[1].replace(/\b(room|space|area|zone)\b/g, ' '));
      const target = move[2];
      const object = findRoom(next, roomLabel) || (next.elements || []).find((element) => normalizeDesignLabel(element.name).includes(roomLabel));
      if (object) {
        const location = targetLocationForPhrase(next, object, target);
        object.x = location.x;
        object.y = location.y;
        changedIds.push(object.id);
        actions.push(`Moved ${object.name} to ${target.trim()} at X ${object.x}', Y ${object.y}'.`);
      } else {
        assumptions.push(`I could not find "${move[1].trim()}" to move.`);
      }
      continue;
    }

    const opening = addOpeningFromText(next, lowerChunk);
    if (opening) {
      actions.push(`Added ${opening.label}: ${opening.widthFt}' ${opening.type} on the ${opening.wall} wall.`);
      continue;
    }

    const libraryItem = matchingLibraryItem(lowerChunk);
    if (libraryItem && !/kitchen|bedroom|bath|pantry|office|study|mud|laundry/.test(lowerChunk)) {
      const wantsSystemChange = looksLikeSystemChange(lowerChunk);
      if (wantsSystemChange) {
        actions.push(applyLibraryItemToSystems(next, libraryItem));
      } else {
        addElementToSpec(next, libraryItem);
        changedIds.push(next.elements[next.elements.length - 1].id);
        actions.push(`Added ${libraryItem.name} as a BIM natural-building element.`);
      }
      continue;
    }

    const resize = lowerChunk.match(/(?:make|resize|set|change)\s+(?:the\s+)?([a-z][a-z\s/-]*?)\s*(?:room|space|area)?\s*(?:to|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?/);
    if (resize) {
      const room = findRoom(next, resize[1]);
      if (room) {
        room.w = clamp(Number(resize[2]), 4, next.shell.widthFt);
        room.d = clamp(Number(resize[3]), 4, next.shell.depthFt);
        changedIds.push(room.id);
        actions.push(`Resized ${room.name} to ${room.w}' x ${room.d}'.`);
      } else {
        assumptions.push(`I could not find a room named "${resize[1].trim()}" to resize.`);
      }
      continue;
    }

    const roomNameSource = chunk
      .replace(/\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*\d+(?:\.\d+)?\s*(?:ft|feet|foot|')?/i, '')
      .split(/\b(?:near|beside|adjacent to|next to|inside|in|off|by)\b/i)[0];
    const rawName = cleanDesignPhrase(roomNameSource);
    if (isOpeningIntent(lowerChunk) || isDrawingReferenceIntent(lowerChunk) || isRoofIntent(lowerChunk) || plan.blockGenericRoom) {
      assumptions.push(`I did not turn "${chunk}" into a room. It targets ${plan.intent.replace(/_/g, ' ')}, not a room/program space.`);
      continue;
    }
    if (!rawName || rawName.length < 3) continue;
    const profile = roomProfile(rawName);
    const dims = dimensionsFromText(chunk, profile);
    const width = clamp(dims.w, 4, Math.max(4, next.shell.widthFt));
    const depth = clamp(dims.d, 4, Math.max(4, next.shell.depthFt));
    const location = nextRoomLocation(next, width, depth, rawName);
    const existing = findRoom(next, rawName);
    const room = {
      id: existing?.id || slugify(rawName),
      name: existing?.name || titleCase(rawName),
      x: location.x,
      y: location.y,
      w: width,
      d: depth,
      type: profile.type,
      floor: profile.floor
    };
    upsertRoom(next, room);
    changedIds.push(room.id);
    actions.push(`${existing ? 'Updated' : 'Added'} ${room.name} at ${room.w}' x ${room.d}'.`);
  }

  for (const match of resizeRoomMatches) {
    const room = findRoom(next, match[1]);
    if (room) {
      room.w = clamp(Number(match[2]), 4, next.shell.widthFt);
      room.d = clamp(Number(match[3]), 4, next.shell.depthFt);
      changedIds.push(room.id);
      actions.push(`Resized ${room.name} to ${room.w}' x ${room.d}'.`);
    }
  }

  if (text.includes('greenhouse')) {
    upsertRoom(next, { id: 'greenhouse', name: 'Thermally Isolated Greenhouse', x: next.shell.widthFt - 10, y: next.shell.depthFt, w: 10, d: 8, type: 'plant', floor: 'drainable pavers' });
    changedIds.push('greenhouse');
    actions.push('Added a thermally isolated greenhouse outside the conditioned shell.');
  }
  for (const group of elementLibrary) {
    for (const item of group.items) {
      const compactName = item.name.toLowerCase();
      if (text.includes(compactName) || compactName.split('/').some((part) => part.trim() && text.includes(part.trim()))) {
        const wantsSystemChange = looksLikeSystemChange(text);
        if (wantsSystemChange) {
          actions.push(applyLibraryItemToSystems(next, item));
        } else {
          addElementToSpec(next, item);
          changedIds.push(next.elements[next.elements.length - 1].id);
          actions.push(`Added ${item.name} from ${group.category}.`);
        }
      }
    }
  }
  const aliasItem = matchingLibraryItem(text);
  if (aliasItem && looksLikeSystemChange(text)) {
    actions.push(applyLibraryItemToSystems(next, aliasItem));
  } else if (aliasItem && !(next.elements || []).some((element) => element.name === aliasItem.name)) {
    addElementToSpec(next, aliasItem);
    changedIds.push(next.elements[next.elements.length - 1].id);
    actions.push(`Added ${aliasItem.name} as a recognized natural-building system.`);
  }
  if (text.includes('root cellar')) {
    upsertRoom(next, { id: 'root-cellar', name: 'Root Cellar', x: 0, y: -8, w: 10, d: 8, type: 'storage', floor: 'earth sheltered slab' });
    changedIds.push('root-cellar');
    actions.push('Added a root cellar outside the main conditioned rectangle.');
  }
  if (text.includes('wood') || text.includes('hearth') || text.includes('masonry heater')) {
    next.systems.energy = 'masonry heater or listed wood stove with outdoor combustion air, plus backup heat';
    actions.push('Updated the energy concept for a masonry heater / wood heat strategy.');
  }
  if ((text.includes('straw') || text.includes('hemp') || text.includes('cob')) && !actions.some((action) => action.includes('Changed envelope'))) {
    next.systems.envelope = 'natural vapor-open wall assembly with engineered structure, capillary break, rainscreen, and wide eaves';
    actions.push('Updated the envelope note for vapor-open natural wall construction.');
  }
  if (text.includes('rain') || text.includes('water catchment')) {
    next.systems.water = 'oversized gutters, first-flush diverter, cistern pad, greywater-ready wet core';
    actions.push('Updated the water strategy for roof catchment and greywater readiness.');
  }
  if (bedroomMatch && Number(bedroomMatch[1]) > 1 && !next.rooms.some((room) => room.id === 'bed2')) {
    upsertRoom(next, { id: 'bed2', name: 'Bedroom 2', x: 0, y: 0, w: 11, d: 12, type: 'sleeping', floor: 'wood' });
    const primary = next.rooms.find((room) => room.id === 'bed1');
    if (primary) primary.x = 11;
    changedIds.push('bed2');
    actions.push('Added Bedroom 2 and shifted the primary bedroom zone.');
  }
  if (bathMatch && Number(bathMatch[1]) > 1 && !next.rooms.some((room) => room.id === 'powder')) {
    upsertRoom(next, { id: 'powder', name: 'Powder Room', x: next.shell.widthFt - 7, y: 12, w: 7, d: 6, type: 'wet', floor: 'tile' });
    changedIds.push('powder');
    actions.push('Added a powder room to support the requested bath count.');
  }
  if (text.includes('south window') || text.includes('more daylight') || text.includes('passive solar')) {
    next.openings.push({ type: 'window', wall: 'south', x: Math.round(next.shell.widthFt * 0.45), widthFt: 5, label: 'Design Chat South Window' });
    actions.push('Added a south-facing daylight/passive-solar window.');
  }
  if (text.includes('front porch') || text.includes('covered entry') || text.includes('porch')) {
    upsertRoom(next, { id: 'front-porch', name: 'Covered Front Porch', x: 4, y: -8, w: Math.min(18, next.shell.widthFt - 8), d: 8, type: 'living', floor: 'decking' });
    changedIds.push('front-porch');
    actions.push('Added a covered front porch.');
  }
  if (attachedImages.length) {
    next.notes = `${next.notes}\nReference images in chat: ${attachedImages.map((image) => image.name).join(', ')}.`;
    assumptions.push('Attached drawings are saved as references, but this version cannot reliably read wall/opening symbols from pixels. I will not invent geometry from an image; provide wall, type, width, and approximate location to create BIM openings.');
  }

  normalizeRooms(next);
  const suspiciousRooms = next.rooms.filter((room) => !currentSpec.rooms.some((existing) => existing.id === room.id) && /\b(window|windows|door|doors|opening|openings|drawing|image|photo|plan|roof|shed|lean)\b/i.test(room.name));
  if (suspiciousRooms.length) {
    next.rooms = next.rooms.filter((room) => !suspiciousRooms.some((badRoom) => badRoom.id === room.id));
    suspiciousRooms.forEach((room) => {
      assumptions.push(`Blocked unsafe room creation: "${room.name}" looked like an opening/drawing request, not a room.`);
    });
  }
  const nextIssues = detectIssues(next).filter((issue) => issue.severity !== 'pass');
  return {
    spec: next,
    actions: [...new Set(actions)],
    assumptions,
    issues: nextIssues,
    changedIds: [...new Set(changedIds.filter(Boolean))],
    plan
  };
}

export function parsePromptToSpec(prompt, currentSpec, attachedImages = []) {
  return applyNaturalLanguageDesign(prompt, currentSpec, attachedImages).spec;
}

export function interpreterSummary(report) {
  const opening = report.actions.length
    ? `Done — here's what changed:\n${report.actions.slice(0, 8).map((action) => `- ${action}`).join('\n')}`
    : `I couldn't turn that into a change to the house, so nothing was altered.${report.plan?.missing?.length ? ` To do it I still need: ${report.plan.missing.join(', ')}.` : ''} Try a direct instruction like "make all exterior walls straw bale" or "add pantry 8 x 10 near kitchen".`;
  const assumptions = report.assumptions.length ? `\n\nI assumed: ${report.assumptions.join(' ')}` : '';
  // Council opinions are OPT-IN (the Council Loop button / Review tab) — they
  // don't ride along on every ordinary edit reply.
  return `${opening}${assumptions}`;
}

export function isConsultativePrompt(prompt, attachedImages = []) {
  const text = String(prompt || '').toLowerCase().trim();
  if (!text) return false;
  if (/\b(tell me|what do you see|what do you notice|what differs|what's different|compare|critique|review|analyze|analyse|explain|describe|do you think|what is wrong|what's wrong|why|help me understand)\b/.test(text)) return true;
  if (attachedImages.length && /\b(image|drawing|sketch|photo|handwriting|plan)\b/.test(text)) return true;
  if (text.endsWith('?') && !/\b(add|move|make|resize|set|change|delete|remove|place|build|create|put)\b/.test(text)) return true;
  return false;
}

export function buildStudioConversationResponse(promptText, spec, selected, issues, attachedImages = []) {
  const text = String(promptText || '').toLowerCase();
  const selectedLabel = selected ? `${selected.name} (${selected.category || selected.type || 'object'})` : 'nothing selected';
  const shell = `${spec.shell.widthFt}' x ${spec.shell.depthFt}' shell`;
  const roof = roofProfile(spec.shell);
  const issueLines = (issues || []).filter((issue) => issue.severity !== 'pass').slice(0, 3);
  const issueSummary = issueLines.length
    ? issueLines.map((issue) => `${issue.owner}: ${issue.title}`).join('; ')
    : 'No blocking automated schematic issue is currently flagged.';

  if (attachedImages.length && /\b(differ|different|compare|comparison|match|see)\b/.test(text)) {
    return `I can compare against the BIM model conceptually, but in this local build I still cannot truly inspect the uploaded image itself. Right now I only know the current model state: ${shell}, ${spec.rooms.length} rooms, ${spec.openings.length} openings, roof type ${roof.roofType}, selected object ${selectedLabel}. The next upgrade is real vision-based comparison, so Studio can say things like "the drawing shows two west openings and the model has one" instead of punting. Until that is wired, ask for a specific comparison such as "list all openings on the south wall" or "summarize the current model so I can compare it to the sketch."`;
  }

  if (/\b(what do you see|describe|summarize|tell me what you see)\b/.test(text)) {
    return `Here is the current model state in plain language: ${shell}, roof type ${roof.roofType}${roof.roofType === 'shed' ? ` with south wall ${roof.southWallHeightFt}' and north wall ${roof.northWallHeightFt}'` : ''}, ${spec.rooms.length} room zones, ${(spec.elements || []).length} placed elements, and ${spec.openings.length} openings. Selected object: ${selectedLabel}. Current review flags: ${issueSummary}`;
  }

  if (/\b(what differs|what's different|compare|critique|review)\b/.test(text)) {
    return `From the BIM side, the first things I would compare are footprint, room adjacency, wall heights, roof form, and opening count/location. Current model snapshot: ${shell}, roof ${roof.roofType}, ${spec.rooms.length} rooms, ${spec.openings.length} openings. Current review flags: ${issueSummary}. Once image vision is connected, this same request should produce a concrete mismatch list instead of a BIM-command fallback.`;
  }

  if (/\b(what is wrong|what's wrong|concern|worry|problem)\b/.test(text)) {
    return `The main concerns I see right now are: ${issueSummary}. If you want the short version, the app should be surfacing these as plain-language design concerns first, and only suggesting geometry edits second.`;
  }

  return `I read that as a design conversation prompt, not a direct BIM edit. Current model snapshot: ${shell}, roof ${roof.roofType}, selected object ${selectedLabel}. Current review flags: ${issueSummary}. Studio should be able to discuss the model naturally here even when no geometry change is needed.`;
}

export function emptyBimOperation(operation = {}) {
  return {
    type: 'no_change',
    id: '',
    targetId: '',
    name: '',
    category: '',
    field: '',
    value: '',
    x: 0,
    y: 0,
    z: 0,
    w: 0,
    d: 0,
    h: 0,
    level: 0,
    wall: '',
    openingType: '',
    widthFt: 0,
    heightFt: 0,
    positionFt: 0,
    roofType: '',
    pitch: 0,
    southWallHeightFt: 0,
    northWallHeightFt: 0,
    reason: '',
    ...operation
  };
}

export function uniqueObjectId(spec, preferred) {
  const base = slugify(preferred || 'object');
  const taken = new Set([
    ...spec.rooms.map((room) => room.id),
    ...(spec.elements || []).map((element) => element.id)
  ]);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function findDesignObject(spec, targetId, name = '') {
  if (!targetId && !name) return null;
  const normalizedName = normalizeDesignLabel(name);
  return spec.rooms.find((room) => room.id === targetId || normalizeDesignLabel(room.name) === normalizedName || normalizeDesignLabel(room.name).includes(normalizedName))
    || (spec.elements || []).find((element) => element.id === targetId || normalizeDesignLabel(element.name) === normalizedName || normalizeDesignLabel(element.name).includes(normalizedName))
    || null;
}

export function operationDescription(operation, spec) {
  const op = emptyBimOperation(operation);
  if (op.type === 'add_room') return `Added ${op.name || 'room'} at ${op.w}' x ${op.d}'.`;
  if (op.type === 'add_element' || op.type === 'add_site_element' || op.type === 'add_loft' || op.type === 'add_tower' || op.type === 'add_floor') return `Added ${op.name || 'building element'} as ${op.category || 'custom BIM object'}.`;
  if (op.type === 'add_level' || op.type === 'edit_level') return `Added/edited ${op.name || `Level ${op.level || 2}`} in the BIM model.`;
  if (op.type === 'set_roof' || op.type === 'set_roof_profile' || op.type === 'add_roof_plane') return `Set roof to ${op.roofType || spec.shell.roofType || 'roof'}${op.southWallHeightFt && op.northWallHeightFt ? ` with S ${op.southWallHeightFt}' / N ${op.northWallHeightFt}' wall heights` : ''}.`;
  if (op.type === 'set_assembly' || op.type === 'set_wall_assembly' || op.type === 'set_wall_segment_assembly') return `Updated ${op.field || op.wall || 'assembly'} to ${op.value}.`;
  if (op.type === 'set_wall_height') return `Set ${op.wall || 'wall'} height to ${op.h || op.value}'.`;
  if (op.type === 'set_shell' || op.type === 'add_pad_extension') return `Updated shell ${op.field || 'padExtensionFt'} to ${op.value || op.w}.`;
  if (op.type === 'add_opening') return `Added ${op.widthFt || 3}' ${op.openingType || 'opening'} on the ${op.wall} wall.`;
  if (op.type === 'add_opening_from_reference' || op.type === 'trace_image_request') return op.reason || 'Image tracing needs wall, type, width, and location before BIM openings can be placed.';
  if (op.type === 'request_clarification') return op.reason || 'More information is needed before changing the BIM.';
  if (op.type === 'move_object') return `Moved ${op.name || op.targetId || 'object'} to X ${op.x}', Y ${op.y}'.`;
  if (op.type === 'resize_object') return `Resized ${op.name || op.targetId || 'object'} to ${op.w}' x ${op.d}'.`;
  if (op.type === 'update_object') return `Updated ${op.name || op.targetId || 'object'} ${op.field}.`;
  if (op.type === 'remove_object') return `Removed ${op.name || op.targetId || 'object'}.`;
  return op.reason || 'No model change.';
}

export function applyStructuredDesignPlan(currentSpec, plan) {
  const next = structuredClone(currentSpec);
  next.rooms ||= [];
  next.elements ||= [];
  next.openings ||= [];
  next.levels ||= [{ id: 'level-1', name: 'Level 01', elevationFt: 0, heightFt: next.shell.wallHeightFt || 10 }];
  next.site = { ...SITE_DEFAULTS, ...(next.site || {}) };
  next.utilities = { ...UTILITY_DEFAULTS, ...(next.utilities || {}) };

  const actions = [];
  const warnings = [...(plan?.warnings || [])];
  const assumptions = [...(plan?.assumptions || [])];
  const changedIds = [];
  const operations = (plan?.operations || []).map(emptyBimOperation);

  for (const operation of operations) {
    if (operation.type === 'no_change') {
      if (operation.reason) assumptions.push(operation.reason);
      continue;
    }

    if (operation.type === 'set_shell' || operation.type === 'add_pad_extension') {
      const field = operation.field || 'padExtensionFt';
      const numeric = Number(operation.value || operation.w);
      if (operation.field === 'widthFt') next.shell.widthFt = clamp(numeric, 18, 120);
      else if (field === 'depthFt') next.shell.depthFt = clamp(numeric, 18, 120);
      else if (field === 'wallHeightFt') next.shell.wallHeightFt = clamp(numeric, 7, 32);
      else if (field === 'padExtensionFt') next.shell.padExtensionFt = clamp(numeric, 0, 240);
      else if (field === 'storeys') next.shell.storeys = clamp(numeric, 1, 3);
      else if (field === 'basementHeightFt') {
        const v = Math.max(0, numeric || 0);
        if (v > 0) next.shell.basementHeightFt = clamp(v, 6, 12);
        else {
          delete next.shell.basementHeightFt;
          delete next.shell.basementHeated;
          next.rooms = next.rooms.map((room) => (Number(room.level || 1) === BASEMENT_LEVEL ? { ...room, level: 1 } : room));
          next.elements = (next.elements || []).map((el) => (Number(el.level || 1) === BASEMENT_LEVEL ? { ...el, level: 1, z: 0 } : el));
        }
      }
      else if (field === 'basementHeated') next.shell.basementHeated = String(operation.value) === 'true' || operation.value === true;
      else if (field === 'upperStoreyHeightFt') {
        const v = Number(operation.value) || 0;
        if (v > 0) next.shell.upperStoreyHeightFt = clamp(v, 6, 14);
        else delete next.shell.upperStoreyHeightFt;
      }
      else if (field === 'overhangFt') {
        next.shell.overhangFt = clamp(numeric, 0, 12);
        delete next.shell.overhangs;
      }
      else if (field) next.shell[field] = operation.value;
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'set_overhang') {
      const value = clamp(Number(operation.value), 0, 12);
      if (operation.wall === 'all' || !operation.wall) {
        next.shell.overhangFt = value;
        delete next.shell.overhangs;
      } else if (WALL_SIDES.includes(operation.wall)) {
        next.shell.overhangs ||= {};
        next.shell.overhangs[operation.wall] = value;
      }
      actions.push(`Set ${operation.wall || 'all'} roof overhang to ${value} ft.`);
      continue;
    }

    if (operation.type === 'set_site') {
      const field = operation.field;
      if (field === 'zip') next.site.zip = String(operation.value || '').replace(/\D/g, '').slice(0, 5);
      else if (field === 'placeName') next.site.placeName = String(operation.value || '').slice(0, 80);
      else if (field === 'latitudeDeg') next.site.latitudeDeg = clamp(Number(operation.value), 0, 70);
      else if (field === 'rainInYr') next.site.rainInYr = clamp(Number(operation.value), 0, 200);
      actions.push(`Set site ${field} to ${operation.value}.`);
      continue;
    }

    if (operation.type === 'set_utility') {
      const field = operation.field;
      const value = String(operation.value || '');
      const allowed = {
        waterSource: ['well', 'spring', 'catchment', 'town'],
        wasteMethod: ['septic', 'composting', 'reedbed'],
        powerMode: ['offgrid', 'hybrid', 'gridtie'],
        heatSource: ['rocket_mass', 'masonry', 'wood_stove', 'minisplit']
      };
      if (field === 'tankGal') next.utilities.tankGal = clamp(Number(operation.value) || 0, 0, 50000);
      else if (field === 'stemwallHeightFt') next.utilities.stemwallHeightFt = clamp(Number(operation.value) || 1.5, 0.5, 6);
      else if (field === 'wellSepticFt') next.utilities.wellSepticFt = clamp(Number(operation.value) || 0, 0, 2000);
      else if (field === 'diyWalls' || field === 'diyRoof' || field === 'diyHeat') {
        next.utilities[field] = value === 'true' || operation.value === true || value === '1';
      } else if (allowed[field]) {
        next.utilities[field] = allowed[field].includes(value) ? value : next.utilities[field];
      }
      actions.push(`Set ${field} to ${operation.value}.`);
      continue;
    }

    if (operation.type === 'set_roof' || operation.type === 'set_roof_profile' || operation.type === 'add_roof_plane') {
      if (operation.roofType) next.shell.roofType = operation.roofType;
      if (operation.southWallHeightFt) next.shell.southWallHeightFt = clamp(operation.southWallHeightFt, 2, 40);
      if (operation.northWallHeightFt) next.shell.northWallHeightFt = clamp(operation.northWallHeightFt, 2, 40);
      if (operation.pitch) next.shell.roofPitch = clamp(operation.pitch, 0.02, 1.5);
      const profile = roofProfile(next.shell);
      next.shell.wallHeightFt = profile.highWallHeightFt;
      next.shell.roofPitch = Math.round(profile.pitch * 1000) / 1000;
      next.shell.roofNote = `${profile.roofType} roof; south wall ${profile.southWallHeightFt}', north wall ${profile.northWallHeightFt}'.`;
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'set_wall_height') {
      const heightMin = operation.wall === 'south' || operation.wall === 'north' ? 2 : 7;
      const height = clamp(Number(operation.h || operation.value || 10), heightMin, 40);
      if (operation.wall === 'south') next.shell.southWallHeightFt = height;
      else if (operation.wall === 'north') next.shell.northWallHeightFt = height;
      else next.shell.wallHeightFt = height;
      if (operation.wall === 'south' || operation.wall === 'north') next.shell.roofType = 'shed';
      const profile = roofProfile(next.shell);
      next.shell.wallHeightFt = profile.highWallHeightFt;
      next.shell.roofPitch = Math.round(profile.pitch * 1000) / 1000;
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'set_assembly' || operation.type === 'set_wall_assembly' || operation.type === 'set_wall_segment_assembly') {
      const field = ['structure', 'envelope', 'water', 'energy'].includes(operation.field) ? operation.field : 'notes';
      const assemblyField = operation.type.includes('wall') ? 'envelope' : field;
      if (assemblyField === 'notes') next.notes = `${next.notes}\n${operation.value}`;
      else next.systems[assemblyField] = String(operation.value || next.systems[assemblyField]);
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'add_opening') {
      const wall = operation.wall || 'south';
      const widthFt = clamp(Number(operation.widthFt || 3), 1, 24);
      const maxAlong = wall === 'north' || wall === 'south' ? next.shell.widthFt : next.shell.depthFt;
      const along = clamp(Number(operation.positionFt || 0), 0, Math.max(0, maxAlong - widthFt));
      const requestedType = OPENING_TYPES[operation.openingType] ? operation.openingType : 'window';
      const isRoofOpening = wall === 'roof' || OPENING_TYPES[requestedType].roof;
      const openingType = isRoofOpening ? 'skylight' : requestedType;
      const label = operation.name || `${titleCase(isRoofOpening ? 'roof' : wall)} ${OPENING_TYPES[openingType].label} ${next.openings.length + 1}`;
      if (isRoofOpening) {
        next.openings.push({
          type: 'skylight',
          wall: 'roof',
          x: clamp(Number(operation.x ?? operation.positionFt ?? 4), 0, Math.max(0, next.shell.widthFt - widthFt)),
          y: clamp(Number(operation.y ?? 4), 0, Math.max(0, next.shell.depthFt - widthFt)),
          widthFt,
          label
        });
      } else {
        next.openings.push(wall === 'north' || wall === 'south'
          ? { type: openingType, wall, x: along, widthFt, label }
          : { type: openingType, wall, y: along, widthFt, label });
      }
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'add_level' || operation.type === 'edit_level') {
      const level = Math.max(2, Number(operation.level || next.levels.length + 1));
      const elevationFt = Number(operation.z || (level - 1) * (next.shell.wallHeightFt || 10));
      const name = operation.name || `Level ${String(level).padStart(2, '0')}`;
      next.levels.push({ id: uniqueObjectId(next, name), name, level, elevationFt, heightFt: Number(operation.h || next.shell.wallHeightFt || 10) });
      const floorId = uniqueObjectId(next, `${name} floor plate`);
      next.elements.push({
        id: floorId,
        name: `${name} Floor Plate`,
        category: 'floor',
        sourceCategory: 'Level',
        note: 'Upper level floor plate generated by BIM planner.',
        x: Number(operation.x || 0),
        y: Number(operation.y || 0),
        z: elevationFt,
        w: Number(operation.w || next.shell.widthFt),
        d: Number(operation.d || next.shell.depthFt),
        h: 0.45,
        level,
        type: 'work'
      });
      changedIds.push(floorId);
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'add_room') {
      const id = uniqueObjectId(next, operation.id || operation.name || 'room');
      const room = {
        id,
        name: operation.name || titleCase(id),
        x: Number(operation.x || 2),
        y: Number(operation.y || 2),
        z: Number(operation.z || 0),
        w: clamp(Number(operation.w || 10), 4, next.shell.widthFt),
        d: clamp(Number(operation.d || 10), 4, next.shell.depthFt),
        h: Number(operation.h || 0.22),
        level: Number(operation.level || 1),
        type: operation.category || roomProfile(operation.name || '').type,
        floor: roomProfile(operation.name || '').floor
      };
      upsertRoom(next, room);
      changedIds.push(room.id);
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'add_element' || operation.type === 'add_site_element' || operation.type === 'add_loft' || operation.type === 'add_tower' || operation.type === 'add_floor') {
      const id = uniqueObjectId(next, operation.id || operation.name || 'custom element');
      const element = {
        id,
        name: operation.name || titleCase(id),
        category: operation.category || (operation.type === 'add_site_element' ? 'site' : operation.type.replace('add_', '') || 'custom'),
        sourceCategory: 'AI Planner',
        note: operation.reason || 'Custom BIM element generated from natural-language design request.',
        x: Number(operation.x || next.shell.widthFt + 3),
        y: Number(operation.y || 3),
        z: Number(operation.z || 0),
        w: Math.max(1, Number(operation.w || 10)),
        d: Math.max(1, Number(operation.d || 10)),
        h: Math.max(0.2, Number(operation.h || 1.2)),
        level: Number(operation.level || 1),
        roofType: operation.roofType || '',
        construction: operation.construction || '',
        doorWFt: operation.category === 'partition' ? Number(operation.widthFt || 0) : 0,
        doorAtFt: operation.category === 'partition' ? Number(operation.positionFt || 0) : 0,
        type: operation.category || 'custom'
      };
      if (element.category === 'partition') {
        const pType = PARTITION_TYPES[element.construction] ? element.construction : 'framed';
        element.construction = pType;
        const thick = PARTITION_TYPES[pType].thicknessFt;
        const longAxis = Number(operation.w || 0) >= Number(operation.d || 0) ? 'w' : 'd';
        if (longAxis === 'w') { element.d = Number(operation.d) > 0 && Number(operation.d) <= 2 ? Number(operation.d) : thick; }
        else { element.w = Number(operation.w) > 0 && Number(operation.w) <= 2 ? Number(operation.w) : thick; }
        if (!Number(operation.h)) element.h = Math.max(7, Number(next.shell.wallHeightFt || 10) - 0.5);
      }
      next.elements.push({ ...element, ...clampObjectPosition(next, element, element.x, element.y) });
      changedIds.push(id);
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'trace_image_request' || operation.type === 'add_opening_from_reference' || operation.type === 'request_clarification') {
      warnings.push(operationDescription(operation, next));
      continue;
    }

    const target = findDesignObject(next, operation.targetId || operation.id, operation.name);
    if (!target) {
      warnings.push(`Could not find target for operation: ${operationDescription(operation, next)}`);
      continue;
    }

    if (operation.type === 'move_object') {
      const position = clampObjectPosition(next, target, operation.x, operation.y);
      target.x = position.x;
      target.y = position.y;
      if (Number.isFinite(operation.z)) target.z = operation.z;
      changedIds.push(target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    } else if (operation.type === 'resize_object') {
      target.w = Math.max(1, Number(operation.w || target.w));
      target.d = Math.max(1, Number(operation.d || target.d));
      if (operation.h) target.h = Math.max(0.2, Number(operation.h));
      changedIds.push(target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    } else if (operation.type === 'update_object') {
      if (operation.field) target[operation.field] = operation.value;
      changedIds.push(target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    } else if (operation.type === 'remove_object') {
      next.rooms = next.rooms.filter((room) => room.id !== target.id);
      next.elements = next.elements.filter((element) => element.id !== target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    }
  }

  if (actions.length) {
    next.revision += 1;
    normalizeRooms(next);
  }

  return {
    spec: next,
    actions: [...new Set(actions)],
    warnings: [...new Set(warnings)],
    assumptions: [...new Set(assumptions)],
    questions: plan?.questions || [],
    changedIds: [...new Set(changedIds.filter(Boolean))],
    source: plan?.source || 'planner',
    summary: plan?.summary || 'Structured BIM plan applied.',
    issues: detectIssues(next).filter((issue) => issue.severity !== 'pass')
  };
}

export function structuredPlanSummary(report) {
  const opening = report.actions.length
    ? `${report.summary}\n\nWhat changed:\n${report.actions.slice(0, 10).map((action) => `- ${action}`).join('\n')}`
    : `${report.summary}\n\nNothing was changed in the model.`;
  // Truth in reporting: anything the plan asked for that did NOT apply is
  // said out loud, never silently dropped.
  const rejectedOps = report.rejectedOperations || [];
  const rejected = rejectedOps.length
    ? `\n\nCouldn't apply:\n${rejectedOps.slice(0, 6).map((operation) => `- ${operationDescription(operation, report.spec)}`).join('\n')}`
    : '';
  const warnings = report.warnings.length ? `\n\nWatch out: ${report.warnings.join(' ')}` : '';
  const assumptions = report.assumptions.length ? `\n\nI assumed: ${report.assumptions.join(' ')}` : '';
  const questions = report.questions.length ? `\n\nTo do this better, tell me:\n${report.questions.map((item) => `- ${item}`).join('\n')}` : '';
  // Council opinions are OPT-IN (Council Loop button / Review tab), not a
  // sermon appended to every reply.
  return `${opening}${rejected}${warnings}${assumptions}${questions}`;
}

export async function requestCurrentProjectState() {
  const response = await fetch('/api/projects/current');
  if (!response.ok) throw new Error(`Project load failed with HTTP ${response.status}`);
  return response.json();
}

export async function saveDashboardStateToBackend(payload) {
  const response = await fetch('/api/projects/current/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Project save failed with HTTP ${response.status}`);
  return response.json();
}

export async function requestStructuredDesignPlan(payload) {
  const request = (url) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let response = await request('/api/design-plan');
  if (response.status === 404 && typeof window !== 'undefined' && window.location.port !== '5184') {
    response = await request('http://127.0.0.1:5184/api/design-plan');
  }
  if (!response.ok) throw new Error(`Planner failed with HTTP ${response.status}`);
  return response.json();
}

export async function requestServerAppliedBim(payload) {
  const request = (url) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let response = await request('/api/bim/apply');
  if (response.status === 404 && typeof window !== 'undefined' && window.location.port !== '5184') {
    response = await request('http://127.0.0.1:5184/api/bim/apply');
  }
  if (!response.ok) {
    // Surface the server's actual reason — "HTTP 500" alone is undiagnosable.
    let detail = '';
    try { detail = (await response.json())?.error || ''; } catch { /* body wasn't JSON */ }
    throw new Error(`BIM apply failed with HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
  return response.json();
}

export async function requestStudioResponse(payload) {
  const request = (url) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let response = await request('/api/studio/respond');
  if (response.status === 404 && typeof window !== 'undefined' && window.location.port !== '5184') {
    response = await request('http://127.0.0.1:5184/api/studio/respond');
  }
  if (!response.ok) throw new Error(`Studio response failed with HTTP ${response.status}`);
  return response.json();
}

export function buildDashboardStatePayload({
  projectId,
  savedAt,
  spec,
  selectedRoom,
  prompt,
  chatTarget,
  addToTarget,
  selectedExpertId,
  expertQuestion,
  libraryActionMode,
  revisionLog,
  history,
  lastModelChange,
  operationAudit,
  projectBrain,
  chatMessages,
  modelLayers,
  buildProgress,
  visitedSystems
}) {
  return {
    version: 1,
    projectId,
    savedAt,
    spec,
    selectedRoom,
    prompt,
    chatTarget,
    addToTarget,
    selectedExpertId,
    expertQuestion,
    libraryActionMode,
    revisionLog: revisionLog.slice(0, 80),
    history: compactHistoryForStorage(history),
    lastModelChange,
    operationAudit: operationAudit.slice(0, 40),
    projectBrain,
    chatMessages: compactChatForStorage(chatMessages),
    modelLayers,
    buildProgress,
    visitedSystems
  };
}

export function addElementToSpec(spec, item) {
  if (!spec.elements) spec.elements = [];
  const baseId = slugify(item.name);
  const matchingCount = spec.elements.filter((element) => element.id.startsWith(baseId)).length;
  const id = matchingCount ? `${baseId}-${matchingCount + 1}` : baseId;
  const offset = spec.elements.length * 2;
  const element = {
    id,
    name: item.name,
    category: item.kind,
    sourceCategory: item.sourceCategory || '',
    note: item.note,
    x: clamp(2 + offset, -24, spec.shell.widthFt + 24),
    y: clamp(spec.shell.depthFt + 3 + offset, -24, spec.shell.depthFt + 32),
    w: item.w,
    d: item.d,
    h: item.kind === 'wall' ? 8 : item.kind === 'thermal' ? 5 : item.kind === 'water' ? 6 : 1.2,
    type: item.type || 'storage'
  };
  spec.elements.push({ ...element, ...clampObjectPosition(spec, element, element.x, element.y) });
}

export function upsertRoom(spec, room) {
  const index = spec.rooms.findIndex((item) => item.id === room.id);
  if (index >= 0) spec.rooms[index] = { ...spec.rooms[index], ...room };
  else spec.rooms.push(room);
}

export function normalizeRooms(spec) {
  const roomMargin = Math.max(16, padExtension(spec.shell));
  spec.rooms = spec.rooms.map((room) => ({
    ...room,
    ...(OUTDOOR_SPACE_TYPES.has(room.type)
      ? clampObjectPosition(spec, room, room.x, room.y)
      : {
        x: clamp(room.x, -roomMargin * 0.25, spec.shell.widthFt + 8),
        y: clamp(room.y, -roomMargin * 0.25, spec.shell.depthFt + 8)
      }),
    w: clamp(room.w, 4, spec.shell.widthFt),
    d: clamp(room.d, 4, spec.shell.depthFt)
  }));
  if (Array.isArray(spec.elements)) {
    spec.elements = spec.elements.map((element) => {
      const resized = {
        ...element,
        w: clamp(Number(element.w) || 1, 1, spec.shell.widthFt + 48),
        d: clamp(Number(element.d) || 1, 1, spec.shell.depthFt + 48)
      };
      return { ...resized, ...clampObjectPosition(spec, resized, resized.x || 0, resized.y || 0) };
    });
  }
}

export function repairNorthBandRooms(spec) {
  const insideRooms = spec.rooms.filter((room) => room.x >= 0 && room.y >= 0 && room.y < spec.shell.depthFt);
  if (!insideRooms.length) return [];
  const northY = Math.min(...insideRooms.map((room) => room.y));
  const bandTolerance = Math.max(2, spec.shell.depthFt * 0.12);
  const bandRooms = insideRooms
    .filter((room) => room.y <= northY + bandTolerance)
    .sort((a, b) => a.x - b.x);

  if (!bandRooms.length) return [];

  const commonDepth = clamp(
    Math.round(Math.max(...bandRooms.map((room) => room.d)) * 10) / 10,
    4,
    Math.max(4, spec.shell.depthFt * 0.6)
  );
  const totalWidth = bandRooms.reduce((sum, room) => sum + Math.max(4, room.w), 0) || spec.shell.widthFt;
  let cursor = 0;

  bandRooms.forEach((room, index) => {
    const remainingRooms = bandRooms.length - index - 1;
    const proportionalWidth = index === bandRooms.length - 1
      ? spec.shell.widthFt - cursor
      : (Math.max(4, room.w) / totalWidth) * spec.shell.widthFt;
    const maxWidth = spec.shell.widthFt - cursor - remainingRooms * 4;
    room.x = Math.round(cursor * 10) / 10;
    room.y = 0;
    room.w = clamp(Math.round(proportionalWidth * 10) / 10, 4, Math.max(4, maxWidth));
    room.d = commonDepth;
    cursor += room.w;
  });

  const lastRoom = bandRooms[bandRooms.length - 1];
  if (lastRoom) lastRoom.w = Math.round((spec.shell.widthFt - lastRoom.x) * 10) / 10;

  return bandRooms;
}

export function detectIssues(spec) {
  const issues = [];
  const customFpCheck = hasCustomFootprint(spec);
  const fpPolyCheck = customFpCheck ? footprintPolygon(spec) : null;
  const enclosedRooms = spec.rooms.filter((room) => (customFpCheck
    ? rectInFootprint(fpPolyCheck, { x: room.x, y: room.y, w: room.w, d: room.d })
    : room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt));
  const conditionedArea = enclosedRooms.reduce((sum, room) => sum + room.w * room.d, 0);
  const shellArea = customFpCheck ? polygonArea(fpPolyCheck) : spec.shell.widthFt * spec.shell.depthFt;
  // A room hanging outside the walls of an L/U footprint is a real flag —
  // on a rectangle it just reads as "outside the shell" in the plan.
  if (customFpCheck) {
    const strayRoom = spec.rooms.find((room) => Number(room.level || 1) === 1
      && room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt
      && !rectInFootprint(fpPolyCheck, { x: room.x, y: room.y, w: room.w, d: room.d }));
    if (strayRoom) {
      issues.push({ severity: 'warning', title: `${strayRoom.name} sits outside the building outline`, owner: 'Architect', system: 'rooms', fix: 'The footprint is not a plain rectangle — drag the room fully inside the outline in the Plan view, or move a wall edge out to enclose it.' });
    }
  } else {
    // A rectangle shell that only covers PART of the ground floor: indoor
    // rooms left standing outside the walls (a chat/trace often sets the
    // shell to the two-storey core and strands the single-storey spaces).
    const strays = spec.rooms.filter((room) => Number(room.level || 1) === 1 && !OUTDOOR_SPACE_TYPES.has(room.type)
      && (room.x < -0.5 || room.y < -0.5 || room.x + room.w > spec.shell.widthFt + 0.5 || room.y + room.d > spec.shell.depthFt + 0.5));
    if (strays.length) {
      issues.push({ severity: 'critical', title: strays.length === 1 ? `${strays[0].name} sits outside the walls` : `${strays.length} ground-floor rooms sit outside the walls`, owner: 'Architect', system: 'shell', fixId: 'enclose-rooms', fix: 'The shell only covers part of the ground floor. Grow the walls to take these rooms in — an upper storey can still cover just the core: resize its Storey extent (2nd-floor group in the selector, or drag it on the 2nd-floor Plan), and the roof steps down over the rest.' });
    }
  }

  if (conditionedArea > shellArea * 1.08) {
    issues.push({ severity: 'critical', title: 'Room program exceeds shell area', owner: 'Architect', system: 'rooms', fix: 'Reduce room footprints or enlarge the shell before issuing drawings.' });
  }
  if (!spec.rooms.some((room) => room.type === 'wet')) {
    issues.push({ severity: 'critical', title: 'No wet core defined', owner: 'Engineer', system: 'rooms', fixId: 'add-wet-core', fix: 'Add a bathroom/mechanical wet core and align plumbing walls.' });
  }
  // Passive-solar / homestead checks belong to the NATURAL approach — a
  // conventional as-built (designApproach 'standard') isn't judged by them.
  const naturalApproach = (spec.shell?.designApproach || 'natural') !== 'standard';
  if (naturalApproach && !spec.openings.some((item) => (OPENING_TYPES[item.type]?.entry) && item.wall === 'south')) {
    issues.push({ severity: 'warning', title: 'Primary entry lacks clear solar-side approach', owner: 'Designer', system: 'windows', fixId: 'add-south-entry', fix: 'Add or move the main entry (a door, french doors, or a slider) to a legible south approach with weather protection.' });
  }
  if (naturalApproach && !spec.openings.some((item) => (OPENING_TYPES[item.type] || OPENING_TYPES.window).glazed && item.wall === 'south')) {
    issues.push({ severity: 'warning', title: 'Insufficient south-facing daylight strategy', owner: 'Permaculture', system: 'windows', fixId: 'add-south-glass', fix: 'Add balanced south glazing with summer shading and winter solar gain.' });
  }
  if (spec.shell.wallHeightFt > 12) {
    issues.push({ severity: 'warning', title: 'Tall walls need explicit lateral strategy', owner: 'Engineer', system: 'walls', fix: 'Add shear wall schedule, hold-downs, and diaphragm notes.' });
  }
  const shedFall = Math.abs(Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10) - Number(spec.shell.northWallHeightFt || spec.shell.wallHeightFt || 10));
  if ((spec.shell.roofType || 'gable') === 'shed' && shedFall < 0.5) {
    issues.push({ severity: 'warning', title: "Shed roof is flat — it won't drain", owner: 'Engineer', system: 'roof', fixId: 'give-shed-fall', fix: 'A shed needs a high eave and a low one. Set "Drains to" on the Roof page — high south wall draining north is the solar classic.' });
  }
  const glazedOffSouth = WALL_SIDES.filter((side) => { const r = resolveWallSide(spec, side); return !r.omitted && side !== 'south' && (r.assemblyKey === 'glazed' || r.sunGlazing); });
  if (naturalApproach && glazedOffSouth.length) {
    issues.push({ severity: 'warning', title: `Glass wall faces ${glazedOffSouth.join(' + ')} — little solar gain, big heat leak`, owner: 'Natural Builder', system: 'walls', fix: 'A glazed wall earns its keep facing south. Off-south glass loses heat all winter for little gain — face it south, or accept the heat cost knowingly.' });
  }
  const basementCheck = basementInfo(spec.shell);
  const basementBedroom = basementCheck.present && spec.rooms.find((room) => Number(room.level || 1) === BASEMENT_LEVEL && room.type === 'sleeping');
  if (basementBedroom) {
    issues.push({ severity: 'critical', title: `${basementBedroom.name} is a basement bedroom — egress required`, owner: 'Engineer', system: 'rooms', fix: 'A below-grade sleeping room needs an egress window or a walkout door (minimum clear opening per code). Plan the well or walkout on the downhill side.' });
  }
  // A stair has real geometry now: enough run for its rise (7.75" risers,
  // 10" treads). Only judged when it actually climbs somewhere.
  for (const stairEl of (spec.elements || []).filter((el) => /stair/i.test(el.name || '') && !/ladder/i.test(el.name || ''))) {
    const stairLevel = Number(stairEl.level || 1);
    const climbs = stairLevel === BASEMENT_LEVEL ? basementCheck.present : Number(spec.shell.storeys || 1) > 1;
    if (!climbs) continue;
    const rise = stairLevel === BASEMENT_LEVEL ? basementCheck.heightFt : Number(spec.shell.wallHeightFt || 10);
    const run = Math.max(Number(stairEl.w) || 0, Number(stairEl.d) || 0);
    const neededRun = Math.round(rise / 0.646) * 0.833;
    if (run < neededRun * 0.85) {
      issues.push({ severity: 'warning', title: `${stairEl.name} is too short for its ${Math.round(rise)}′ climb`, owner: 'Architect', system: 'rooms', fix: `About ${Math.ceil(neededRun)}′ of run is needed at code-friendly 7¾" risers / 10" treads — stretch the stair in the Plan, or accept a steeper ship-ladder knowingly.` });
    }
  }
  if (spec.systems.envelope.toLowerCase().includes('natural') && !spec.systems.envelope.toLowerCase().includes('rainscreen')) {
    issues.push({ severity: 'warning', title: 'Natural wall lacks drying layer', owner: 'Natural Builder', system: 'walls', fix: 'Include rainscreen, generous roof overhangs, and capillary breaks.' });
  }
  // Frame ↔ wall consistency: a framed (stud) wall assembly needs a structural
  // frame; a load-bearing "frame" means the wall itself carries the load.
  const frameKeyNow = resolveFrameType(spec, 1);
  const hasFramedWall = WALL_SIDES.some((side) => {
    const r = resolveWallSide(spec, side);
    return !r.omitted && r.assemblyKey === 'framed';
  });
  if (frameKeyNow === 'load-bearing' && hasFramedWall) {
    issues.push({ severity: 'warning', title: 'Framed wall has no frame to carry it', owner: 'Engineer', system: 'frame', fixId: 'set-stick-frame', fix: 'A framed (stud) wall is not load-bearing on its own — pick a frame on the Frame page (light stick frame matches), or switch that side to a load-bearing natural assembly.' });
  }
  if (naturalApproach && !spec.rooms.some((room) => /mud|laundry|service/i.test(room.name))) {
    issues.push({ severity: 'warning', title: 'Farm workflow has no dirty entry', owner: 'Homestead/Farm', system: 'rooms', fixId: 'add-mudroom', fix: 'Add a mud/laundry buffer between exterior work and clean living space.' });
  }
  const hasStackedSpace = Number(spec.shell.storeys || 1) > 1
    || (spec.elements || []).some((element) => ['loft', 'tower'].includes(element.category))
    || (basementCheck.present && spec.rooms.some((room) => Number(room.level || 1) === BASEMENT_LEVEL));
  if (hasStackedSpace
    && !spec.rooms.some((room) => /stair|ladder/i.test(room.name))
    && !(spec.elements || []).some((element) => /stair|ladder/i.test(element.name))) {
    issues.push({ severity: 'warning', title: 'Upper space has no stair', owner: 'Architect', system: 'rooms', fixId: 'add-stair', fix: 'Add a stair (about 3 × 10 ft plus a landing) — or a ladder for a loft — so the upper floor, loft, or tower is reachable.' });
  }

  // Ported from the add-on's aiCritic (Appendix S / 75-A style rules).
  const derivedForChecks = deriveDesign(spec, getWallSections(spec));
  const { extraFt: storeyLiftFt } = storeyInfo(spec.shell);
  for (const side of WALL_SIDES) {
    const resolved = resolveWallSide(spec, side);
    if (resolved.omitted || resolved.assemblyKey !== 'straw-bale') continue;
    const slenderness = (resolved.heightFt + storeyLiftFt) / Math.max(resolved.thicknessFt, 0.1);
    // Thickness that brings this side to a compliant 12:1, rounded up to the inch.
    const fixThicknessFt = Math.ceil(((resolved.heightFt + storeyLiftFt) / 12) * 12) / 12;
    if (slenderness > 15) {
      issues.push({ severity: 'critical', title: `${titleCase(side)} bale wall is too tall for its thickness (${slenderness.toFixed(1)}:1)`, owner: 'Engineer', system: 'walls', fixId: 'thicken-bale-wall', side, fixThicknessFt, fix: 'Load-bearing straw bale is typically limited to 15:1 height-to-thickness (Appendix S R325.8-style). Thicken the wall, lower it, or switch that side to a framed/infill system.' });
      break;
    }
    if (slenderness > 12) {
      issues.push({ severity: 'warning', title: `${titleCase(side)} bale wall slenderness is high (${slenderness.toFixed(1)}:1)`, owner: 'Engineer', system: 'walls', fixId: 'thicken-bale-wall', side, fixThicknessFt, fix: 'Compliant, but consider intermediate posts or a timber frame with bale infill.' });
      break;
    }
  }
  const utilitiesForChecks = derivedForChecks.utilities;
  const hasBaleWall = WALL_SIDES.some((side) => {
    const resolved = resolveWallSide(spec, side);
    return !resolved.omitted && resolved.assemblyKey === 'straw-bale';
  });
  if (hasBaleWall && utilitiesForChecks.foundationType !== 'stemwall') {
    issues.push({ severity: 'critical', title: 'Straw bale walls sit too near the ground', owner: 'Natural Builder', system: 'foundation', fixId: 'add-stemwall', fix: 'Bales cannot take ground splash or rising damp — they must ride a stem wall at least 12″ above grade. Switch the foundation to a stem wall (the rubble trench stays underneath as drainage).' });
  }
  if (hasBaleWall && utilitiesForChecks.foundationType === 'stemwall' && derivedForChecks.stemwallHeightFt < 1) {
    issues.push({ severity: 'warning', title: `Stem wall is only ${Math.round(derivedForChecks.stemwallHeightFt * 12)}" under bale walls`, owner: 'Natural Builder', system: 'foundation', fixId: 'raise-stemwall', fix: 'Straw bale wants its base at least 12" above grade for splash protection — raise the stem wall to 1 ft or more.' });
  }
  const usesWell = utilitiesForChecks.waterSource === 'well' || utilitiesForChecks.waterSource === 'spring';
  if (usesWell && utilitiesForChecks.wasteMethod === 'septic' && Number(utilitiesForChecks.wellSepticFt) < 100) {
    issues.push({ severity: 'critical', title: `Well is only ${Math.round(utilitiesForChecks.wellSepticFt)} ft from the septic field`, owner: 'Engineer', system: 'waste', fixId: 'well-septic', fix: 'Health code (NYS 75-A-style) wants at least 100 ft between a well and a septic field. Move one of them — confirm the exact figure with your health department.' });
  }
  if (Number.isFinite(derivedForChecks.supplyGpd) && derivedForChecks.supplyGpd < derivedForChecks.waterGpd) {
    issues.push({ severity: 'warning', title: `Water source gives ~${Math.round(derivedForChecks.supplyGpd)} gal/day but you'll use ~${Math.round(derivedForChecks.waterGpd)}`, owner: 'Engineer', system: 'water', fix: 'Add storage, add a second source, or cut demand — the source has to cover what the household uses.' });
  }
  if (derivedForChecks.panels > 0 && derivedForChecks.panels > derivedForChecks.panelRoom) {
    issues.push({ severity: 'warning', title: `Solar needs ${derivedForChecks.panels} panels but the roof holds ~${derivedForChecks.panelRoom}`, owner: 'Engineer', system: 'power', fix: 'Grow the roof, cut electric loads (a wood heat source helps), or plan a ground-mount array.' });
  }
  if (naturalApproach && derivedForChecks.total > 324700) {
    issues.push({ severity: 'warning', title: 'Cost is over the owner-builder loan ceiling', owner: 'Project Manager', system: 'shell', fix: `Estimated ${'$' + Math.round(derivedForChecks.total).toLocaleString()} exceeds a typical USDA direct-loan limit ($324,700). Shrink the footprint, simplify systems, or take on more sweat equity.` });
  }
  // Overhang rules (aiCritic R325.5.4-style protection + passive-solar shading).
  const overhangCheck = resolveOverhangs(spec.shell);
  const hasEarthenWall = WALL_SIDES.some((side) => {
    const resolved = resolveWallSide(spec, side);
    return !resolved.omitted && resolved.assemblyKey !== 'framed';
  });
  if (hasEarthenWall && overhangCheck.min < 2) {
    issues.push({ severity: 'critical', title: `Roof overhang is only ${(overhangCheck.min * 12).toFixed(0)}" on the shortest side`, owner: 'Natural Builder', system: 'roof', fixId: 'deepen-overhang', fix: 'Plastered natural walls need at least 24" of overhang to stay dry (Appendix S R325.5.4-style). Deepen the overhang or switch the exposed side to a framed rainscreen wall.' });
  }
  const hasSouthGlass = spec.openings.some((opening) => opening.wall === 'south' && opening.type !== 'door');
  if (naturalApproach && hasSouthGlass && derivedForChecks.winterShadeFrac > 0.33) {
    issues.push({ severity: 'warning', title: `South overhang shades ${Math.round(derivedForChecks.winterShadeFrac * 100)}% of the winter sun`, owner: 'Designer', system: 'roof', fixId: 'reduce-south-overhang', fix: `At your latitude the winter noon sun sits at ${Math.round(derivedForChecks.sunWinterDeg)}° — the ${overhangCheck.south.toFixed(1)} ft south overhang casts that much shadow on your solar glass. Trim it, or raise the south wall.` });
  }
  if (issues.length === 0) {
    issues.push({ severity: 'pass', title: 'Schematic passes current council checks', owner: 'Project Manager', fix: 'Ready for PE/architect review, structural sizing, jurisdictional code check, and stamped drawing development.' });
  }
  return issues;
}

export function runCouncil(spec) {
  const issues = detectIssues(spec);
  return expertCouncil.map((expert) => {
    const owned = issues.filter((issue) => issue.owner === expert.name || (expert.id === 'pm' && issue.severity === 'pass'));
    return {
      ...expert,
      status: owned.some((issue) => issue.severity === 'critical') ? 'blocked' : owned.some((issue) => issue.severity === 'warning') ? 'revise' : 'clear',
      notes: owned.length ? owned.map((issue) => issue.fix).join(' ') : `No blocking ${expert.concern} issue found in this schematic pass.`
    };
  });
}

// The dependency engine (v2): quantities every system page reads. Cost,
// sweat-equity, and carbon math lifted from the add-on's computeDerivedState
// (natural_house_designer/web/app.js); water/sun/power sizing from the
// control-face prototype. Directional early-design numbers, not stamped calcs.
// "This design, built the other way": swap the CONSTRUCTION systems between
// natural and standard while leaving the geometry AND the site services
// (water/waste/power — those are site decisions, not construction ones)
// untouched. Feed the result to deriveDesign for an honest apples-to-apples
// cost / carbon / heat comparison of the same house.
export function convertSpecApproach(spec, target) {
  const next = structuredClone(spec);
  next.shell.designApproach = target;
  next.utilities = { ...(next.utilities || {}) };
  next.flooring = { ...(next.flooring || {}) };
  next.frame = { ...(next.frame || {}), storeyTypes: {} };
  const setAllWalls = (assembly) => {
    for (const side of WALL_SIDES) {
      next.walls = next.walls || {};
      next.walls[side] = { ...(next.walls[side] || {}), assembly };
      delete next.walls[side].thicknessFt; // let the assembly's own thickness rule
      if (next.wallsUpper?.[side]) next.wallsUpper[side] = { ...next.wallsUpper[side], assembly };
    }
  };
  if (target === 'standard') {
    next.systems.envelope = 'framed vapor-open walls with rainscreen cladding';
    setAllWalls('framed');
    next.frame.type = 'stick';
    next.utilities.foundationType = 'slab';
    next.utilities.roofInsulation = 'mineralwool';
    next.utilities.floorInsulation = 'mineralwool';
    next.utilities.heatSource = 'minisplit';
    next.flooring.type = 'wood';
    delete next.flooring.subfloor; // follows the slab
  } else {
    next.systems.envelope = 'load-bearing straw bale walls with lime plaster and rainscreen';
    setAllWalls('straw-bale');
    next.frame.type = 'load-bearing';
    next.utilities.foundationType = 'stemwall';
    next.utilities.stemwallHeightFt = Math.max(1.5, Number(next.utilities.stemwallHeightFt) || 1.5);
    next.utilities.roofInsulation = 'cellulose';
    next.utilities.floorInsulation = 'cellulose';
    next.utilities.heatSource = 'wood_stove';
    next.flooring.type = 'earthen';
    delete next.flooring.subfloor;
  }
  return next;
}

export function deriveDesign(spec, wallSections) {
  const site = siteOf(spec);
  const utilities = utilitiesOf(spec);
  const w = Number(spec.shell.widthFt) || 0;
  const d = Number(spec.shell.depthFt) || 0;
  // Custom footprints measure the real polygon; a legacy rectangle keeps the
  // exact w*d / 2(w+d) formulas so existing designs don't shift by a cent.
  const customFp = hasCustomFootprint(spec);
  const fpPoly = customFp ? footprintPolygon(spec) : null;
  const floor = customFp ? polygonArea(fpPoly) : w * d;
  const { storeys, extraFt: storeyExtraFt, baseWallFt } = storeyInfo(spec.shell);
  // Upper storeys cover their extent PLATE (a storey can sit over only one
  // side of the building); no plate = the full footprint. Lofts and towers
  // add their own heated area on top. A 1½-storey loft counts half.
  const loftTowerArea = (spec.elements || [])
    .filter((element) => ['loft', 'tower'].includes(element.category))
    .reduce((sum, element) => sum + (Number(element.w) * Number(element.d) || 0), 0);
  let upperFloorArea = 0;
  for (let lvl = 2; lvl <= Math.ceil(storeys); lvl += 1) {
    const plate = upperPlateRect(spec, lvl);
    const factorForLevel = clamp(storeys - (lvl - 1), 0, 1);
    upperFloorArea += (plate ? plate.w * plate.d : floor) * factorForLevel;
  }
  const stackedArea = loftTowerArea + upperFloorArea;
  // Finished basement space counts what's actually built out (rooms at the
  // basement level), not the whole slab — and only when the user says the
  // basement is HEATED (an unheated basement is cold storage, not living area).
  const basement = basementInfo(spec.shell);
  const basementHeated = basement.present && spec.shell.basementHeated !== false;
  const basementRoomArea = basement.present
    ? spec.rooms.filter((room) => Number(room.level || 1) === BASEMENT_LEVEL).reduce((sum, room) => sum + room.w * room.d, 0)
    : 0;
  const heatedFloor = floor + upperFloorArea + loftTowerArea + (basementHeated ? basementRoomArea : 0);
  const pitch = Number(spec.shell.roofPitch || 0.32);
  const overhangs = resolveOverhangs(spec.shell);
  const roofFootprint = customFp
    ? polygonArea(expandFootprint(fpPoly, overhangs))
    : (w + overhangs.east + overhangs.west) * (d + overhangs.north + overhangs.south);
  const roofArea = roofFootprint / Math.cos(Math.atan(pitch));
  // True face area per wall, roof-shape aware:
  // - shed: east/west walls are RAKED — a trapezoid from the north eave to
  //   the south eave, so their area uses the average of the two, and their
  //   own "height" setting doesn't apply.
  // - gable: north/south walls carry a triangular gable peak above the eave.
  const roofTypeNow = spec.shell.roofType || 'gable';
  const northEaveFt = resolveWallSide(spec, 'north').heightFt;
  const southEaveFt = resolveWallSide(spec, 'south').heightFt;
  const gableRiseFt = roofTypeNow === 'gable' ? Math.max(0, d * pitch - 0.25) : 0;
  // Sections come per storey now (each with its own height slice + assembly),
  // so no storeyExtraFt here. The gable triangle rides the TOPMOST section;
  // shed east/west walls are raked — ground slice uses the eave average, the
  // upper slice is a parallelogram band of the storey lift.
  const hasUpperSections = wallSections.some((wall) => wall.storey === 'upper');
  const wallFaceArea = (wall) => {
    const topmost = wall.storey === 'upper' || !hasUpperSections;
    if (roofTypeNow === 'shed' && (wall.side === 'east' || wall.side === 'west')) {
      return wall.storey === 'upper'
        ? wall.lengthFt * storeyExtraFt
        : wall.lengthFt * ((northEaveFt + southEaveFt) / 2);
    }
    let area = wall.lengthFt * wall.heightFt;
    // Gable-peak triangles ride the topmost N/S walls of a plain rectangle.
    // On a custom footprint the roof breaks into segments whose gables vary —
    // the small triangle areas are left out (a slight, honest undercount).
    if (roofTypeNow === 'gable' && !customFp && topmost && (wall.side === 'north' || wall.side === 'south')) {
      area += (wall.lengthFt * gableRiseFt) / 2;
    }
    return area;
  };
  const wallArea = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall), 0);
  // A glazed assembly is a GLASS WALL (a greenhouse's south face): its face is
  // glazing, not opaque envelope. It leaves the wall R/cost math and joins the
  // glass — ~85% of the face is glass, the rest is its timber frame.
  const GLAZED_WALL_GLASS_FRAC = 0.85;
  const glazedWallArea = wallSections.reduce((sum, wall) => sum + (wall.assemblyKey === 'glazed' ? wallFaceArea(wall) : 0), 0);
  const glazedSouthWallArea = wallSections.reduce((sum, wall) => sum + (wall.assemblyKey === 'glazed' && wall.side === 'south' ? wallFaceArea(wall) : 0), 0);
  const opaqueWallArea = Math.max(0, wallArea - glazedWallArea);
  const wallCostPsf = { 'straw-bale': 12, 'hemp-lime': 20, cob: 20, 'rammed-earth': 22, cordwood: 16, 'light-straw-clay': 15, framed: 18, sips: 22, 'ply-insulated': 16, icf: 24, glazed: utilities.windowQuality === 'triple' ? 70 : 45 };
  // Interior partition walls price by face area of their construction and ride
  // the walls cost line (they're walls, just without weather duty).
  const partitionElements = (spec.elements || []).filter((element) => element.category === 'partition');
  const partitionCost = partitionElements.reduce((sum, element) => {
    const pType = PARTITION_TYPES[element.construction] || PARTITION_TYPES.framed;
    return sum + Math.max(Number(element.w), Number(element.d)) * Math.max(2, Number(element.h) || 8) * pType.costPsf;
  }, 0);
  const partitionCarbon = partitionElements.reduce((sum, element) => {
    const pType = PARTITION_TYPES[element.construction] || PARTITION_TYPES.framed;
    return sum + Math.max(Number(element.w), Number(element.d)) * Math.max(2, Number(element.h) || 8) * pType.carbonPsf;
  }, 0);
  // Cladding is a layer over the assembly, priced per face sf ('render' = 0,
  // the assembly's own plaster face is already in the wall rate).
  const claddingCost = wallSections.reduce((sum, wall) => {
    const clad = CLADDING_TYPES[resolveWallSide(spec, wall.side, wall.level || 1).cladding] || CLADDING_TYPES.render;
    return sum + wallFaceArea(wall) * clad.costPsf;
  }, 0);
  const claddingCarbon = wallSections.reduce((sum, wall) => {
    const clad = CLADDING_TYPES[resolveWallSide(spec, wall.side, wall.level || 1).cladding] || CLADDING_TYPES.render;
    return sum + wallFaceArea(wall) * clad.carbonPsf;
  }, 0);
  const wallsCost = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCostPsf[wall.assemblyKey] ?? 16), 0) + partitionCost + claddingCost;
  const wallR = opaqueWallArea
    ? wallSections.reduce((sum, wall) => sum + (wall.assemblyKey === 'glazed' ? 0 : wallFaceArea(wall) * (WALL_ASSEMBLIES[wall.assemblyKey]?.rValue ?? 20)), 0) / opaqueWallArea
    : 20;
  // Glazed openings on the south wall — windows, picture, clerestory, and
  // glazed doors (french, sliders) all count toward passive-solar glass.
  // A bay window's wrapped faces gather ~25% more glass than its plan width.
  const southOpeningGlass = (spec.openings || []).filter((opening) => opening.wall === 'south' && (OPENING_TYPES[opening.type] || OPENING_TYPES.window).glazed)
    .reduce((sum, opening) => {
      const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
      return sum + (Number(opening.widthFt) || 3) * profile.h * (profile.bay ? 1.25 : 1);
    }, 0);
  // Angled sun-glazing bands above kneewalls (the greenhouse face): glass area
  // = run x slant length. Tilted glass meets the low winter sun more squarely,
  // so south bands get a modest gain bonus (approximation, capped +30%).
  const eaveForBand = Number(spec.shell.wallHeightFt || 10) + storeyExtraFt;
  const sunBands = WALL_SIDES.map((side) => {
    const r = resolveWallSide(spec, side);
    if (!r.sunGlazing || r.omitted) return null;
    const gapH = Math.max(0, eaveForBand - r.heightFt);
    if (gapH < 1.5) return null;
    const tilt = clamp(Number(r.sunGlazingTiltDeg ?? 30), 0, 45);
    const area = ((side === 'north' || side === 'south' ? w : d) - 1) * (gapH / Math.cos(tilt * Math.PI / 180));
    return { side, tilt, area, glass: area * 0.9 };
  }).filter(Boolean);
  const southBandGlass = sunBands.filter((b) => b.side === 'south').reduce((sum, b) => sum + b.glass * (1 + Math.min(0.3, b.tilt / 100)), 0);
  const nonSouthBandGlass = sunBands.filter((b) => b.side !== 'south').reduce((sum, b) => sum + b.glass, 0);
  const bandFrameArea = sunBands.reduce((sum, b) => sum + b.area, 0);
  const southGlass = southOpeningGlass + glazedSouthWallArea * GLAZED_WALL_GLASS_FRAC + southBandGlass;
  // House orientation: how far the south face is rotated off true south. Solar
  // gain falls with the cosine of that angle, so a house aimed SE/SW harvests
  // less winter sun from the same glass.
  const azimuthDeg = Number(site.azimuthDeg) || 0;
  const solarFactor = Math.cos(azimuthDeg * Math.PI / 180);
  const glassPct = floor ? (southGlass * solarFactor / floor) * 100 : 0;
  // Sun angles (solar-noon altitude at the solstices, from latitude) and what
  // the south overhang does with them: the eave's shadow drops o·tan(altitude)
  // down the wall — deep summer shade is free cooling, winter shade steals the
  // heat the glass was placed to gather. Nominal south window: head 7', sill 3'.
  const latDeg = Number(site.latitudeDeg) || 43;
  const sunWinterDeg = clamp(90 - latDeg - 23.5, 2, 88);
  const sunSummerDeg = clamp(90 - latDeg + 23.5, 2, 88);
  const southEaveTopFt = resolveWallSide(spec, 'south').heightFt + storeyExtraFt;
  const shadeFracAt = (altDeg) => {
    const drop = (Number(resolveOverhangs(spec.shell).south) || 0) * Math.tan(altDeg * Math.PI / 180);
    const shadowBottom = southEaveTopFt - drop;
    return clamp((7 - shadowBottom) / (7 - 3), 0, 1);
  };
  const winterShadeFrac = shadeFracAt(sunWinterDeg);
  const summerShadeFrac = shadeFracAt(sunSummerDeg);
  // All glazing (every wall + skylights) for cost and heat loss.
  const skylightArea = (spec.openings || []).filter((opening) => opening.wall === 'roof')
    .reduce((sum, opening) => sum + (Number(opening.widthFt) || 2.5) ** 2, 0);
  const totalGlass = (spec.openings || []).reduce((sum, opening) => {
    const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
    if (!profile.glazed) return sum;
    if (profile.roof) return sum + (Number(opening.widthFt) || 2.5) ** 2;
    return sum + (Number(opening.widthFt) || 3) * profile.h * (profile.bay ? 1.25 : 1);
  }, 0) + sunBands.reduce((sum, b) => sum + b.glass, 0);
  const glazingU = utilities.windowQuality === 'triple' ? 0.28 : 0.5;
  // Insulation is an explicit layer of the roof and floor assemblies.
  const roofInsulKey = resolveInsulation(utilities.roofInsulation, 'cellulose');
  const floorInsulKey = resolveInsulation(utilities.floorInsulation, 'cellulose');
  const roofR = INSULATION_TYPES[roofInsulKey].r;
  const floorR = INSULATION_TYPES[floorInsulKey].r;
  // Ground-coupled floors lose less than their full area — a 0.5 factor.
  const floorLoss = (floor / Math.max(floorR, 3)) * 0.5;
  const heatUA = Math.max(0, opaqueWallArea - southOpeningGlass) / Math.max(wallR, 1)
    + Math.max(0, roofArea - skylightArea) / roofR
    + floorLoss
    + (southGlass + skylightArea + nonSouthBandGlass + (glazedWallArea - glazedSouthWallArea) * GLAZED_WALL_GLASS_FRAC) * glazingU;
  const heatLoadKbtu = (heatUA * 70) / 1000;

  const bedrooms = Math.max(1, spec.rooms.filter((room) => room.type === 'sleeping').length);
  const people = bedrooms + 1;

  // Water: what you use vs what the source can give (gal/day).
  const waterGpd = people * 50;
  const catchmentGpd = roofArea * (Number(site.rainInYr) || 0) * 0.6 * 0.623 / 365;
  const supplyGpd = utilities.waterSource === 'catchment' ? catchmentGpd
    : utilities.waterSource === 'well' ? 600
    : utilities.waterSource === 'spring' ? 220
    : Infinity;
  const septicGpd = bedrooms * 110;

  // Power: loads collect here (well pump, electric heat), sized against sun.
  const peakSunHrs = Math.min(6, Math.max(3.2, 6 - (Number(site.latitudeDeg) - 20) * 0.05));
  let loadKwhDay = 2 + people * 2.2;
  if (utilities.waterSource === 'well') loadKwhDay += 2;
  if (utilities.heatSource === 'minisplit') loadKwhDay += 6;
  const autoPanels = utilities.powerMode === 'gridtie' ? 0 : Math.ceil(loadKwhDay / (peakSunHrs * 0.78) / 0.4);
  const panels = Number(utilities.panelCount) > 0 ? Math.round(Number(utilities.panelCount)) : autoPanels;
  const panelRoom = Math.floor(roofArea / 22);
  const autoBattery = utilities.powerMode === 'offgrid' ? Math.round(loadKwhDay * 2 / 0.8) : 0;
  const batteryKwh = Number(utilities.batteryOverrideKwh) > 0 ? Number(utilities.batteryOverrideKwh) : autoBattery;

  // Costs (add-on constants, keyed to the structured utility choices).
  const heatCostBySource = { rocket_mass: 2500, masonry: 6000, wood_stove: 3000, minisplit: 4500 };
  const waterCostBySource = { well: 7500, spring: 2500, catchment: 3500, town: 1500 };
  const wasteCostByMethod = { septic: 8500, composting: 1500, reedbed: 1200 };
  const foundationCostPsf = { rubble: 8, stemwall: 12, slab: 15 };
  const perimeterFt = customFp ? polygonPerimeter(fpPoly) : 2 * (w + d);
  const stemwallHeightFt = Math.min(6, Math.max(0.5, Number(utilities.stemwallHeightFt) || 1.5));
  // Stem wall cost scales with the wall itself: base prep + footing by floor
  // area, plus the perimeter wall by face area (calibrated so the default
  // 18" stem matches the old flat $12/sf).
  const foundationInsulation = utilities.foundationInsulation || 'perimeter';
  const foundationInsulationCost = foundationInsulation === 'full' ? floor * 3 : foundationInsulation === 'perimeter' ? perimeterFt * 6 : 0;
  // A basement IS the foundation: concrete perimeter walls by face area plus
  // a slab — it supersedes the rubble/stemwall/slab choice while present.
  const foundationCostBase = (basement.present
    ? perimeterFt * basement.heightFt * 24 + floor * 7 + basementRoomArea * 9
    : (utilities.foundationType === 'stemwall'
      ? floor * 8 + perimeterFt * stemwallHeightFt * 18
      : floor * (foundationCostPsf[utilities.foundationType] ?? 10))) + foundationInsulationCost;
  const outbuildingCost = (spec.elements || []).filter((element) => element.category === 'outbuilding')
    .reduce((sum, element) => sum + (Number(element.w) * Number(element.d) || 0) * (OUTBUILDING_CONSTRUCTION[element.construction]?.costPsf ?? 60), 0);
  // Placed foundation RUNS (strips under specific interior walls) price by the
  // foot; a stem type adds its height component. Folded into the foundation line.
  const foundationRuns = (spec.elements || []).filter((element) => element.category === 'foundation');
  const foundationRunCost = foundationRuns.reduce((sum, element) => {
    const runType = FOUNDATION_RUN_TYPES[element.construction] || FOUNDATION_RUN_TYPES.rubble;
    const lengthFt = Math.max(Number(element.w) || 0, Number(element.d) || 0);
    return sum + lengthFt * (runType.costLf + runType.stemCostLfFt * (Number(element.h) || 0));
  }, 0);
  const foundationRunCarbon = foundationRuns.reduce((sum, element) => {
    const runType = FOUNDATION_RUN_TYPES[element.construction] || FOUNDATION_RUN_TYPES.rubble;
    return sum + Math.max(Number(element.w) || 0, Number(element.d) || 0) * runType.carbonLf;
  }, 0);
  // A porch/deck canopy (element.roofType) is a light roof on posts: framing,
  // decking, and metal over the covered footprint, ~$14/sf.
  const canopyCost = (spec.elements || []).filter((element) => element.roofType && element.category !== 'foundation' && element.category !== 'floor')
    .reduce((sum, element) => sum + (Number(element.w) * Number(element.d) || 0) * 14, 0);
  const outdoorCost = OUTDOOR_ITEMS.reduce((sum, item) => sum + (outdoorItemPresent(spec, item) ? item.cost : 0), 0) + outbuildingCost + canopyCost;

  // Floor assembly = finished floor over the whole heated area + the structural
  // subfloor deck under the ground floor (a slab foundation is its own deck, so
  // its subfloor is free). Reclaimed boards cut the finish cost + carbon.
  const flooringKey = resolveFlooring(spec);
  const subfloorKey = resolveSubfloor(spec);
  const subfloorCost = floor * (SUBFLOOR_TYPES[subfloorKey]?.costPsf ?? 0);
  const subfloorCarbon = floor * (SUBFLOOR_TYPES[subfloorKey]?.carbonPsf ?? 0);
  const flooringCostRaw = heatedFloor * (FLOORING_TYPES[flooringKey]?.costPsf ?? 4);
  const flooringCarbonRaw = heatedFloor * (FLOORING_TYPES[flooringKey]?.carbonPsf ?? 2);

  // Frame (structure): framing quantity ≈ perimeter × wall height, split ground
  // vs. upper storeys so each can run a different frame. A load-bearing wall has
  // no separate frame (cost 0). Reclaimed timber cuts cost + carbon sharply.
  const reclaimed = reclaimedOf(spec);
  const groundFrameKey = resolveFrameType(spec, 1);
  const upperFrameKey = resolveFrameType(spec, 2);
  // The sun-glazing bands are CARRIED BY THE FRAME — their slant area joins
  // the frame quantity (a load-bearing "frame" prices at 0, honestly).
  const groundFrameArea = perimeterFt * baseWallFt + bandFrameArea;
  const upperPlateForFrame = upperPlateRect(spec, 2);
  const upperPerimeterFt = upperPlateForFrame ? 2 * (upperPlateForFrame.w + upperPlateForFrame.d) : perimeterFt;
  const upperFrameArea = upperPerimeterFt * storeyExtraFt;
  const frameCostRaw = groundFrameArea * (FRAME_TYPES[groundFrameKey]?.costPsf ?? 0) + upperFrameArea * (FRAME_TYPES[upperFrameKey]?.costPsf ?? 0);
  const frameCarbonRaw = groundFrameArea * (FRAME_TYPES[groundFrameKey]?.carbonPsf ?? 0) + upperFrameArea * (FRAME_TYPES[upperFrameKey]?.carbonPsf ?? 0);
  const frameCost = frameCostRaw * (reclaimed.frame ? RECLAIMED_FACTORS.frame.cost : 1);

  const wallsCostRaw = wallsCost;
  const windowsCostRaw = totalGlass * (utilities.windowQuality === 'triple' ? 70 : 45);
  const roofInsulCost = roofArea * INSULATION_TYPES[roofInsulKey].costPsf;
  const floorInsulCost = floor * INSULATION_TYPES[floorInsulKey].costPsf;
  const roofCostRaw = roofArea * 10 + roofInsulCost;
  const cost = {
    foundation: foundationCostBase + foundationRunCost,
    frame: frameCost,
    flooring: flooringCostRaw * (reclaimed.flooring ? RECLAIMED_FACTORS.flooring.cost : 1) + subfloorCost + floorInsulCost,
    upperFloors: (upperFloorArea + loftTowerArea) * 12,
    outdoors: outdoorCost,
    walls: wallsCostRaw * (reclaimed.walls ? RECLAIMED_FACTORS.walls.cost : 1),
    windows: windowsCostRaw * (reclaimed.windows ? RECLAIMED_FACTORS.windows.cost : 1),
    roof: roofCostRaw * (reclaimed.roof ? RECLAIMED_FACTORS.roof.cost : 1),
    heat: heatCostBySource[utilities.heatSource] ?? 3000,
    water: (waterCostBySource[utilities.waterSource] ?? 5000) + (Number(utilities.tankGal) || 0) * 1.5,
    waste: wasteCostByMethod[utilities.wasteMethod] ?? 5000,
    power: utilities.powerMode === 'gridtie' ? 4200 : panels * 900 + batteryKwh * 500 + 3000
  };
  const totalBeforeSweat = Object.values(cost).reduce((sum, part) => sum + part, 0);

  // Sweat equity: labor fraction of each trade you take on yourself
  // (add-on laborFractionByCategory: walls .8, roof .55, utilities .45).
  const sweat = (utilities.diyWalls ? cost.walls * 0.8 : 0)
    + (utilities.diyRoof ? cost.roof * 0.55 : 0)
    + (utilities.diyHeat ? cost.heat * 0.45 : 0)
    + (utilities.diyFoundation ? cost.foundation * 0.5 : 0)
    + (utilities.diyFrame ? cost.frame * 0.6 : 0);
  const total = totalBeforeSweat - sweat;

  // Embodied carbon (kg CO2e, directional/comparative — add-on coefficients).
  const foundationCarbonPsf = { rubble: 10, stemwall: 18, slab: 25 };
  const wallCarbonPsf = { 'straw-bale': 6, 'rammed-earth': 20, cob: 8, 'hemp-lime': 4, cordwood: 8, 'light-straw-clay': 7, framed: 8, sips: 14, 'ply-insulated': 9, icf: 26, glazed: 15 };
  const wallCarbonRaw = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCarbonPsf[wall.assemblyKey] ?? 8), 0) + partitionCarbon + claddingCarbon;
  const wallCarbon = wallCarbonRaw * (reclaimed.walls ? RECLAIMED_FACTORS.walls.carbon : 1);
  const frameCarbon = frameCarbonRaw * (reclaimed.frame ? RECLAIMED_FACTORS.frame.carbon : 1);
  const roofCarbonRaw = roofArea * (12 + INSULATION_TYPES[roofInsulKey].carbonPsf);
  const roofCarbon = roofCarbonRaw * (reclaimed.roof ? RECLAIMED_FACTORS.roof.carbon : 1);
  const flooringCarbon = flooringCarbonRaw * (reclaimed.flooring ? RECLAIMED_FACTORS.flooring.carbon : 1) + subfloorCarbon + floor * INSULATION_TYPES[floorInsulKey].carbonPsf;
  const stemCarbonExtra = utilities.foundationType === 'stemwall' ? perimeterFt * Math.max(0, stemwallHeightFt - 1.5) * 40 : 0;
  // Basement concrete is carbon-heavy: wall face area + slab replace the
  // regular foundation's coefficient while present.
  const foundationCarbon = basement.present
    ? perimeterFt * basement.heightFt * 16 + floor * 12
    : floor * (foundationCarbonPsf[utilities.foundationType] ?? 10) + stemCarbonExtra;
  const carbonKg = foundationCarbon + foundationRunCarbon + wallCarbon + frameCarbon + flooringCarbon + roofCarbon + (panels > 0 ? 400 : 0) + (batteryKwh > 0 ? 600 : 0);

  // What the reclaimed choices saved vs. buying everything new.
  const reclaimedSavings = {
    cost: (reclaimed.frame ? frameCostRaw - frameCost : 0)
      + (reclaimed.walls ? wallsCostRaw - cost.walls : 0)
      + (reclaimed.flooring ? flooringCostRaw - cost.flooring : 0)
      + (reclaimed.windows ? windowsCostRaw - cost.windows : 0)
      + (reclaimed.roof ? roofCostRaw - cost.roof : 0),
    carbon: (reclaimed.frame ? frameCarbonRaw - frameCarbon : 0)
      + (reclaimed.walls ? wallCarbonRaw - wallCarbon : 0)
      + (reclaimed.flooring ? flooringCarbonRaw - flooringCarbon : 0)
      + (reclaimed.roof ? roofCarbonRaw - roofCarbon : 0),
    count: Object.values(reclaimed).filter(Boolean).length
  };

  return {
    site, utilities, reclaimed, reclaimedSavings, floor, heatedFloor, storeys, basement, basementRoomArea, basementHeated, roofArea, roofFootprint, overhangs, wallArea, glazedWallArea, wallR, southGlass, glassPct,
    skylightArea, totalGlass, glazingU, stemwallHeightFt, azimuthDeg, solarFactor,
    sunWinterDeg, sunSummerDeg, winterShadeFrac, summerShadeFrac,
    frameGround: groundFrameKey, frameUpper: upperFrameKey, frameArea: groundFrameArea + upperFrameArea,
    flooring: flooringKey, subfloor: subfloorKey, subfloorCost,
    roofInsulation: roofInsulKey, floorInsulation: floorInsulKey, roofR, floorR,
    heatLoadKbtu, bedrooms, people, waterGpd, catchmentGpd, supplyGpd, septicGpd,
    peakSunHrs, loadKwhDay, panels, panelRoom, batteryKwh,
    cost, totalBeforeSweat, sweat, total, carbonKg, pitch
  };
}

export const fmtMoney = (value) => `$${Math.round(value).toLocaleString()}`;
export const fmtNum = (value) => Math.round(value).toLocaleString();

export const SYSTEM_GROUPS = [
  { label: 'Land & program', keys: ['site', 'rooms'] },
  { label: 'The building', keys: ['shell', 'foundation', 'frame', 'flooring', 'walls', 'roof', 'windows'] },
  { label: 'Systems', keys: ['heat', 'water', 'waste', 'power', 'outdoors'] }
];

// The cost breakdown reads derived.cost — one row per system, each linked back
// to the page that drives it, so a big number is one tap from the controls.
export const COST_ROWS = [
  { key: 'foundation', label: 'Foundation', system: 'foundation' },
  { key: 'frame', label: 'Frame', system: 'frame' },
  { key: 'flooring', label: 'Floor', system: 'flooring' },
  { key: 'walls', label: 'Walls', system: 'walls' },
  { key: 'roof', label: 'Roof', system: 'roof' },
  { key: 'windows', label: 'Windows & doors', system: 'windows' },
  { key: 'upperFloors', label: 'Upper floors', system: 'shell' },
  { key: 'heat', label: 'Heat', system: 'heat' },
  { key: 'water', label: 'Water', system: 'water' },
  { key: 'waste', label: 'Waste', system: 'waste' },
  { key: 'power', label: 'Power', system: 'power' },
  { key: 'outdoors', label: 'Outdoors', system: 'outdoors' }
];

export const SYSTEM_META = {
  site: {
    label: 'Site',
    why: 'Where the house sits and how it faces the sun — every other system leans on this. Sun angles drive passive solar and panel output; rainfall decides whether a roof can supply your water.',
    feeds: ['Windows', 'Water', 'Power'],
    reads: (dd) => [
      ['Winter noon sun', `${Math.round(dd.sunWinterDeg)}°`, '', 'low — you want it through the glass'],
      ['Summer noon sun', `${Math.round(dd.sunSummerDeg)}°`, '', 'high — the overhang blocks it'],
      ['Peak sun', dd.peakSunHrs.toFixed(1), 'hrs/day', 'drives panel sizing'],
      ['Roof could catch', fmtNum(dd.catchmentGpd), 'gal/day', 'if you choose catchment']
    ]
  },
  rooms: {
    label: 'Rooms',
    why: 'People and rooms seed water use, power draw, and waste sizing. Bedrooms size the septic field.',
    feeds: ['Water', 'Waste', 'Power'],
    reads: (dd) => [
      ['Bedrooms', String(dd.bedrooms), '', 'sizes the septic field'],
      ['Everyday water', fmtNum(dd.waterGpd), 'gal/day', `for about ${dd.people} people`]
    ]
  },
  shell: {
    label: 'Shell',
    why: 'The footprint and storeys set floor, roof, and wall areas — which flow into cost, heat load, panels, and catchment.',
    feeds: ['Walls', 'Roof', 'Heat', 'Power'],
    reads: (dd) => [
      ['Footprint', fmtNum(dd.floor), 'sf', ''],
      ...(dd.storeys > 1 ? [['Heated floor', fmtNum(dd.heatedFloor), 'sf', `${dd.storeys} storeys`]] : []),
      ['Roof surface', fmtNum(dd.roofArea), 'sf', 'shared by panels + catchment'],
      ['Wall area', fmtNum(dd.wallArea), 'sf', '']
    ]
  },
  foundation: {
    label: 'Foundation',
    why: 'What the house sits on sets cost per square foot and a big share of the embodied carbon — a slab carries 2.5× the carbon of a rubble trench.',
    feeds: ['Cost'],
    reads: (dd) => [
      ['This system', fmtMoney(dd.cost.foundation), '', ''],
      ...(dd.utilities.diyFoundation ? [['You save', fmtMoney(dd.cost.foundation * 0.5), '', 'doing it yourself']] : [])
    ]
  },
  frame: {
    label: 'Frame',
    why: 'The structural skeleton between the foundation and the walls. A timber or stick frame carries the roof so the walls can be insulation-only infill; load-bearing walls skip the frame and carry the load themselves.',
    feeds: ['Walls', 'Cost'],
    reads: (dd) => [
      ['Ground frame', FRAME_TYPES[dd.frameGround]?.label.split(' (')[0] || dd.frameGround, '', ''],
      ...(dd.storeys > 1 ? [['Upper frame', FRAME_TYPES[dd.frameUpper]?.label.split(' (')[0] || dd.frameUpper, '', `${dd.storeys} storeys`]] : []),
      ['This system', fmtMoney(dd.cost.frame), '', dd.reclaimed.frame ? 'reclaimed timber' : ''],
      ...(dd.utilities.diyFrame ? [['You save', fmtMoney(dd.cost.frame * 0.6), '', 'raising it yourself']] : [])
    ]
  },
  flooring: {
    label: 'Floor',
    why: 'The floor assembly: the structural subfloor deck (a slab is its own; a raised foundation needs a joisted deck) plus the finished floor. Earthen, tile, and stone add thermal mass; wood, cork, and bamboo are warmer underfoot. Reclaimed boards are a cheap carbon win.',
    feeds: ['Cost'],
    reads: (dd) => [
      ['Subfloor', (SUBFLOOR_TYPES[dd.subfloor]?.label || dd.subfloor).split(' —')[0], '', ''],
      ['Finish', FLOORING_TYPES[dd.flooring]?.label || dd.flooring, '', dd.reclaimed.flooring ? 'reclaimed' : ''],
      ['This system', fmtMoney(dd.cost.flooring), '', `${fmtNum(dd.heatedFloor)} sf`]
    ]
  },
  walls: {
    label: 'Walls',
    why: 'The single biggest lever on insulation, cost, carbon, and how much you can build yourself. Wall R-value sets your heat load; thickness sets how tall an earthen wall may be.',
    feeds: ['Heat', 'Cost'],
    reads: (dd) => [
      ['Insulation', `R-${Math.round(dd.wallR)}`, '', 'area-weighted across sides'],
      ['This system', fmtMoney(dd.cost.walls), '', ''],
      ...(dd.utilities.diyWalls ? [['You save', fmtMoney(dd.cost.walls * 0.8), '', 'raising them yourself']] : []),
      ['Embodied carbon', fmtNum(dd.carbonKg / 1000), 't CO₂e', 'whole build, directional']
    ]
  },
  roof: {
    label: 'Roof',
    why: 'Roof area caps your solar panels and feeds rain catchment; the overhang shades summer sun and shields earthen walls.',
    feeds: ['Power', 'Water', 'Heat'],
    reads: (dd) => [
      ['Roof surface', fmtNum(dd.roofArea), 'sf', 'grows with pitch + overhang'],
      ['Smallest overhang', dd.overhangs.min.toFixed(1), 'ft', dd.overhangs.min >= 2 ? 'protects the walls' : 'too shallow for plastered walls'],
      ['Summer shading', `${Math.round(dd.summerShadeFrac * 100)}%`, 'of south glass', `sun at ${Math.round(dd.sunSummerDeg)}° — more is cooler`],
      ['Winter shading', `${Math.round(dd.winterShadeFrac * 100)}%`, 'of south glass', `sun at ${Math.round(dd.sunWinterDeg)}° — less is warmer`],
      ['Panel room', `~${dd.panelRoom}`, 'panels', ''],
      ['This system', fmtMoney(dd.cost.roof), '', '']
    ]
  },
  windows: {
    label: 'Windows',
    why: 'South glass against floor area decides free winter heat — too little wastes the sun, too much overheats. 7–12% of the floor is the sweet spot. Triple glazing halves what the glass leaks back out.',
    feeds: ['Heat'],
    reads: (dd) => [
      ['South glass', fmtNum(dd.southGlass), 'sf', ''],
      ['Of floor area', `${dd.glassPct.toFixed(1)}%`, '', dd.glassPct >= 7 && dd.glassPct <= 12 ? 'in the passive-solar range' : 'target 7–12%'],
      ['Winter sun reaching it', `${Math.round((1 - dd.winterShadeFrac) * 100)}%`, '', `noon sun at ${Math.round(dd.sunWinterDeg)}° under the overhang`],
      ...(dd.skylightArea > 0 ? [['Skylights', fmtNum(dd.skylightArea), 'sf', 'roof glass leaks heat both ways']] : []),
      ['This system', fmtMoney(dd.cost.windows), '', dd.utilities.windowQuality === 'triple' ? 'triple pane' : 'double pane']
    ]
  },
  heat: {
    label: 'Heat',
    why: 'Your walls, roof, and windows set the heat load below; whatever heater you pick has to cover it.',
    feeds: ['Power', 'Cost'],
    reads: (dd) => [
      ['Design heat load', dd.heatLoadKbtu.toFixed(1), 'kBTU/hr', 'from your walls + windows'],
      ['This system', fmtMoney(dd.cost.heat), '', '']
    ]
  },
  water: {
    label: 'Water',
    why: 'A well needs power for its pump; catchment leans on your roof area and rainfall. What you can get has to cover what you use.',
    feeds: ['Power', 'Waste'],
    reads: (dd) => [
      ['You will use', fmtNum(dd.waterGpd), 'gal/day', `about ${dd.people} people`],
      ['Source gives', Number.isFinite(dd.supplyGpd) ? fmtNum(dd.supplyGpd) : 'town main', Number.isFinite(dd.supplyGpd) ? 'gal/day' : '', Number.isFinite(dd.supplyGpd) ? (dd.supplyGpd >= dd.waterGpd ? 'covers the household' : 'falls short') : ''],
      ['This system', fmtMoney(dd.cost.water), '', dd.utilities.tankGal > 0 ? `${fmtNum(dd.utilities.tankGal)} gal storage` : '']
    ]
  },
  waste: {
    label: 'Waste',
    why: 'A septic field must sit at least 100 ft from a well, and bedrooms size the field. Composting sidesteps most of it.',
    feeds: ['Water', 'Site'],
    reads: (dd) => [
      ['Design flow', fmtNum(dd.septicGpd), 'gal/day', `${dd.bedrooms} bedroom${dd.bedrooms === 1 ? '' : 's'} × 110`],
      ['This system', fmtMoney(dd.cost.waste), '', '']
    ]
  },
  power: {
    label: 'Power',
    why: 'Everything in the house that draws electricity collects here, then panels are sized against your roof and sun.',
    feeds: ['Roof', 'Cost'],
    reads: (dd) => [
      ['You use', dd.loadKwhDay.toFixed(1), 'kWh/day', dd.utilities.heatSource === 'minisplit' ? 'includes the mini-split' : dd.utilities.waterSource === 'well' ? 'includes the well pump' : ''],
      ['Panels needed', dd.panels > 0 ? String(dd.panels) : '—', '', dd.panels === 0 ? 'grid only' : dd.panels <= dd.panelRoom ? 'fits the roof' : 'more than the roof holds'],
      ['Battery', dd.batteryKwh > 0 ? String(dd.batteryKwh) : '—', dd.batteryKwh > 0 ? 'kWh' : '', ''],
      ['This system', fmtMoney(dd.cost.power), '', '']
    ]
  },
  outdoors: {
    label: 'Outdoors',
    why: 'The rest of the homestead — gardens, coop, root cellar, workshop. Each lands on the site with its own separation rules and cost.',
    feeds: ['Site', 'Cost'],
    reads: (dd) => [['These items', fmtMoney(dd.cost.outdoors), '', '']]
  }
};

export function buildingSnapshot(spec, issues) {
  const enclosedRooms = spec.rooms.filter((room) => room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt);
  const shellArea = Math.round(spec.shell.widthFt * spec.shell.depthFt);
  const roomArea = enclosedRooms.reduce((sum, room) => sum + room.w * room.d, 0);
  return {
    shellArea,
    roomArea,
    shell: `${spec.shell.widthFt}' x ${spec.shell.depthFt}' with ${spec.shell.wallHeightFt}' walls`,
    rooms: spec.rooms.map((room) => `${room.name} ${room.w}' x ${room.d}'`).join(', '),
    elements: (spec.elements || []).map((element) => `${element.name} (${element.category})`).join(', ') || 'no natural-building elements added yet',
    issues: issues.filter((issue) => issue.severity !== 'pass')
  };
}

export function expertResponse(expert, question, spec, issues, selectedRoom) {
  const snapshot = buildingSnapshot(spec, issues);
  const room = spec.rooms.find((item) => item.id === selectedRoom) || (spec.elements || []).find((item) => item.id === selectedRoom) || spec.rooms[0];
  const lower = question.toLowerCase();
  const issueText = snapshot.issues.length
    ? snapshot.issues.map((issue) => `${issue.title}: ${issue.fix}`).join(' ')
    : 'I do not see a blocking schematic issue from the current automated checks.';
  const askContext = lower.includes('selected') || lower.includes('room') || lower.includes(room?.name.toLowerCase() || '')
    ? `For the selected ${room.name}, I would treat its ${room.w}' x ${room.d}' footprint and role as provisional until the building, site, structure, moisture, and daily use are checked together.`
    : `The current shell is ${snapshot.shell}, with about ${snapshot.roomArea} sf of enclosed room zones inside a ${snapshot.shellArea} sf footprint. Natural-building elements currently added: ${snapshot.elements}.`;

  const voices = {
    designer: `As the designer, I am looking first at daily movement, light, and whether the plan feels calm to live in. ${askContext} I would check the path from entry to kitchen, mud/laundry, bath, and great room, then tune openings so daylight lands where people actually spend time. ${issueText}`,
    artist: `As the artist, I am reading this as a composition of solid, void, light, and material. ${askContext} I would simplify the strongest visual idea: a grounded base, a clear roof, and one or two memorable material contrasts rather than many competing gestures. ${issueText}`,
    engineer: `As the engineer, I am asking where loads go and what needs calculation before anyone trusts this. ${askContext} The next professional pass should identify spans, bearing lines, shear walls, foundation thickening, roof thrust or truss assumptions, and any concentrated loads from hearth or masonry. ${issueText}`,
    architect: `As the architect, I am testing whether this can become a coherent permit set. ${askContext} I would document occupancy assumptions, egress, smoke/CO locations, wet wall coordination, envelope sections, door/window schedules, and local code constraints before calling it stamp-track ready. ${issueText}`,
    sculptor: `As the sculptor, I am judging the massing and the way the building meets the ground. ${askContext} I would keep the main form legible, then use porch, greenhouse, or service attachments as secondary masses that make the approach and roofline clearer. ${issueText}`,
    natural: `As the natural builder, I am watching moisture, drying potential, toxicity, and repairability. ${askContext} Natural assemblies can work beautifully, but they need capillary breaks, rainscreen drying, generous roof protection, and details that keep bulk water out. ${issueText}`,
    permaculture: `As the permaculture voice, I am reading sun, water, wind, soil, and work patterns. ${askContext} I would place water catchment, greywater routing, greenhouse separation, compost, wood, garden access, and summer shade as one connected site system. ${issueText}`,
    homestead: `As the homestead/farm reviewer, I care about dirty boots, tools, animals, food storage, firewood, and how tired people move at the end of a workday. ${askContext} Keep the service entry, laundry, pantry, freezer/root storage, and outdoor work zones close without dragging mess through sleeping or quiet spaces. ${issueText}`,
    pm: `As the project manager, I am separating decisions from wishes. ${askContext} I would turn this into a decision log: fixed footprint, target budget, climate zone, structural system, envelope assembly, utility assumptions, required drawings, and who signs each discipline. ${issueText}`
  };

  return voices[expert.id] || `${expert.name}: ${askContext} ${issueText}`;
}

export function wholeTeamResponse(question, spec, issues, selectedRoom) {
  const priority = ['architect', 'engineer', 'designer', 'natural', 'permaculture', 'homestead', 'pm'];
  return priority
    .map((id) => {
      const expert = expertCouncil.find((item) => item.id === id);
      return `${expert.name}: ${expertResponse(expert, question, spec, issues, selectedRoom)}`;
    })
    .join('\n\n');
}

export function reviseSpec(spec) {
  const next = structuredClone(spec);
  next.revision += 1;
  const issues = detectIssues(next);
  for (const issue of issues) {
    if (issue.title.includes('south-facing')) {
      next.openings.push({ type: 'window', wall: 'south', x: Math.round(next.shell.widthFt * 0.55), widthFt: 5, label: 'Added Solar Window' });
    }
    if (issue.title.includes('dirty entry')) {
      upsertRoom(next, { id: 'mud', name: 'Mud/Laundry', x: next.shell.widthFt - 10, y: 0, w: 10, d: 10, type: 'service', floor: 'tile' });
    }
    if (issue.title.includes('wet core')) {
      upsertRoom(next, { id: 'bath', name: 'Bath Core', x: next.shell.widthFt / 2 - 4, y: 0, w: 8, d: 10, type: 'wet', floor: 'tile' });
    }
    if (issue.title.includes('Room program')) {
      next.shell.widthFt = Math.ceil(next.shell.widthFt * 1.1);
      next.shell.depthFt = Math.ceil(next.shell.depthFt * 1.06);
    }
  }
  return next;
}

// Element fill colors for the 2D plan (mirrors the 3D elementPalette).
export const PLAN_ELEMENT_HEX = {
  wall: '#9f7d54', earthwork: '#7d684f', structure: '#74553d', roof: '#55766f',
  passive: '#b08b4f', thermal: '#9a5944', water: '#4c88a0', plant: '#6f9b61',
  homestead: '#8e7049', landscape: '#6d8c55', storage: '#8a7768', site: '#9a8f70',
  garden: '#5f8d49', animal: '#b0895b', floor: '#8d8473', loft: '#6f7f6a',
  tower: '#7a5f49', outbuilding: '#a08a5f', foundation: '#8f8b80', partition: '#6b6257',
  chimney: '#9a5944', deck: '#8e7049', custom: '#8b786d'
};

// 🌿 marks green/natural methods and materials in every options list, with a
// green tint where the control allows it. Standard options sit unmarked
// alongside — both are always offered.
export const greenLeaf = (item) => (item?.green ? '🌿 ' : '');
export const greenOptStyle = (item) => (item?.green ? { color: '#2f7d46' } : undefined);

// Label ink by fill luminance — dark ink on light fills, paper ink on dark
// fills (slab plates, partitions, chimneys were unreadable with dark-on-dark).
export function planLabelInk(hex) {
  const n = parseInt(String(hex || '#8a7768').slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? '#1a1f1d' : '#f4f1e6';
}

// Zone fill colors as hex strings for the 2D plan (mirrors the 3D zonePalette).
export const PLAN_ZONE_HEX = {
  living: '#79a7a8', service: '#be9b6f', sleeping: '#8f9cc2', wet: '#78a9c8',
  work: '#9ca66a', plant: '#7fbf78', storage: '#9a8575', outdoor: '#9a8f70',
  site: '#9a8f70', garden: '#5f8d49', animal: '#b0895b', paddock: '#b0895b',
  run: '#b0895b', landscape: '#6d8c55', homestead: '#8e7049'
};

// Top-down 2D floor-plan editor: drag rooms to move, drag corners to resize,
// snapped to 0.5 ft. Commits on drop via onMove / onResize. This is the
// natural surface for laying out a first floor.
// Parametric 2D connection details — real cross-sections drawn from the live
// spec, so editing a thickness / stem height / overhang in the fields beside
// the drawing redraws the joint. Feet are the SVG unit.
export const hexOf = (color) => `#${Number(color || 0x8a8a8a).toString(16).padStart(6, '0')}`;
