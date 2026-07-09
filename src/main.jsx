import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { pushToBlender, exportIfcViaBlender } from './blenderBridge.js';
import { OPENING_TYPES } from '../backend/bim-core.mjs';
import {
  AlertTriangle,
  Box,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Coins,
  Download,
  FileText,
  FileJson,
  Grid3X3,
  Hammer,
  ImagePlus,
  Layers,
  Leaf,
  Plus,
  PenTool,
  Play,
  RefreshCcw,
  Ruler,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Tractor,
  TreePine,
  Trash2,
  Undo2,
  Upload,
  Users,
  Wrench
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './styles.css';

const MM_PER_FOOT = 304.8;
const DASHBOARD_STORAGE_KEY = 'natural-building-design-dashboard-state-v1';
const DEFAULT_PROMPT = '';
const DEFAULT_EXPERT_QUESTION = 'What should I worry about before taking this design further?';
const DEFAULT_CHAT_MESSAGES = [];
const WELCOME_CHAT_TEXT = 'Tell me what to change, attach sketches, or choose an expert/team target and ask for plain-language advice.';
const DEFAULT_SITE_PAD_EXTENSION_FT = 64;
const DEFAULT_OUTDOOR_GRID_SIZE_FT = 240;
const OUTDOOR_SPACE_TYPES = new Set(['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead']);

const expertCouncil = [
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

const addToTargets = [
  { value: 'auto', label: 'Auto' },
  { value: 'house', label: 'Whole house' },
  { value: 'selected', label: 'Selected item' },
  { value: 'openings', label: 'Windows / doors' },
  { value: 'roof', label: 'Roof' },
  { value: 'assemblies', label: 'Assemblies' },
  { value: 'site', label: 'Site' },
  { value: 'outputs', label: 'Outputs' }
];

const elementLibrary = [
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

const seedSpec = {
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

function loadSavedDashboardState() {
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

function compactHistoryForStorage(history) {
  return history.slice(0, 30).map((entry) => ({
    spec: entry.spec,
    selectedRoom: entry.selectedRoom
  }));
}

function compactChatForStorage(messages) {
  return messages
    .filter((message) => message.text !== WELCOME_CHAT_TEXT)
    .slice(-40)
    .map(({ role, speaker, text }) => ({ role, speaker, text }));
}

function cleanSavedChatMessages(messages) {
  return (messages || DEFAULT_CHAT_MESSAGES).filter((message) => message.text !== WELCOME_CHAT_TEXT);
}

const workflowStages = [
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

function createProjectBrain(spec) {
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

function ensureProjectBrain(brain, spec) {
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

function updateProjectBrainAfterOperation(brain, spec, event) {
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

function buildContextPacket(spec, projectBrain, selected, exactTask = '') {
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function padExtension(shell = {}) {
  return Math.max(0, Number(shell.padExtensionFt ?? DEFAULT_SITE_PAD_EXTENSION_FT));
}

function sitePadRect(spec) {
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

function objectBounds(spec, object) {
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

function clampObjectPosition(spec, object, x, y) {
  const bounds = objectBounds(spec, object);
  const w = Math.max(0, Number(object?.w || 0));
  const d = Math.max(0, Number(object?.d || 0));
  return {
    x: clamp(Math.round(x * 10) / 10, bounds.minX, Math.max(bounds.minX, bounds.maxX - w)),
    y: clamp(Math.round(y * 10) / 10, bounds.minY, Math.max(bounds.minY, bounds.maxY - d))
  };
}

function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function feetToMm(value) {
  return Math.round(value * MM_PER_FOOT);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'space';
}

function findRoom(spec, label) {
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

function titleCase(value) {
  return value
    .replace(/[-_/]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function cleanDesignPhrase(value) {
  return value
    .toLowerCase()
    .replace(/\b(please|can you|could you|would you|i want|we need|need|want|include|create|build|place|put|add|make|set|resize|change|revise|design|a|an|the|some|more|with|and|into|for|to|at|room|space|area|zone)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDesignLabel(value) {
  return value
    .toLowerCase()
    .replace(/\bbederoom\b/g, 'bedroom')
    .replace(/\bbr\b/g, 'bedroom')
    .replace(/\bprimary bed\b/g, 'primary bedroom')
    .replace(/\bmaster\b/g, 'primary')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomProfile(name) {
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

function targetLocationForPhrase(spec, object, phrase) {
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

function dimensionsFromText(text, fallback) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?/);
  if (!match) return fallback;
  return { w: Number(match[1]), d: Number(match[2]) };
}

function isDrawingReferenceIntent(text) {
  return /\b(per|from|based on|match|trace|shown in|according to)\s+(?:the\s+)?(?:drawing|drawings|sketch|sketches|image|images|photo|photos|plan|plans)\b/.test(text)
    || /\b(?:drawing|drawings|sketch|sketches|image|images|photo|photos|plan|plans)\b/.test(text) && /\b(?:window|windows|door|doors|opening|openings|wall|walls|trace|match)\b/.test(text);
}

function isOpeningIntent(text) {
  return /\b(window|windows|door|doors|slider|sliders|sliding door|opening|openings|glazing|egress)\b/.test(text);
}

function hasOpeningPlacementData(text) {
  return /\b(north|south|east|west|n|s|e|w)\b/.test(text)
    && (
      /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:wide|window|door|slider|opening)/.test(text)
      || /\badd\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s+(?:north|south|east|west|n|s|e|w)\s+(?:window|door|slider|opening)\b/.test(text)
    );
}

function isRoofIntent(text) {
  return /\b(roof|shed roof|lean[-\s=]*to|single slope|mono[-\s]*pitch|roofline|rafter|pitch)\b/.test(text);
}

function roofProfile(shell = {}) {
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
function storeyInfo(shell = {}) {
  const storeys = Math.min(3, Math.max(1, Number(shell.storeys || 1)));
  const baseWallFt = Number(shell.wallHeightFt || 10);
  return { storeys, baseWallFt, extraFt: (storeys - 1) * baseWallFt };
}

// How many floors the plan has = whichever is larger: the storeys setting, or
// the highest floor any room actually lives on.
function floorCount(spec) {
  const byStoreys = Math.ceil(Number(spec.shell?.storeys || 1));
  const byRooms = Math.max(1, ...(spec.rooms || []).map((r) => Number(r.level || 1)));
  return Math.max(1, byStoreys, byRooms);
}

function floorLabel(spec, floor) {
  if (floor === 1) return 'Ground';
  if (floor === 2 && Number(spec.shell?.storeys) === 1.5) return 'Loft';
  const ord = { 2: '2nd', 3: '3rd', 4: '4th' };
  return `${ord[floor] || floor + 'th'} floor`;
}

const UTILITY_DEFAULTS = {
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
function resolveOverhangs(shell = {}) {
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
const OUTDOOR_ITEMS = [
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

function outdoorItemPresent(spec, item) {
  return (spec.elements || []).some((element) => element.name === item.name);
}

// Interior fixtures & equipment that live inside the house as placed objects —
// draggable in the 2D plan and rendered in 3D. The heater name follows the
// chosen heat source so "the heater" is a real object you can position.
const HEATER_NAMES = { rocket_mass: 'Rocket Mass Heater', masonry: 'Masonry Heater', wood_stove: 'Wood Stove', minisplit: 'Mini-Split Unit' };
const HEATER_SIZES = { rocket_mass: [6, 3], masonry: [4, 4], wood_stove: [3, 2.5], minisplit: [3, 1] };
function interiorFixtures(spec) {
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
const ROOM_PRESETS = [
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
const FIX_LABELS = {
  'add-wet-core': 'Add a bathroom',
  'add-mudroom': 'Add a mudroom',
  'add-south-entry': 'Add a south door',
  'add-south-glass': 'Add south glazing',
  'add-stair': 'Add a stair',
  'raise-stemwall': 'Raise stem wall to 18″',
  'well-septic': 'Set 100 ft separation',
  'deepen-overhang': 'Deepen overhangs to 2 ft',
  'reduce-south-overhang': 'Trim south overhang to 2.5 ft',
  'thicken-bale-wall': 'Thicken the wall'
};

// Give a new room a non-colliding display name (Bedroom, Bedroom 2, ...).
function uniqueRoomName(spec, base) {
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
function packRooms(rooms, shellW) {
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
const ROOM_SYNONYMS = [
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

const WORD_COUNTS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, another: 1 };

// Parse a plain "add a bedroom" / "add two bedrooms 12x14 and a kitchen" chat
// line into room specs — the instant local path that skips the slow planner.
// Returns null if the text isn't a simple add-room request (so it falls
// through to the full planner / Gemini).
function parseLocalRoomAdds(text) {
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

function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.d + gap && a.y + a.d + gap > b.y;
}

// Find the first free spot for a w×d room inside the shell that doesn't collide
// with existing rooms — so adding a room never has to disturb the others.
function findFreeSpot(shellW, shellD, rooms, w, d) {
  const margin = 1;
  const gap = 0.5;
  for (let y = margin; y + d <= shellD - margin + 0.01; y += 1) {
    for (let x = margin; x + w <= shellW - margin + 0.01; x += 1) {
      const cand = { x, y, w, d };
      if (!rooms.some((r) => rectsOverlap(cand, r, gap))) return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
    }
  }
  return null;
}

// Place one or more NEW rooms without moving any existing room: each drops into
// the first free gap; if none fits, the house grows (down, and wider if the
// room itself is too wide) and the room lands in the new space. Returns add ops
// + any shell-grow ops, plus whether it grew.
function planNewRoomPlacements(spec, newRooms, level = 1) {
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
    let spot = findFreeSpot(shellW, shellD, virtualRooms, nr.w, nr.d);
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

// Build the operation list that tidies the current rooms into a plan and grows
// the shell to hold them if needed.
function arrangeRoomsPlan(spec) {
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
const DEFAULT_MODEL_LAYERS = {
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
  hiddenCats: []
};

// --- Build mode: construction phases + maintenance (salvaged from the
// add-on's constructionTimeline.js, adapted to the current design) ---------
const BUILD_PHASES_BASE = [
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

const MAINTENANCE_TASKS = [
  { interval: 'Annual', title: 'Rubble trench drain flushing', desc: 'Flush the perimeter drain with a hose to clear silt.', when: (spec, u) => u.foundationType === 'rubble' },
  { interval: 'Annual', title: 'Roof flashing check', desc: 'Inspect cladding joints and flue flashing before winter.', when: () => true },
  { interval: 'Annual', title: 'Plaster crack patching', desc: 'Patch hairline cracks in exterior lime plaster.', when: (spec) => WALL_SIDES.some((side) => resolveWallSide(spec, side).assemblyKey !== 'framed') },
  { interval: '5-year', title: 'Lime-wash refresh', desc: 'Fresh breathable coating on exposed natural walls.', when: (spec) => WALL_SIDES.some((side) => resolveWallSide(spec, side).assemblyKey !== 'framed') },
  { interval: '10-year', title: 'Battery health check', desc: 'Full load diagnostic on the solar bank; inspect terminals.', when: (spec, u) => u.powerMode === 'offgrid' }
];

// Adapt the base phases to what this design actually is.
function buildTimeline(spec, derived) {
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

// Directional materials takeoff from the real quantities.
function materialsTakeoff(spec, derived) {
  const u = derived.utilities;
  const rows = [];
  const perimeter = 2 * ((Number(spec.shell.widthFt) || 0) + (Number(spec.shell.depthFt) || 0));
  if (u.foundationType === 'rubble') rows.push(['Drain rock', `${Math.round(perimeter * 1.5 * 3 / 27)} yd³`, 'perimeter trench 18" × 36"']);
  if (u.foundationType === 'stemwall') rows.push(['Concrete (stem + footing)', `${Math.round((perimeter * derived.stemwallHeightFt * 0.67 + perimeter * 1.33 * 0.83) / 27)} yd³`, `${derived.stemwallHeightFt}' stem on footing`]);
  if (u.foundationType === 'slab') rows.push(['Concrete (slab)', `${Math.round(derived.floor * 0.33 / 27)} yd³`, '4" slab over insulation']);
  const baleArea = WALL_SIDES.map((side) => resolveWallSide(spec, side)).filter((r) => !r.omitted && r.assemblyKey === 'straw-bale')
    .reduce((sum, r) => sum + (r.side === 'north' || r.side === 'south' ? Number(spec.shell.widthFt) : Number(spec.shell.depthFt)) * r.heightFt, 0);
  if (baleArea > 0) rows.push(['Straw bales', `~${Math.ceil(baleArea / 5.5)}`, 'two-string, laid flat — plus 15% spares']);
  const naturalFaces = WALL_SIDES.map((side) => resolveWallSide(spec, side)).filter((r) => !r.omitted && r.assemblyKey !== 'framed')
    .reduce((sum, r) => sum + (r.side === 'north' || r.side === 'south' ? Number(spec.shell.widthFt) : Number(spec.shell.depthFt)) * r.heightFt * 2, 0);
  if (naturalFaces > 0) rows.push(['Plaster (3 coats)', `${Math.round(naturalFaces)} sf`, 'both faces of natural walls']);
  rows.push(['Roof cladding + sheathing', `${Math.round(derived.roofArea)} sf`, 'includes overhangs and pitch']);
  rows.push(['Glazing', `${Math.round(derived.totalGlass)} sf`, u.windowQuality === 'triple' ? 'triple pane' : 'double pane']);
  if (derived.panels > 0) rows.push(['Solar panels', `${derived.panels} × 400 W`, `${derived.batteryKwh > 0 ? `+ ${derived.batteryKwh} kWh battery` : 'grid-tied'}`]);
  if (spec.systems?.structure?.toLowerCase().includes('timber')) rows.push(['Timber posts', `~${Math.ceil(perimeter / 8)}`, 'one bent post per 8 lf of perimeter']);
  return rows;
}

const LAYER_PRESETS = {
  all: { ...DEFAULT_MODEL_LAYERS },
  structure: { ...DEFAULT_MODEL_LAYERS, rooms: false, openings: false, elements: false, labels: false },
  plan: { ...DEFAULT_MODEL_LAYERS, roof: false, upperFloors: false, wallNorth: false, wallSouth: false, wallEast: false, wallWest: false, openings: false },
  interior: { ...DEFAULT_MODEL_LAYERS, roof: false, xray: true },
  site: { ...DEFAULT_MODEL_LAYERS, roof: true, rooms: false, openings: false, labels: false }
};

const SITE_DEFAULTS = { zip: '', placeName: '', latitudeDeg: 43, rainInYr: 38 };

function siteOf(spec) {
  return { ...SITE_DEFAULTS, ...(spec.site || {}) };
}

function utilitiesOf(spec) {
  return { ...UTILITY_DEFAULTS, ...(spec.utilities || {}) };
}

// Offline ZIP -> region estimate (the assistant/geocoder refines this later).
function zipRegionInfo(zip) {
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

function directionalHeightFromText(text, directionWords) {
  const directionPattern = directionWords.join('|');
  const afterDirection = new RegExp(`\\b(?:${directionPattern})\\b[^.;\\n]{0,70}?(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')`, 'i');
  const beforeDirection = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')[^.;\\n]{0,70}?\\b(?:${directionPattern})\\b`, 'i');
  return text.match(afterDirection)?.[1] || text.match(beforeDirection)?.[1] || null;
}

function applyRoofInstruction(spec, text) {
  if (!isRoofIntent(text)) return null;
  const shell = spec.shell;
  const wantsShed = /\b(shed|lean[-\s=]*to|single slope|mono[-\s]*pitch)\b/.test(text);
  const southHeight = directionalHeightFromText(text, ['south', 's']);
  const northHeight = directionalHeightFromText(text, ['north', 'n']);
  const genericHeights = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/g)].map((match) => Number(match[1]));

  if (wantsShed || southHeight || northHeight) shell.roofType = 'shed';
  if (southHeight) shell.southWallHeightFt = clamp(Number(southHeight), 7, 24);
  if (northHeight) shell.northWallHeightFt = clamp(Number(northHeight), 7, 24);
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

function openingRequestNeedsTrace(text) {
  return isOpeningIntent(text) && isDrawingReferenceIntent(text) && !hasOpeningPlacementData(text);
}

function classifyDesignRequest(prompt, attachedImages = [], addToTarget = 'auto', selectedObject = null) {
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

function addOpeningFromText(spec, text) {
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

function getWallSections(spec) {
  const layout = {
    north: { name: 'North Wall', lengthFt: spec.shell.widthFt, x: 0, y: 0 },
    south: { name: 'South Wall', lengthFt: spec.shell.widthFt, x: 0, y: spec.shell.depthFt },
    west: { name: 'West Wall', lengthFt: spec.shell.depthFt, x: 0, y: 0 },
    east: { name: 'East Wall', lengthFt: spec.shell.depthFt, x: spec.shell.widthFt, y: 0 }
  };
  return WALL_SIDES
    .map((side) => ({ side, ...layout[side], resolved: resolveWallSide(spec, side) }))
    .filter((wall) => !wall.resolved.omitted)
    .map((wall) => {
      const r = wall.resolved;
      return {
        id: `wall-${wall.side}`,
        name: wall.name,
        side: wall.side,
        lengthFt: wall.lengthFt,
        heightFt: r.heightFt,
        x: wall.x,
        y: wall.y,
        category: 'wall-section',
        type: 'wall',
        w: wall.side === 'north' || wall.side === 'south' ? wall.lengthFt : r.thicknessFt,
        d: wall.side === 'east' || wall.side === 'west' ? wall.lengthFt : r.thicknessFt,
        h: r.heightFt,
        assembly: r.assembly.label,
        assemblyKey: r.assemblyKey,
        thicknessFt: r.thicknessFt,
        rValue: r.assembly.rValue,
        interiorFinish: r.interiorFinish,
        exteriorFinish: r.exteriorFinish,
        note: `${r.assembly.label} (R≈${r.assembly.rValue}, ${r.thicknessFt.toFixed(2)}' thick); ${wall.lengthFt}' long, ${r.heightFt}' high. Interior: ${r.interiorFinish}. Openings on this side: ${spec.openings.filter((opening) => opening.wall === wall.side).length}.`
      };
    });
}

function getSpecialBimObjects(spec) {
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

function nextRoomLocation(spec, width, depth, roomName) {
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

function allLibraryItems() {
  return elementLibrary.flatMap((group) => group.items.map((item) => ({ ...item, sourceCategory: group.category })));
}

function libraryAliases() {
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

function textMatchesLibraryItem(text, item) {
  const itemName = item.name.toLowerCase();
  if (text.includes(itemName)) return true;
  const aliasSet = libraryAliases().find(([name]) => itemName === name);
  return Boolean(aliasSet?.[1].some((alias) => text.includes(alias)));
}

function matchingLibraryItems(text) {
  const items = allLibraryItems();
  return items.filter((item) => textMatchesLibraryItem(text, item));
}

function matchingLibraryItem(text) {
  return matchingLibraryItems(text)[0] || null;
}

function systemFieldForLibraryItem(item) {
  const name = item.name.toLowerCase();
  if (item.kind === 'wall' || /wall|straw|hemp|cob|cordwood|earth/.test(name)) return 'envelope';
  if (item.kind === 'structure' || /timber frame|post and beam|roundhouse|yurt/.test(name)) return 'structure';
  if (item.kind === 'roof' || /roof|eave|veranda/.test(name)) return 'structure';
  if (item.kind === 'thermal' || item.kind === 'passive' || /heater|trombe|sunspace|solar|thermal/.test(name)) return 'energy';
  if (item.kind === 'water' || /water|cistern|greywater|reed/.test(name)) return 'water';
  return 'notes';
}

function looksLikeSystemChange(text) {
  return /\b(all|whole|change|switch|convert|make|set|use|wall|walls|structure|frame|envelope|assembly|system|roof|energy|water)\b/.test(text);
}

function appliedSystemText(item) {
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

function wallAssemblyProfile(envelopeText = '') {
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
const WALL_SIDES = ['north', 'south', 'east', 'west'];
const WALL_SIDE_LABELS = { north: 'North', south: 'South', east: 'East', west: 'West' };

const WALL_ASSEMBLIES = {
  'straw-bale':       { key: 'straw-bale',       label: 'Straw Bale',          thicknessFt: 1.6,  color: 0xd8bf79, rValue: 33, finish: 'lime / clay plaster' },
  'hemp-lime':        { key: 'hemp-lime',        label: 'Hemp-Lime',           thicknessFt: 1.25, color: 0xb9c49b, rValue: 22, finish: 'vapor-open plaster' },
  'cob':              { key: 'cob',              label: 'Cob',                 thicknessFt: 1.8,  color: 0xb9835e, rValue: 14, finish: 'earthen plaster' },
  'rammed-earth':     { key: 'rammed-earth',     label: 'Rammed Earth',        thicknessFt: 1.35, color: 0x9d7456, rValue: 12, finish: 'sealed / waxed earth' },
  'cordwood':         { key: 'cordwood',         label: 'Cordwood',            thicknessFt: 1.25, color: 0x9b7652, rValue: 18, finish: 'lime mortar joints' },
  'light-straw-clay': { key: 'light-straw-clay', label: 'Light Straw-Clay',    thicknessFt: 1.0,  color: 0xc6b077, rValue: 20, finish: 'clay plaster' },
  'framed':           { key: 'framed',           label: 'Framed (vapor-open)', thicknessFt: 0.55, color: 0xd9d5c8, rValue: 23, finish: 'plaster / cladding' }
};

function wallAssemblyKeyFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/light straw|straw.?clay/.test(t)) return 'light-straw-clay';
  if (/straw bale|strawbale|straw/.test(t)) return 'straw-bale';
  if (/hemp/.test(t)) return 'hemp-lime';
  if (/cob/.test(t)) return 'cob';
  if (/rammed/.test(t)) return 'rammed-earth';
  if (/cordwood/.test(t)) return 'cordwood';
  return 'framed';
}

function resolveWallSide(spec, side) {
  const shell = spec.shell || {};
  const w = (spec.walls || {})[side] || {};
  const assemblyKey = w.assembly && WALL_ASSEMBLIES[w.assembly] ? w.assembly : wallAssemblyKeyFromText(spec.systems?.envelope);
  const assembly = WALL_ASSEMBLIES[assemblyKey] || WALL_ASSEMBLIES.framed;
  const defaultHeight = side === 'south' ? Number(shell.southWallHeightFt || shell.wallHeightFt || 10)
    : side === 'north' ? Number(shell.northWallHeightFt || shell.wallHeightFt || 10)
      : Number(shell.wallHeightFt || 10);
  const omittedSet = new Set(shell.omittedWalls || []);
  return {
    side,
    heightFt: Number(w.heightFt ?? defaultHeight),
    assemblyKey,
    assembly,
    thicknessFt: Number(w.thicknessFt ?? assembly.thicknessFt),
    interiorFinish: w.interiorFinish || assembly.finish,
    exteriorFinish: w.exteriorFinish || 'rainscreen / lime render',
    omitted: Boolean(w.omitted) || omittedSet.has(side)
  };
}

// True when any side carries a per-wall override (drives the "mixed" hint).
function wallsAreMixed(spec) {
  const resolved = WALL_SIDES.map((side) => resolveWallSide(spec, side));
  const keys = new Set(resolved.map((r) => r.assemblyKey));
  const heights = new Set(resolved.map((r) => Math.round(r.heightFt * 10)));
  return keys.size > 1 || heights.size > 1;
}

function applyLibraryItemToSystems(spec, item) {
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

function applyNaturalLanguageDesign(prompt, currentSpec, attachedImages = [], addToTarget = 'auto', selectedObject = null) {
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

function parsePromptToSpec(prompt, currentSpec, attachedImages = []) {
  return applyNaturalLanguageDesign(prompt, currentSpec, attachedImages).spec;
}

function interpreterSummary(report) {
  const opening = report.actions.length
    ? `Done — here's what changed:\n${report.actions.slice(0, 8).map((action) => `- ${action}`).join('\n')}`
    : `I couldn't turn that into a change to the house, so nothing was altered.${report.plan?.missing?.length ? ` To do it I still need: ${report.plan.missing.join(', ')}.` : ''} Try a direct instruction like "make all exterior walls straw bale" or "add pantry 8 x 10 near kitchen".`;
  const assumptions = report.assumptions.length ? `\n\nI assumed: ${report.assumptions.join(' ')}` : '';
  const issues = report.issues.length ? `\n\nThe council flagged:\n${report.issues.slice(0, 4).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}` : '';
  return `${opening}${assumptions}${issues}`;
}

function isConsultativePrompt(prompt, attachedImages = []) {
  const text = String(prompt || '').toLowerCase().trim();
  if (!text) return false;
  if (/\b(tell me|what do you see|what do you notice|what differs|what's different|compare|critique|review|analyze|analyse|explain|describe|do you think|what is wrong|what's wrong|why|help me understand)\b/.test(text)) return true;
  if (attachedImages.length && /\b(image|drawing|sketch|photo|handwriting|plan)\b/.test(text)) return true;
  if (text.endsWith('?') && !/\b(add|move|make|resize|set|change|delete|remove|place|build|create|put)\b/.test(text)) return true;
  return false;
}

function buildStudioConversationResponse(promptText, spec, selected, issues, attachedImages = []) {
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

function emptyBimOperation(operation = {}) {
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

function uniqueObjectId(spec, preferred) {
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

function findDesignObject(spec, targetId, name = '') {
  if (!targetId && !name) return null;
  const normalizedName = normalizeDesignLabel(name);
  return spec.rooms.find((room) => room.id === targetId || normalizeDesignLabel(room.name) === normalizedName || normalizeDesignLabel(room.name).includes(normalizedName))
    || (spec.elements || []).find((element) => element.id === targetId || normalizeDesignLabel(element.name) === normalizedName || normalizeDesignLabel(element.name).includes(normalizedName))
    || null;
}

function operationDescription(operation, spec) {
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

function applyStructuredDesignPlan(currentSpec, plan) {
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
      if (operation.southWallHeightFt) next.shell.southWallHeightFt = clamp(operation.southWallHeightFt, 7, 40);
      if (operation.northWallHeightFt) next.shell.northWallHeightFt = clamp(operation.northWallHeightFt, 7, 40);
      if (operation.pitch) next.shell.roofPitch = clamp(operation.pitch, 0.02, 1.5);
      const profile = roofProfile(next.shell);
      next.shell.wallHeightFt = profile.highWallHeightFt;
      next.shell.roofPitch = Math.round(profile.pitch * 1000) / 1000;
      next.shell.roofNote = `${profile.roofType} roof; south wall ${profile.southWallHeightFt}', north wall ${profile.northWallHeightFt}'.`;
      actions.push(operationDescription(operation, next));
      continue;
    }

    if (operation.type === 'set_wall_height') {
      const height = clamp(Number(operation.h || operation.value || 10), 7, 40);
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
        type: operation.category || 'custom'
      };
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

function structuredPlanSummary(report) {
  const opening = report.actions.length
    ? `${report.summary}\n\nWhat changed:\n${report.actions.slice(0, 10).map((action) => `- ${action}`).join('\n')}`
    : `${report.summary}\n\nNothing was changed in the model.`;
  const warnings = report.warnings.length ? `\n\nWatch out: ${report.warnings.join(' ')}` : '';
  const assumptions = report.assumptions.length ? `\n\nI assumed: ${report.assumptions.join(' ')}` : '';
  const questions = report.questions.length ? `\n\nTo do this better, tell me:\n${report.questions.map((item) => `- ${item}`).join('\n')}` : '';
  const issues = report.issues.length ? `\n\nThe council flagged:\n${report.issues.slice(0, 4).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}` : '';
  return `${opening}${warnings}${assumptions}${questions}${issues}`;
}

async function requestCurrentProjectState() {
  const response = await fetch('/api/projects/current');
  if (!response.ok) throw new Error(`Project load failed with HTTP ${response.status}`);
  return response.json();
}

async function saveDashboardStateToBackend(payload) {
  const response = await fetch('/api/projects/current/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Project save failed with HTTP ${response.status}`);
  return response.json();
}

async function requestStructuredDesignPlan(payload) {
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

async function requestServerAppliedBim(payload) {
  const request = (url) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let response = await request('/api/bim/apply');
  if (response.status === 404 && typeof window !== 'undefined' && window.location.port !== '5184') {
    response = await request('http://127.0.0.1:5184/api/bim/apply');
  }
  if (!response.ok) throw new Error(`BIM apply failed with HTTP ${response.status}`);
  return response.json();
}

async function requestStudioResponse(payload) {
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

function buildDashboardStatePayload({
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
  buildProgress
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
    buildProgress
  };
}

function addElementToSpec(spec, item) {
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

function upsertRoom(spec, room) {
  const index = spec.rooms.findIndex((item) => item.id === room.id);
  if (index >= 0) spec.rooms[index] = { ...spec.rooms[index], ...room };
  else spec.rooms.push(room);
}

function normalizeRooms(spec) {
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

function repairNorthBandRooms(spec) {
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

function detectIssues(spec) {
  const issues = [];
  const enclosedRooms = spec.rooms.filter((room) => room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt);
  const conditionedArea = enclosedRooms.reduce((sum, room) => sum + room.w * room.d, 0);
  const shellArea = spec.shell.widthFt * spec.shell.depthFt;

  if (conditionedArea > shellArea * 1.08) {
    issues.push({ severity: 'critical', title: 'Room program exceeds shell area', owner: 'Architect', system: 'rooms', fix: 'Reduce room footprints or enlarge the shell before issuing drawings.' });
  }
  if (!spec.rooms.some((room) => room.type === 'wet')) {
    issues.push({ severity: 'critical', title: 'No wet core defined', owner: 'Engineer', system: 'rooms', fixId: 'add-wet-core', fix: 'Add a bathroom/mechanical wet core and align plumbing walls.' });
  }
  if (!spec.openings.some((item) => (OPENING_TYPES[item.type]?.entry) && item.wall === 'south')) {
    issues.push({ severity: 'warning', title: 'Primary entry lacks clear solar-side approach', owner: 'Designer', system: 'windows', fixId: 'add-south-entry', fix: 'Add or move the main entry (a door, french doors, or a slider) to a legible south approach with weather protection.' });
  }
  if (!spec.openings.some((item) => (OPENING_TYPES[item.type] || OPENING_TYPES.window).glazed && item.wall === 'south')) {
    issues.push({ severity: 'warning', title: 'Insufficient south-facing daylight strategy', owner: 'Permaculture', system: 'windows', fixId: 'add-south-glass', fix: 'Add balanced south glazing with summer shading and winter solar gain.' });
  }
  if (spec.shell.wallHeightFt > 12) {
    issues.push({ severity: 'warning', title: 'Tall walls need explicit lateral strategy', owner: 'Engineer', system: 'walls', fix: 'Add shear wall schedule, hold-downs, and diaphragm notes.' });
  }
  if (spec.systems.envelope.toLowerCase().includes('natural') && !spec.systems.envelope.toLowerCase().includes('rainscreen')) {
    issues.push({ severity: 'warning', title: 'Natural wall lacks drying layer', owner: 'Natural Builder', system: 'walls', fix: 'Include rainscreen, generous roof overhangs, and capillary breaks.' });
  }
  if (!spec.rooms.some((room) => /mud|laundry|service/i.test(room.name))) {
    issues.push({ severity: 'warning', title: 'Farm workflow has no dirty entry', owner: 'Homestead/Farm', system: 'rooms', fixId: 'add-mudroom', fix: 'Add a mud/laundry buffer between exterior work and clean living space.' });
  }
  const hasStackedSpace = Number(spec.shell.storeys || 1) > 1
    || (spec.elements || []).some((element) => ['loft', 'tower'].includes(element.category));
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
  if (derivedForChecks.total > 324700) {
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
  if (hasSouthGlass && overhangCheck.south > 3.5) {
    issues.push({ severity: 'warning', title: `South overhang (${overhangCheck.south.toFixed(1)} ft) will block winter sun`, owner: 'Designer', system: 'roof', fixId: 'reduce-south-overhang', fix: 'A deep south overhang casts winter shadow on your solar glass, starving the house of free heat. 2 to 3 ft is the usual sweet spot.' });
  }
  if (issues.length === 0) {
    issues.push({ severity: 'pass', title: 'Schematic passes current council checks', owner: 'Project Manager', fix: 'Ready for PE/architect review, structural sizing, jurisdictional code check, and stamped drawing development.' });
  }
  return issues;
}

function runCouncil(spec) {
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
function deriveDesign(spec, wallSections) {
  const site = siteOf(spec);
  const utilities = utilitiesOf(spec);
  const w = Number(spec.shell.widthFt) || 0;
  const d = Number(spec.shell.depthFt) || 0;
  const floor = w * d;
  const { storeys, extraFt: storeyExtraFt } = storeyInfo(spec.shell);
  // Lofts, tower rooms, and planner floor plates are heated area too.
  const stackedArea = (spec.elements || [])
    .filter((element) => ['loft', 'tower', 'floor'].includes(element.category))
    .reduce((sum, element) => sum + (Number(element.w) * Number(element.d) || 0), 0);
  const heatedFloor = floor * storeys + stackedArea;
  const pitch = Number(spec.shell.roofPitch || 0.32);
  const overhangs = resolveOverhangs(spec.shell);
  const roofFootprint = (w + overhangs.east + overhangs.west) * (d + overhangs.north + overhangs.south);
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
  const wallFaceArea = (wall) => {
    if (roofTypeNow === 'shed' && (wall.side === 'east' || wall.side === 'west')) {
      return wall.lengthFt * ((northEaveFt + southEaveFt) / 2 + storeyExtraFt);
    }
    let area = wall.lengthFt * (wall.heightFt + storeyExtraFt);
    if (roofTypeNow === 'gable' && (wall.side === 'north' || wall.side === 'south')) {
      area += (wall.lengthFt * gableRiseFt) / 2;
    }
    return area;
  };
  const wallArea = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall), 0);
  const wallCostPsf = { 'straw-bale': 12, 'hemp-lime': 20, cob: 20, 'rammed-earth': 22, cordwood: 16, 'light-straw-clay': 15, framed: 18 };
  const wallsCost = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCostPsf[wall.assemblyKey] ?? 16), 0);
  const wallR = wallArea
    ? wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (WALL_ASSEMBLIES[wall.assemblyKey]?.rValue ?? 20), 0) / wallArea
    : 20;
  // Glazed openings on the south wall — windows, picture, clerestory, and
  // glazed doors (french, sliders) all count toward passive-solar glass.
  // A bay window's wrapped faces gather ~25% more glass than its plan width.
  const southGlass = (spec.openings || []).filter((opening) => opening.wall === 'south' && (OPENING_TYPES[opening.type] || OPENING_TYPES.window).glazed)
    .reduce((sum, opening) => {
      const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
      return sum + (Number(opening.widthFt) || 3) * profile.h * (profile.bay ? 1.25 : 1);
    }, 0);
  const glassPct = floor ? (southGlass / floor) * 100 : 0;
  // All glazing (every wall + skylights) for cost and heat loss.
  const skylightArea = (spec.openings || []).filter((opening) => opening.wall === 'roof')
    .reduce((sum, opening) => sum + (Number(opening.widthFt) || 2.5) ** 2, 0);
  const totalGlass = (spec.openings || []).reduce((sum, opening) => {
    const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
    if (!profile.glazed) return sum;
    if (profile.roof) return sum + (Number(opening.widthFt) || 2.5) ** 2;
    return sum + (Number(opening.widthFt) || 3) * profile.h * (profile.bay ? 1.25 : 1);
  }, 0);
  const glazingU = utilities.windowQuality === 'triple' ? 0.28 : 0.5;
  const roofR = 38;
  const heatUA = Math.max(0, wallArea - southGlass) / Math.max(wallR, 1)
    + Math.max(0, roofArea - skylightArea) / roofR
    + (southGlass + skylightArea) * glazingU;
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
  const panels = utilities.powerMode === 'gridtie' ? 0 : Math.ceil(loadKwhDay / (peakSunHrs * 0.78) / 0.4);
  const panelRoom = Math.floor(roofArea / 22);
  const batteryKwh = utilities.powerMode === 'offgrid' ? Math.round(loadKwhDay * 2 / 0.8) : 0;

  // Costs (add-on constants, keyed to the structured utility choices).
  const heatCostBySource = { rocket_mass: 2500, masonry: 6000, wood_stove: 3000, minisplit: 4500 };
  const waterCostBySource = { well: 7500, spring: 2500, catchment: 3500, town: 1500 };
  const wasteCostByMethod = { septic: 8500, composting: 1500, reedbed: 1200 };
  const foundationCostPsf = { rubble: 8, stemwall: 12, slab: 15 };
  const perimeterFt = 2 * (w + d);
  const stemwallHeightFt = Math.min(6, Math.max(0.5, Number(utilities.stemwallHeightFt) || 1.5));
  // Stem wall cost scales with the wall itself: base prep + footing by floor
  // area, plus the perimeter wall by face area (calibrated so the default
  // 18" stem matches the old flat $12/sf).
  const foundationCost = utilities.foundationType === 'stemwall'
    ? floor * 8 + perimeterFt * stemwallHeightFt * 18
    : floor * (foundationCostPsf[utilities.foundationType] ?? 10);
  const outdoorCost = OUTDOOR_ITEMS.reduce((sum, item) => sum + (outdoorItemPresent(spec, item) ? item.cost : 0), 0);
  const cost = {
    foundation: foundationCost,
    upperFloors: (storeys - 1) * floor * 12 + stackedArea * 12,
    outdoors: outdoorCost,
    walls: wallsCost,
    windows: totalGlass * (utilities.windowQuality === 'triple' ? 70 : 45),
    roof: roofArea * 10,
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
    + (utilities.diyFoundation ? cost.foundation * 0.5 : 0);
  const total = totalBeforeSweat - sweat;

  // Embodied carbon (kg CO2e, directional/comparative — add-on coefficients).
  const foundationCarbonPsf = { rubble: 10, stemwall: 18, slab: 25 };
  const wallCarbonPsf = { 'straw-bale': 6, 'rammed-earth': 20, cob: 8, 'hemp-lime': 4, cordwood: 8, 'light-straw-clay': 7, framed: 8 };
  const wallCarbon = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCarbonPsf[wall.assemblyKey] ?? 8), 0);
  const stemCarbonExtra = utilities.foundationType === 'stemwall' ? perimeterFt * Math.max(0, stemwallHeightFt - 1.5) * 40 : 0;
  const carbonKg = floor * (foundationCarbonPsf[utilities.foundationType] ?? 10) + stemCarbonExtra + wallCarbon + roofArea * 12 + (panels > 0 ? 400 : 0) + (batteryKwh > 0 ? 600 : 0);

  return {
    site, utilities, floor, heatedFloor, storeys, roofArea, roofFootprint, overhangs, wallArea, wallR, southGlass, glassPct,
    skylightArea, totalGlass, glazingU, stemwallHeightFt,
    heatLoadKbtu, bedrooms, people, waterGpd, catchmentGpd, supplyGpd, septicGpd,
    peakSunHrs, loadKwhDay, panels, panelRoom, batteryKwh,
    cost, totalBeforeSweat, sweat, total, carbonKg, pitch
  };
}

const fmtMoney = (value) => `$${Math.round(value).toLocaleString()}`;
const fmtNum = (value) => Math.round(value).toLocaleString();

const SYSTEM_GROUPS = [
  { label: 'Land & program', keys: ['site', 'rooms'] },
  { label: 'The building', keys: ['shell', 'foundation', 'walls', 'roof', 'windows'] },
  { label: 'Systems', keys: ['heat', 'water', 'waste', 'power', 'outdoors'] }
];

// The cost breakdown reads derived.cost — one row per system, each linked back
// to the page that drives it, so a big number is one tap from the controls.
const COST_ROWS = [
  { key: 'foundation', label: 'Foundation', system: 'foundation' },
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

const SYSTEM_META = {
  site: {
    label: 'Site',
    why: 'Where the house sits and how it faces the sun — every other system leans on this. Sun angles drive passive solar and panel output; rainfall decides whether a roof can supply your water.',
    feeds: ['Windows', 'Water', 'Power'],
    reads: (dd) => [
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

function buildingSnapshot(spec, issues) {
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

function expertResponse(expert, question, spec, issues, selectedRoom) {
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

function wholeTeamResponse(question, spec, issues, selectedRoom) {
  const priority = ['architect', 'engineer', 'designer', 'natural', 'permaculture', 'homestead', 'pm'];
  return priority
    .map((id) => {
      const expert = expertCouncil.find((item) => item.id === id);
      return `${expert.name}: ${expertResponse(expert, question, spec, issues, selectedRoom)}`;
    })
    .join('\n\n');
}

function reviseSpec(spec) {
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

function createIfcSummary(spec) {
  const modeledWallAssembly = wallAssemblyProfile(spec.systems.envelope);
  const modeledRoof = roofProfile(spec.shell);
  return {
    schema: 'IFC4-oriented schematic summary',
    disclaimer: 'Permit-track BIM data with code, structural, MEP, and jurisdictional coordination fields.',
    project: spec.projectName,
    revision: spec.revision,
    units: 'feet in UI, millimeters in IFC export',
    hierarchy: ['IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSlab', 'IfcWall', 'IfcRoof', 'IfcSpace', 'IfcOpeningElement'],
    spaces: spec.rooms.map((room) => ({
      ifcClass: 'IfcSpace',
      name: room.name,
      areaSf: Math.round(room.w * room.d),
      use: room.type,
      finishFloor: room.floor
    })),
    naturalBuildingElements: (spec.elements || []).map((element) => ({
      ifcClass: element.category === 'wall' ? 'IfcWallType' : element.category === 'roof' ? 'IfcRoof' : 'IfcBuildingElementProxy',
      name: element.name,
      category: element.category,
      areaSf: Math.round(element.w * element.d),
      note: element.note
    })),
    modeledWallAssembly: {
      ifcClass: 'IfcWallType',
      name: modeledWallAssembly.label,
      key: modeledWallAssembly.key,
      thicknessFt: modeledWallAssembly.thicknessFt,
      finish: modeledWallAssembly.finish
    },
    modeledRoof: {
      ifcClass: 'IfcRoof',
      type: modeledRoof.roofType,
      highSide: modeledRoof.highSide,
      southWallHeightFt: modeledRoof.southWallHeightFt,
      northWallHeightFt: modeledRoof.northWallHeightFt,
      pitch: modeledRoof.pitch
    },
    systems: spec.systems,
    qualityGate: detectIssues(spec)
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleBlock(project, sheet, title, revision) {
  return `
    <aside class="title-block">
      <div class="firm">NATURAL BUILDING DESIGN DASHBOARD</div>
      <div class="stamp-box">PERMIT<br />TRACK SET</div>
      <dl>
        <dt>Project</dt><dd>${escapeHtml(project)}</dd>
        <dt>Sheet</dt><dd>${escapeHtml(sheet)}</dd>
        <dt>Title</dt><dd>${escapeHtml(title)}</dd>
        <dt>Revision</dt><dd>${escapeHtml(revision)}</dd>
        <dt>Date</dt><dd>${new Date().toLocaleDateString()}</dd>
        <dt>Scale</dt><dd>Diagrammatic</dd>
      </dl>
      <div class="stamp-note">Coordinated BIM sheet package with calculation, schedule, and seal-review fields.</div>
    </aside>`;
}

function createPlanSvg(spec) {
  const pad = 42;
  const scale = Math.min((620 - pad * 2) / spec.shell.widthFt, (430 - pad * 2) / spec.shell.depthFt);
  const planW = spec.shell.widthFt * scale;
  const planD = spec.shell.depthFt * scale;
  const x0 = pad;
  const y0 = pad;
  const roomColors = {
    living: '#dfe9df',
    service: '#eadfca',
    sleeping: '#dce4ee',
    wet: '#d6e9eb',
    work: '#e6ddec',
    plant: '#dcebd2',
    storage: '#eee7d6'
  };
  const roomRects = spec.rooms.map((room) => {
    const x = x0 + room.x * scale;
    const y = y0 + room.y * scale;
    const w = room.w * scale;
    const h = room.d * scale;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${roomColors[room.type] || '#e9e4d7'}" stroke="#172a3a" stroke-width="1.2" />
        <text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" class="room-name">${escapeHtml(room.name)}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 10}" text-anchor="middle" class="room-dim">${room.w}' x ${room.d}'</text>
      </g>`;
  }).join('');
  const openingLines = spec.openings.map((opening) => {
    const width = opening.widthFt * scale;
    if (opening.wall === 'north') return `<line x1="${x0 + (opening.x || 0) * scale}" y1="${y0}" x2="${x0 + (opening.x || 0) * scale + width}" y2="${y0}" class="opening ${opening.type}" />`;
    if (opening.wall === 'south') return `<line x1="${x0 + (opening.x || 0) * scale}" y1="${y0 + planD}" x2="${x0 + (opening.x || 0) * scale + width}" y2="${y0 + planD}" class="opening ${opening.type}" />`;
    if (opening.wall === 'east') return `<line x1="${x0 + planW}" y1="${y0 + (opening.y || 0) * scale}" x2="${x0 + planW}" y2="${y0 + (opening.y || 0) * scale + width}" class="opening ${opening.type}" />`;
    return `<line x1="${x0}" y1="${y0 + (opening.y || 0) * scale}" x2="${x0}" y2="${y0 + (opening.y || 0) * scale + width}" class="opening ${opening.type}" />`;
  }).join('');
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Schematic floor plan">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="2" orient="auto"><path d="M0,0 L4,4 L8,0 Z" fill="#0c1f33" /></marker>
      </defs>
      <rect x="${x0}" y="${y0}" width="${planW}" height="${planD}" fill="#fbfaf4" stroke="#0c1f33" stroke-width="4" />
      ${roomRects}
      ${openingLines}
      <line x1="${x0}" y1="${y0 + planD + 22}" x2="${x0 + planW}" y2="${y0 + planD + 22}" class="dim-line" />
      <text x="${x0 + planW / 2}" y="${y0 + planD + 40}" text-anchor="middle" class="dim-text">${spec.shell.widthFt}' overall</text>
      <line x1="${x0 + planW + 22}" y1="${y0}" x2="${x0 + planW + 22}" y2="${y0 + planD}" class="dim-line" />
      <text x="${x0 + planW + 40}" y="${y0 + planD / 2}" transform="rotate(90 ${x0 + planW + 40} ${y0 + planD / 2})" text-anchor="middle" class="dim-text">${spec.shell.depthFt}' overall</text>
      <g transform="translate(555 38)"><line x1="0" y1="42" x2="0" y2="8" stroke="#0c1f33" stroke-width="2" marker-end="url(#arrow)" /><text x="0" y="58" text-anchor="middle" class="north">N</text></g>
    </svg>`;
}

function createWallSectionSvg(spec) {
  const envelope = escapeHtml(spec.systems.envelope);
  const structure = escapeHtml(spec.systems.structure);
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Typical wall section">
      <rect x="260" y="74" width="72" height="240" fill="#d9d2bb" stroke="#0c1f33" stroke-width="2" />
      <rect x="236" y="74" width="18" height="240" fill="#eef3f7" stroke="#53687c" />
      <rect x="338" y="74" width="16" height="240" fill="#c9a36b" stroke="#53687c" />
      <rect x="216" y="314" width="160" height="34" fill="#8f8a7a" stroke="#0c1f33" />
      <rect x="192" y="348" width="208" height="42" fill="#c7c1ad" stroke="#0c1f33" />
      <path d="M214 74 L378 74 L320 22 L260 22 Z" fill="#47596b" stroke="#0c1f33" stroke-width="2" />
      <line x1="380" y1="74" x2="468" y2="74" class="dim-line" /><text x="474" y="78" class="dim-text">roof protection</text>
      <line x1="356" y1="172" x2="468" y2="172" class="dim-line" /><text x="474" y="176" class="dim-text">rainscreen / cladding</text>
      <line x1="254" y1="194" x2="130" y2="194" class="dim-line" /><text x="48" y="198" class="dim-text">natural wall body</text>
      <line x1="260" y1="330" x2="118" y2="330" class="dim-line" /><text x="42" y="334" class="dim-text">capillary break</text>
      <text x="35" y="42" class="section-title">Typical Natural Wall Section</text>
      <text x="35" y="386" class="section-note">Envelope: ${envelope.slice(0, 118)}${envelope.length > 118 ? '...' : ''}</text>
      <text x="35" y="405" class="section-note">Structure: ${structure.slice(0, 118)}${structure.length > 118 ? '...' : ''}</text>
    </svg>`;
}

function createFoundationSvg(spec) {
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Foundation and load path diagram">
      <rect x="50" y="64" width="520" height="300" fill="#fbfaf4" stroke="#0c1f33" stroke-width="4" />
      <rect x="74" y="88" width="472" height="252" fill="none" stroke="#8f8a7a" stroke-width="12" />
      <line x1="74" y1="88" x2="546" y2="340" stroke="#c05a45" stroke-width="2" stroke-dasharray="8 5" />
      <line x1="546" y1="88" x2="74" y2="340" stroke="#c05a45" stroke-width="2" stroke-dasharray="8 5" />
      <g fill="#0c1f33">${[110, 230, 350, 470].map((x) => `<circle cx="${x}" cy="96" r="5" /><circle cx="${x}" cy="332" r="5" />`).join('')}</g>
      <text x="50" y="42" class="section-title">Foundation / Load Path Diagram</text>
      <text x="50" y="390" class="section-note">Continuous path: roof to walls/frame to foundation to soil. Footing, slab, reinforcement, hold-down, and lateral values feed the calculation sheet.</text>
      <text x="50" y="408" class="section-note">Shell: ${spec.shell.widthFt}' x ${spec.shell.depthFt}' - wall height ${spec.shell.wallHeightFt}' - roof pitch ${spec.shell.roofPitch}</text>
    </svg>`;
}

function professionalDocMatrix(spec) {
  const naturalEnvelope = /straw|hemp|cob|earth|cordwood|natural/i.test(spec.systems.envelope);
  return [
    ['Jurisdiction / AHJ', 'Required', 'Not Set', 'County/city, zoning, adopted code year, frost depth, snow/wind/seismic criteria.'],
    ['Code Sheet', 'Required', 'Template Ready', 'Occupancy path, construction type, egress, smoke/CO, fire separation, energy path.'],
    ['Structural Calculations', 'Required', 'Worksheet Ready', 'Gravity, lateral, diaphragm, foundation, connection, and natural-wall restraint worksheets.'],
    ['Foundation Plan', 'Required', 'Permit Track', 'Soil bearing, frost depth, slab/footing/rebar schedule, drainage, vapor/radon strategy.'],
    ['Wall Sections', 'Required', naturalEnvelope ? 'Natural Assembly Flag' : 'Draft', 'Water, air, vapor, thermal, fire, structure, plaster, base, and roof protection layers.'],
    ['MEP Coordination', 'Required', 'Worksheet Ready', 'Wet core, ventilation, combustion air, electrical service, water/waste routes.'],
    ['Door / Window Schedule', 'Required', spec.openings.length ? 'Draft' : 'Missing', 'Exact sizes, operation, headers, U-factor/SHGC, egress and safety glazing.'],
    ['Energy Code', 'Required', 'Not Calculated', 'Climate zone, insulation values, glazing ratio, ventilation, HVAC sizing, compliance path.'],
    ['Seal Workflow', 'Required', 'Reserved', 'Review comments, calculation references, correction log, seal/date fields.']
  ];
}

function structuralLoadRows(spec) {
  const timber = /timber|post|beam/i.test(spec.systems.structure);
  return [
    ['Roof Loads', 'Snow, dead, wind uplift, roof diaphragm', 'Set local loads and size rafters/trusses/purlins.'],
    ['Gravity Path', timber ? 'Roof to timber bents/posts to beams to footings' : 'Roof to framed walls to slab/footings', 'Show bearing points and tributary areas.'],
    ['Lateral System', timber ? 'Braced timber bents, shear walls, roof diaphragm' : 'Shear walls, hold-downs, wall bracing, roof diaphragm', 'Specify shear schedule and connectors.'],
    ['Foundation', 'Continuous perimeter footing/slab concept', 'Size from soil bearing, frost depth, point loads, drainage, radon, and settlement.'],
    ['Natural Wall Restraint', spec.systems.envelope, 'Show top/bottom restraint, buckling limits, plaster reinforcement, moisture base, and seismic/wind compatibility.']
  ];
}

function createDrawingSetHtml(spec, qualityScore, issues) {
  const sheetIndex = [
    ['G001', 'Cover Sheet'],
    ['G002', 'Code Matrix'],
    ['A101', 'Schematic Floor Plan'],
    ['A200', 'Assemblies and Schedules'],
    ['A300', 'Wall Section'],
    ['S100', 'Structural Load Path / Foundation'],
    ['M100', 'MEP / Water / Energy Coordination']
  ];
  const systemRows = Object.entries(spec.systems)
    .map(([key, value]) => `<tr><th>${escapeHtml(titleCase(key))}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const roomRows = spec.rooms
    .map((room, index) => `<tr><td>A${String(index + 1).padStart(3, '0')}</td><td>${escapeHtml(room.name)}</td><td>${Math.round(room.w * room.d)} sf</td><td>${escapeHtml(room.type)}</td><td>${escapeHtml(room.floor)}</td></tr>`)
    .join('');
  const issueRows = issues
    .map((issue) => `<tr><td>${escapeHtml(issue.severity.toUpperCase())}</td><td>${escapeHtml(issue.title)}</td><td>${escapeHtml(issue.owner)}</td><td>${escapeHtml(issue.fix)}</td></tr>`)
    .join('');
  const matrixRows = professionalDocMatrix(spec)
    .map(([item, required, status, action]) => `<tr><th>${escapeHtml(item)}</th><td>${escapeHtml(required)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(action)}</td></tr>`)
    .join('');
  const structuralRows = structuralLoadRows(spec)
    .map(([item, concept, action]) => `<tr><th>${escapeHtml(item)}</th><td>${escapeHtml(concept)}</td><td>${escapeHtml(action)}</td></tr>`)
    .join('');
  const openingRows = spec.openings.map((opening, index) => {
    const prefix = opening.type === 'door' ? 'D' : 'W';
    return `<tr><td>${prefix}${String(index + 1).padStart(2, '0')}</td><td>${escapeHtml(opening.label)}</td><td>${escapeHtml(opening.type)}</td><td>${escapeHtml(opening.wall)}</td><td>${opening.widthFt}' nominal</td><td>Operation, header, U-factor/SHGC, egress, safety glazing.</td></tr>`;
  }).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(spec.projectName)} Drawing Set Rev ${spec.revision}</title>
  <style>
    @page { size: letter landscape; margin: 0.35in; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #d9dde2; color: #0c1f33; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
    .sheet { width: 10.3in; height: 7.8in; margin: 18px auto; background: #fff; display: grid; grid-template-columns: 1fr 1.68in; border: 2px solid #0c1f33; page-break-after: always; }
    .main { padding: 0.22in; border-right: 2px solid #0c1f33; display: grid; grid-template-rows: auto 1fr; gap: 0.14in; }
    .title-block { display: grid; grid-template-rows: auto auto 1fr auto; border-left: 0; font-size: 8px; }
    .firm { background: #0c1f33; color: #fff; padding: 0.12in; font-weight: 800; letter-spacing: 0.04em; writing-mode: vertical-rl; text-orientation: mixed; min-height: 1.45in; }
    .stamp-box { margin: 0.1in; border: 1px solid #0c1f33; border-radius: 50%; width: 0.96in; height: 0.96in; display: grid; place-items: center; text-align: center; font-size: 7px; justify-self: center; }
    dl { margin: 0; border-top: 2px solid #0c1f33; }
    dt, dd { margin: 0; padding: 0.045in 0.06in; border-bottom: 1px solid #8794a3; }
    dt { background: #eef3f7; color: #425161; text-transform: uppercase; font-size: 6.5px; }
    dd { min-height: 0.22in; font-weight: 700; }
    .stamp-note { padding: 0.08in; border-top: 2px solid #0c1f33; font-size: 7px; line-height: 1.25; }
    h1 { margin: 0; font-size: 31px; letter-spacing: 0.08em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #47596b; }
    h3 { margin: 0 0 0.08in; font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; }
    .hero { background: #0c1f33; color: #fff; padding: 0.22in; display: grid; gap: 0.04in; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.14in; }
    .full { grid-column: 1 / -1; }
    .box { border: 1px solid #c6d0da; min-height: 1in; padding: 0.12in; background: #fbfcfd; }
    table { width: 100%; border-collapse: collapse; font-size: 7.5px; }
    th, td { border-bottom: 1px solid #d5dde5; padding: 0.045in; text-align: left; vertical-align: top; }
    th { color: #394b5d; background: #eef3f7; text-transform: uppercase; font-size: 6.5px; }
    .plan { display: grid; grid-template-columns: 1fr 2.35in; gap: 0.12in; align-items: start; }
    svg { width: 100%; height: auto; border: 1px solid #c6d0da; background: #fff; }
    .room-name { font-size: 8px; font-weight: 800; fill: #0c1f33; }
    .room-dim, .dim-text, .north { font-size: 7px; fill: #394b5d; }
    .opening { stroke-width: 7; stroke-linecap: round; }
    .opening.window { stroke: #4b83b7; }
    .opening.door { stroke: #9a633f; }
    .dim-line { stroke: #53687c; stroke-width: 1; stroke-dasharray: 4 3; }
    .section-title { font-size: 15px; font-weight: 900; fill: #0c1f33; text-transform: uppercase; letter-spacing: 1px; }
    .section-note { font-size: 8px; fill: #394b5d; }
    .note { font-size: 8px; line-height: 1.35; color: #394b5d; }
    .score { font-size: 28px; font-weight: 900; color: #0c1f33; }
    @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <section class="sheet">
    <main class="main">
      <div class="hero"><h1>${escapeHtml(spec.projectName)}</h1><h2>Natural Building Permit-Track Package - Revision ${spec.revision}</h2></div>
      <div class="grid">
        <div class="box"><h3>Project Data</h3><table>
          <tr><th>Climate</th><td>${escapeHtml(spec.site.climate)}</td></tr>
          <tr><th>Footprint</th><td>${spec.shell.widthFt}' x ${spec.shell.depthFt}'</td></tr>
          <tr><th>Area</th><td>${Math.round(spec.shell.widthFt * spec.shell.depthFt)} sf shell</td></tr>
          <tr><th>Wall Height</th><td>${spec.shell.wallHeightFt}'</td></tr>
        </table></div>
        <div class="box"><h3>Sheet Index</h3><table>${sheetIndex.map(([id, name]) => `<tr><th>${id}</th><td>${name}</td></tr>`).join('')}</table></div>
        <div class="box"><h3>Code / Coordination Basis</h3><p class="note">Permit-track design for BIM coordination, assembly selection, professional calculations, and AHJ review. Track zoning, adopted code year, IRC/IBC path, seismic/wind/snow loads, energy code, wastewater, potable water, and fire separation.</p></div>
        <div class="box"><h3>Revision / QA</h3><div class="score">${qualityScore}</div><p class="note">Document readiness score. Required actions are listed on G002 and A200.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'G001', 'Cover Sheet', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>G002 - Code Matrix / Permit Readiness</h2></div>
      <div class="grid">
        <div class="box full"><h3>Required Permit / Engineering Document Matrix</h3><table><tr><th>Document Area</th><th>Need</th><th>Status</th><th>Next Action</th></tr>${matrixRows}</table></div>
        <div class="box"><h3>Project Criteria To Set</h3><p class="note">Jurisdiction, parcel constraints, design criteria, occupancy path, construction type, frost depth, soil bearing, well/septic/water source, utility service, energy compliance path, wildfire/flood/snow/seismic exposure.</p></div>
        <div class="box"><h3>Seal Workflow</h3><p class="note">Comment log, calculation references, reviewer initials, corrected-sheet dates, and final issue fields are reserved in this package.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'G002', 'Code Matrix', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A101 - Schematic Floor Plan</h2></div>
      <div class="plan">
        ${createPlanSvg(spec)}
        <div class="box"><h3>Room Schedule</h3><table><tr><th>ID</th><th>Name</th><th>Area</th><th>Use</th><th>Floor</th></tr>${roomRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A101', 'Schematic Floor Plan', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A200 - Assemblies, Schedules, Review Flags</h2></div>
      <div class="grid">
        <div class="box"><h3>Current Assemblies</h3><table>${systemRows}</table></div>
        <div class="box"><h3>Professional Review Flags</h3><table><tr><th>Status</th><th>Item</th><th>Owner</th><th>Resolution</th></tr>${issueRows}</table></div>
        <div class="box"><h3>Natural Building Notes</h3><p class="note">${escapeHtml(spec.notes)}</p></div>
        <div class="box"><h3>Openings</h3><table><tr><th>ID</th><th>Label</th><th>Type</th><th>Wall</th><th>Width</th><th>Schedule Notes</th></tr>${openingRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A200', 'Assemblies and Schedules', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A300 - Typical Wall Section / Natural Assembly</h2></div>
      <div class="plan">
        ${createWallSectionSvg(spec)}
        <div class="box"><h3>Section Notes</h3><table>
          <tr><th>Water</th><td>Bulk water shedding, roof overhang, flashing, capillary break, drainage plane, rainscreen.</td></tr>
          <tr><th>Air</th><td>Continuous air barrier strategy through all transitions.</td></tr>
          <tr><th>Vapor</th><td>Vapor-open drying profile checked for climate and interior humidity.</td></tr>
          <tr><th>Fire / Code</th><td>Plaster thickness, ignition resistance, thermal barrier, and assembly path.</td></tr>
          <tr><th>Structure</th><td>Natural wall infill/restraint and frame/load path coordination.</td></tr>
        </table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A300', 'Wall Section', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>S100 - Structural Load Path / Foundation Coordination</h2></div>
      <div class="plan">
        ${createFoundationSvg(spec)}
        <div class="box"><h3>Structural Calculation Index</h3><table><tr><th>Item</th><th>Current Concept</th><th>Calculation / Detailing Action</th></tr>${structuralRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'S100', 'Structural Load Path', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>M100 - MEP / Water / Energy Coordination</h2></div>
      <div class="grid">
        <div class="box"><h3>Water / Plumbing</h3><p class="note">${escapeHtml(spec.systems.water)}. Add fixture schedule, supply sizing, DWV routes, septic/greywater legality, roof catchment calculations, filtration, overflow, freeze protection, and backflow protection.</p></div>
        <div class="box"><h3>Energy / HVAC</h3><p class="note">${escapeHtml(spec.systems.energy)}. Add heating/cooling loads, ventilation design, combustion air, clearances, energy-code path, and electrical service coordination.</p></div>
        <div class="box"><h3>Electrical</h3><p class="note">Panel location, load calculation, smoke/CO alarms, GFCI/AFCI locations, exterior/weatherproof circuits, equipment circuits, and renewable/backup provisions.</p></div>
        <div class="box"><h3>Natural Building Coordination</h3><p class="note">Coordinate penetrations through straw/hemp/cob/earth assemblies. Avoid hidden wet services in moisture-sensitive walls unless access, sleeves, and drying strategy are resolved.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'M100', 'MEP Coordination', spec.revision)}
  </section>
</body>
</html>`;
}

// Element fill colors for the 2D plan (mirrors the 3D elementPalette).
const PLAN_ELEMENT_HEX = {
  wall: '#9f7d54', earthwork: '#7d684f', structure: '#74553d', roof: '#55766f',
  passive: '#b08b4f', thermal: '#9a5944', water: '#4c88a0', plant: '#6f9b61',
  homestead: '#8e7049', landscape: '#6d8c55', storage: '#8a7768', site: '#9a8f70',
  garden: '#5f8d49', animal: '#b0895b', floor: '#8d8473', loft: '#6f7f6a',
  tower: '#7a5f49', custom: '#8b786d'
};

// Zone fill colors as hex strings for the 2D plan (mirrors the 3D zonePalette).
const PLAN_ZONE_HEX = {
  living: '#79a7a8', service: '#be9b6f', sleeping: '#8f9cc2', wet: '#78a9c8',
  work: '#9ca66a', plant: '#7fbf78', storage: '#9a8575', outdoor: '#9a8f70',
  site: '#9a8f70', garden: '#5f8d49', animal: '#b0895b', paddock: '#b0895b',
  run: '#b0895b', landscape: '#6d8c55', homestead: '#8e7049'
};

// Top-down 2D floor-plan editor: drag rooms to move, drag corners to resize,
// snapped to 0.5 ft. Commits on drop via onMove / onResize. This is the
// natural surface for laying out a first floor.
function PlanView({ spec, selectedRoom, onSelect, onMove, onResize, activeFloor = 1 }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const W = Number(spec.shell.widthFt) || 36;
  const D = Number(spec.shell.depthFt) || 28;
  const pad = Math.max(6, Math.round(Math.max(W, D) * 0.14));
  const snap = (v) => Math.round(v * 2) / 2;

  function clientToFeet(event) {
    const svg = svgRef.current;
    if (!svg) return { fx: 0, fy: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const user = point.matrixTransform(svg.getScreenCTM().inverse());
    return { fx: user.x, fy: user.y };
  }

  function startDrag(event, room, mode) {
    event.stopPropagation();
    event.preventDefault();
    // Capture the pointer to the SVG so move/up keep firing even if the cursor
    // outruns the small handle or leaves a room rect mid-drag.
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    setDrag({ id: room.id, mode, startFx: fx, startFy: fy, orig: { x: Number(room.x), y: Number(room.y), w: Number(room.w), d: Number(room.d) }, ghost: { x: Number(room.x), y: Number(room.y), w: Number(room.w), d: Number(room.d) } });
    onSelect(room.id);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const { fx, fy } = clientToFeet(event);
    const dx = fx - drag.startFx;
    const dy = fy - drag.startFy;
    const o = drag.orig;
    let ghost;
    if (drag.mode === 'move') {
      ghost = { x: clamp(snap(o.x + dx), -pad, W + pad - o.w), y: clamp(snap(o.y + dy), -pad, D + pad - o.d), w: o.w, d: o.d };
    } else {
      // corner resize keeps the opposite corner fixed
      let { x, y, w, d } = o;
      const right = o.x + o.w;
      const bottom = o.y + o.d;
      if (drag.mode.includes('w')) { x = clamp(snap(o.x + dx), right - 60, right - 3); w = right - x; } else if (drag.mode.includes('e')) { w = clamp(snap(o.w + dx), 3, 60); }
      if (drag.mode.includes('n')) { y = clamp(snap(o.y + dy), bottom - 60, bottom - 3); d = bottom - y; } else if (drag.mode.includes('s')) { d = clamp(snap(o.d + dy), 3, 60); }
      ghost = { x, y, w, d };
    }
    setDrag((current) => current && { ...current, ghost });
  }

  function endDrag() {
    if (!drag) return;
    const g = drag.ghost;
    const o = drag.orig;
    if (drag.mode === 'move') {
      if (g.x !== o.x || g.y !== o.y) onMove(drag.id, g.x, g.y);
    } else if (g.w !== o.w || g.d !== o.d || g.x !== o.x || g.y !== o.y) {
      onResize(drag.id, g.x, g.y, g.w, g.d);
    }
    setDrag(null);
  }

  const roomAt = (room) => (drag && drag.id === room.id ? { ...room, ...drag.ghost } : room);
  const gridStep = W > 60 ? 10 : 5;
  const gridLines = [];
  for (let gx = 0; gx <= W + 0.01; gx += gridStep) gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={D} stroke="var(--line)" strokeWidth={0.06} opacity={0.5} />);
  for (let gy = 0; gy <= D + 0.01; gy += gridStep) gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--line)" strokeWidth={0.06} opacity={0.5} />);

  const openings = (spec.openings || []).filter((o) => o.wall !== 'roof');

  return (
    <div className="planWrap">
      <svg
        ref={svgRef}
        className="planSvg"
        viewBox={`${-pad} ${-pad} ${W + pad * 2} ${D + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={() => {}}
      >
        {/* site around the house */}
        <rect x={-pad} y={-pad} width={W + pad * 2} height={D + pad * 2} fill="var(--canvas)" />
        {gridLines}
        {/* shell / exterior wall */}
        <rect x={0} y={0} width={W} height={D} fill="none" stroke="var(--ink3)" strokeWidth={1} />
        <rect x={0.7} y={0.7} width={Math.max(0, W - 1.4)} height={Math.max(0, D - 1.4)} fill="none" stroke="var(--line2)" strokeWidth={0.12} />
        {/* rooms */}
        {(spec.rooms || []).map((raw) => {
          const onFloor = Number(raw.level || 1) === activeFloor;
          if (!onFloor) {
            // other floors: faint ghost for context, not interactive
            return <rect key={raw.id} x={raw.x} y={raw.y} width={raw.w} height={raw.d} fill="var(--ink3)" fillOpacity={0.1} stroke="var(--line)" strokeWidth={0.1} strokeDasharray="0.5 0.5" pointerEvents="none" />;
          }
          const room = roomAt(raw);
          const isSel = raw.id === selectedRoom;
          return (
            <g key={raw.id} style={{ cursor: drag ? 'grabbing' : 'grab' }}>
              <rect
                x={room.x} y={room.y} width={room.w} height={room.d}
                fill={PLAN_ZONE_HEX[raw.type] || '#86a0a8'}
                fillOpacity={isSel ? 0.9 : 0.66}
                stroke={isSel ? 'var(--active-line)' : 'var(--line)'}
                strokeWidth={isSel ? 0.4 : 0.18}
                onPointerDown={(event) => startDrag(event, raw, 'move')}
              />
              <text x={room.x + room.w / 2} y={room.y + room.d / 2 - 0.3} textAnchor="middle" fontSize={Math.min(2, room.w / 5)} fill="#1a1f1d" fontWeight="600" pointerEvents="none">{raw.name}</text>
              <text x={room.x + room.w / 2} y={room.y + room.d / 2 + 1.5} textAnchor="middle" fontSize={Math.min(1.6, room.w / 6)} fill="#2a302d" opacity={0.75} pointerEvents="none">{raw.w}×{raw.d}′</text>
              {isSel && ['nw', 'ne', 'sw', 'se'].map((corner) => {
                const cx = room.x + (corner.includes('e') ? room.w : 0);
                const cy = room.y + (corner.includes('s') ? room.d : 0);
                return <circle key={corner} cx={cx} cy={cy} r={0.9} fill="var(--active-line)" stroke="#fff" strokeWidth={0.15} style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
              })}
            </g>
          );
        })}
        {/* placed elements (heater, tank, garden, coop, stairs…) — dashed to
            read as objects/fixtures rather than rooms; drag + resize like rooms */}
        {(spec.elements || []).filter((el) => el.category !== 'floor' && (Number(el.level || 1) === activeFloor || (/stair|ladder/i.test(el.name || '') && Number(el.level || 1) === activeFloor - 1))).map((raw) => {
          const el = roomAt(raw);
          const isSel = raw.id === selectedRoom;
          const w = Number(el.w) || 4;
          const d = Number(el.d) || 4;
          return (
            <g key={raw.id} style={{ cursor: drag ? 'grabbing' : 'grab' }}>
              <rect
                x={el.x} y={el.y} width={w} height={d}
                fill={PLAN_ELEMENT_HEX[raw.category] || '#8a7768'}
                fillOpacity={isSel ? 0.92 : 0.7}
                stroke={isSel ? 'var(--active-line)' : '#5a5348'}
                strokeWidth={isSel ? 0.4 : 0.22}
                strokeDasharray="0.8 0.5"
                onPointerDown={(event) => startDrag(event, raw, 'move')}
              />
              <text x={el.x + w / 2} y={el.y + d / 2 + 0.5} textAnchor="middle" fontSize={Math.min(1.5, w / 5)} fill="#1a1f1d" fontWeight="600" pointerEvents="none">{raw.name}</text>
              {isSel && ['nw', 'ne', 'sw', 'se'].map((corner) => {
                const cx = el.x + (corner.includes('e') ? w : 0);
                const cy = el.y + (corner.includes('s') ? d : 0);
                return <circle key={corner} cx={cx} cy={cy} r={0.8} fill="var(--active-line)" stroke="#fff" strokeWidth={0.15} style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
              })}
            </g>
          );
        })}
        {/* openings as white gaps on the walls */}
        {openings.map((o, i) => {
          const wide = Number(o.widthFt) || 3;
          if (o.wall === 'north') return <line key={i} x1={o.x} y1={0} x2={o.x + wide} y2={0} stroke="#e8e6dd" strokeWidth={1.1} />;
          if (o.wall === 'south') return <line key={i} x1={o.x} y1={D} x2={o.x + wide} y2={D} stroke="#e8e6dd" strokeWidth={1.1} />;
          if (o.wall === 'east') return <line key={i} x1={W} y1={o.y} x2={W} y2={o.y + wide} stroke="#e8e6dd" strokeWidth={1.1} />;
          if (o.wall === 'west') return <line key={i} x1={0} y1={o.y} x2={0} y2={o.y + wide} stroke="#e8e6dd" strokeWidth={1.1} />;
          return null;
        })}
        {/* dimensions */}
        <text x={W / 2} y={-pad + 1.6} textAnchor="middle" fontSize={2} fill="var(--ink2)">{W}′</text>
        <text x={-pad + 1.6} y={D / 2} textAnchor="middle" fontSize={2} fill="var(--ink2)" transform={`rotate(-90 ${-pad + 1.6} ${D / 2})`}>{D}′</text>
      </svg>
      <div className="planNorth">▲ N</div>
      <div className="planHint">{floorLabel(spec, activeFloor)} plan{floorCount(spec) > 1 ? ' · switch floors top-left' : ''} · drag to move, drag corners to resize (½ ft snap)</div>
    </div>
  );
}

function ThreeScene({ spec, selectedRoom, layers = DEFAULT_MODEL_LAYERS, onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraStateRef = useRef(null);
  const selectedRoomRef = useRef(selectedRoom);
  const callbacksRef = useRef({ onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview });

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    callbacksRef.current = { onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview };
  }, [onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e1cf);
    // Faint atmospheric falloff so the site melts into the paper backdrop.
    scene.fog = new THREE.Fog(0xe9e1cf, 220, 520);

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    if (cameraStateRef.current?.position) {
      camera.position.copy(cameraStateRef.current.position);
    } else {
      camera.position.set(36, 42, 42);
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    if (cameraStateRef.current?.target) {
      controls.target.copy(cameraStateRef.current.target);
    } else {
      controls.target.set(18, 5, 14);
    }
    controls.update();

    // Warm late-morning light: sky slightly cool, bounce warm like dry grass,
    // sun a touch golden with soft-edged shadows sized to the site.
    const hemi = new THREE.HemisphereLight(0xf3f6f9, 0xc4b596, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
    sun.position.set(26, 48, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    scene.add(sun);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const roomMeshes = [];
    const resizeHandles = [];
    const draggableParts = new Map();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragPoint = new THREE.Vector3();
    let dragState = null;

    function renderModel() {
      scene.children.filter((child) => child.userData.generated).forEach((child) => scene.remove(child));
      roomMeshes.length = 0;
      resizeHandles.length = 0;
      draggableParts.clear();

      const group = new THREE.Group();
      group.userData.generated = true;
      const width = spec.shell.widthFt;
      const depth = spec.shell.depthFt;
      const pad = padExtension(spec.shell);
      const padRect = sitePadRect(spec);
      const roofSpec = roofProfile(spec.shell);
      const { extraFt: storeyLift, baseWallFt: baseStoreyFt, storeys } = storeyInfo(spec.shell);
      const wallHeight = roofSpec.highWallHeightFt + storeyLift;
      const southWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.southWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const northWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.northWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const wallProfile = wallAssemblyProfile(spec.systems.envelope);
      const wallT = wallProfile.thicknessFt;

      const slabMat = new THREE.MeshStandardMaterial({ color: 0xc0b49b, roughness: 0.92 });
      const wallMat = new THREE.MeshStandardMaterial({ color: wallProfile.color, roughness: 0.88 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a938f, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb2cc, transparent: true, opacity: 0.55, roughness: 0.12, metalness: 0.1 });
      const zonePalette = {
        living: 0x79a7a8,
        service: 0xbe9b6f,
        sleeping: 0x8f9cc2,
        wet: 0x78a9c8,
        work: 0x9ca66a,
        plant: 0x7fbf78,
        storage: 0x9a8575,
        outdoor: 0x9a8f70,
        site: 0x9a8f70,
        garden: 0x5f8d49,
        animal: 0xb0895b,
        paddock: 0xb0895b,
        run: 0xb0895b,
        landscape: 0x6d8c55,
        homestead: 0x8e7049
      };
      const elementPalette = {
        wall: 0x9f7d54,
        earthwork: 0x7d684f,
        structure: 0x74553d,
        roof: 0x55766f,
        passive: 0xb08b4f,
        thermal: 0x9a5944,
        water: 0x4c88a0,
        plant: 0x6f9b61,
        homestead: 0x8e7049,
        landscape: 0x6d8c55,
        storage: 0x8a7768,
        site: 0x9a8f70,
        garden: 0x5f8d49,
        animal: 0xb0895b,
        floor: 0x8d8473,
        loft: 0x6f7f6a,
        tower: 0x7a5f49,
        custom: 0x8b786d
      };

      const slab = box(padRect.w, padRect.h, padRect.d, padRect.x + padRect.w / 2, -padRect.h / 2, padRect.y + padRect.d / 2, slabMat);
      slab.name = `Site pad (${padRect.w}' x ${padRect.d}')`;
      slab.userData.roomId = 'site-pad';
      slab.userData.footprint = { w: padRect.w, d: padRect.d };
      slab.visible = layers.pad;
      if (layers.pad) roomMeshes.push(slab);
      if (layers.pad && selectedRoom === 'site-pad') {
        const padObject = {
          id: 'site-pad',
          name: 'Site Pad',
          x: padRect.x,
          y: padRect.y,
          w: padRect.w,
          d: padRect.d,
          type: 'site',
          category: 'site-pad'
        };
        const parts = { mesh: slab, label: null, halo: null, handles: [], baseW: padObject.w, baseD: padObject.d, h: padRect.h, w: padObject.w, d: padObject.d };
        draggableParts.set('site-pad', parts);
        const halo = selectionHalo(padObject.w, padObject.d, padObject.x + padObject.w / 2, 0.12, padObject.y + padObject.d / 2);
        parts.halo = halo;
        group.add(halo);
        addResizeHandles(group, parts, 'site-pad', padObject.x, padObject.y, padObject.w, padObject.d, 0.7);
      }
      group.add(slab);

      const omittedWalls = new Set(spec.shell.omittedWalls || []);
      // Per-wall assembly + height: each side reads its own resolved profile so
      // color (material), thickness, and height can differ N/S/E/W.
      const wallResolved = {
        north: resolveWallSide(spec, 'north'),
        south: resolveWallSide(spec, 'south'),
        east: resolveWallSide(spec, 'east'),
        west: resolveWallSide(spec, 'west')
      };
      const wallMatFor = (side) => new THREE.MeshStandardMaterial({ color: wallResolved[side].assembly.color, roughness: 0.88, transparent: layers.xray, opacity: layers.xray ? 0.34 : 1 });
      const tN = wallResolved.north.thicknessFt;
      const tS = wallResolved.south.thicknessFt;
      const tE = wallResolved.east.thicknessFt;
      const tW = wallResolved.west.thicknessFt;
      const hN = roofSpec.roofType === 'shed' ? northWallHeight : wallResolved.north.heightFt + storeyLift;
      const hS = roofSpec.roofType === 'shed' ? southWallHeight : wallResolved.south.heightFt + storeyLift;
      const hE = wallResolved.east.heightFt + storeyLift;
      const hW = wallResolved.west.heightFt + storeyLift;
      const wallMeshSpecs = roofSpec.roofType === 'shed'
        ? [
          { side: 'north', mesh: box(width, hN, tN, width / 2, hN / 2, tN / 2, wallMatFor('north')) },
          { side: 'south', mesh: box(width, hS, tS, width / 2, hS / 2, depth - tS / 2, wallMatFor('south')) },
          { side: 'west', mesh: makeShedSideWall(0, tW, depth, northWallHeight, southWallHeight, wallMatFor('west')) },
          { side: 'east', mesh: makeShedSideWall(width - tE, tE, depth, northWallHeight, southWallHeight, wallMatFor('east')) }
        ]
        : [
          { side: 'north', mesh: box(width, hN, tN, width / 2, hN / 2, tN / 2, wallMatFor('north')) },
          { side: 'south', mesh: box(width, hS, tS, width / 2, hS / 2, depth - tS / 2, wallMatFor('south')) },
          { side: 'west', mesh: box(tW, hW, depth, tW / 2, hW / 2, depth / 2, wallMatFor('west')) },
          { side: 'east', mesh: box(tE, hE, depth, width - tE / 2, hE / 2, depth / 2, wallMatFor('east')) }
        ];
      wallMeshSpecs.forEach(({ side, mesh }) => {
        if (omittedWalls.has(side) || wallResolved[side].omitted) return;
        if (!layers[`wall${titleCase(side)}`]) return;
        mesh.name = `${titleCase(side)} Wall - ${wallResolved[side].assembly.label}`;
        mesh.userData.roomId = `wall-${side}`;
        roomMeshes.push(mesh);
        group.add(mesh);
      });

      const roofLabel = roofSpec.roofType === 'shed' ? `shed roof S ${southWallHeight}' / N ${northWallHeight}'` : 'gable roof';
      if (layers.labels) {
        const assemblyLabel = makeLabel(`${wallProfile.label} - ${wallT}' walls - ${roofLabel}`, 16);
        assemblyLabel.position.set(width / 2, wallHeight + 1.4, depth / 2);
        group.add(assemblyLabel);
      }

      // Stem wall foundation: a visible concrete plinth ring under the walls.
      if (utilitiesOf(spec).foundationType === 'stemwall') {
        const stemH = Math.min(6, Math.max(0.5, Number(utilitiesOf(spec).stemwallHeightFt) || 1.5));
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95 });
        const lip = 0.25;
        const ring = [
          box(width + lip * 2, stemH, tN + lip, width / 2, stemH / 2, tN / 2, stemMat),
          box(width + lip * 2, stemH, tS + lip, width / 2, stemH / 2, depth - tS / 2, stemMat),
          box(tW + lip, stemH, depth + lip * 2, tW / 2, stemH / 2, depth / 2, stemMat),
          box(tE + lip, stemH, depth + lip * 2, width - tE / 2, stemH / 2, depth / 2, stemMat)
        ];
        ring.forEach((segment) => { segment.name = 'Stem wall foundation'; group.add(segment); });
      }

      // Upper floor plate(s): one deck per full-or-partial storey above the first,
      // seated on the ground-storey wall tops, inset by the wall thicknesses.
      if (storeys > 1 && layers.upperFloors) {
        const plateMat = new THREE.MeshStandardMaterial({ color: 0xb3a284, roughness: 0.85, transparent: true, opacity: 0.92 });
        const plate = box(
          Math.max(1, width - tE - tW), 0.4, Math.max(1, depth - tN - tS),
          width / 2, baseStoreyFt + 0.2, depth / 2, plateMat
        );
        plate.name = `Upper floor plate (level 2, ${storeys === 1.5 ? 'loft' : 'full storey'})`;
        group.add(plate);
      }

      if (layers.rooms) spec.rooms.forEach((room) => {
        const roomLift = (Math.max(1, Number(room.level || 1)) - 1) * baseStoreyFt + (Number(room.level || 1) > 1 ? 0.42 : 0);
        const material = new THREE.MeshStandardMaterial({
          color: zonePalette[room.type] || 0x86a0a8,
          transparent: true,
          opacity: room.id === selectedRoom ? 0.88 : 0.58,
          roughness: 0.7
        });
        const mesh = box(room.w, 0.22, room.d, room.x + room.w / 2, 0.05 + roomLift, room.y + room.d / 2, material);
        mesh.name = room.name;
        mesh.userData.roomId = room.id;
        mesh.userData.footprint = { w: room.w, d: room.d };
        mesh.userData.generated = true;
        roomMeshes.push(mesh);
        const parts = { mesh, label: null, halo: null, handles: [], baseW: room.w, baseD: room.d, h: 0.22, w: room.w, d: room.d };
        draggableParts.set(room.id, parts);
        group.add(mesh);
        if (room.id === selectedRoom) {
          const halo = selectionHalo(room.w, room.d, room.x + room.w / 2, 0.26 + roomLift, room.y + room.d / 2);
          parts.halo = halo;
          group.add(halo);
          addResizeHandles(group, parts, room.id, room.x, room.y, room.w, room.d, 0.72 + roomLift);
        }

        if (layers.labels) {
          const label = makeLabel(room.name, room.w);
          label.position.set(room.x + room.w / 2, 0.42 + roomLift, room.y + room.d / 2);
          parts.label = label;
          group.add(label);
        }
      });

      (spec.elements || []).forEach((element) => {
        if (!layers.elements || (layers.hiddenCats || []).includes(element.category || 'custom')) return;
        const elementHeight = element.h || 1.2;
        const elevation = Number(element.z || 0);
        const material = new THREE.MeshStandardMaterial({
          color: elementPalette[element.category] || 0x8a7768,
          transparent: true,
          opacity: element.id === selectedRoom ? 0.9 : 0.66,
          roughness: 0.85
        });
        const mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, material);
        mesh.name = element.name;
        mesh.userData.roomId = element.id;
        mesh.userData.footprint = { w: element.w, d: element.d };
        mesh.userData.generated = true;
        roomMeshes.push(mesh);
        const parts = { mesh, label: null, halo: null, handles: [], baseW: element.w, baseD: element.d, h: elementHeight, z: elevation, w: element.w, d: element.d };
        draggableParts.set(element.id, parts);
        group.add(mesh);
        if (element.id === selectedRoom) {
          const halo = selectionHalo(element.w, element.d, element.x + element.w / 2, elevation + elementHeight + 0.15, element.y + element.d / 2);
          parts.halo = halo;
          group.add(halo);
          addResizeHandles(group, parts, element.id, element.x, element.y, element.w, element.d, elevation + elementHeight + 0.65);
        }

        if (layers.labels) {
          const label = makeLabel(element.name, Math.max(element.w, 8));
          label.position.set(element.x + element.w / 2, elevation + elementHeight + 0.8, element.y + element.d / 2);
          parts.label = label;
          group.add(label);
        }
      });

      const doorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.75 });
      const bayFrameMat = new THREE.MeshStandardMaterial({ color: 0xa08258, roughness: 0.8 });
      const overhangsNow = resolveOverhangs(spec.shell);
      const gableRise = depth * Number(spec.shell.roofPitch || 0.32);
      if (layers.openings) spec.openings.forEach((opening, index) => {
        const size = opening.widthFt;
        const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
        const openH = profile.h;
        const centerY = profile.sill + openH / 2;
        const mat = profile.glazed ? glassMat : doorMat;
        let mesh;
        if (opening.wall === 'roof') {
          // Skylight: a glass panel lying on the roof plane, tilted to the slope.
          const cx = (Number(opening.x) || 0) + size / 2;
          const cz = (Number(opening.y) || 0) + size / 2;
          mesh = box(size, 0.16, size, cx, 0, cz, glassMat);
          if (roofSpec.roofType === 'shed') {
            const totalD = depth + overhangsNow.north + overhangsNow.south;
            const t = (cz + overhangsNow.north) / totalD;
            mesh.position.y = northWallHeight + 0.28 + (southWallHeight - northWallHeight) * t + 0.22;
            mesh.rotation.x = Math.atan2(southWallHeight - northWallHeight, totalD);
          } else {
            const halfRun = width / 2 + overhangsNow.west;
            const onWest = cx < width / 2;
            const t = onWest ? (cx + overhangsNow.west) / halfRun : (width + overhangsNow.east - cx) / (width / 2 + overhangsNow.east);
            mesh.position.y = wallHeight + 0.25 + Math.max(0, gableRise - 0.25) * Math.min(1, Math.max(0, t)) + 0.22;
            const slopeAngle = Math.atan2(Math.max(0, gableRise - 0.25), width / 2);
            mesh.rotation.z = onWest ? slopeAngle : -slopeAngle;
          }
        } else if (profile.bay) {
          // Bay window: a wood-framed box pushed out from the wall, glass on its face.
          const bayD = 1.4;
          let glassFace = null;
          if (opening.wall === 'south') {
            mesh = box(size, openH, bayD, opening.x + size / 2, centerY, depth + bayD / 2, bayFrameMat);
            glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, depth + bayD + 0.06, glassMat);
          } else if (opening.wall === 'north') {
            mesh = box(size, openH, bayD, opening.x + size / 2, centerY, -bayD / 2, bayFrameMat);
            glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, -bayD - 0.06, glassMat);
          } else if (opening.wall === 'east') {
            mesh = box(bayD, openH, size, width + bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
            glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), width + bayD + 0.06, centerY, opening.y + size / 2, glassMat);
          } else {
            mesh = box(bayD, openH, size, -bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
            glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), -bayD - 0.06, centerY, opening.y + size / 2, glassMat);
          }
          if (glassFace) group.add(glassFace);
        } else {
          if (opening.wall === 'north') mesh = box(size, openH, 0.18, opening.x + size / 2, centerY, -0.08, mat);
          if (opening.wall === 'south') mesh = box(size, openH, 0.18, opening.x + size / 2, centerY, depth + 0.08, mat);
          if (opening.wall === 'east') mesh = box(0.18, openH, size, width + 0.08, centerY, opening.y + size / 2, mat);
          if (opening.wall === 'west') mesh = box(0.18, openH, size, -0.08, centerY, opening.y + size / 2, mat);
        }
        if (mesh) {
          mesh.name = opening.label || `${opening.wall} ${opening.type}`;
          mesh.userData.roomId = `opening-${index}`;
          roomMeshes.push(mesh);
          group.add(mesh);
        }
      });

      if (layers.roof) {
        if (layers.xray) {
          roofMat.transparent = true;
          roofMat.opacity = 0.4;
        }
        const roof = makeRoof(width, depth, wallHeight, spec.shell.roofPitch, roofMat, roofSpec, resolveOverhangs(spec.shell));
        roof.userData.roomId = 'roof-main';
        roomMeshes.push(roof);
        group.add(roof);
      }

      const fixedGridSize = Number(spec.shell.outdoorGridSizeFt || DEFAULT_OUTDOOR_GRID_SIZE_FT);
      // The land itself: a soft green ground plane under everything, so the
      // model reads as a house on a site rather than a box in a void.
      if (layers.ground) {
      // The land fades out at its edges instead of ending in a hard square —
      // a radial meadow-green wash painted onto a canvas texture.
      const groundCanvas = document.createElement('canvas');
      groundCanvas.width = 256;
      groundCanvas.height = 256;
      const groundCtx = groundCanvas.getContext('2d');
      const fade = groundCtx.createRadialGradient(128, 128, 30, 128, 128, 128);
      fade.addColorStop(0, 'rgba(168, 177, 141, 1)');
      fade.addColorStop(0.62, 'rgba(168, 177, 141, 0.95)');
      fade.addColorStop(0.85, 'rgba(180, 184, 155, 0.45)');
      fade.addColorStop(1, 'rgba(190, 190, 168, 0)');
      groundCtx.fillStyle = fade;
      groundCtx.fillRect(0, 0, 256, 256);
      const groundPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(fixedGridSize * 2.5, fixedGridSize * 2.5),
        new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(groundCanvas), transparent: true, roughness: 1 })
      );
      groundPlane.rotation.x = -Math.PI / 2;
      groundPlane.position.set(width / 2, -0.52, depth / 2);
      groundPlane.receiveShadow = true;
      groundPlane.userData.generated = true;
      group.add(groundPlane);

      const grid = new THREE.GridHelper(fixedGridSize, Math.max(48, Math.round(fixedGridSize / 4)), 0x6e6a58, 0x8b8672);
      grid.material.transparent = true;
      grid.material.opacity = 0.8;
      // Just above the pad's top surface (y=0) so the scale grid peeks through
      // the site pad instead of being buried under it.
      grid.position.set(width / 2, 0.03, depth / 2);
      grid.name = `Fixed outdoor reference grid (${fixedGridSize}' x ${fixedGridSize}')`;
      grid.userData.generated = true;
      group.add(grid);
      }

      scene.add(group);
    }

    function box(sx, sy, sz, x, y, z, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }

    function makeShedSideWall(x, thickness, depth, northHeight, southHeight, material) {
      const geometry = new THREE.BufferGeometry();
      const x0 = x;
      const x1 = x + thickness;
      const vertices = new Float32Array([
        x0, 0, 0, x1, 0, 0, x1, northHeight, 0, x0, northHeight, 0,
        x0, 0, depth, x1, 0, depth, x1, southHeight, depth, x0, southHeight, depth
      ]);
      const indices = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        3, 2, 6, 3, 6, 7,
        0, 3, 7, 0, 7, 4,
        1, 5, 6, 1, 6, 2
      ];
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }

    function addResizeHandles(group, parts, id, x, y, width, depth, height) {
      const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x174f45, roughness: 0.45 });
      const points = [
        { corner: 'nw', x, z: y },
        { corner: 'ne', x: x + width, z: y },
        { corner: 'se', x: x + width, z: y + depth },
        { corner: 'sw', x, z: y + depth }
      ];
      points.forEach((point) => {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), handleMaterial);
        handle.position.set(point.x, height, point.z);
        handle.userData.generated = true;
        handle.userData.resizeHandle = { id, corner: point.corner };
        handle.castShadow = true;
        handle.receiveShadow = true;
        resizeHandles.push(handle);
        parts.handles.push(handle);
        group.add(handle);
      });
    }

    function makeRoof(width, depth, wallHeight, pitch, material, roofSpec, overhangs) {
      const rise = depth * pitch;
      const o = overhangs || { north: 1.6, south: 1.6, east: 1.6, west: 1.6 };
      if (roofSpec.roofType === 'shed') {
        const geometry = new THREE.BufferGeometry();
        const southHeight = roofSpec.southWallHeightFt + 0.28;
        const northHeight = roofSpec.northWallHeightFt + 0.28;
        const vertices = new Float32Array([
          -o.west, northHeight, -o.north,
          width + o.east, northHeight, -o.north,
          width + o.east, southHeight, depth + o.south,
          -o.west, southHeight, depth + o.south
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.generated = true;
        mesh.name = 'Shed / lean-to roof plane';
        return mesh;
      }
      if (roofSpec.roofType === 'flat') {
        // A near-flat roof: one horizontal plane just above the walls, extended
        // to the overhangs. (Low-slope drainage is left implicit at this scale.)
        const y = wallHeight + 0.25;
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          -o.west, y, -o.north,
          width + o.east, y, -o.north,
          width + o.east, y, depth + o.south,
          -o.west, y, depth + o.south
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.generated = true;
        mesh.name = 'Flat roof plane';
        return mesh;
      }
      if (roofSpec.roofType === 'hip') {
        // A hip roof: all four sides slope up to a ridge. The ridge runs along
        // the longer axis and is inset from the short ends by half the short
        // span (a standard 45° hip), collapsing to a point when the plan is
        // square. Two trapezoids on the long sides, two triangles on the ends.
        const x0 = -o.west, x1 = width + o.east, z0 = -o.north, z1 = depth + o.south;
        const spanX = x1 - x0, spanZ = z1 - z0;
        const ridgeY = wallHeight + Math.min(spanX, spanZ) / 2 * pitch;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        let rA, rB;
        if (spanX >= spanZ) {
          const inset = spanZ / 2;
          rA = [x0 + inset, ridgeY, cz];
          rB = [x1 - inset, ridgeY, cz];
        } else {
          const inset = spanX / 2;
          rA = [cx, ridgeY, z0 + inset];
          rB = [cx, ridgeY, z1 - inset];
        }
        const c00 = [x0, wallHeight, z0], c10 = [x1, wallHeight, z0], c11 = [x1, wallHeight, z1], c01 = [x0, wallHeight, z1];
        // Wind each face counter-clockwise seen from outside so normals point up/out.
        const faces = spanX >= spanZ
          ? [[c00, c10, rB, rA], [c11, c01, rA, rB], [c10, c11, rB], [c01, c00, rA]]
          : [[c10, c11, rB, rA], [c01, c00, rA, rB], [c00, c10, rA], [c11, c01, rB]];
        const verts = [];
        for (const face of faces) {
          const [p0, p1, p2, p3] = face;
          verts.push(...p0, ...p1, ...p2);
          if (p3) verts.push(...p0, ...p2, ...p3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.generated = true;
        mesh.name = 'Hip roof';
        return mesh;
      }
      const shape = new THREE.Shape();
      shape.moveTo(-o.west, wallHeight);
      shape.lineTo(width + o.east, wallHeight);
      shape.lineTo(width + o.east, wallHeight + 0.25);
      shape.lineTo(width / 2, wallHeight + rise);
      shape.lineTo(-o.west, wallHeight + 0.25);
      shape.lineTo(-o.west, wallHeight);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth + o.north + o.south, bevelEnabled: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, -o.north);
      mesh.userData.generated = true;
      return mesh;
    }

    function makeLabel(text, roomWidth) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(251, 250, 246, 0.94)';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = 'rgba(60, 100, 114, 0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, 508, 124);
      ctx.fillStyle = '#26424C';
      ctx.font = '600 44px "Source Sans 3", Aptos, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 64, 470);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(Math.min(Math.max(roomWidth, 7), 11), 2.6, 1);
      sprite.userData.generated = true;
      return sprite;
    }

    function selectionHalo(width, depth, x, y, z) {
      const shape = new THREE.Shape();
      const pad = 0.35;
      shape.moveTo(-width / 2 - pad, -depth / 2 - pad);
      shape.lineTo(width / 2 + pad, -depth / 2 - pad);
      shape.lineTo(width / 2 + pad, depth / 2 + pad);
      shape.lineTo(-width / 2 - pad, depth / 2 + pad);
      shape.lineTo(-width / 2 - pad, -depth / 2 - pad);
      const points = shape.getPoints();
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, 0, point.y)));
      const material = new THREE.LineBasicMaterial({ color: 0x3c6472, linewidth: 3 });
      const line = new THREE.Line(geometry, material);
      line.position.set(x, y, z);
      line.userData.generated = true;
      return line;
    }

    function updatePointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    }

    function onPointerDown(event) {
      updatePointer(event);
      const handleHit = raycaster.intersectObjects(resizeHandles, false)[0];
      if (handleHit?.object?.userData?.resizeHandle) {
        const { id, corner } = handleHit.object.userData.resizeHandle;
        const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === id);
        if (!object) return;
        callbacksRef.current.onSelectRoom(id);
        renderer.domElement.setPointerCapture(event.pointerId);
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const anchor = {
          nw: { x: object.x + object.w, z: object.y + object.d },
          ne: { x: object.x, z: object.y + object.d },
          se: { x: object.x, z: object.y },
          sw: { x: object.x + object.w, z: object.y }
        }[corner];
        dragState = {
          mode: 'resize',
          id,
          pointerId: event.pointerId,
          corner,
          anchorX: anchor.x,
          anchorZ: anchor.z,
          startX: dragPoint.x,
          startZ: dragPoint.z,
          original: { x: object.x, y: object.y, w: object.w, d: object.d },
          bounds: objectBounds(spec, object),
          began: false,
          moved: false
        };
        return;
      }
      const hit = raycaster.intersectObjects(roomMeshes, false)[0];
      if (!hit?.object?.userData?.roomId) return;
      const objectId = hit.object.userData.roomId;
      const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === objectId);
      if (!object) {
        callbacksRef.current.onSelectRoom(objectId);
        return;
      }
      if (objectId === 'site-pad' || objectId === 'roof-main' || objectId.startsWith('opening-')) {
        callbacksRef.current.onSelectRoom(objectId);
        return;
      }
      renderer.domElement.setPointerCapture(event.pointerId);
      if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
      const footprint = hit.object.userData.footprint || { w: 1, d: 1 };
      dragState = {
        id: objectId,
        pointerId: event.pointerId,
        startX: dragPoint.x,
        startZ: dragPoint.z,
        offsetX: dragPoint.x - hit.object.position.x,
        offsetZ: dragPoint.z - hit.object.position.z,
        w: footprint.w,
        d: footprint.d,
        bounds: objectBounds(spec, object),
        moved: false,
        began: false
      };
    }

    function onPointerMove(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      updatePointer(event);
      if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
      const delta = Math.hypot(dragPoint.x - dragState.startX, dragPoint.z - dragState.startZ);
      if (!dragState.began && delta < 0.25) return;
      if (!dragState.began) {
        dragState.began = true;
        callbacksRef.current.onMoveStart();
        controls.enabled = false;
        renderer.domElement.style.cursor = dragState.mode === 'resize' ? 'nwse-resize' : 'grabbing';
      }
      dragState.moved = true;
      const bounds = dragState.bounds || { minX: 0, minY: 0, maxX: spec.shell.widthFt, maxY: spec.shell.depthFt };
      if (dragState.mode === 'resize') {
        const minSize = 4;
        const px = clamp(Math.round(dragPoint.x * 2) / 2, bounds.minX, bounds.maxX);
        const pz = clamp(Math.round(dragPoint.z * 2) / 2, bounds.minY, bounds.maxY);
        const rawX = Math.min(px, dragState.anchorX);
        const rawY = Math.min(pz, dragState.anchorZ);
        let nextW = Math.max(minSize, Math.abs(px - dragState.anchorX));
        let nextD = Math.max(minSize, Math.abs(pz - dragState.anchorZ));
        let nextX = rawX;
        let nextY = rawY;
        if (nextX + nextW > bounds.maxX) nextW = bounds.maxX - nextX;
        if (nextY + nextD > bounds.maxY) nextD = bounds.maxY - nextY;
        nextX = clamp(Math.round(nextX * 10) / 10, bounds.minX, Math.max(bounds.minX, bounds.maxX - nextW));
        nextY = clamp(Math.round(nextY * 10) / 10, bounds.minY, Math.max(bounds.minY, bounds.maxY - nextD));
        nextW = clamp(Math.round(nextW * 10) / 10, minSize, bounds.maxX - nextX);
        nextD = clamp(Math.round(nextD * 10) / 10, minSize, bounds.maxY - nextY);
        dragState.finalX = nextX;
        dragState.finalY = nextY;
        dragState.finalW = nextW;
        dragState.finalD = nextD;
        updateObjectParts(dragState.id, nextX, nextY, nextW, nextD);
        callbacksRef.current.onDimensionPreview({ id: dragState.id, w: nextW, d: nextD, x: nextX, y: nextY, mode: 'resize' });
        return;
      }
      const centerX = clamp(Math.round((dragPoint.x - dragState.offsetX) * 2) / 2, bounds.minX + dragState.w / 2, bounds.maxX - dragState.w / 2);
      const centerZ = clamp(Math.round((dragPoint.z - dragState.offsetZ) * 2) / 2, bounds.minY + dragState.d / 2, bounds.maxY - dragState.d / 2);
      dragState.finalX = Math.round((centerX - dragState.w / 2) * 10) / 10;
      dragState.finalY = Math.round((centerZ - dragState.d / 2) * 10) / 10;
      updateObjectParts(dragState.id, dragState.finalX, dragState.finalY, dragState.w, dragState.d);
      callbacksRef.current.onDimensionPreview({ id: dragState.id, w: dragState.w, d: dragState.d, x: dragState.finalX, y: dragState.finalY, mode: 'move' });
    }

    function updateObjectParts(id, x, y, width, depth) {
      const parts = draggableParts.get(id);
      if (!parts) return;
      const centerX = x + width / 2;
      const centerZ = y + depth / 2;
      if (parts.mesh) {
        parts.mesh.position.x = centerX;
        parts.mesh.position.z = centerZ;
        parts.mesh.scale.x = width / parts.baseW;
        parts.mesh.scale.z = depth / parts.baseD;
        parts.mesh.userData.footprint = { w: width, d: depth };
      }
      if (parts.label) {
        parts.label.position.x = centerX;
        parts.label.position.z = centerZ;
        parts.label.scale.x = Math.min(width, 9);
      }
      if (parts.halo) {
        parts.halo.position.x = centerX;
        parts.halo.position.z = centerZ;
        parts.halo.scale.x = width / parts.w;
        parts.halo.scale.z = depth / parts.d;
      }
      const handlePoints = [
        { x, z: y },
        { x: x + width, z: y },
        { x: x + width, z: y + depth },
        { x, z: y + depth }
      ];
      parts.handles.forEach((handle, index) => {
        const point = handlePoints[index];
        if (point) handle.position.set(point.x, handle.position.y, point.z);
      });
    }

    function onPointerUp(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const finished = dragState;
      dragState = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = '';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      callbacksRef.current.onDimensionPreview(null);
      if (finished.mode === 'resize' && finished.moved && Number.isFinite(finished.finalW) && Number.isFinite(finished.finalD)) {
        callbacksRef.current.onResizeEnd(finished.id, finished.finalW, finished.finalD, finished.finalX, finished.finalY);
      } else if (finished.moved && Number.isFinite(finished.finalX) && Number.isFinite(finished.finalY)) {
        callbacksRef.current.onMoveEnd(finished.id, finished.finalX, finished.finalY);
      } else {
        callbacksRef.current.onSelectRoom(finished.id);
      }
    }

    function animate() {
      controls.update();
      renderer.render(scene, camera);
      sceneRef.current = { renderer, scene, camera };
      requestAnimationFrame(animate);
    }

    function resize() {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    }

    renderModel();
    animate();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', resize);

    return () => {
      cameraStateRef.current = {
        position: camera.position.clone(),
        target: controls.target.clone()
      };
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', resize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [spec, selectedRoom, layers]);

  return <div className="scene" ref={mountRef} aria-label="Interactive 3D BIM model" />;
}

function PlanMoveBoard({ spec, selectedRoom, selectedObject, onSelectRoom, onRename, onMoveStart, onMove, onMoveEnd, onResize, onResizeEnd, onQuickMove, onNudge, onAddRoom }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const shellW = spec.shell.widthFt;
  const shellD = spec.shell.depthFt;

  function pointToFeet(event) {
    const rect = boardRef.current.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * shellW, 0, shellW),
      y: clamp(((event.clientY - rect.top) / rect.height) * shellD, 0, shellD)
    };
  }

  function startDrag(event, room) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointToFeet(event);
    dragRef.current = {
      id: room.id,
      pointerId: event.pointerId,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y
    };
    onSelectRoom(room.id);
    onMoveStart();
  }

  function startResize(event, room) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: 'resize',
      id: room.id,
      pointerId: event.pointerId
    };
    onSelectRoom(room.id);
    onMoveStart();
  }

  function dragMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const room = spec.rooms.find((item) => item.id === drag.id);
    if (!room) return;
    const point = pointToFeet(event);
    if (drag.mode === 'resize') {
      const nextW = clamp(Math.round((point.x - room.x) * 2) / 2, 4, Math.max(4, shellW - room.x));
      const nextD = clamp(Math.round((point.y - room.y) * 2) / 2, 4, Math.max(4, shellD - room.y));
      dragRef.current = { ...drag, w: nextW, d: nextD };
      onResize(room.id, nextW, nextD, false);
      return;
    }
    const nextX = clamp(Math.round((point.x - drag.offsetX) * 2) / 2, 0, Math.max(0, shellW - room.w));
    const nextY = clamp(Math.round((point.y - drag.offsetY) * 2) / 2, 0, Math.max(0, shellD - room.d));
    dragRef.current = { ...drag, x: nextX, y: nextY };
    onMove(room.id, nextX, nextY, false);
  }

  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const room = spec.rooms.find((item) => item.id === drag.id);
    dragRef.current = null;
    if (room && drag.mode === 'resize') {
      onResizeEnd(room.id, drag.w ?? room.w, drag.d ?? room.d);
      return;
    }
    if (room) onMoveEnd(room.id, drag.x ?? room.x, drag.y ?? room.y);
  }

  return (
    <div className="planMove">
      <div className="sectionHead"><Grid3X3 size={17} /> Plan Move Board</div>
      <label className="planNameEdit">
        <span>Name</span>
        <input value={selectedObject?.name || ''} onChange={(event) => onRename(event.target.value)} />
      </label>
      <div className="planBoard" ref={boardRef} aria-label="Drag rooms on plan">
        <span className="planNorth">N</span>
        {spec.rooms.map((room) => (
          <button
            key={room.id}
            className={room.id === selectedRoom ? `planRoom ${room.type} active` : `planRoom ${room.type}`}
            style={{
              left: `${(room.x / shellW) * 100}%`,
              top: `${(room.y / shellD) * 100}%`,
              width: `${(room.w / shellW) * 100}%`,
              height: `${(room.d / shellD) * 100}%`
            }}
            onClick={() => onSelectRoom(room.id)}
            onPointerDown={(event) => startDrag(event, room)}
            onPointerMove={dragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span>{room.name}</span>
            <i
              className="resizeHandle"
              aria-hidden="true"
              onPointerDown={(event) => startResize(event, room)}
              onPointerMove={dragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </button>
        ))}
      </div>
      <div className="moveControls">
        <button className="secondary addPlanRoom" onClick={onAddRoom}><Plus size={14} /> Add Room</button>
        {['NW', 'N', 'NE', 'W', 'Center', 'E', 'SW', 'S', 'SE'].map((target) => (
          <button key={target} className="ghost" onClick={() => onQuickMove(target)}>{target}</button>
        ))}
      </div>
      <div className="nudgeControls">
        <button className="ghost" onClick={() => onNudge(0, -1)}>Nudge N</button>
        <button className="ghost" onClick={() => onNudge(-1, 0)}>W</button>
        <button className="ghost" onClick={() => onNudge(1, 0)}>E</button>
        <button className="ghost" onClick={() => onNudge(0, 1)}>Nudge S</button>
      </div>
    </div>
  );
}

function App() {
  const initialSaved = loadSavedDashboardState();
  const [projectId, setProjectId] = useState(() => initialSaved?.projectId || 'current-project');
  const [spec, setSpec] = useState(() => initialSaved?.spec || seedSpec);
  const [systemView, setSystemView] = useState('shell');
  const [wallBreakOpen, setWallBreakOpen] = useState(false);
  const [wallOpeningType, setWallOpeningType] = useState('window');
  const [windowAddWall, setWindowAddWall] = useState('south');
  const [overhangBreakOpen, setOverhangBreakOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => initialSaved?.prompt || DEFAULT_PROMPT);
  const [selectedRoom, setSelectedRoom] = useState(() => initialSaved?.selectedRoom || 'great');
  const [imagePreview, setImagePreview] = useState('');
  const [attachedImages, setAttachedImages] = useState([]);
  const [chatMessages, setChatMessages] = useState(() => cleanSavedChatMessages(initialSaved?.chatMessages));
  const [chatTarget, setChatTarget] = useState(() => initialSaved?.chatTarget || 'design');
  const [addToTarget, setAddToTarget] = useState(() => initialSaved?.addToTarget || 'auto');
  const [selectedExpertId, setSelectedExpertId] = useState(() => initialSaved?.selectedExpertId || 'team');
  const [expertQuestion, setExpertQuestion] = useState(() => initialSaved?.expertQuestion || DEFAULT_EXPERT_QUESTION);
  const [revisionLog, setRevisionLog] = useState(() => initialSaved?.revisionLog || ['Rev 1: Baseline professional schematic loaded.']);
  const [history, setHistory] = useState(() => initialSaved?.history || []);
  const [lastModelChange, setLastModelChange] = useState(() => initialSaved?.lastModelChange || 'Baseline model loaded.');
  const [operationAudit, setOperationAudit] = useState(() => initialSaved?.operationAudit || []);
  const [projectBrain, setProjectBrain] = useState(() => ensureProjectBrain(initialSaved?.projectBrain, initialSaved?.spec || seedSpec));
  const [clipboardObject, setClipboardObject] = useState(null);
  const [consoleView, setConsoleView] = useState('systems');
  const [appMode, setAppMode] = useState('design');
  const [viewMode, setViewMode] = useState('3d');
  const [activeFloor, setActiveFloor] = useState(1);
  const [buildProgress, setBuildProgress] = useState(() => initialSaved?.buildProgress || {});
  const [inspectorView, setInspectorView] = useState('inspect');
  const [dimensionPreview, setDimensionPreview] = useState(null);
  const [savedAt, setSavedAt] = useState(() => initialSaved?.savedAt || '');
  const [libraryActionMode, setLibraryActionMode] = useState(() => initialSaved?.libraryActionMode || 'apply');
  const [modelLayers, setModelLayers] = useState(() => ({ ...DEFAULT_MODEL_LAYERS, ...(initialSaved?.modelLayers || {}) }));
  const [layersOpen, setLayersOpen] = useState(false);
  // First run (nothing saved anywhere): ask how to begin instead of silently
  // dropping the visitor into a finished sample house. Also reusable as "New".
  const [welcomeOpen, setWelcomeOpen] = useState(() => !initialSaved);
  const [welcomeIsFirstRun, setWelcomeIsFirstRun] = useState(() => !initialSaved);
  const [welcomeName, setWelcomeName] = useState('');
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState([]);
  const [geoStatus, setGeoStatus] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const planDragRevisionRef = useRef(false);
  const chatStreamRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const backendReadyRef = useRef(false);

  const issues = useMemo(() => detectIssues(spec), [spec]);
  const council = useMemo(() => runCouncil(spec), [spec]);
  const wallSections = useMemo(() => getWallSections(spec), [spec]);
  const specialBimObjects = useMemo(() => getSpecialBimObjects(spec), [spec]);
  const selected = spec.rooms.find((room) => room.id === selectedRoom) || (spec.elements || []).find((element) => element.id === selectedRoom) || wallSections.find((wall) => wall.id === selectedRoom) || specialBimObjects.find((object) => object.id === selectedRoom) || spec.rooms[0];
  const selectedIsElement = Boolean((spec.elements || []).some((element) => element.id === selectedRoom));
  const selectedIsWall = Boolean(wallSections.some((wall) => wall.id === selectedRoom));
  const selectedIsSpecial = Boolean(specialBimObjects.some((object) => object.id === selectedRoom));
  const selectedIsOpening = selected?.category === 'opening';
  const selectedIsPad = selected?.id === 'site-pad';
  const selectedIsGrid = selected?.id === 'outdoor-grid';
  const selectedIsRoof = selected?.id === 'roof-main';
  const selectedExpert = selectedExpertId === 'team' ? null : expertCouncil.find((expert) => expert.id === selectedExpertId);
  const modeledWallProfile = wallAssemblyProfile(spec.systems.envelope);
  const modeledRoofProfile = roofProfile(spec.shell);
  const area = Math.round(spec.shell.widthFt * spec.shell.depthFt);
  const qualityScore = Math.max(42, 100 - issues.filter((item) => item.severity !== 'pass').length * 16);
  const openFlagCount = issues.filter((item) => item.severity !== 'pass').length;
  const flaggedSystems = useMemo(() => new Set(issues.filter((item) => item.severity !== 'pass' && item.system).map((item) => item.system)), [issues]);
  const derived = useMemo(() => deriveDesign(spec, wallSections), [spec, wallSections]);
  const estimatedCost = Math.round(derived.total);
  // How filtered is the model view? (Hidden groups never change the design or
  // the numbers — this powers the "partial view" cue so that stays obvious.)
  const hiddenLayerCount = useMemo(() => {
    const visibilityKeys = ['wallNorth', 'wallSouth', 'wallEast', 'wallWest', 'roof', 'rooms', 'openings', 'elements', 'pad', 'ground', 'labels'];
    if (storeyInfo(spec.shell).storeys > 1) visibilityKeys.push('upperFloors');
    return visibilityKeys.filter((key) => modelLayers[key] === false).length + (modelLayers.hiddenCats || []).length;
  }, [modelLayers, spec]);
  const contextPacket = useMemo(() => buildContextPacket(spec, projectBrain, selected, prompt || expertQuestion), [spec, projectBrain, selected, prompt, expertQuestion]);

  function restoreDashboardState(snapshot) {
    if (!snapshot?.spec?.shell || !Array.isArray(snapshot.spec.rooms)) return;
    setProjectId(snapshot.projectId || 'current-project');
    setSpec(snapshot.spec);
    setPrompt(snapshot.prompt || DEFAULT_PROMPT);
    setSelectedRoom(snapshot.selectedRoom || snapshot.spec.rooms[0]?.id || 'great');
    setChatMessages(cleanSavedChatMessages(snapshot.chatMessages));
    setChatTarget(snapshot.chatTarget || 'design');
    setAddToTarget(snapshot.addToTarget || 'auto');
    setSelectedExpertId(snapshot.selectedExpertId || 'team');
    setExpertQuestion(snapshot.expertQuestion || DEFAULT_EXPERT_QUESTION);
    setRevisionLog(snapshot.revisionLog || ['Rev 1: Baseline professional schematic loaded.']);
    setHistory(snapshot.history || []);
    setLastModelChange(snapshot.lastModelChange || 'Baseline model loaded.');
    setOperationAudit(snapshot.operationAudit || []);
    setProjectBrain(ensureProjectBrain(snapshot.projectBrain, snapshot.spec));
    setSavedAt(snapshot.savedAt || '');
    setLibraryActionMode(snapshot.libraryActionMode || 'apply');
    setModelLayers({ ...DEFAULT_MODEL_LAYERS, ...(snapshot.modelLayers || {}) });
    setBuildProgress(snapshot.buildProgress || {});
  }

  function currentDashboardState(custom = {}) {
    return buildDashboardStatePayload({
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
      ...custom
    });
  }

  function startNewDesign(template) {
    const next = structuredClone(seedSpec);
    next.revision = 1;
    if (template === 'blank') {
      next.rooms = [];
      next.elements = [];
      next.openings = [];
      next.levels = [];
    }
    next.projectName = welcomeName.trim() || (template === 'blank' ? 'My Natural Home' : 'Sample Homestead Study');
    const startLine = template === 'blank'
      ? 'Rev 1: A fresh start — an empty shell on the land. Add rooms, or describe the home you want in the chat.'
      : 'Rev 1: Sample homestead loaded as a starting point — everything in it is yours to change.';
    setSpec(next);
    setHistory([]);
    setRevisionLog([startLine]);
    setChatMessages([]);
    setOperationAudit([]);
    setSelectedRoom(next.rooms[0]?.id || 'site-pad');
    setLastModelChange(template === 'blank' ? 'Fresh start on empty land.' : 'Sample homestead loaded.');
    setProjectBrain(ensureProjectBrain(null, next));
    setModelLayers({ ...DEFAULT_MODEL_LAYERS });
    setWelcomeName('');
    setWelcomeOpen(false);
    setWelcomeIsFirstRun(false);
  }

  async function answerConsultativePrompt(submittedPrompt) {
    try {
      const result = await requestStudioResponse({
        prompt: submittedPrompt,
        bim: spec,
        spec,
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submittedPrompt)
      });
      const reply = result.reply || buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
      const warningText = result.warnings?.length ? `\n\nNotes:\n- ${result.warnings.join('\n- ')}` : '';
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: `${reply}${warningText}` }
      ]);
      setRevisionLog((items) => [`Studio consult: answered "${submittedPrompt}" without changing the BIM.`, ...items]);
    } catch (error) {
      const reply = buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: `${reply}\n\nNote: Studio vision/analysis was unavailable just now (${error.message}), so I answered from the live BIM state only.` }
      ]);
      setRevisionLog((items) => [`Studio consult fallback: answered "${submittedPrompt}" while studio analysis was unavailable.`, ...items]);
    }
  }

  async function applyBackendOperations({
    operations,
    promptText,
    logPrefix = 'BIM edit',
    chatText = '',
    nextSelectedId = null,
    persist = true,
    baseSpec = null
  }) {
    // Chained UI actions (add-then-arrange) must apply to the spec returned by
    // the prior step, not stale component state, or the second call clobbers
    // the first. baseSpec lets a caller pass that fresh spec explicitly.
    const source = baseSpec || spec;
    const plan = {
      source: 'manual-ui',
      summary: promptText,
      operations,
      warnings: [],
      assumptions: [],
      questions: []
    };
    let result;
    try {
      result = await requestServerAppliedBim({
        prompt: promptText,
        bim: source,
        spec: source,
        state: currentDashboardState(),
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        addToTarget,
        attachedImages: [],
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(source, projectBrain, selected, promptText),
        plan,
        persist
      });
    } catch (error) {
      // A change must never vanish silently — say so where the user is looking.
      setLastModelChange(`"${promptText}" did not apply — the design service didn't respond. Try it again.`);
      setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: `"${promptText}" didn't save (${error?.message || 'no response'}). Nothing changed — try it once more.` }]);
      return null;
    }
    const report = result.report;
    rememberRevision();
    setSpec(report.spec);
    recordOperationAudit(promptText, plan, report, spec.revision, report.spec.revision);
    const chosenId = nextSelectedId || report.changedIds[0];
    if (chosenId) setSelectedRoom(chosenId);
    if (report.actions[0]) setLastModelChange(report.actions[0]);
    if (chatText) {
      setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: chatText || report.actions[0] }]);
    }
    setRevisionLog((items) => [`Rev ${report.spec.revision}: ${logPrefix}${report.actions[0] ? ` - ${report.actions[0]}` : ''}`, ...items]);
    return report;
  }

  useEffect(() => {
    if (activeFloor > floorCount(spec)) setActiveFloor(1);
  }, [spec, activeFloor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await requestCurrentProjectState();
        if (!cancelled && result?.state?.spec) {
          restoreDashboardState(result.state);
          setWelcomeOpen(false);
          setWelcomeIsFirstRun(false);
        }
      } catch (error) {
        console.warn('Backend project load skipped:', error);
      } finally {
        backendReadyRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const payload = buildDashboardStatePayload({
      projectId,
      savedAt: now,
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
      buildProgress
    });
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(payload));
      if (backendReadyRef.current) {
        void saveDashboardStateToBackend(payload).catch((error) => {
          console.warn('Backend autosave skipped:', error);
        });
      }
    }, 250);
    if (!savedAt) setSavedAt(now);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [projectId, spec, selectedRoom, libraryActionMode, chatMessages, chatTarget, addToTarget, selectedExpertId, expertQuestion, prompt, operationAudit, projectBrain, modelLayers, buildProgress]);

  useEffect(() => {
    const stream = chatStreamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    function onKeyDown(event) {
      const key = event.key.toLowerCase();
      const active = document.activeElement;
      const isTyping = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      const isModifier = event.ctrlKey || event.metaKey;

      if (isModifier && key === 's') {
        event.preventDefault();
        saveHouseState();
        return;
      }

      if (isModifier && key === 'enter') {
        event.preventDefault();
        submitChat();
        return;
      }

      if (isModifier && key === 'z' && !isTyping) {
        event.preventDefault();
        goBackRevision();
        return;
      }

      if (isModifier && key === 'c' && !isTyping && selected && !selectedIsWall && !selectedIsSpecial) {
        event.preventDefault();
        setClipboardObject(structuredClone(selected));
        return;
      }

      if (isModifier && key === 'v' && !isTyping && clipboardObject) {
        event.preventDefault();
        pasteClipboardObject();
        return;
      }

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && !isTyping && selected && !selectedIsWall && !selectedIsSpecial) {
        event.preventDefault();
        const step = event.shiftKey ? 4 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudgeSelected(dx, dy);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping) {
        event.preventDefault();
        removeSelectedRoom();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, selectedRoom, selected, selectedIsWall, selectedIsSpecial, prompt, expertQuestion, chatTarget, addToTarget, attachedImages, chatMessages, isPlanning, clipboardObject]);

  function rememberRevision(currentSpec = spec, currentSelectedRoom = selectedRoom, currentImagePreview = imagePreview, currentAttachedImages = attachedImages) {
    setHistory((items) => [
      {
        spec: structuredClone(currentSpec),
        selectedRoom: currentSelectedRoom,
        imagePreview: currentImagePreview,
        attachedImages: structuredClone(currentAttachedImages)
      },
      ...items
    ].slice(0, 80));
  }

  function goBackRevision() {
    const previous = history[0];
    if (!previous) return;
    setSpec(previous.spec);
    setSelectedRoom(previous.selectedRoom);
    setImagePreview(previous.imagePreview || '');
    setAttachedImages(previous.attachedImages || []);
    setHistory((items) => items.slice(1));
    setRevisionLog((items) => [`Back to Revision ${previous.spec.revision}: restored previous BIM state.`, ...items]);
    setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: `Back to Revision ${previous.spec.revision}.` }]);
  }

  function recordOperationAudit(promptText, plan, report, beforeRevision, afterRevision) {
    const operations = (plan?.operations || []).map((operation) => operationDescription(operation, report?.spec || spec));
    setOperationAudit((items) => [
      {
        id: `${Date.now()}`,
        prompt: promptText,
        source: report?.source || plan?.source || 'planner',
        intent: plan?.intent || report?.summary || 'structured BIM operation',
        confidence: plan?.confidence,
        beforeRevision,
        afterRevision,
        changedIds: report?.changedIds || [],
        operations,
        warnings: report?.warnings || [],
        rejected: report?.rejectedOperations || []
      },
      ...items
    ].slice(0, 60));
    setProjectBrain((current) => updateProjectBrainAfterOperation(current, report?.spec || spec, {
      prompt: promptText,
      source: report?.source || plan?.source || 'planner',
      beforeRevision,
      afterRevision,
      actions: report?.actions || operations,
      changedIds: report?.changedIds || [],
      issues: report?.issues || [],
      summary: report?.summary
    }));
  }

  async function applyPrompt() {
    if (!prompt.trim()) return;
    const submittedPrompt = prompt.trim();
    setPrompt('');

    if (isConsultativePrompt(submittedPrompt, attachedImages)) {
      await answerConsultativePrompt(submittedPrompt);
      return;
    }

    // Fast local path: simple "add a bedroom / a kitchen 14x12" requests skip
    // the slow planner entirely and go straight through the layout engine.
    const localRooms = attachedImages.length ? null : parseLocalRoomAdds(submittedPrompt);
    if (localRooms) {
      await applyLocalRoomAdds(localRooms, submittedPrompt);
      return;
    }

    setIsPlanning(true);

    try {
      const payload = {
        prompt: submittedPrompt,
        bim: spec,
        spec,
        state: currentDashboardState(),
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        addToTarget,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submittedPrompt)
      };
      const result = await requestServerAppliedBim(payload);
      const plan = result.plan;
      const structuredReport = result.report;
      recordOperationAudit(submittedPrompt, plan, structuredReport, spec.revision, structuredReport.spec.revision);
      if (structuredReport.actions.length) {
        const next = structuredReport.spec;
        rememberRevision();
        setSpec(next);
        if (structuredReport.changedIds[0]) setSelectedRoom(structuredReport.changedIds[0]);
        setLastModelChange(structuredReport.actions[0]);
        setChatMessages((items) => [
          ...items,
          { role: 'user', speaker: 'You', text: submittedPrompt },
          { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision}.\n\n${structuredPlanSummary(structuredReport)}` }
        ]);
        setRevisionLog((items) => [`Rev ${next.revision}: Planner applied ${structuredReport.actions.length} structured BIM operation${structuredReport.actions.length === 1 ? '' : 's'}.`, ...items]);
        return;
      }

      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: isConsultativePrompt(submittedPrompt, attachedImages) ? buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages) : `No BIM change made.\n\n${structuredPlanSummary(structuredReport)}` }
      ]);
      setRevisionLog((items) => [`No change: Planner could not turn "${submittedPrompt}" into a safe BIM operation.`, ...items]);
    } catch (error) {
      const report = applyNaturalLanguageDesign(submittedPrompt, spec, attachedImages, addToTarget, selected);
      if (isConsultativePrompt(submittedPrompt, attachedImages)) {
        const reply = buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
        setChatMessages((items) => [
          ...items,
          { role: 'user', speaker: 'You', text: submittedPrompt },
          { role: 'studio', speaker: 'Studio', text: `${reply}\n\nNote: the BIM planner was unavailable just now (${error.message}), so I stayed in conversation mode instead of pretending that was a geometry request.` }
        ]);
        setRevisionLog((items) => [`Studio consult fallback: answered "${submittedPrompt}" while planner was unavailable.`, ...items]);
        return;
      }
      recordOperationAudit(submittedPrompt, { source: 'browser-emergency-fallback', operations: [] }, report, spec.revision, report.spec.revision);
      if (!report.actions.length) {
        setChatMessages((items) => [
          ...items,
          { role: 'user', speaker: 'You', text: submittedPrompt },
          { role: 'studio', speaker: 'Studio', text: `No BIM change made.\n\nPlanner error: ${error.message}\n\n${interpreterSummary(report)}` }
        ]);
        setRevisionLog((items) => [`No change: Planner failed and fallback could not apply "${submittedPrompt}".`, ...items]);
        return;
      }
      const next = report.spec;
      rememberRevision();
      setSpec(next);
      if (report.changedIds[0]) setSelectedRoom(report.changedIds[0]);
      setLastModelChange(report.actions[0] || 'Revision applied, but no visible geometry command was detected.');
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision} with fallback parser.\n\nPlanner error: ${error.message}\n\n${interpreterSummary(report)}` }
      ]);
      setRevisionLog((items) => [`Rev ${next.revision}: Fallback parser applied changes after planner error.`, ...items]);
    } finally {
      setIsPlanning(false);
    }
  }

  function loopRevisions() {
    rememberRevision();
    let next = structuredClone(spec);
    let passes = 0;
    while (passes < 4 && detectIssues(next).some((issue) => issue.severity !== 'pass')) {
      next = reviseSpec(next);
      passes += 1;
    }
    const displayedPasses = passes || 1;
    setSpec(next);
    setRevisionLog((items) => [`Rev ${next.revision}: Council loop ran ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'} and resolved available schematic blockers.`, ...items]);
  }

  function handleImage(file) {
    if (!file) return;
    const studioSays = (text) => setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text }]);
    // Windows often reports an empty MIME type — fall back to the extension.
    const looksLikeImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isTextDoc = /\.(txt|md|csv)$/i.test(file.name) || ['text/plain', 'text/markdown', 'text/csv'].includes(file.type);
    const attach = (src, kind = 'image') => {
      const image = {
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        src,
        size: file.size,
        kind
      };
      if (kind === 'image') setImagePreview(image.src);
      setAttachedImages((items) => [image, ...items].slice(0, 6));
      setChatMessages((items) => [
        ...items,
        kind === 'image'
          ? { role: 'user', speaker: 'You', text: `Attached reference image: ${file.name}`, image: image.src }
          : { role: 'user', speaker: 'You', text: `Attached document: ${file.name}` },
        { role: 'studio', speaker: 'Studio', text: kind === 'image'
          ? 'Image attached to chat. Tell me what to use from it, such as "trace the handwritten room labels", "match this roof shape", or "turn this sketch into a 32 x 24 plan".'
          : 'Document attached — the planner will read it with your next message. Ask things like "use the setbacks from this survey", "size the house to fit this parcel", or "what does this spec sheet mean for my walls".' }
      ]);
    };
    // Documents: PDFs and plain text go to the planner as themselves.
    if (isPdf || isTextDoc) {
      if (file.size > 15 * 1024 * 1024) {
        studioSays(`"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB — too big to send to the planner. Keep documents under 15 MB (export just the relevant pages).`);
        return;
      }
      const docReader = new FileReader();
      docReader.onerror = docReader.onabort = () => {
        studioSays(`I couldn't read "${file.name}" from disk. If it lives in cloud storage (Google Drive, OneDrive), it may be online-only — open it once or copy it somewhere local, then try again.`);
      };
      docReader.onload = () => {
        let src = String(docReader.result || '');
        if (!src.startsWith('data:')) {
          studioSays(`I couldn't read "${file.name}" — the file came back empty. Try copying it somewhere local first.`);
          return;
        }
        // Empty/odd MIME from Windows: rewrite the data URL to the real type.
        const wantedMime = isPdf ? 'application/pdf' : 'text/plain';
        if (!src.startsWith(`data:${wantedMime}`)) src = src.replace(/^data:[^;,]*/, `data:${wantedMime}`);
        attach(src, isPdf ? 'pdf' : 'text');
      };
      docReader.readAsDataURL(file);
      return;
    }
    if (!looksLikeImage) {
      studioSays(`"${file.name}" isn't a file type I can read. Photos (JPG or PNG), PDFs, and plain text (.txt, .md, .csv) all work.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => {
      studioSays(`I couldn't read "${file.name}" from disk. If it lives in cloud storage (Google Drive, OneDrive), it may be online-only — open it once or copy it somewhere local, then try again.`);
    };
    reader.onload = () => {
      const raw = String(reader.result || '');
      if (!raw.startsWith('data:')) {
        studioSays(`I couldn't read "${file.name}" — the file came back empty. Try copying it somewhere local first.`);
        return;
      }
      // Decode + downscale before attaching: huge photos stay fast, and
      // formats the browser can't decode fail with an explanation instead
      // of silently attaching garbage.
      const probe = new Image();
      probe.onload = () => {
        const longest = Math.max(probe.width, probe.height);
        if (longest > 1600) {
          const scale = 1600 / longest;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(probe.width * scale);
          canvas.height = Math.round(probe.height * scale);
          canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
          attach(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          attach(raw);
        }
      };
      probe.onerror = () => {
        const isHeic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(file.type);
        studioSays(isHeic
          ? `"${file.name}" is a HEIC photo — browsers can't display those. Export it as JPG or PNG (or screenshot it) and add that instead.`
          : `I can't decode "${file.name}" in the browser. A JPG, PNG, or screenshot will work.`);
      };
      probe.src = raw;
    };
    reader.readAsDataURL(file);
  }

  function handleImageInput(event) {
    handleImage(event.target.files?.[0]);
    event.target.value = '';
  }

  function handleChatPaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    handleImage(file);
  }

  function removeAttachedImage(id) {
    setAttachedImages((items) => {
      const nextImages = items.filter((item) => item.id !== id);
      setImagePreview(nextImages[0]?.src || '');
      return nextImages;
    });
  }

  function updateShell(field, value) {
    const numeric = Number(value);
    const operations = [];
    if (field === 'roofType') {
      operations.push({ type: 'set_shell', field: 'roofType', value });
      if (value === 'shed') {
        operations.push({ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: spec.shell.southWallHeightFt || spec.shell.wallHeightFt + 2, northWallHeightFt: spec.shell.northWallHeightFt || spec.shell.wallHeightFt });
      }
    } else if (field === 'southWallHeightFt' || field === 'northWallHeightFt') {
      operations.push({ type: 'set_wall_height', wall: field === 'southWallHeightFt' ? 'south' : 'north', h: clamp(numeric, 7, 24) });
    } else {
      operations.push({ type: 'set_shell', field, value: String(field === 'roofPitch' ? clamp(numeric, 0.08, 0.75) : field === 'wallHeightFt' ? clamp(numeric, 7, 40) : field === 'storeys' ? clamp(numeric, 1, 3) : clamp(numeric, 18, field === 'depthFt' ? 80 : field === 'widthFt' ? 96 : field === 'padExtensionFt' ? 200 : 24)) });
    }
    void applyBackendOperations({ operations, promptText: `Update shell ${field}`, logPrefix: 'Shell edit' });
  }

  // Per-wall edit: system / height / thickness / finish / omit, per N/S/E/W side.
  function updateWallSide(side, field, rawValue) {
    let value = rawValue;
    if (field === 'heightFt') value = clamp(Number(rawValue), 7, 40);
    else if (field === 'thicknessFt') value = clamp(Number(rawValue), 0.2, 3.5);
    else if (field === 'omitted') value = Boolean(rawValue);
    void applyBackendOperations({
      operations: [{ type: 'set_wall_side', wall: side, field, value }],
      promptText: `Set ${side} wall ${field}`,
      logPrefix: 'Wall edit',
      nextSelectedId: `wall-${side}`
    });
  }

  // "Assembly (all sides)" on the Walls page. This MUST be a single dispatch —
  // four separate updateWallSide calls each apply to the same stale spec, so
  // only the last (west) would survive (the "goes to West no matter what" bug).
  // One plan with four ops applies them in sequence on the backend.
  function setAllWallsAssembly(value) {
    void applyBackendOperations({
      operations: WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'assembly', value })),
      promptText: `Set all walls to ${WALL_ASSEMBLIES[value]?.label || value}`,
      logPrefix: 'Wall edit'
    });
  }

  function updateSite(field, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_site', field, value: String(value) }],
      promptText: `Set site ${field}`,
      logPrefix: 'Site'
    });
  }

  function applyZip(zip) {
    const cleaned = String(zip || '').replace(/\D/g, '').slice(0, 5);
    const info = zipRegionInfo(cleaned);
    const operations = [{ type: 'set_site', field: 'zip', value: cleaned }];
    if (info) {
      operations.push({ type: 'set_site', field: 'latitudeDeg', value: String(info.lat) });
      operations.push({ type: 'set_site', field: 'rainInYr', value: String(info.rain) });
    }
    void applyBackendOperations({
      operations,
      promptText: `Set site ZIP ${cleaned}`,
      logPrefix: 'Site',
      chatText: info ? `ZIP ${cleaned} looks like ${info.name} — about ${info.lat.toFixed(1)}°N and ${info.rain}" of rain a year. Fine-tune below if you know better.` : undefined
    });
  }

  function updateUtility(field, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_utility', field, value: String(value) }],
      promptText: `Set ${field} to ${value}`,
      logPrefix: 'Systems'
    });
  }

  async function runGeoSearch() {
    const query = geoQuery.trim();
    if (!query) return;
    setGeoResults([]);
    // 5-digit ZIP: apply the offline regional estimate right away, then still
    // try the online geocoder for an exact match.
    if (/^\d{5}$/.test(query)) applyZip(query);
    setGeoStatus('Searching…');
    try {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!data.results?.length) {
        setGeoStatus(/^\d{5}$/.test(query)
          ? 'Regional estimate set from the ZIP. For an exact spot, search the town name.'
          : `No places found for "${query}" — try the nearest town, or set latitude and rain by hand below.`);
        return;
      }
      setGeoResults(data.results);
      setGeoStatus('Pick your place:');
    } catch {
      setGeoStatus('Place search needs internet. Use a 5-digit ZIP for an offline estimate, or set latitude and rain by hand below.');
    }
  }

  async function pickGeoResult(result) {
    setGeoResults([]);
    setGeoStatus(`Looking up rainfall for ${result.name}…`);
    let rain = null;
    try {
      const response = await fetch(`/api/geo/rain?lat=${result.latitude}&lon=${result.longitude}`);
      if (response.ok) rain = (await response.json()).rainInYr;
    } catch { /* rainfall is optional — latitude still applies */ }
    const place = `${result.name}${result.admin1 ? ', ' + result.admin1 : ''}${result.country && result.country !== 'United States' ? ', ' + result.country : ''}`;
    const operations = [
      { type: 'set_site', field: 'placeName', value: place },
      { type: 'set_site', field: 'latitudeDeg', value: String(Math.round(Math.abs(result.latitude) * 10) / 10) },
      ...(rain !== null ? [{ type: 'set_site', field: 'rainInYr', value: String(rain) }] : [])
    ];
    await applyBackendOperations({
      operations,
      promptText: `Set location to ${place}`,
      logPrefix: 'Site',
      chatText: `Site set to ${place} — ${Math.round(Math.abs(result.latitude) * 10) / 10}° latitude${rain !== null ? `, about ${rain}" of rain last year (real weather-station data)` : ' (rainfall lookup failed — set it by hand on the Site page)'}. Sun angles, solar sizing, and catchment all follow.`
    });
    setGeoStatus('');
    setGeoQuery('');
  }

  function updateOverhang(side, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_overhang', wall: side, value: String(clamp(Number(value) || 0, 0, 12)) }],
      promptText: `Set ${side} overhang`,
      logPrefix: 'Roof'
    });
  }

  function updateOpening(index, field, value) {
    const opening = spec.openings?.[index];
    if (!opening) return;
    const updated = structuredClone(opening);
    if (field === 'w') updated.widthFt = clamp(Number(value), 1, 24);
    if (field === 'type') updated.type = value;
    if (field === 'roofX') updated.x = clamp(Number(value), 0, Math.max(0, spec.shell.widthFt - Number(updated.widthFt || 3)));
    if (field === 'roofY') updated.y = clamp(Number(value), 0, Math.max(0, spec.shell.depthFt - Number(updated.widthFt || 3)));
    if (field === 'along') {
      const maxAlong = updated.wall === 'north' || updated.wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
      const along = clamp(Number(value), 0, Math.max(0, maxAlong - Number(updated.widthFt || 3)));
      if (updated.wall === 'north' || updated.wall === 'south') { updated.x = along; delete updated.y; }
      else { updated.y = along; delete updated.x; }
    }
    if (field === 'wall') {
      // Keep a sensible position when the opening moves to another wall (or the roof).
      const along = Number(opening.wall === 'north' || opening.wall === 'south' ? opening.x : opening.y) || 0;
      updated.wall = value;
      if (value === 'roof') { updated.x = Math.min(along, spec.shell.widthFt - 4); updated.y = 4; }
      else if (value === 'north' || value === 'south') { updated.x = along; delete updated.y; }
      else { updated.y = along; delete updated.x; }
    }
    const toRoof = updated.wall === 'roof' || Boolean(OPENING_TYPES[updated.type]?.roof);
    const addOp = toRoof
      ? { type: 'add_opening', wall: 'roof', openingType: 'skylight', widthFt: updated.widthFt, x: Number(updated.x) || 4, y: Number(updated.y) || 4, name: updated.label }
      : { type: 'add_opening', wall: updated.wall === 'roof' ? 'south' : updated.wall, openingType: OPENING_TYPES[updated.type] && updated.type !== 'skylight' ? updated.type : 'window', widthFt: updated.widthFt, positionFt: Number(updated.wall === 'north' || updated.wall === 'south' ? updated.x : updated.y) || 0, name: updated.label };
    void applyBackendOperations({
      operations: [
        { type: 'remove_object', targetId: `opening-${index}`, name: opening.label },
        addOp
      ],
      promptText: `Update opening ${opening.label}`,
      logPrefix: 'Windows'
    });
  }

  function removeOpening(index) {
    const opening = spec.openings?.[index];
    if (!opening) return;
    void applyBackendOperations({
      operations: [{ type: 'remove_object', targetId: `opening-${index}`, name: opening.label }],
      promptText: `Remove ${opening.label}`,
      logPrefix: 'Windows'
    });
  }

  function addOpeningOnWall(wall, type) {
    const profile = OPENING_TYPES[type] || OPENING_TYPES.window;
    const widthFt = profile.defaultW;
    const maxAlong = wall === 'north' || wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
    const existing = spec.openings.filter((opening) => opening.wall === wall).length;
    const along = clamp(4 + existing * 6, 0, Math.max(0, maxAlong - widthFt));
    void applyBackendOperations({
      operations: [{ type: 'add_opening', wall, openingType: type, widthFt, positionFt: along, name: `${titleCase(wall)} ${profile.label} ${existing + 1}` }],
      promptText: `Add ${profile.label} to ${wall} wall`,
      logPrefix: 'Windows'
    });
  }

  function toggleOutdoorItem(item) {
    if (outdoorItemPresent(spec, item)) {
      const element = (spec.elements || []).find((el) => el.name === item.name);
      if (!element) return;
      void applyBackendOperations({
        operations: [{ type: 'remove_object', targetId: element.id, name: element.name }],
        promptText: `Remove ${item.name}`,
        logPrefix: 'Outdoors'
      });
    } else {
      const placed = (spec.elements || []).length;
      void applyBackendOperations({
        operations: [{ type: 'add_element', name: item.name, category: item.category, x: spec.shell.widthFt + 6 + (placed % 3) * 14, y: 2 + Math.floor(placed / 3) * 14, z: 0, w: item.w, d: item.d, h: item.h, reason: item.note }],
        promptText: `Add ${item.name}`,
        logPrefix: 'Outdoors'
      });
    }
  }

  function updateProjectName(value) {
    setSpec((current) => {
      const next = structuredClone(current);
      next.projectName = value || 'Untitled Natural Building Study';
      return next;
    });
  }

  function updateSelectedRoom(field, value) {
    const numericFields = ['x', 'y', 'w', 'd', 'h'];
    if (selectedRoom === 'outdoor-grid') return;
    if (selectedRoom === 'site-pad') {
      const currentPad = sitePadRect(spec);
      const updatedPad = { ...currentPad };
      if (field === 'x') updatedPad.x = Number(value);
      if (field === 'y') updatedPad.y = Number(value);
      if (field === 'w') updatedPad.w = Math.max(4, Number(value));
      if (field === 'd') updatedPad.d = Math.max(4, Number(value));
      void applyBackendOperations({
        operations: [{ type: 'set_shell', field: 'sitePad', value: JSON.stringify(updatedPad) }],
        promptText: 'Update site pad',
        logPrefix: 'Pad edit',
        nextSelectedId: 'site-pad'
      });
      return;
    }
    if (selectedRoom === 'roof-main') {
      const operations = [];
      if (field === 'h') operations.push({ type: 'set_shell', field: 'wallHeightFt', value: String(clamp(Number(value), 7, 40)) });
      if (field === 'type') operations.push({ type: 'set_shell', field: 'roofType', value });
      if (operations.length) void applyBackendOperations({ operations, promptText: 'Update roof', logPrefix: 'Roof edit', nextSelectedId: 'roof-main' });
      return;
    }
    if (selectedRoom?.startsWith('opening-')) {
      const openingIndex = Number(selectedRoom.replace('opening-', ''));
      const opening = spec.openings?.[openingIndex];
      if (!opening) return;
      const updated = structuredClone(opening);
      if (field === 'name') updated.label = value;
      if (field === 'w') updated.widthFt = clamp(Number(value), 1, 24);
      if (field === 'x' || field === 'y') {
        const maxAlong = updated.wall === 'north' || updated.wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
        const along = clamp(Number(value), 0, Math.max(0, maxAlong - Number(updated.widthFt || 3)));
        if (updated.wall === 'north' || updated.wall === 'south') updated.x = along;
        else updated.y = along;
      }
      if (field === 'type') updated.type = value;
      const operations = [{ type: 'remove_object', targetId: selectedRoom, name: opening.label }, { type: 'add_opening', wall: updated.wall, openingType: OPENING_TYPES[updated.type] ? updated.type : 'window', widthFt: updated.widthFt, positionFt: updated.wall === 'north' || updated.wall === 'south' ? updated.x : updated.y, name: updated.label }];
      void applyBackendOperations({ operations, promptText: `Update opening ${opening.label}`, logPrefix: 'Opening edit', nextSelectedId: selectedRoom });
      return;
    }
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (wall) {
      if (field === 'h') updateWallSide(wall.side, 'heightFt', value);
      else if (field === 'w') updateShell(wall.side === 'north' || wall.side === 'south' ? 'widthFt' : 'depthFt', value);
      else if (field === 'thickness') updateWallSide(wall.side, 'thicknessFt', value);
      else if (field === 'assembly') updateWallSide(wall.side, 'assembly', value);
      return;
    }
    const object = spec.rooms.find((item) => item.id === selectedRoom) || (spec.elements || []).find((item) => item.id === selectedRoom);
    if (!object) return;
    const operations = [];
    if (field === 'x' || field === 'y') {
      operations.push({ type: 'move_object', targetId: selectedRoom, name: object.name, x: field === 'x' ? Number(value) : Number(object.x || 0), y: field === 'y' ? Number(value) : Number(object.y || 0) });
    } else if (field === 'level') {
      operations.push({ type: 'update_object', targetId: selectedRoom, name: object.name, field: 'level', value: String(clamp(Math.round(Number(value) || 1), 1, 3)) });
    } else if (field === 'w' || field === 'd' || field === 'h') {
      operations.push({ type: 'resize_object', targetId: selectedRoom, name: object.name, w: field === 'w' ? Number(value) : Number(object.w || 1), d: field === 'd' ? Number(value) : Number(object.d || 1), h: field === 'h' ? Number(value) : Number(object.h || 1.2) });
    } else {
      operations.push({ type: 'update_object', targetId: selectedRoom, name: object.name, field: field === 'name' ? 'name' : field, value: String(value) });
    }
    void applyBackendOperations({ operations, promptText: `Update ${object.name}`, logPrefix: 'Inspector edit', nextSelectedId: selectedRoom });
  }

  function addOpeningToSelectedWall(type = 'window') {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    const profile = OPENING_TYPES[type] || OPENING_TYPES.window;
    const widthFt = profile.defaultW || 4;
    const maxAlong = wall.side === 'north' || wall.side === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
    const existingOnWall = spec.openings.filter((opening) => opening.wall === wall.side).length;
    const along = clamp(4 + existingOnWall * 6, 0, Math.max(0, maxAlong - widthFt));
    void applyBackendOperations({
      operations: [{ type: 'add_opening', wall: wall.side, openingType: type, widthFt, positionFt: along, name: `${titleCase(wall.side)} ${profile.label} ${existingOnWall + 1}` }],
      promptText: `Add ${profile.label.toLowerCase()} to ${wall.name}`,
      logPrefix: 'Wall edit'
    });
  }

  function removeSelectedWallSection() {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    rememberRevision();
    setSpec((current) => {
      const next = structuredClone(current);
      next.shell.omittedWalls = [...new Set([...(next.shell.omittedWalls || []), wall.side])];
      next.revision += 1;
      return next;
    });
    setSelectedRoom(spec.rooms[0]?.id || '');
    setLastModelChange(`Removed ${wall.name} from shell model.`);
    setRevisionLog((items) => [`Wall edit: Removed ${wall.name} from shell model.`, ...items]);
  }

  function beginPlanMove() {
    if (planDragRevisionRef.current) return;
    rememberRevision();
    planDragRevisionRef.current = true;
  }

  function moveObjectPosition(objectId, x, y, finalize = false, label = 'Moved object on plan board.') {
    setSpec((current) => {
      const next = structuredClone(current);
      const object = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!object) return current;
      const position = clampObjectPosition(next, object, x, y);
      object.x = position.x;
      object.y = position.y;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    if (finalize) {
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'move_object', targetId: objectId, x, y }],
        promptText: label,
        logPrefix: 'Plan move',
        nextSelectedId: objectId,
        persist: true
      });
    }
  }

  function finishPlanMove(objectId, x, y) {
    const object = spec.rooms.find((item) => item.id === objectId) || (spec.elements || []).find((item) => item.id === objectId);
    if (!object) return;
    const finalX = Number.isFinite(x) ? x : object.x;
    const finalY = Number.isFinite(y) ? y : object.y;
    moveObjectPosition(objectId, finalX, finalY, true, `Moved ${object.name} to X ${finalX}', Y ${finalY}'.`);
  }

  function resizeObjectFootprint(objectId, w, d, finalize = false, label = 'Resized object on plan board.') {
    setSpec((current) => {
      const next = structuredClone(current);
      const object = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!object) return current;
      object.w = w;
      object.d = d;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    if (finalize) {
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'resize_object', targetId: objectId, w, d }],
        promptText: label,
        logPrefix: 'Plan resize',
        nextSelectedId: objectId,
        persist: true
      });
    }
  }

  function finishPlanResize(objectId, w, d, x, y) {
    if (objectId === 'site-pad') {
      const currentPad = sitePadRect(spec);
      const finalW = Math.max(4, Number.isFinite(w) ? w : currentPad.w);
      const finalD = Math.max(4, Number.isFinite(d) ? d : currentPad.d);
      const finalX = Number.isFinite(x) ? x : currentPad.x;
      const finalY = Number.isFinite(y) ? y : currentPad.y;
      setSelectedRoom('site-pad');
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'set_shell', field: 'sitePad', value: JSON.stringify({ x: finalX, y: finalY, w: finalW, d: finalD, h: currentPad.h }) }],
        promptText: `Resize site pad to ${Math.round(finalW * 10) / 10}' x ${Math.round(finalD * 10) / 10}'`,
        logPrefix: 'Pad resize',
        nextSelectedId: 'site-pad'
      });
      return;
    }
    const object = spec.rooms.find((item) => item.id === objectId) || (spec.elements || []).find((item) => item.id === objectId);
    if (!object) return;
    const finalW = Number.isFinite(w) ? w : object.w;
    const finalD = Number.isFinite(d) ? d : object.d;
    const finalX = Number.isFinite(x) ? x : object.x;
    const finalY = Number.isFinite(y) ? y : object.y;
    setSpec((current) => {
      const next = structuredClone(current);
      const target = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!target) return current;
      target.w = finalW;
      target.d = finalD;
      const position = clampObjectPosition(next, target, finalX, finalY);
      target.x = position.x;
      target.y = position.y;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    planDragRevisionRef.current = false;
    void applyBackendOperations({
      operations: [{ type: 'resize_object', targetId: objectId, w: finalW, d: finalD }, { type: 'move_object', targetId: objectId, x: finalX, y: finalY }],
      promptText: `Resized ${object.name} to ${finalW}' x ${finalD}'.`,
      logPrefix: 'Model resize',
      nextSelectedId: objectId
    });
  }

  function quickMoveSelected(target) {
    if (!selected) return;
    rememberRevision();
    const location = targetLocationForPhrase(spec, selected, target);
    moveObjectPosition(selected.id, location.x, location.y, true, `Moved ${selected.name} to ${target}.`);
  }

  function nudgeSelected(dx, dy) {
    if (!selected) return;
    rememberRevision();
    const position = clampObjectPosition(spec, selected, selected.x + dx, selected.y + dy);
    const x = position.x;
    const y = position.y;
    moveObjectPosition(selected.id, x, y, true, `Nudged ${selected.name} to X ${x}', Y ${y}'.`);
  }

  function pasteClipboardObject() {
    if (!clipboardObject || selectedIsWall || selectedIsSpecial) return;
    const baseName = clipboardObject.name || 'Copied BIM Object';
    const isElementCopy = (spec.elements || []).some((element) => element.id === clipboardObject.id);
    const position = clampObjectPosition(spec, clipboardObject, Number(clipboardObject.x || 0) + 3, Number(clipboardObject.y || 0) + 3);
    const operation = isElementCopy
      ? { type: 'add_element', name: `${baseName} Copy`, category: clipboardObject.category || clipboardObject.type || 'custom', x: position.x, y: position.y, z: Number(clipboardObject.z || 0), w: Number(clipboardObject.w || 10), d: Number(clipboardObject.d || 10), h: Number(clipboardObject.h || 1.2), level: Number(clipboardObject.level || 1) }
      : { type: 'add_room', name: `${baseName} Copy`, category: clipboardObject.type || 'living', x: position.x, y: position.y, z: Number(clipboardObject.z || 0), w: Number(clipboardObject.w || 10), d: Number(clipboardObject.d || 10), h: Number(clipboardObject.h || 0.2), level: Number(clipboardObject.level || 1) };
    void applyBackendOperations({ operations: [operation], promptText: `Paste ${baseName}`, logPrefix: 'Clipboard paste' });
  }

  function addRoom() {
    void addRoomPreset({ name: 'Room', type: 'living', w: 12, d: 12 });
  }

  // Add a room, then re-pack the whole floor plan so nothing overlaps and the
  // house grows to fit — the GUI path that makes building a first floor work.
  // Drop a room into the first free gap without disturbing the rooms already
  // placed (a manual layout survives an add). Only 'auto-arrange' re-packs.
  // Place an interior fixture (heater, tank, stairs…) as an element in a free
  // spot inside the house — then it's draggable in 2D and shows in 3D.
  function placeFixture(fixture) {
    const taken = new Set((spec.elements || []).map((e) => e.name));
    let name = fixture.name;
    let n = 2;
    while (taken.has(name)) { name = `${fixture.name} ${n}`; n += 1; }
    const existing = (spec.rooms || []).concat((spec.elements || []).filter((e) => e.category !== 'floor'))
      .map((o) => ({ x: Number(o.x), y: Number(o.y), w: Number(o.w), d: Number(o.d) }));
    const spot = findFreeSpot(Number(spec.shell.widthFt), Number(spec.shell.depthFt), existing, fixture.w, fixture.d)
      || { x: 2, y: 2 };
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: fixture.category, x: spot.x, y: spot.y, z: 0, w: fixture.w, d: fixture.d, h: fixture.h, reason: 'Interior fixture placed from the plan.' }],
      promptText: `Place ${name}`,
      logPrefix: 'Fixture'
    });
  }

  async function addRoomPreset(preset) {
    const plan = planNewRoomPlacements(spec, [preset], activeFloor);
    const where = activeFloor > 1 ? ` on the ${floorLabel(spec, activeFloor).toLowerCase()}` : '';
    await applyBackendOperations({
      operations: plan.ops,
      promptText: `Add ${plan.names[0]}${where}`,
      logPrefix: 'Add room',
      chatText: plan.grew ? `Added the ${plan.names[0]}${where} and grew the house to ${plan.newW}′ × ${plan.newD}′ to fit it — your other rooms stayed put.` : undefined
    });
  }

  // One-click fixes for council flags. Each maps a flagged issue to the SAME
  // safe op path a manual control uses — the non-destructive room placement and
  // the standard backend dispatch — so a fix never clobbers a layout or vanishes
  // silently. Only issues with a clean single-intent remedy carry a fixId; the
  // judgment calls (cost over ceiling, undersized water source) stay prose-only.
  function fixIssue(issue) {
    const preset = (name) => ROOM_PRESETS.find((item) => item.name === name);
    switch (issue.fixId) {
      case 'add-wet-core':
        return void addRoomPreset(preset('Bathroom'));
      case 'add-mudroom':
        return void addRoomPreset(preset('Mudroom'));
      case 'add-south-entry':
        return void applyBackendOperations({ operations: [{ type: 'add_opening', wall: 'south', openingType: 'door', widthFt: 3 }], promptText: 'Add a south entry door', logPrefix: 'Fix', chatText: 'Added a south-facing door so the main entry has a clear solar-side approach — position it on the Windows page.' });
      case 'add-south-glass':
        return void applyBackendOperations({ operations: [{ type: 'add_opening', wall: 'south', openingType: 'window', widthFt: 5 }], promptText: 'Add south glazing', logPrefix: 'Fix', chatText: 'Added a south window for winter solar gain — tune the size and summer shading on the Windows page.' });
      case 'add-stair':
        return void placeFixture({ name: 'Stairs', category: 'structure', w: 3.5, d: 10, h: 8 });
      case 'raise-stemwall':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'stemwallHeightFt', value: 1.5 }], promptText: 'Raise the stem wall', logPrefix: 'Fix', chatText: 'Raised the stem wall to 18″ so the bale base clears splash and grade.' });
      case 'well-septic':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'wellSepticFt', value: 100 }], promptText: 'Separate well and septic', logPrefix: 'Fix', chatText: 'Set the well-to-septic separation to 100 ft. Confirm the exact figure with your local health department.' });
      case 'deepen-overhang':
        return void applyBackendOperations({ operations: [{ type: 'set_overhang', wall: 'all', value: 2 }], promptText: 'Deepen the roof overhangs', logPrefix: 'Fix', chatText: 'Set every roof overhang to 2 ft so the plastered walls shed rain.' });
      case 'reduce-south-overhang':
        return void applyBackendOperations({ operations: [{ type: 'set_overhang', wall: 'south', value: 2.5 }], promptText: 'Trim the south overhang', logPrefix: 'Fix', chatText: 'Trimmed the south overhang to 2.5 ft so winter sun reaches the solar glass.' });
      case 'thicken-bale-wall': {
        if (!issue.side) return;
        const target = issue.fixThicknessFt || 1.5;
        return void applyBackendOperations({ operations: [{ type: 'set_wall_side', wall: issue.side, field: 'thicknessFt', value: target }], promptText: `Thicken the ${issue.side} wall`, logPrefix: 'Fix', chatText: `Thickened the ${issue.side} bale wall to ${Math.round(target * 12)}″ to bring it within the 12:1 slenderness limit.` });
      }
      default:
        return;
    }
  }

  // Instant local path for simple "add a bedroom" chat lines — one call, rooms
  // slotted into free space, no re-pack of what's already there, no planner.
  async function applyLocalRoomAdds(parsed, submittedPrompt) {
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
    const plan = planNewRoomPlacements(spec, parsed, activeFloor);
    const added = plan.names.join(', ');
    await applyBackendOperations({
      operations: plan.ops,
      promptText: parsed.length === 1 ? `Add ${plan.names[0]}` : `Add ${parsed.length} rooms`,
      logPrefix: 'Add rooms',
      chatText: plan.grew
        ? `Added ${added} into free space and grew the house to ${plan.newW}′ × ${plan.newD}′ to fit — existing rooms didn't move. (Instant — no planner needed.)`
        : `Added ${added} into the open floor space, no overlaps, nothing else moved. (Instant — no planner needed.)`
    });
  }

  // 2D plan editor commit handlers.
  function planMoveObject(id, x, y) {
    const object = spec.rooms.find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);
    if (!object) return;
    void applyBackendOperations({
      operations: [{ type: 'move_object', targetId: id, name: object.name, x, y }],
      promptText: `Move ${object.name}`,
      logPrefix: 'Plan edit',
      nextSelectedId: id
    });
  }

  function planResizeObject(id, x, y, w, d) {
    const object = spec.rooms.find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);
    if (!object) return;
    void applyBackendOperations({
      operations: [
        { type: 'resize_object', targetId: id, name: object.name, w, d, h: Number(object.h) || 0.22 },
        { type: 'move_object', targetId: id, name: object.name, x, y }
      ],
      promptText: `Resize ${object.name}`,
      logPrefix: 'Plan edit',
      nextSelectedId: id
    });
  }

  function addStorey() {
    const next = Math.min(3, floorCount(spec) + 1);
    // Just add the storey — do NOT auto-drop a stair. A stair depends on how the
    // rest of the floor lays out, so it's added later, by hand: Rooms → Add a
    // fixture → Stairs, or the one-click "Add a stair" fix in Review (the council
    // check flags it as a reminder until then). Daniel's call: place first, stair after.
    const hasStair = (spec.rooms || []).concat(spec.elements || []).some((o) => /stair|ladder/i.test(o.name || ''));
    void applyBackendOperations({
      operations: [{ type: 'set_shell', field: 'storeys', value: String(next) }],
      promptText: `Add a storey (now ${next})`,
      logPrefix: 'Storeys',
      chatText: hasStair
        ? `Added a storey — floor ${next} is ready to lay out.`
        : `Added a storey — floor ${next} is ready to lay out. Add a stair once the layout settles (Rooms → Add a fixture → Stairs, or the "Add a stair" fix in Review) so it lands where you want it.`
    });
    setActiveFloor(next);
  }

  async function arrangeRooms() {
    const arrange = arrangeRoomsPlan(spec);
    if (!arrange.ops.length) return;
    await applyBackendOperations({
      operations: arrange.ops,
      promptText: arrange.grew ? `Arrange plan · grew house to ${arrange.newW} × ${arrange.newD}` : 'Arrange floor plan',
      logPrefix: 'Layout',
      chatText: arrange.grew
        ? `Tidied the floor plan and grew the house to ${arrange.newW}′ × ${arrange.newD}′ so every room fits without overlapping.`
        : 'Tidied the floor plan — rooms laid out edge to edge without overlapping.'
    });
  }

  function removeSelectedRoom() {
    if (selectedIsSpecial) {
      if (selectedIsOpening) {
        void applyBackendOperations({
          operations: [{ type: 'remove_object', targetId: selectedRoom, name: selected?.name }],
          promptText: `Remove ${selected?.name || 'opening'}`,
          logPrefix: 'Remove opening'
        });
        setSelectedRoom(spec.rooms[0]?.id || '');
        setLastModelChange(`Removed ${selected.name}.`);
      }
      return;
    }
    if (selectedIsWall) {
      removeSelectedWallSection();
      return;
    }
    if (!selected || (!selectedIsElement && spec.rooms.length <= 1)) return;
    void applyBackendOperations({
      operations: [{ type: 'remove_object', targetId: selectedRoom, name: selected.name }],
      promptText: `Remove ${selected.name}`,
      logPrefix: 'Remove object'
    });
  }

  function useLibraryElement(item, sourceCategory, mode = libraryActionMode) {
    if (mode === 'apply') {
      const field = systemFieldForLibraryItem(item);
      const value = appliedSystemText(item);
      void applyBackendOperations({
        operations: [{ type: 'set_assembly', field, value }],
        promptText: `Apply ${item.name} to house`,
        logPrefix: 'Library apply',
        chatText: `Applied ${item.name} to the house system.`
      });
    } else {
      void applyBackendOperations({
        operations: [{ type: 'add_element', name: item.name, category: item.kind, x: clamp(spec.shell.widthFt + 3, -24, spec.shell.widthFt + 24), y: clamp(spec.shell.depthFt + 3, -24, spec.shell.depthFt + 32), w: item.w, d: item.d, h: item.kind === 'wall' ? 8 : item.kind === 'thermal' ? 5 : item.kind === 'water' ? 6 : 1.2 }],
        promptText: `Place ${item.name}`,
        logPrefix: 'Library place',
        chatText: `Placed ${item.name} as a fresh BIM object.`
      });
    }
  }

  function askExpert() {
    if (!expertQuestion.trim()) return;
    const speaker = selectedExpert ? selectedExpert.name : 'Whole Team';
    const answer = selectedExpert
      ? expertResponse(selectedExpert, expertQuestion, spec, issues, selectedRoom)
      : wholeTeamResponse(expertQuestion, spec, issues, selectedRoom);
    setChatMessages((items) => [
      ...items,
      { role: 'user', speaker: 'You', text: expertQuestion },
      { role: 'expertMsg', speaker, text: answer }
    ]);
    setExpertQuestion('');
  }

  function submitChat() {
    if (chatTarget === 'design') applyPrompt();
    else askExpert();
  }

  function chooseChatTarget(target) {
    setChatTarget(target);
    if (target !== 'design') setSelectedExpertId(target === 'team' ? 'team' : target);
  }

  async function saveHouseState() {
    if (typeof window === 'undefined') return;
    const now = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const saveNote = `Saved Revision ${spec.revision}: Current house state stored in this dashboard.`;
    const savedChange = `Saved Revision ${spec.revision} in this dashboard.`;
    const chatWithNotice = [
      ...chatMessages,
      { role: 'studio', speaker: 'Studio', text: `${savedChange} It will restore automatically when you reopen this app in this browser.` }
    ];
    const payload = buildDashboardStatePayload({
      projectId,
      savedAt: now,
      spec,
      selectedRoom,
      prompt,
      chatTarget,
      addToTarget,
      selectedExpertId,
      expertQuestion,
      libraryActionMode,
      revisionLog: [saveNote, ...revisionLog],
      history,
      lastModelChange: savedChange,
      operationAudit,
      projectBrain,
      chatMessages: chatWithNotice,
      modelLayers,
      buildProgress
    });
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(payload));
    setSavedAt(now);
    setLastModelChange(savedChange);
    setRevisionLog((items) => [saveNote, ...items]);
    setChatMessages(chatWithNotice);
    try {
      const result = await saveDashboardStateToBackend(payload);
      if (result?.projectId) setProjectId(result.projectId);
    } catch (error) {
      console.warn('Explicit backend save failed:', error);
    }
  }

  function exportJson() {
    downloadFile(`house-bim-rev-${spec.revision}.json`, JSON.stringify(createIfcSummary(spec), null, 2), 'application/json');
  }

  function exportBrief() {
    const lines = [
      `${spec.projectName} - Revision ${spec.revision}`,
      '',
      'Professional Quality Gate',
      `Score: ${qualityScore}/100 schematic readiness`,
      ...issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.title} (${issue.owner}) - ${issue.fix}`),
      '',
      'BIM Hierarchy',
      '- Site > Building > Level 01 > Foundation, Walls, Roof, Openings, Room Zones, Systems',
      '',
      'Rooms',
      ...spec.rooms.map((room) => `- ${room.name}: ${Math.round(room.w * room.d)} sf, ${room.type}, ${room.floor}`),
      '',
      'Systems',
      ...Object.entries(spec.systems).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Stamp Track Note',
      'This app produces permit-track BIM and QA artifacts with local code, structural, MEP, and jurisdiction-specific drawing fields.'
    ];
    downloadFile(`schematic-brief-rev-${spec.revision}.md`, lines.join('\n'), 'text/markdown');
  }

  function exportSheetSet() {
    downloadFile(`permit-track-set-rev-${spec.revision}.html`, createDrawingSetHtml(spec, qualityScore, issues), 'text/html');
  }

  const SYSTEM_LABELS = { site: 'Site', rooms: 'Rooms', shell: 'Shell', foundation: 'Foundation', walls: 'Walls', roof: 'Roof', windows: 'Windows', heat: 'Heat', water: 'Water', waste: 'Waste', power: 'Power', outdoors: 'Outdoors' };
  const systemOfRoom = (room) => {
    const t = String(room?.type || '').toLowerCase();
    if (t === 'wet') return 'water';
    if (['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant'].includes(t)) return 'outdoors';
    return 'rooms';
  };
  const systemOfElementCategory = (cat) => {
    const map = { water: 'water', thermal: 'heat', passive: 'heat', roof: 'roof', earthwork: 'foundation', floor: 'foundation', structure: 'walls', wall: 'walls', landscape: 'outdoors', garden: 'outdoors', animal: 'outdoors', loft: 'rooms', tower: 'rooms' };
    return map[String(cat || '').toLowerCase()] || 'outdoors';
  };
  const systemOfSpecialCategory = (cat) => {
    const c = String(cat || '').toLowerCase();
    if (c.includes('open') || c.includes('window') || c.includes('door')) return 'windows';
    if (c.includes('roof')) return 'roof';
    if (c.includes('pad') || c.includes('grid') || c.includes('site')) return 'site';
    if (c.includes('wall')) return 'walls';
    return 'outdoors';
  };
  const systemFocus = consoleView === 'systems' ? systemView : null;

  return (
    <main className="app">
      <aside className="leftPanel">
        <div className="brand">
          <div className="brandMark" aria-hidden="true"><span className="brandGable" /></div>
          <div>
            <h1>Natural Building Design Dashboard</h1>
            <p>Living BIM studio for ancient and regenerative design</p>
          </div>
        </div>

        <section className="panelBlock compact consoleSummary">
          <div className="statGrid four">
            <button type="button" title="See the full cost breakdown" onClick={() => { setAppMode('design'); setConsoleView('costs'); }}><strong>${estimatedCost.toLocaleString()}</strong><span>{derived.sweat > 0 ? `est. cost · sweat saves $${Math.round(derived.sweat / 1000)}k` : 'est. cost'}</span></button>
            <button type="button" title="Open the Rooms plan" onClick={() => { setConsoleView('systems'); setSystemView('rooms'); }}><strong>{spec.rooms.length}</strong><span>room{spec.rooms.length === 1 ? '' : 's'} · {area} sf</span></button>
            <button type="button" title="See the code flags in Review" onClick={() => setConsoleView('review')}><strong>{openFlagCount}</strong><span>code flag{openFlagCount === 1 ? '' : 's'}</span></button>
            <button type="button" className={openFlagCount === 0 ? 'stateStat ok' : 'stateStat bad'} title="See what does and doesn't add up in Review" onClick={() => setConsoleView('review')}><strong>{openFlagCount === 0 ? 'Yes' : 'Not yet'}</strong><span>adds up</span></button>
          </div>
        </section>

        <nav className="modeTabs" aria-label="Design or build">
          <button className={appMode === 'design' ? 'active' : ''} onClick={() => setAppMode('design')}><Hammer size={15} /> Design</button>
          <button className={appMode === 'build' ? 'active' : ''} onClick={() => setAppMode('build')}><ClipboardCheck size={15} /> Build</button>
        </nav>

        {appMode === 'build' && (() => {
          const phases = buildTimeline(spec, derived);
          const doneCount = phases.filter((phase) => buildProgress[phase.id]).length;
          const totalWeeks = phases.reduce((sum, phase) => sum + phase.weeks, 0);
          const takeoff = materialsTakeoff(spec, derived);
          const maintenance = MAINTENANCE_TASKS.filter((task) => task.when(spec, derived.utilities));
          return (
            <section className="panelBlock consolePanel buildPanel">
              <div className="blockTitle"><ClipboardCheck size={16} /> Build It</div>
              <p className="studioHint">The design, turned into a build: phases in order, what each takes, and the materials list. Check phases off as you go — progress saves with the design.</p>
              <div className="buildSummary">
                <div><strong>{doneCount}/{phases.length}</strong><span>phases done</span></div>
                <div><strong>~{Math.round(totalWeeks)}</strong><span>weeks of work</span></div>
                <div><strong>${Math.round(derived.total).toLocaleString()}</strong><span>after sweat equity</span></div>
              </div>
              <div className="buildBar"><div className="buildBarFill" style={{ width: `${(doneCount / phases.length) * 100}%` }} /></div>

              <div className="sectionHead">Construction phases</div>
              <div className="phaseList">
                {phases.map((phase, index) => (
                  <details key={phase.id} className={buildProgress[phase.id] ? 'phaseCard done' : 'phaseCard'}>
                    <summary>
                      <input type="checkbox" checked={Boolean(buildProgress[phase.id])} onClick={(event) => event.stopPropagation()} onChange={(event) => setBuildProgress((current) => ({ ...current, [phase.id]: event.target.checked }))} />
                      <span className="phaseTitle">{index + 1}. {phase.title}</span>
                      <span className="phaseMeta">{phase.weeks} wk{phase.costPct > 0 ? ` · $${Math.round(derived.total * phase.costPct / 1000)}k` : ''}{phase.inspector ? ' · 🔍 inspection' : ''}</span>
                    </summary>
                    <div className="phaseBody">
                      <p><b>Materials:</b> {phase.materials}</p>
                      <p><b>Tools:</b> {phase.tools}</p>
                      <p><b>Safety:</b> {phase.safety}</p>
                      <p><b>Weather:</b> {phase.weather}</p>
                    </div>
                  </details>
                ))}
              </div>

              <div className="sectionHead">Materials takeoff</div>
              <div className="takeoffTable">
                {takeoff.map(([item, qty, note]) => (
                  <div className="takeoffRow" key={item}>
                    <span>{item}</span>
                    <b>{qty}</b>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              <p className="systemNote">Directional quantities from the current design — order from these only after your own count.</p>

              <div className="sectionHead">Living with it</div>
              <div className="maintList">
                {maintenance.map((task) => (
                  <div className="maintRow" key={task.title}>
                    <span className="maintInterval">{task.interval}</span>
                    <div><b>{task.title}</b><small>{task.desc}</small></div>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {appMode === 'design' && <nav className="consoleTabs" aria-label="Project console">
          <button className={consoleView === 'systems' ? 'active' : ''} onClick={() => setConsoleView('systems')}><Grid3X3 size={14} /> Systems</button>
          <button className={consoleView === 'costs' ? 'active' : ''} onClick={() => setConsoleView('costs')}><Coins size={14} /> Costs</button>
          <button className={consoleView === 'os' ? 'active' : ''} onClick={() => setConsoleView('os')}><ClipboardCheck size={14} /> Plan</button>
          <button className={consoleView === 'review' ? 'active' : ''} onClick={() => setConsoleView('review')}><ShieldCheck size={14} /> Review</button>
          <button className={consoleView === 'experts' ? 'active' : ''} onClick={() => setConsoleView('experts')}><Users size={14} /> Experts</button>
          <button className={consoleView === 'audit' ? 'active' : ''} onClick={() => setConsoleView('audit')}><FileJson size={14} /> History</button>
          <button className={consoleView === 'log' ? 'active' : ''} onClick={() => setConsoleView('log')}><Layers size={14} /> Log</button>
        </nav>}

        {appMode === 'design' && consoleView === 'systems' && <section className="panelBlock consolePanel systemsPanel">
          <div className="blockTitle"><Grid3X3 size={16} /> Systems</div>
          <p className="studioHint">Design the house one system at a time. Each page shows what that system controls.</p>
          <nav className="systemNav" aria-label="Building systems">
            {SYSTEM_GROUPS.map((group) => (
              <div className="systemNavGroup" key={group.label}>
                <div className="systemNavEyebrow">{group.label}</div>
                <div className="systemTabs">
                  {group.keys.map((key) => (
                    <button key={key} className={systemView === key ? 'active' : ''} onClick={() => { setSystemView(key); setInspectorView('schedule'); }} title={flaggedSystems.has(key) ? 'A council check is failing in this system' : undefined}>
                      <span className={flaggedSystems.has(key) ? 'sysDot flag' : 'sysDot'} />{SYSTEM_META[key].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {systemView === 'shell' && (() => {
            const shellHeights = WALL_SIDES.map((side) => resolveWallSide(spec, side)).filter((r) => !r.omitted).map((r) => r.heightFt);
            const shellHeightsMixed = new Set(shellHeights).size > 1;
            return (
            <div className="systemPage">
              <div className="sectionHead">Overall shape</div>
              <div className="controlGrid">
                <label>Width (ft)<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                <label>Length (ft)<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
                {shellHeightsMixed ? (
                  <label>Wall height
                    <div className="mixedField">
                      <span>Mixed · {Math.min(...shellHeights)}–{Math.max(...shellHeights)}' — set per wall on the Walls page</span>
                    </div>
                  </label>
                ) : (
                  <label>Wall height (ft)<input type="number" value={shellHeights[0] ?? spec.shell.wallHeightFt} onChange={(event) => updateShell('wallHeightFt', event.target.value)} /></label>
                )}
                <label>Storeys
                  <select value={String(storeyInfo(spec.shell).storeys)} onChange={(event) => updateShell('storeys', event.target.value)}>
                    <option value="1">1 — single storey</option>
                    <option value="1.5">1½ — loft with knee walls</option>
                    <option value="2">2 — full two storeys</option>
                    <option value="3">3 — three storeys</option>
                  </select>
                </label>
              </div>
              <p className="systemNote">Footprint: {spec.shell.widthFt} × {spec.shell.depthFt} ft = {Math.round(Number(spec.shell.widthFt) * Number(spec.shell.depthFt))} sf{storeyInfo(spec.shell).storeys > 1 ? ` · ${Math.round(Number(spec.shell.widthFt) * Number(spec.shell.depthFt) * storeyInfo(spec.shell).storeys)} sf heated across ${storeyInfo(spec.shell).storeys} storeys` : ''}. Per-wall heights, systems, and thickness live on the <b>Walls</b> page (a taller south than north makes a shed roof). Put a room upstairs by setting its Level in the inspector. Roof shape lives on the Roof page.</p>
            </div>
            );
          })()}

          {systemView === 'rooms' && (
            <div className="systemPage">
              <div className="sectionHead">Add a room</div>
              <div className="roomAddGrid">
                {ROOM_PRESETS.map((preset) => (
                  <button key={preset.name} className="roomAddChip" onClick={() => addRoomPreset(preset)}>
                    <b>{preset.name}</b>
                    <small>{preset.w} × {preset.d}′</small>
                  </button>
                ))}
              </div>
              <p className="systemNote">Click to drop a room in — it slots into free space (nothing else moves). Rename or resize any room in the Inspector below, or drag it in the 2D plan. You can also tell the assistant "add a pantry 8 × 10".</p>

              <div className="sectionHead">Add a fixture</div>
              <div className="roomAddGrid">
                {interiorFixtures(spec).map((fixture) => (
                  <button key={fixture.key} className="roomAddChip fixture" onClick={() => placeFixture(fixture)}>
                    <b>{fixture.name}</b>
                    <small>{fixture.w} × {fixture.d}′</small>
                  </button>
                ))}
              </div>
              <p className="systemNote">Heaters, tanks, stairs, counters — placed as objects you can drag in the 2D plan and see in 3D. The heater matches your Heat page choice.</p>

              {spec.rooms.length > 0 && (
                <>
                  <div className="breakOpenRow">
                    <div className="sectionHead">Floor plan · {spec.rooms.length} room{spec.rooms.length === 1 ? '' : 's'}</div>
                    <button className="breakOpen" onClick={arrangeRooms}>↹ auto-arrange</button>
                  </div>
                  <div className="systemList roomPickList">
                    {spec.rooms.map((room, index) => (
                      <button
                        key={room.id || index}
                        className={room.id === selectedRoom ? 'roomPickRow active' : 'roomPickRow'}
                        onClick={() => setSelectedRoom(room.id)}
                      >
                        <span>{room.name}</span>
                        <small>{room.w} × {room.d}′ · {Math.round(room.w * room.d)} sf{Number(room.level || 1) > 1 ? ' · upstairs' : ''}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {systemView === 'walls' && (() => {
            const resolvedSides = WALL_SIDES.map((side) => ({ side, r: resolveWallSide(spec, side) }));
            const globalKey = wallAssemblyKeyFromText(spec.systems?.envelope);
            const mixed = wallsAreMixed(spec);
            const activeHeights = resolvedSides.filter(({ r }) => !r.omitted).map(({ r }) => r.heightFt);
            const heightsMixed = new Set(activeHeights).size > 1;
            const sharedHeight = activeHeights[0] ?? spec.shell.wallHeightFt;
            return (
              <div className="systemPage">
                <div className="sectionHead">Wall system (all sides)</div>
                <div className="controlGrid">
                  <label>Assembly
                    <select value={mixed ? '' : globalKey} onChange={(event) => setAllWallsAssembly(event.target.value)}>
                      {mixed && <option value="" disabled>Mixed — see per-side</option>}
                      {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                        <option key={assembly.key} value={assembly.key}>{assembly.label} (R≈{assembly.rValue})</option>
                      ))}
                    </select>
                  </label>
                  {heightsMixed ? (
                    <label>Height
                      <div className="mixedField">
                        <span>Mixed · {Math.min(...activeHeights)}–{Math.max(...activeHeights)}' — each side rules below</span>
                        <button className="breakOpen" onClick={() => updateShell('wallHeightFt', Math.max(...activeHeights))}>unify at {Math.max(...activeHeights)}'</button>
                      </div>
                    </label>
                  ) : (
                    <label>Height (ft)<input type="number" min="7" max="40" value={sharedHeight} onChange={(event) => updateShell('wallHeightFt', event.target.value)} /></label>
                  )}
                  <label>Width (ft)<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                  <label>Length (ft)<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
                </div>
                <label className="diyToggle">
                  <input type="checkbox" checked={utilitiesOf(spec).diyWalls} onChange={(event) => updateUtility('diyWalls', event.target.checked)} />
                  <span>I'll raise the walls myself (sweat equity — walls are the most DIY-able system)</span>
                </label>
                <p className="systemNote">While all sides share one height you can set it here; the moment any side differs, <b>the per-side controls below are the only height controls</b>. Width is the north/south wall length; Length is the east/west wall length.</p>

                <div className="breakOpenRow">
                  <div className="sectionHead">Per side (N / S / E / W)</div>
                  <button className="breakOpen" onClick={() => setWallBreakOpen((open) => !open)}>
                    {wallBreakOpen ? '▾ collapse' : '▸ break open per side'}
                  </button>
                </div>

                {!wallBreakOpen ? (
                  <p className="systemNote">{mixed ? 'Walls currently differ by side — break open to see and edit each.' : 'All four sides share the settings above. Break open to give each side its own system, height, thickness, and finish.'}</p>
                ) : (
                  <div className="wallSideList">
                    {resolvedSides.map(({ side, r }) => (
                      <div key={side} className={r.omitted ? 'wallSideCard omitted' : 'wallSideCard'}>
                        <div className="wallSideCardHead">
                          <strong>{WALL_SIDE_LABELS[side]} wall</strong>
                          <label className="wallOmitToggle">
                            <input type="checkbox" checked={r.omitted} onChange={(event) => updateWallSide(side, 'omitted', event.target.checked)} />
                            <span>open / no wall</span>
                          </label>
                        </div>
                        {!r.omitted && (
                          <>
                            <div className="controlGrid tight">
                              <label>System
                                <select value={r.assemblyKey} onChange={(event) => updateWallSide(side, 'assembly', event.target.value)}>
                                  {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                                    <option key={assembly.key} value={assembly.key}>{assembly.label}</option>
                                  ))}
                                </select>
                              </label>
                              {(spec.shell.roofType === 'shed' && (side === 'east' || side === 'west')) ? (
                                <label>Height
                                  <div className="mixedField">
                                    <span>Raked — follows the roof, {resolveWallSide(spec, 'north').heightFt}' (N) → {resolveWallSide(spec, 'south').heightFt}' (S)</span>
                                  </div>
                                </label>
                              ) : (
                                <label>Height (ft){spec.shell.roofType === 'gable' && (side === 'north' || side === 'south') && <em className="pitchHint">eave · gable peaks +{Math.round(Number(spec.shell.depthFt || 28) * Number(spec.shell.roofPitch || 0.32))}'</em>}<input type="number" min="7" max="40" value={r.heightFt} onChange={(event) => updateWallSide(side, 'heightFt', event.target.value)} /></label>
                              )}
                              <label>Length (ft)<input type="number" value={side === 'north' || side === 'south' ? spec.shell.widthFt : spec.shell.depthFt} onChange={(event) => updateShell(side === 'north' || side === 'south' ? 'widthFt' : 'depthFt', event.target.value)} /></label>
                              <label>Thickness (ft)<input type="number" step="0.05" min="0.2" max="3.5" value={r.thicknessFt} onChange={(event) => updateWallSide(side, 'thicknessFt', event.target.value)} /></label>
                              <label>Interior finish<input type="text" value={r.interiorFinish} onChange={(event) => updateWallSide(side, 'interiorFinish', event.target.value)} /></label>
                              <label>Exterior finish<input type="text" value={r.exteriorFinish} onChange={(event) => updateWallSide(side, 'exteriorFinish', event.target.value)} /></label>
                            </div>
                            <p className="wallSideMeta">R≈{r.assembly.rValue} · {r.thicknessFt.toFixed(2)}' thick · {spec.openings.filter((opening) => opening.wall === side).length} opening(s) · length is shared with the {side === 'north' ? 'south' : side === 'south' ? 'north' : side === 'east' ? 'west' : 'east'} wall</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {systemView === 'site' && (
            <div className="systemPage">
              <div className="sectionHead">Where the house sits</div>
              <label className="geoSearchLabel">Find your place
                <div className="geoRow">
                  <input
                    type="text"
                    placeholder="Town, county, or ZIP — e.g. Corning NY"
                    value={geoQuery}
                    onChange={(event) => setGeoQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') runGeoSearch(); }}
                  />
                  <button className="secondary" onClick={runGeoSearch}>Search</button>
                </div>
              </label>
              {geoStatus && <p className="systemNote geoStatus">{geoStatus}</p>}
              {geoResults.length > 0 && (
                <div className="geoResults">
                  {geoResults.map((result, index) => (
                    <button key={`${result.name}-${index}`} onClick={() => pickGeoResult(result)}>
                      <b>{result.name}{result.admin1 ? `, ${result.admin1}` : ''}</b>
                      <small>{result.country} · {result.latitude.toFixed(1)}°, {result.longitude.toFixed(1)}°</small>
                    </button>
                  ))}
                </div>
              )}
              {siteOf(spec).placeName && <p className="systemNote">Current place: <b>{siteOf(spec).placeName}</b> — {siteOf(spec).latitudeDeg}° latitude, {siteOf(spec).rainInYr}" of rain a year.</p>}
              <div className="controlGrid">
                <label>Latitude (°)<input type="number" step="0.5" min="0" max="70" value={siteOf(spec).latitudeDeg} onChange={(event) => updateSite('latitudeDeg', event.target.value)} /></label>
                <label>Yearly rain (in)<input type="number" min="0" max="200" value={siteOf(spec).rainInYr} onChange={(event) => updateSite('rainInYr', event.target.value)} /></label>
              </div>
              <p className="systemNote">Search by name for real coordinates and last year's actual rainfall, or fine-tune the numbers by hand if you know your land better. Latitude sets sun angles and solar output; rain decides whether the roof can be your water source.</p>
            </div>
          )}

          {systemView === 'foundation' && (
            <div className="systemPage">
              <div className="sectionHead">Foundation size</div>
              <div className="controlGrid">
                <label>Width (ft)<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                <label>Length (ft)<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
              </div>
              <p className="systemNote">The foundation carries the building footprint — <b>{spec.shell.widthFt} × {spec.shell.depthFt} ft = {Math.round(Number(spec.shell.widthFt) * Number(spec.shell.depthFt))} sf</b>, {Math.round(2 * (Number(spec.shell.widthFt) + Number(spec.shell.depthFt)))} ft of perimeter. Set it here, on Shell, or on Walls — they all stay in step.</p>

              <div className="sectionHead">What the house sits on</div>
              <div className="controlGrid">
                <label>Type
                  <select value={utilitiesOf(spec).foundationType} onChange={(event) => updateUtility('foundationType', event.target.value)}>
                    <option value="rubble">Rubble trench — drained gravel, low cost, low carbon</option>
                    <option value="stemwall">Stem wall — perimeter wall on footing</option>
                    <option value="slab">Insulated slab — simple, the most concrete</option>
                  </select>
                </label>
                {utilitiesOf(spec).foundationType === 'stemwall' && (
                  <label>Stem wall height (ft)<input type="number" step="0.25" min="0.5" max="6" value={utilitiesOf(spec).stemwallHeightFt ?? 1.5} onChange={(event) => updateUtility('stemwallHeightFt', event.target.value)} /></label>
                )}
              </div>
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyFoundation} onChange={(event) => updateUtility('diyFoundation', event.target.checked)} />
                <span>I'll dig and place it myself (sweat equity)</span>
              </label>
              <p className="systemNote">Rubble trench is the natural-building favorite: half the concrete of a slab, and the biggest single carbon saving on the whole build.</p>
            </div>
          )}

          {systemView === 'windows' && (
            <div className="systemPage">
              <div className="sectionHead">All windows</div>
              <div className="controlGrid">
                <label>Glazing quality
                  <select value={utilitiesOf(spec).windowQuality} onChange={(event) => updateUtility('windowQuality', event.target.value)}>
                    <option value="double">Standard double pane — good value</option>
                    <option value="triple">Triple pane / low-e — half the heat loss, pricier</option>
                  </select>
                </label>
              </div>
              <div className="sectionHead">Every opening, one by one</div>
              {spec.openings.length === 0 && <p className="systemNote">No windows or doors yet — add one below, or tell the assistant "add a south window 5 ft wide near the kitchen".</p>}
              <div className="openingList">
                {spec.openings.map((opening, index) => (
                  <div className="openingRow" key={`${opening.label || opening.type}-${index}`}>
                    <strong>{opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}`}</strong>
                    <div className="controlGrid tight">
                      <label>Wall
                        <select value={opening.wall} onChange={(event) => updateOpening(index, 'wall', event.target.value)}>
                          <option value="north">North</option>
                          <option value="south">South</option>
                          <option value="east">East</option>
                          <option value="west">West</option>
                          <option value="roof">Roof</option>
                        </select>
                      </label>
                      <label>Type
                        <select value={OPENING_TYPES[opening.type] ? opening.type : 'window'} onChange={(event) => updateOpening(index, 'type', event.target.value)}>
                          {Object.entries(OPENING_TYPES).map(([key, profile]) => (
                            <option key={key} value={key}>{profile.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>Width (ft)<input type="number" min="1" max="24" value={opening.widthFt} onChange={(event) => updateOpening(index, 'w', event.target.value)} /></label>
                      {opening.wall === 'roof' ? (
                        <>
                          <label>Across, W→E (ft)<input type="number" min="0" value={Number(opening.x) || 0} onChange={(event) => updateOpening(index, 'roofX', event.target.value)} /></label>
                          <label>Down, N→S (ft)<input type="number" min="0" value={Number(opening.y) || 0} onChange={(event) => updateOpening(index, 'roofY', event.target.value)} /></label>
                        </>
                      ) : (
                        <label>Along wall (ft)<input type="number" min="0" value={Number(opening.wall === 'north' || opening.wall === 'south' ? opening.x : opening.y) || 0} onChange={(event) => updateOpening(index, 'along', event.target.value)} /></label>
                      )}
                    </div>
                    <button className="ghost openingRemove" onClick={() => removeOpening(index)}><Trash2 size={13} /> Remove</button>
                  </div>
                ))}
              </div>
              <div className="addOpeningBar">
                <label>Add to wall
                  <select value={windowAddWall} onChange={(event) => setWindowAddWall(event.target.value)}>
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                    <option value="roof">Roof (skylight)</option>
                  </select>
                </label>
                <div className="buttonRow openingTypeRow">
                  {Object.entries(OPENING_TYPES).map(([key, profile]) => {
                    const roofOnly = Boolean(profile.roof);
                    const wall = windowAddWall === 'roof' ? 'roof' : (roofOnly ? 'roof' : windowAddWall);
                    return (
                      <button
                        key={key}
                        className="secondary"
                        title={roofOnly ? 'Skylights sit on the roof plane' : `Add a ${profile.label.toLowerCase()} to the ${windowAddWall} wall`}
                        onClick={() => addOpeningOnWall(wall, key)}
                      ><Plus size={15} /> {profile.label}</button>
                    );
                  })}
                </div>
              </div>
              <p className="systemNote">Pick a wall, then a type. Glazed doors (french, sliders) and bay windows count toward your south solar glass; clerestories sit high for daylight and summer venting; skylights always land on the roof (place them with the two plan coordinates).</p>
            </div>
          )}

          {systemView === 'outdoors' && (
            <div className="systemPage">
              <div className="sectionHead">The rest of the homestead</div>
              <div className="outdoorGrid">
                {OUTDOOR_ITEMS.map((item) => {
                  const on = outdoorItemPresent(spec, item);
                  return (
                    <button key={item.key} className={on ? 'outdoorItem on' : 'outdoorItem'} onClick={() => toggleOutdoorItem(item)}>
                      <b>{item.name}</b>
                      <small>{item.note}</small>
                      <span className="outdoorCost">${item.cost.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
              <p className="systemNote">Toggling an item places it on the site next to the house — drag it where it belongs in the model. Each adds its cost to the build.</p>
            </div>
          )}

          {systemView === 'water' && (
            <div className="systemPage">
              <div className="sectionHead">Where water comes from</div>
              <div className="controlGrid">
                <label>Source
                  <select value={utilitiesOf(spec).waterSource} onChange={(event) => updateUtility('waterSource', event.target.value)}>
                    <option value="well">Drilled well — reliable, needs a pump</option>
                    <option value="spring">Spring — cheap if the land has one</option>
                    <option value="catchment">Rain catchment — roof + rain</option>
                    <option value="town">Town main — simplest</option>
                  </select>
                </label>
                <label>Storage tank (gal)<input type="number" min="0" max="50000" step="100" value={utilitiesOf(spec).tankGal} onChange={(event) => updateUtility('tankGal', event.target.value)} /></label>
              </div>
              <p className="systemNote">A well adds a pump to your power load. Catchment leans on the roof area and your site's rainfall — the readouts below show whether it covers the household.</p>
            </div>
          )}

          {systemView === 'waste' && (
            <div className="systemPage">
              <div className="sectionHead">Where used water goes</div>
              <div className="controlGrid">
                <label>Method
                  <select value={utilitiesOf(spec).wasteMethod} onChange={(event) => updateUtility('wasteMethod', event.target.value)}>
                    <option value="septic">Septic + leach field — conventional</option>
                    <option value="composting">Composting toilet + greywater</option>
                    <option value="reedbed">Reed bed / constructed wetland</option>
                  </select>
                </label>
                {utilitiesOf(spec).wasteMethod === 'septic' && (
                  <label>Well → septic distance (ft)<input type="number" min="0" max="2000" step="5" value={utilitiesOf(spec).wellSepticFt} onChange={(event) => updateUtility('wellSepticFt', event.target.value)} /></label>
                )}
              </div>
              <p className="systemNote">A septic field must sit at least 100 ft from a well, and bedrooms size the field. Composting sidesteps most of that.</p>
            </div>
          )}

          {systemView === 'power' && (
            <div className="systemPage">
              <div className="sectionHead">Where electricity comes from</div>
              <div className="controlGrid">
                <label>Mode
                  <select value={utilitiesOf(spec).powerMode} onChange={(event) => updateUtility('powerMode', event.target.value)}>
                    <option value="offgrid">Off-grid — panels + battery, independent</option>
                    <option value="hybrid">Grid + solar — panels, grid as backup</option>
                    <option value="gridtie">Grid only — simplest, no battery</option>
                  </select>
                </label>
              </div>
              <p className="systemNote">The well pump and an electric heater land here as loads; panels are then sized against your roof and your site's sun.</p>
            </div>
          )}

          {systemView === 'heat' && (
            <div className="systemPage">
              <div className="sectionHead">How you stay warm</div>
              <div className="controlGrid">
                <label>Source
                  <select value={utilitiesOf(spec).heatSource} onChange={(event) => updateUtility('heatSource', event.target.value)}>
                    <option value="rocket_mass">Rocket mass heater — wood, huge mass, very DIY</option>
                    <option value="masonry">Masonry heater — wood, slow steady radiant</option>
                    <option value="wood_stove">Wood stove — simple, familiar</option>
                    <option value="minisplit">Electric mini-split — no wood, draws power</option>
                  </select>
                </label>
              </div>
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyHeat} onChange={(event) => updateUtility('diyHeat', event.target.checked)} />
                <span>I'll build the heater myself (sweat equity)</span>
              </label>
              <p className="systemNote">Your walls, roof, and windows set the heat load below. A mini-split moves the burden onto Power; the wood options need a chimney and clearances.</p>
            </div>
          )}

          {systemView === 'roof' && (
            <div className="systemPage">
              <div className="sectionHead">Roof shape</div>
              <div className="controlGrid">
                <label>Style
                  <select value={spec.shell.roofType || 'gable'} onChange={(event) => updateShell('roofType', event.target.value)}>
                    <option value="gable">Gable</option>
                    <option value="shed">Shed</option>
                    <option value="flat">Flat</option>
                    <option value="hip">Hip</option>
                  </select>
                </label>
                <label>Pitch <em className="pitchHint">≈ {Math.round(Number(spec.shell.roofPitch || 0.32) * 12)}:12</em><input type="number" step="0.01" value={spec.shell.roofPitch} onChange={(event) => updateShell('roofPitch', event.target.value)} /></label>
              </div>
              <div className="breakOpenRow">
                <div className="sectionHead">Overhang</div>
                <button className="breakOpen" onClick={() => setOverhangBreakOpen((open) => !open)}>
                  {overhangBreakOpen ? '▾ one value all around' : '▸ break open per side (N/S/E/W)'}
                </button>
              </div>
              {!overhangBreakOpen ? (
                <div className="controlGrid">
                  <label>Overhang (ft)<input type="number" step="0.5" min="0" max="12" value={resolveOverhangs(spec.shell).split ? '' : resolveOverhangs(spec.shell).all} placeholder={resolveOverhangs(spec.shell).split ? 'mixed — break open' : undefined} onChange={(event) => updateOverhang('all', event.target.value)} /></label>
                </div>
              ) : (
                <div className="wallSideGrid">
                  {WALL_SIDES.map((side) => (
                    <label key={side} className="wallSideCell">
                      <span className="wallSideLabel">{WALL_SIDE_LABELS[side]}</span>
                      <input type="number" step="0.5" min="0" max="12" value={resolveOverhangs(spec.shell)[side]} onChange={(event) => updateOverhang(side, event.target.value)} />
                      <span className="wallSideUnit">ft</span>
                    </label>
                  ))}
                </div>
              )}
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyRoof} onChange={(event) => updateUtility('diyRoof', event.target.checked)} />
                <span>I'll frame the roof myself (sweat equity)</span>
              </label>
              <p className="systemNote">The overhang shields plastered natural walls (24" minimum) and shades summer sun without blocking winter rays — 2 to 3 ft is the sweet spot on the south. A different north vs south wall height on the Shell page makes a shed roof.</p>
            </div>
          )}

          {SYSTEM_META[systemView] && (() => {
            const meta = SYSTEM_META[systemView];
            const reads = meta.reads ? meta.reads(derived, spec) : [];
            return (
              <div className="systemFeedback">
                <div className="whyNote">{meta.why}</div>
                {reads.length > 0 && (
                  <>
                    <div className="sectionHead readsHead">What this comes to</div>
                    <div className="readsGrid">
                      {reads.map(([key, value, unit, note]) => (
                        <div className="readCell" key={key}>
                          <span className="readKey">{key}</span>
                          <strong className="readValue">{value} {unit && <small>{unit}</small>}</strong>
                          {note && <span className="readNote">{note}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {meta.feeds && meta.feeds.length > 0 && (
                  <div className="feedsRow">
                    <span className="systemNavEyebrow">Feeds</span>
                    {meta.feeds.map((tag) => <span className="feedTag" key={tag}>{tag}</span>)}
                  </div>
                )}
              </div>
            );
          })()}
        </section>}

        {appMode === 'design' && consoleView === 'os' && <section className="panelBlock consolePanel projectOS">
            <div className="blockTitle"><ClipboardCheck size={16} /> Project Plan</div>
            <div className="osStage">
              {workflowStages.map((stage) => (
                <span key={stage} className={stage === projectBrain.stage ? 'active' : ''}>{stage}</span>
              ))}
            </div>
            <div className="osBlock">
              <b>Master Brief</b>
              <p>{projectBrain.masterDesignBrief.summary}</p>
            </div>
            <div className="osGrid">
              <div className="osBlock">
                <b>Requirements</b>
                {(projectBrain.requirements || []).slice(0, 4).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
              <div className="osBlock">
                <b>Open Questions</b>
                {(projectBrain.openQuestions || []).filter((item) => item.status !== 'closed').slice(0, 4).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
              <div className="osBlock">
                <b>Task Queue</b>
                {(projectBrain.taskQueue || []).slice(0, 5).map((item) => <p key={item.id}><span>{item.priority}</span> {item.title}</p>)}
              </div>
              <div className="osBlock">
                <b>Recent Decisions</b>
                {(projectBrain.decisions || []).slice(0, 5).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
            </div>
            <details className="contextPacket">
              <summary>Context Packet Preview</summary>
              <pre>{JSON.stringify(contextPacket, null, 2)}</pre>
            </details>
        </section>}

        {appMode === 'design' && consoleView === 'costs' && (() => {
          const rows = COST_ROWS
            .map((row) => ({ ...row, amount: derived.cost[row.key] || 0 }))
            .filter((row) => row.amount > 0)
            .sort((a, b) => b.amount - a.amount);
          const subtotal = derived.totalBeforeSweat;
          const maxAmount = rows.length ? rows[0].amount : 1;
          const perSf = derived.heatedFloor > 0 ? derived.total / derived.heatedFloor : 0;
          const overBy = derived.total - 324700;
          const diyTrades = [
            { field: 'diyWalls', label: 'Walls', costKey: 'walls', frac: 0.8 },
            { field: 'diyRoof', label: 'Roof', costKey: 'roof', frac: 0.55 },
            { field: 'diyHeat', label: 'Heat', costKey: 'heat', frac: 0.45 },
            { field: 'diyFoundation', label: 'Foundation', costKey: 'foundation', frac: 0.5 }
          ];
          const toggleDiy = (field) => void applyBackendOperations({
            operations: [{ type: 'set_utility', field, value: !derived.utilities[field] }],
            promptText: `${derived.utilities[field] ? 'Hire out' : 'Self-build'} the ${field.replace('diy', '').toLowerCase()}`,
            logPrefix: 'Sweat equity'
          });
          return (
            <section className="panelBlock consolePanel costPanel">
              <div className="blockTitle"><Coins size={16} /> Cost breakdown</div>
              <p className="studioHint">Every system's directional cost, biggest first. Tap a row to open that system's controls. Early-design estimates — order from your own counts.</p>
              <div className="costHead">
                <div><strong>{fmtMoney(derived.total)}</strong><span>after sweat equity</span></div>
                <div><strong>{perSf > 0 ? fmtMoney(perSf) : '—'}</strong><span>per heated sf</span></div>
                <div><strong>{(derived.carbonKg / 1000).toFixed(1)} t</strong><span>embodied CO₂e</span></div>
              </div>
              <div className="costRows">
                {rows.map((row) => (
                  <button type="button" className="costRow" key={row.key} onClick={() => { setConsoleView('systems'); setSystemView(row.system); setInspectorView('schedule'); }}>
                    <span className="costRowLabel">{row.label}</span>
                    <span className="costBar"><span className="costBarFill" style={{ width: `${Math.max(3, (row.amount / maxAmount) * 100)}%` }} /></span>
                    <span className="costRowAmt">{fmtMoney(row.amount)}</span>
                    <span className="costRowPct">{subtotal > 0 ? Math.round((row.amount / subtotal) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
              <div className="costTotals">
                <div className="costTotalRow"><span>Subtotal</span><b>{fmtMoney(subtotal)}</b></div>
                {derived.sweat > 0 && <div className="costTotalRow save"><span>Sweat equity</span><b>−{fmtMoney(derived.sweat)}</b></div>}
                <div className="costTotalRow net"><span>Estimated total</span><b>{fmtMoney(derived.total)}</b></div>
              </div>
              <div className="sectionHead">Do it yourself</div>
              <p className="systemNote">Each trade you take on drops the cash cost by its labor share. Toggle what you'll build.</p>
              <div className="diyGrid">
                {diyTrades.map((trade) => {
                  const on = Boolean(derived.utilities[trade.field]);
                  const saves = (derived.cost[trade.costKey] || 0) * trade.frac;
                  return (
                    <label key={trade.field} className={on ? 'diyToggle on' : 'diyToggle'}>
                      <input type="checkbox" checked={on} onChange={() => toggleDiy(trade.field)} />
                      <span>{trade.label}</span>
                      <small>{on ? `saving ${fmtMoney(saves)}` : `save ~${fmtMoney(saves)}`}</small>
                    </label>
                  );
                })}
              </div>
              <div className={overBy > 0 ? 'costCeiling over' : 'costCeiling under'}>
                {overBy > 0
                  ? `${fmtMoney(overBy)} over the $324,700 owner-builder loan ceiling — trim the footprint, simplify systems, or take on more sweat equity.`
                  : `${fmtMoney(-overBy)} under the $324,700 owner-builder loan ceiling.`}
              </div>
            </section>
          );
        })()}

        {appMode === 'design' && consoleView === 'review' && <section className="panelBlock consolePanel reviewHub">
            <div className="blockTitle"><ShieldCheck size={16} /> Does it add up</div>
            {(() => {
              const openFlags = issues.filter((item) => item.severity !== 'pass');
              const critical = openFlags.filter((item) => item.severity === 'critical').length;
              const state = openFlags.length === 0 ? 'ok' : critical > 0 ? 'bad' : 'warn';
              return (
                <div className={`checksSummary ${state}`}>
                  <strong>{openFlags.length === 0 ? 'Everything checks out' : `${openFlags.length} thing${openFlags.length === 1 ? '' : 's'} to fix`}</strong>
                  <span>{openFlags.length === 0 ? 'The design passes every check the council runs.' : critical > 0 ? 'At least one check must be fixed before drawings.' : 'Worth fixing, but nothing is blocking yet.'}</span>
                </div>
              );
            })()}
            <div className="issues">
              {issues.map((issue, index) => (
                <div key={`${issue.title}-${index}`} className={`issue ${issue.severity}`}>
                  {issue.severity === 'pass' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <div>
                    <b>{issue.title}</b>
                    <span>{issue.fix}</span>
                    <div className="issueActions">
                      {issue.system && issue.severity !== 'pass' && (
                        <button type="button" className="issueJump" onClick={() => { setConsoleView('systems'); setSystemView(issue.system); setInspectorView('schedule'); }}>Go to {SYSTEM_META[issue.system]?.label || issue.system}</button>
                      )}
                      {issue.fixId && FIX_LABELS[issue.fixId] && (
                        <button type="button" className="issueFix" onClick={() => fixIssue(issue)}><Wrench size={13} /> {FIX_LABELS[issue.fixId]}</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
        </section>}

        {appMode === 'design' && consoleView === 'experts' && <section className="panelBlock consolePanel">
            <div className="blockTitle"><Users size={16} /> Council of Professionals</div>
            <p className="studioHint">Select an expert here, then ask in Studio.</p>
            <div className="council">
              {council.map((expert) => {
                const Icon = expert.icon;
                return (
                  <button key={expert.id} className={`expert ${expert.status}`} onClick={() => chooseChatTarget(expert.id)}>
                    <Icon size={17} />
                    <div><b>{expert.name}</b><span>{expert.notes}</span></div>
                  </button>
                );
              })}
            </div>
        </section>}

        {appMode === 'design' && consoleView === 'audit' && <section className="panelBlock consolePanel">
            <div className="blockTitle"><FileJson size={16} /> Change History</div>
            <div className="auditList">
              {operationAudit.length === 0 && <p className="studioHint">No structured operations recorded yet.</p>}
              {operationAudit.map((item) => (
                <article className="auditItem" key={item.id}>
                  <b>{item.prompt}</b>
                  <span>{item.source} · Rev {item.beforeRevision} → {item.afterRevision}</span>
                  {item.changedIds.length > 0 && <small>Changed: {item.changedIds.join(', ')}</small>}
                  {item.operations.length > 0 && <ul>{item.operations.slice(0, 6).map((operation, index) => <li key={`${item.id}-${index}`}>{operation}</li>)}</ul>}
                  {item.warnings.length > 0 && <small>Warnings: {item.warnings.join(' | ')}</small>}
                </article>
              ))}
            </div>
        </section>}

        {appMode === 'design' && consoleView === 'log' && <section className="panelBlock consolePanel">
            <div className="blockTitle"><Layers size={16} /> Revision Log</div>
            <div className="log">
              {revisionLog.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
            </div>
        </section>}

      </aside>

      <section className="workspace">
        <header className="topBar">
          <div className="projectIdentity">
            <label>
              <span>Design Name</span>
              <input value={spec.projectName} onChange={(event) => updateProjectName(event.target.value)} />
            </label>
            <p>Revision {spec.revision} · {spec.shell.widthFt}' x {spec.shell.depthFt}' · Blender/IFC export ready</p>
            {savedAt && <p className="saveStatus">Saved in app: {savedAt}</p>}
          </div>
          <div className="exportActions">
            <button className="ghost" title="Start a new design" onClick={() => setWelcomeOpen(true)}><Plus size={16} /> New</button>
            <button className="ghost backButton" onClick={goBackRevision} disabled={history.length === 0}><Undo2 size={16} /> Back</button>
            <button className="ghost saveButton" onClick={saveHouseState}><Save size={16} /> Save House</button>
            <button className="ghost" onClick={exportSheetSet}><FileText size={16} /> Permit Set</button>
            <button className="ghost" title="Rebuild this design in the Blender backend (starts a headless Blender automatically if needed)" onClick={async () => { try { await pushToBlender(spec); window.alert('Synced to Blender: the model is rebuilding in the Natural Building GC backend.'); } catch (e) { window.alert('Blender sync failed: ' + e.message + ' (First start can take up to a minute — try once more.)'); } }}>Sync to Blender</button>
            <button className="ghost" title="Push this design to Blender and write a validated IFC4 file" onClick={async () => { try { const r = await exportIfcViaBlender(spec); window.alert(r && r.ok ? ('IFC written: ' + r.path + ' (' + r.count + ' elements). Open it in any BIM viewer.') : ('IFC export failed: ' + ((r && r.error) || 'unknown'))); } catch (e) { window.alert('Blender backend not reachable. Start Blender 5.1 with the Dashboard add-on, then retry. (' + e.message + ')'); } }}>Export IFC</button>
          </div>
        </header>

        <div className="modelShell">
          {viewMode === 'plan' ? (
            <PlanView
              spec={spec}
              selectedRoom={selectedRoom}
              onSelect={setSelectedRoom}
              onMove={planMoveObject}
              onResize={planResizeObject}
              activeFloor={activeFloor}
            />
          ) : (
            <ThreeScene
              spec={spec}
              selectedRoom={selectedRoom}
              layers={modelLayers}
              onSelectRoom={setSelectedRoom}
              onMoveStart={beginPlanMove}
              onMoveEnd={finishPlanMove}
              onResizeEnd={finishPlanResize}
              onDimensionPreview={setDimensionPreview}
            />
          )}
          <div className="viewModeToggle">
            <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>3D</button>
            <button className={viewMode === 'plan' ? 'active' : ''} onClick={() => setViewMode('plan')}>Plan</button>
          </div>
          {(viewMode === 'plan' || floorCount(spec) > 1) && <div className="floorTabs">
            {Array.from({ length: floorCount(spec) }, (_, i) => i + 1).map((floor) => (
              <button key={floor} className={activeFloor === floor ? 'active' : ''} onClick={() => setActiveFloor(floor)} title={`${floorLabel(spec, floor)} — view & edit this floor`}>{floor === 1 ? 'Ground' : floorLabel(spec, floor).replace(' floor', '')}</button>
            ))}
            {floorCount(spec) < 3 && <button className="addFloor" onClick={addStorey} title="Add a storey">+ Floor</button>}
          </div>}
          {viewMode === '3d' && <button className={`layersToggle${layersOpen ? ' open' : ''}${hiddenLayerCount > 0 || modelLayers.xray ? ' filtered' : ''}`} onClick={() => setLayersOpen((open) => !open)} title="Show / hide model layers">
            <Layers size={14} /> Layers{hiddenLayerCount > 0 ? ` · ${hiddenLayerCount} off` : modelLayers.xray ? ' · x-ray' : ''}
          </button>}
          {(hiddenLayerCount > 0 || modelLayers.xray) && (
            <div className="viewFilterBadge">
              <span>
                {hiddenLayerCount > 0 ? `Partial view — ${hiddenLayerCount} group${hiddenLayerCount === 1 ? '' : 's'} hidden` : 'X-ray view'}
                {hiddenLayerCount > 0 && modelLayers.xray ? ' · x-ray' : ''}. Costs and checks still cover the whole design.
              </span>
              <button onClick={() => setModelLayers({ ...LAYER_PRESETS.all })}>Show all</button>
            </div>
          )}
          {layersOpen && (() => {
            const set = (patch) => setModelLayers((current) => ({ ...current, ...patch }));
            const check = (key, label) => (
              <label className="layerCheck" key={key}>
                <input type="checkbox" checked={Boolean(modelLayers[key])} onChange={(event) => set({ [key]: event.target.checked })} />
                <span>{label}</span>
              </label>
            );
            const presentCats = [...new Set((spec.elements || []).map((element) => element.category || 'custom'))];
            const hiddenCats = modelLayers.hiddenCats || [];
            return (
              <div className="layersPanel">
                <div className="layersPresets">
                  {Object.entries({ all: 'All', structure: 'Structure', plan: 'Plan', interior: 'Interior', site: 'Site' }).map(([key, label]) => (
                    <button key={key} onClick={() => setModelLayers({ ...LAYER_PRESETS[key] })}>{label}</button>
                  ))}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Building</span>
                  {check('wallNorth', 'North wall')}
                  {check('wallSouth', 'South wall')}
                  {check('wallEast', 'East wall')}
                  {check('wallWest', 'West wall')}
                  {check('roof', 'Roof')}
                  {storeyInfo(spec.shell).storeys > 1 && check('upperFloors', 'Upper floors')}
                  {check('openings', 'Windows & doors')}
                  {check('rooms', 'Rooms')}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Site</span>
                  {check('pad', 'Site pad')}
                  {check('ground', 'Ground & grid')}
                  {check('elements', 'Elements')}
                  {modelLayers.elements && presentCats.map((cat) => (
                    <label className="layerCheck sub" key={`cat-${cat}`}>
                      <input type="checkbox" checked={!hiddenCats.includes(cat)} onChange={(event) => set({ hiddenCats: event.target.checked ? hiddenCats.filter((item) => item !== cat) : [...hiddenCats, cat] })} />
                      <span>{titleCase(cat)}</span>
                    </label>
                  ))}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Display</span>
                  {check('labels', 'Labels')}
                  {check('xray', 'X-ray walls & roof')}
                </div>
              </div>
            );
          })()}
          {viewMode === '3d' && <div className="viewBadge"><Camera size={15} /> drag rooms, drag corner handles to resize</div>}
          <div className="changeBadge" key={`${spec.revision}-${selectedRoom}`}><Sparkles size={14} /> Rev {spec.revision}: {lastModelChange}</div>
          {viewMode === '3d' && dimensionPreview && (
            <div className="dimensionBadge">
              <Ruler size={15} />
              <span>{dimensionPreview.mode === 'resize' ? 'Resizing' : 'Moving'} · {dimensionPreview.w}' x {dimensionPreview.d}' · X {dimensionPreview.x}' Y {dimensionPreview.y}'</span>
            </div>
          )}
          {viewMode === '3d' && <div className="northBadge">N</div>}
        </div>

        <div className="lowerDeck">
          <section className="bimEditor">
            <div className="bimEditorHead">
              <div>
                <div className="sectionHead"><Grid3X3 size={17} /> BIM Inspector</div>
                <nav className="inspectorTabs" aria-label="BIM inspector">
                  <button className={inspectorView === 'inspect' ? 'active' : ''} onClick={() => setInspectorView('inspect')}>Selected</button>
                  <button className={inspectorView === 'schedule' ? 'active' : ''} onClick={() => setInspectorView('schedule')}>Schedule</button>
                  <button className={inspectorView === 'assemblies' ? 'active' : ''} onClick={() => setInspectorView('assemblies')}>Assemblies</button>
                  <button className={inspectorView === 'outputs' ? 'active' : ''} onClick={() => setInspectorView('outputs')}>Outputs</button>
                </nav>
              </div>
              <div className="selectedSummary"><Ruler size={15} /> {selected?.name} · {selected?.w}' x {selected?.d}' · {Math.round(selected?.w * selected?.d)} sf</div>
            </div>

            {inspectorView === 'schedule' && (
              <div className="schedulePane fullPane">
                <div className="miniHead">BIM Space and Element Schedule</div>
                {systemFocus && <div className="scheduleFocus">Focus: {SYSTEM_LABELS[systemFocus] || systemFocus} — showing this system's items. Pick another system on the left, or leave the Systems tab to see everything.</div>}
                {(() => {
                  const rooms = spec.rooms.filter((room) => !systemFocus || systemOfRoom(room) === systemFocus);
                  const elements = (spec.elements || []).filter((element) => !systemFocus || systemOfElementCategory(element.category) === systemFocus);
                  const walls = (!systemFocus || systemFocus === 'walls' || systemFocus === 'shell') ? wallSections : [];
                  const specials = specialBimObjects.filter((object) => !systemFocus || systemOfSpecialCategory(object.category) === systemFocus);
                  // Systems whose reality is design state rather than placed
                  // objects (foundation, heat, water...) still ARE in the
                  // model — show them as derived fact cards, never a false
                  // "nothing here yet".
                  const factCards = (() => {
                    if (!systemFocus) return [];
                    const u = derived.utilities;
                    const money = (n) => `$${Math.round(n).toLocaleString()}`;
                    const perimeter = Math.round(2 * ((Number(spec.shell.widthFt) || 0) + (Number(spec.shell.depthFt) || 0)));
                    const names = {
                      foundation: { rubble: 'Rubble Trench Foundation', stemwall: 'Stem Wall Foundation', slab: 'Insulated Slab Foundation' },
                      heat: { rocket_mass: 'Rocket Mass Heater', masonry: 'Masonry Heater', wood_stove: 'Wood Stove', minisplit: 'Electric Mini-Split' },
                      water: { well: 'Drilled Well', spring: 'Spring Supply', catchment: 'Rain Catchment', town: 'Town Main' },
                      waste: { septic: 'Septic Tank + Leach Field', composting: 'Composting Toilet + Greywater', reedbed: 'Reed Bed Wetland' },
                      power: { offgrid: 'Off-Grid Solar + Battery', hybrid: 'Grid + Solar', gridtie: 'Grid Power' }
                    };
                    switch (systemFocus) {
                      case 'foundation': return [{ key: 'f', name: names.foundation[u.foundationType] || 'Foundation', meta: `${spec.shell.widthFt}' × ${spec.shell.depthFt}' footprint · ${perimeter} lf perimeter${u.foundationType === 'stemwall' ? ` · ${derived.stemwallHeightFt}' stem` : ''} · ${money(derived.cost.foundation)}` }];
                      case 'heat': return [{ key: 'h', name: names.heat[u.heatSource] || 'Heat Source', meta: `covers a ${derived.heatLoadKbtu.toFixed(1)} kBTU/hr design load · ${money(derived.cost.heat)}` }];
                      case 'water': return [{ key: 'w', name: names.water[u.waterSource] || 'Water Source', meta: `${Number.isFinite(derived.supplyGpd) ? `${Math.round(derived.supplyGpd)} gal/day supply` : 'unlimited supply'} vs ${Math.round(derived.waterGpd)} used${u.tankGal ? ` · ${Number(u.tankGal).toLocaleString()} gal tank` : ''} · ${money(derived.cost.water)}` }];
                      case 'waste': return [{ key: 'x', name: names.waste[u.wasteMethod] || 'Waste System', meta: `${Math.round(derived.septicGpd)} gal/day design flow${u.wasteMethod === 'septic' ? ` · ${u.wellSepticFt}' from the well` : ''} · ${money(derived.cost.waste)}` }];
                      case 'power': return [{ key: 'p', name: names.power[u.powerMode] || 'Power', meta: `${derived.loadKwhDay.toFixed(1)} kWh/day${derived.panels ? ` · ${derived.panels} panels` : ''}${derived.batteryKwh ? ` · ${derived.batteryKwh} kWh battery` : ''} · ${money(derived.cost.power)}` }];
                      case 'site': return [{ key: 's', name: derived.site.placeName || 'Site (no place set yet)', meta: `${derived.site.latitudeDeg}° latitude · ${derived.site.rainInYr}" rain/yr · ${derived.peakSunHrs.toFixed(1)} peak sun hrs/day` }];
                      case 'windows': return [{ key: 'g', name: derived.utilities.windowQuality === 'triple' ? 'Triple-Pane Glazing (whole house)' : 'Double-Pane Glazing (whole house)', meta: `${Math.round(derived.southGlass)} sf south glass · ${derived.glassPct.toFixed(1)}% of floor · ${money(derived.cost.windows)}` }];
                      default: return [];
                    }
                  })();
                  if (rooms.length + elements.length + walls.length + specials.length + factCards.length === 0) {
                    return <div className="scheduleEmpty">No {SYSTEM_LABELS[systemFocus] || 'matching'} items in the model yet. Tell the assistant what to add — it will appear here.</div>;
                  }
                  return (
                    <div className="roomTable">
                      {factCards.map((fact) => (
                        <div key={fact.key} className="roomRow systemFact">
                          <span>{fact.name}</span>
                          <small>{fact.meta}</small>
                        </div>
                      ))}
                      {rooms.map((room) => (
                        <button key={room.id} className={room.id === selectedRoom ? 'roomRow active' : 'roomRow'} onClick={() => setSelectedRoom(room.id)}>
                          <span>{room.name}</span>
                          <small>{Math.round(room.w * room.d)} sf · {room.type}</small>
                        </button>
                      ))}
                      {elements.map((element) => (
                        <button key={element.id} className={element.id === selectedRoom ? 'roomRow element active' : 'roomRow element'} onClick={() => setSelectedRoom(element.id)}>
                          <span>{element.name}</span>
                          <small>{Math.round(element.w * element.d)} sf · {element.category}</small>
                        </button>
                      ))}
                      {walls.map((wall) => (
                        <button key={wall.id} className={wall.id === selectedRoom ? 'roomRow wall active' : 'roomRow wall'} onClick={() => setSelectedRoom(wall.id)}>
                          <span>{wall.name}</span>
                          <small>{wall.lengthFt}' long · {wall.heightFt}' high · {wall.assembly}</small>
                        </button>
                      ))}
                      {specials.map((object) => (
                        <button key={object.id} className={object.id === selectedRoom ? 'roomRow special active' : 'roomRow special'} onClick={() => setSelectedRoom(object.id)}>
                          <span>{object.name}</span>
                          <small>{object.category} · {Math.round(object.w * object.d)} sf</small>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {inspectorView === 'inspect' && (
              <div className="editorPane fullPane">
                {selectedIsWall && <p className="elementNote">{selected?.note}</p>}
                {selectedIsElement && <p className="elementNote">{selected?.note}</p>}
                {selectedIsSpecial && <p className="elementNote">{selected?.note}</p>}
                {!selectedIsElement && !selectedIsWall && !selectedIsSpecial && <div className="modelEditHint"><Camera size={15} /> Drag the room body to move it. Drag green corner cubes in the model to resize; dimensions appear live.</div>}
                <div className={selectedIsWall ? 'liveEdit wallEdit' : 'liveEdit'}>
                  <label>Name<input value={selected?.name || ''} onChange={(event) => updateSelectedRoom('name', event.target.value)} /></label>
                  <label>{selectedIsWall ? 'Length' : 'Width'}<input type="number" value={selectedIsWall ? selected?.lengthFt || 0 : selected?.w || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom('w', event.target.value)} /></label>
                  <label>{selectedIsWall ? 'Thickness' : 'Depth'}<input type="number" step={selectedIsWall ? 0.05 : undefined} value={selectedIsWall ? selected?.thicknessFt ?? modeledWallProfile.thicknessFt : selected?.d || 0} disabled={selectedIsOpening || selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsWall ? 'thickness' : 'd', event.target.value)} /></label>
                  {selectedIsWall && <label>System
                    <select value={selected?.assemblyKey || 'framed'} onChange={(event) => updateSelectedRoom('assembly', event.target.value)}>
                      {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                        <option key={assembly.key} value={assembly.key}>{assembly.label}</option>
                      ))}
                    </select>
                  </label>}
                  {!selectedIsWall && <label>{selectedIsOpening ? 'Along Wall' : 'X'}<input type="number" value={selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? selected.x : selected.y) || 0 : selected?.x || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? 'x' : 'y') : 'x', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsOpening && <label>Y<input type="number" value={selected?.y || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom('y', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsSpecial && !selectedIsElement && storeyInfo(spec.shell).storeys > 1 && <label>Level<input type="number" min="1" max={Math.ceil(storeyInfo(spec.shell).storeys)} value={Number(selected?.level || 1)} onChange={(event) => updateSelectedRoom('level', event.target.value)} /></label>}
                  {(selectedIsElement || selectedIsWall || selectedIsRoof) && <label>Height<input type="number" value={selected?.h || 1.2} disabled={selectedIsOpening || selectedIsPad || selectedIsGrid || (selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west'))} title={selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west') ? 'Raked wall — its ends follow the north and south walls' : undefined} onChange={(event) => updateSelectedRoom('h', event.target.value)} /></label>}
                  {selectedIsSpecial && !selectedIsPad && <label>{selectedIsRoof ? 'Roof Type' : 'Opening Type'}
                    <select value={selectedIsRoof ? (selected?.type || 'gable') : (OPENING_TYPES[selected?.type] ? selected.type : 'window')} onChange={(event) => updateSelectedRoom('type', event.target.value)}>
                      {selectedIsRoof && <option value="gable">gable</option>}
                      {selectedIsRoof && <option value="shed">shed / lean-to</option>}
                      {!selectedIsRoof && Object.entries(OPENING_TYPES).map(([key, profile]) => (
                        <option key={key} value={key}>{profile.label}</option>
                      ))}
                    </select>
                  </label>}
                  {!selectedIsWall && !selectedIsSpecial && <label>{selectedIsElement ? 'Category' : 'Type'}
                    <select value={selectedIsElement ? selected?.category || 'storage' : selected?.type || 'living'} onChange={(event) => updateSelectedRoom(selectedIsElement ? 'category' : 'type', event.target.value)}>
                      {selectedIsElement && <option value="wall">wall</option>}
                      {selectedIsElement && <option value="earthwork">earthwork</option>}
                      {selectedIsElement && <option value="structure">structure</option>}
                      {selectedIsElement && <option value="roof">roof</option>}
                      {selectedIsElement && <option value="passive">passive</option>}
                      {selectedIsElement && <option value="thermal">thermal</option>}
                      {selectedIsElement && <option value="water">water</option>}
                      {selectedIsElement && <option value="landscape">landscape</option>}
                      {selectedIsElement && <option value="garden">garden</option>}
                      {selectedIsElement && <option value="animal">animal</option>}
                      {selectedIsElement && <option value="floor">floor</option>}
                      {selectedIsElement && <option value="loft">loft</option>}
                      {selectedIsElement && <option value="tower">tower</option>}
                      {selectedIsElement && <option value="custom">custom</option>}
                      <option value="living">living</option>
                      <option value="service">service</option>
                      <option value="sleeping">sleeping</option>
                      <option value="wet">wet</option>
                      <option value="work">work</option>
                      <option value="plant">plant</option>
                      <option value="storage">storage</option>
                      <option value="outdoor">outdoor</option>
                      <option value="site">site</option>
                      <option value="garden">garden</option>
                      <option value="animal">animal</option>
                      <option value="paddock">paddock</option>
                      <option value="run">run</option>
                      <option value="landscape">landscape</option>
                      <option value="homestead">homestead</option>
                    </select>
                  </label>}
                  <div className="editActions">
                    {selectedIsSpecial ? (
                      <>
                        {selectedIsOpening && <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove Opening</button>}
                        {selectedIsPad && <button className="secondary" onClick={() => updateSelectedRoom('w', selected.w + 32)}><Plus size={15} /> Expand Pad</button>}
                        {selectedIsGrid && <span className="fixedNote">Fixed scale reference</span>}
                      </>
                    ) : selectedIsWall ? (
                      <>
                        <label className="addOpeningPick">Add opening
                          <select value={wallOpeningType} onChange={(event) => setWallOpeningType(event.target.value)}>
                            {Object.entries(OPENING_TYPES).filter(([, profile]) => !profile.roof).map(([key, profile]) => (
                              <option key={key} value={key}>{profile.label}</option>
                            ))}
                          </select>
                        </label>
                        <button onClick={() => addOpeningToSelectedWall(wallOpeningType)}><Plus size={15} /> Add to this wall</button>
                        <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove Wall</button>
                      </>
                    ) : (
                      <>
                        <button onClick={addRoom}><Plus size={15} /> Add Space</button>
                        <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {inspectorView === 'assemblies' && (
              <div className="assembliesPane fullPane">
              <div className="shellEdit">
                <label>Shell W<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                <label>Shell D<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
                <label>Wall H<input type="number" value={spec.shell.wallHeightFt} onChange={(event) => updateShell('wallHeightFt', event.target.value)} /></label>
                <label>Roof <em className="pitchHint">≈ {Math.round(Number(spec.shell.roofPitch || 0.32) * 12)}:12</em><input type="number" step="0.01" value={spec.shell.roofPitch} onChange={(event) => updateShell('roofPitch', event.target.value)} /></label>
                <label>Roof Type
                  <select value={spec.shell.roofType || 'gable'} onChange={(event) => updateShell('roofType', event.target.value)}>
                    <option value="gable">gable</option>
                    <option value="shed">shed / lean-to</option>
                  </select>
                </label>
                <label>S Wall H<input type="number" value={spec.shell.southWallHeightFt || spec.shell.wallHeightFt} onChange={(event) => updateShell('southWallHeightFt', event.target.value)} /></label>
                <label>N Wall H<input type="number" value={spec.shell.northWallHeightFt || spec.shell.wallHeightFt} onChange={(event) => updateShell('northWallHeightFt', event.target.value)} /></label>
                <label>Outdoor Grid<input type="number" value={spec.shell.padExtensionFt ?? DEFAULT_SITE_PAD_EXTENSION_FT} onChange={(event) => updateShell('padExtensionFt', event.target.value)} /></label>
              </div>
              <div className="assembly">
                <em>Current House Assemblies</em>
                <span>Modeled Wall Type</span><b>{modeledWallProfile.label} · {modeledWallProfile.thicknessFt}'</b>
                <span>Modeled Roof</span><b>{modeledRoofProfile.roofType} · S {modeledRoofProfile.southWallHeightFt}' / N {modeledRoofProfile.northWallHeightFt}' · pitch {modeledRoofProfile.pitch.toFixed(3)}</b>
                <span>Structure</span><b>{spec.systems.structure}</b>
                <span>Envelope</span><b>{spec.systems.envelope}</b>
                <span>Water</span><b>{spec.systems.water}</b>
                <span>Energy</span><b>{spec.systems.energy}</b>
              </div>
              <div className="scheduleElements">
                <div className="libraryMode">
                  <button className={libraryActionMode === 'apply' ? 'active' : ''} onClick={() => setLibraryActionMode('apply')}>Apply to House</button>
                  <button className={libraryActionMode === 'place' ? 'active' : ''} onClick={() => setLibraryActionMode('place')}>Place Object</button>
                </div>
                <div className="elementLibrary">
                  {elementLibrary.map((group) => (
                    <details key={group.category}>
                      <summary>{group.category}</summary>
                      <div className="elementGrid">
                        {group.items.map((item) => (
                          <div
                            key={`${group.category}-${item.name}`}
                            className="elementCard"
                            role="button"
                            tabIndex={0}
                            onClick={() => useLibraryElement(item, group.category)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                useLibraryElement(item, group.category);
                              }
                            }}
                          >
                            <b>{item.name}</b>
                            <span>{item.note}</span>
                            <div className="elementActions">
                              <button className="ghost" onClick={(event) => { event.stopPropagation(); useLibraryElement(item, group.category, 'apply'); }}>Apply to House</button>
                              <button className="ghost" onClick={(event) => { event.stopPropagation(); useLibraryElement(item, group.category, 'place'); }}>Place Object</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
              </div>
            )}

            {inspectorView === 'outputs' && (
              <div className="outputsPane fullPane">
                <div className="outputCards">
                  <button onClick={exportSheetSet}><FileText size={18} /><span><b>Permit Set</b><small>G/A/S/M drawing package</small></span></button>
                  <button className="ghost" onClick={exportBrief}><Download size={18} /><span><b>Brief</b><small>Coordination summary</small></span></button>
                  <button className="ghost" onClick={exportJson}><FileJson size={18} /><span><b>BIM JSON</b><small>Structured model data</small></span></button>
                </div>
                <div className="assembly outputNotes">
                  <em>Export Status</em>
                  <span>Revision</span><b>{spec.revision}</b>
                  <span>Selected</span><b>{selected?.name}</b>
                  <span>Readiness</span><b>{qualityScore}/100</b>
                  <span>Open Flags</span><b>{issues.filter((issue) => issue.severity !== 'pass').length}</b>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      {welcomeOpen && (
        <div className="welcomeOverlay">
          <div className="welcomeCard">
            <div className="welcomeMark" aria-hidden="true"><span className="brandGable" /></div>
            <h2>{welcomeIsFirstRun ? 'Welcome — let\'s design a natural home' : 'Start a new design'}</h2>
            <p className="welcomeIntro">Design system by system — walls, roof, water, power — with live cost and code checks, and a real BIM model at the end.</p>
            <label className="welcomeName">
              <span>Name your design</span>
              <input
                type="text"
                placeholder="e.g. Cedar Hollow Homestead"
                value={welcomeName}
                onChange={(event) => setWelcomeName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="welcomeChoices">
              <button className="welcomeChoice" onClick={() => startNewDesign('blank')}>
                <b>Start on empty land</b>
                <small>Just the shell on the site. Add rooms yourself, or tell the assistant what you need.</small>
              </button>
              <button className="welcomeChoice" onClick={() => startNewDesign('sample')}>
                <b>Start from the sample homestead</b>
                <small>A small working house — rooms, systems, and checks already alive. Change everything.</small>
              </button>
            </div>
            {!welcomeIsFirstRun && (
              <div className="welcomeFoot">
                <span>This replaces the design that's open now.</span>
                <button className="welcomeCancel" onClick={() => { setWelcomeName(''); setWelcomeOpen(false); }}>Keep working instead</button>
              </div>
            )}
          </div>
        </div>
      )}

      <aside className="rightPanel">
        <section className="panelBlock consolePanel chatPanel">
          <div className="blockTitle"><Send size={16} /> Studio</div>
          <p className="studioHint">Type a design edit, attach a sketch, or consult the team.</p>
          <div className="chatTargets compactTargets">
            <button className={chatTarget === 'design' ? 'chatTarget active' : 'chatTarget'} onClick={() => chooseChatTarget('design')}>
              <Hammer size={15} />
              <span>Design</span>
            </button>
            <button className={chatTarget === 'team' ? 'chatTarget active' : 'chatTarget'} onClick={() => chooseChatTarget('team')}>
              <Users size={15} />
              <span>Team</span>
            </button>
          </div>
          {chatTarget === 'design' && (
            <label className="addToSelector">
              <span>Add to:</span>
              <select value={addToTarget} onChange={(event) => setAddToTarget(event.target.value)}>
                {addToTargets.map((target) => (
                  <option key={target.value} value={target.value}>
                    {target.value === 'selected' && selected?.name ? `Selected: ${selected.name}` : target.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="chatStream" ref={chatStreamRef}>
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chatBubble ${message.role}`}>
                {message.image && <img src={message.image} alt="Attached design reference" />}
                {message.speaker && <b>{message.speaker}</b>}
                <span>{message.text}</span>
              </div>
            ))}
          </div>
          <textarea
            value={chatTarget === 'design' ? prompt : expertQuestion}
            onChange={(event) => chatTarget === 'design' ? setPrompt(event.target.value) : setExpertQuestion(event.target.value)}
            onPaste={handleChatPaste}
            placeholder={chatTarget === 'design' ? 'Ask for edits: move primary bedroom to NE corner, make kitchen 14 x 12, add pantry 8 x 10...' : 'Ask the team about structure, materials, layout, code, water, farm workflow, cost, or sequencing...'}
          />
          <div className="buttonRow">
            <button onClick={submitChat} disabled={isPlanning}>{chatTarget === 'design' ? <Play size={16} /> : <Send size={16} />} {isPlanning ? 'Planning...' : chatTarget === 'design' ? 'Apply Design' : 'Consult'}</button>
            <button className="secondary" onClick={loopRevisions}><RefreshCcw size={16} /> Council Loop</button>
          </div>
          <label
            className="uploadBox slimUpload"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleImage(event.dataTransfer.files?.[0]);
            }}
          >
            {imagePreview ? (
              <span className="uploadPreview">
                <img src={imagePreview} alt="Uploaded drawing reference" />
                <span>Add another image or document, or drop one here</span>
              </span>
            ) : (
              <>
                <Upload size={20} />
                <span>Add photo, drawing, PDF, or text</span>
              </>
            )}
            <input type="file" accept="image/*,application/pdf,.pdf,.txt,.md,.csv" onChange={handleImageInput} />
          </label>
          {attachedImages.length > 0 && (
            <div className="attachmentTray" aria-label="Chat image attachments">
              {attachedImages.map((image) => (
                <div className="attachmentChip" key={image.id}>
                  {image.kind === 'pdf' || image.kind === 'text' ? (
                    <span className="docChipIcon"><FileText size={15} /></span>
                  ) : (
                    <img src={image.src} alt={image.name} />
                  )}
                  <span>{image.name}</span>
                  <button className="ghost iconButton" onClick={() => removeAttachedImage(image.id)} aria-label={`Remove ${image.name}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
