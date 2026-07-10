import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { pushToBlender, exportIfcViaBlender } from './blenderBridge.js';
import { createFrameDrawingSetHtml } from './frameDrawings.js';
import {
  OPENING_TYPES, FRAME_TYPES, resolveFrameType, FLOORING_TYPES, resolveFlooring, SUBFLOOR_TYPES, resolveSubfloor, INSULATION_TYPES, resolveInsulation,
  footprintPolygon, footprintEdges, hasCustomFootprint, polygonArea, polygonPerimeter, expandFootprint,
  decomposeFootprint, subtractRect, subtractRectFromFootprint, rectInFootprint, pointInFootprint, edgeForOpening,
  gradeElevationAt, maxFoundationExposureFt, basementInfo, BASEMENT_LEVEL, PARTITION_TYPES
} from '../backend/bim-core.mjs';
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
  // Upper storeys carry their OWN height (shell.upperStoreyHeightFt) — a 10'
  // ground floor under an 8' second storey is normal construction. Absent =
  // same as the ground (legacy designs unchanged).
  const upperFt = Math.min(14, Math.max(6, Number(shell.upperStoreyHeightFt || baseWallFt)));
  return { storeys, baseWallFt, upperFt, extraFt: (storeys - 1) * upperFt };
}

// The extent of an upper storey: a 'floor' plate element at that level defines
// how much of the footprint the storey covers (a second storey over only one
// side of the building). No plate = the full footprint (legacy designs).
function upperPlateRect(spec, level = 2) {
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
function floorCount(spec) {
  const byStoreys = Math.ceil(Number(spec.shell?.storeys || 1));
  const byRooms = Math.max(1, ...(spec.rooms || []).map((r) => Number(r.level || 1)));
  return Math.max(1, byStoreys, byRooms);
}

function floorLabel(spec, floor) {
  if (floor === BASEMENT_LEVEL) return 'Basement';
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

// Outbuildings — sizable, constructable structures placed on the site (distinct
// from the fixed Outdoors homestead items). Each drops a real element you resize
// in the plan/model and cost by its construction.
// Foundation RUNS: strips of foundation placed under a SPECIFIC line — a
// load-bearing interior wall (the classic: the wall between the house and an
// attached greenhouse), a mass heater, a future addition. Placed like
// fixtures (elements, category 'foundation'), dragged into position on the
// plan, costed by the foot. Independent of the perimeter foundation type.
const FOUNDATION_RUN_TYPES = {
  rubble: { label: 'Rubble trench', costLf: 22, stemCostLfFt: 0, carbonLf: 6, note: 'Drained gravel trench — carries a wall with almost no concrete.' },
  'rubble-stem': { label: 'Rubble trench + stem wall', costLf: 26, stemCostLfFt: 18, carbonLf: 10, note: 'The full natural detail: drained trench below, masonry stem above splash height. What a bale or cob wall wants.' },
  stemwall: { label: 'Stem wall on footing', costLf: 20, stemCostLfFt: 18, carbonLf: 18, note: 'Concrete footing and stem — conventional and strong.' },
  thickened: { label: 'Thickened slab edge / grade beam', costLf: 24, stemCostLfFt: 0, carbonLf: 22, note: 'For slab foundations: a deepened, reinforced strip under the load.' }
};
const FOUNDATION_RUN_PRESETS = [
  { name: 'Rubble trench run', construction: 'rubble', w: 12, d: 1.5, h: 0.3 },
  { name: 'Trench + stem run', construction: 'rubble-stem', w: 12, d: 1.5, h: 1.5 },
  { name: 'Stem wall run', construction: 'stemwall', w: 12, d: 1.5, h: 1.5 },
  { name: 'Grade beam run', construction: 'thickened', w: 12, d: 1.5, h: 0.2 }
];

const OUTBUILDING_CONSTRUCTION = {
  shed: { label: 'Simple shed frame', costPsf: 45 },
  pole: { label: 'Pole barn', costPsf: 40 },
  stick: { label: 'Stick frame', costPsf: 90 },
  timber: { label: 'Timber frame', costPsf: 130 },
  strawbale: { label: 'Straw bale', costPsf: 110 },
  cordwood: { label: 'Cordwood', costPsf: 95 }
};
const OUTBUILDING_PRESETS = [
  { name: 'Shed', w: 10, d: 8, h: 8, construction: 'shed' },
  { name: 'Workshop', w: 16, d: 12, h: 9, construction: 'stick' },
  { name: 'Studio', w: 14, d: 12, h: 9, construction: 'timber' },
  { name: 'Barn', w: 24, d: 18, h: 14, construction: 'pole' },
  { name: 'Garage', w: 20, d: 12, h: 9, construction: 'stick' },
  { name: 'Guest cabin', w: 14, d: 12, h: 10, construction: 'timber' },
  { name: 'Greenhouse', w: 12, d: 8, h: 8, construction: 'shed' },
  { name: 'Sauna', w: 8, d: 8, h: 8, construction: 'timber' }
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
function findFreeSpot(shellW, shellD, rooms, w, d, footprint = null) {
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
function derivePartitionOps(spec, level = 1) {
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
  explode: false,
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

// Mirror of bim-core SITE_DEFAULTS — keep in sync (topography fields included).
const SITE_DEFAULTS = { zip: '', placeName: '', latitudeDeg: 43, rainInYr: 38, slopeFt: 0, slopeDir: 'south', gradeFt: 1.5, contourInterval: 2 };

function siteOf(spec) {
  return { ...SITE_DEFAULTS, ...(spec.site || {}) };
}

function utilitiesOf(spec) {
  return { ...UTILITY_DEFAULTS, ...(spec.utilities || {}) };
}

function frameOf(spec) {
  return { type: 'load-bearing', storeyTypes: {}, ...(spec.frame || {}) };
}

// Which material systems are marked reclaimed / salvaged. Reclaimed materials
// cut cost and (especially) embodied carbon — reused stock carries no new
// manufacturing burden.
function reclaimedOf(spec) {
  return { frame: false, walls: false, flooring: false, windows: false, roof: false, ...(spec.reclaimed || {}) };
}
const RECLAIMED_FACTORS = {
  frame: { cost: 0.4, carbon: 0.15 },
  walls: { cost: 0.65, carbon: 0.3 },
  flooring: { cost: 0.45, carbon: 0.25 },
  windows: { cost: 0.4, carbon: 0.35 },
  roof: { cost: 0.6, carbon: 0.3 }
};

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
  'framed':           { key: 'framed',           label: 'Framed (vapor-open)', thicknessFt: 0.55, color: 0xd9d5c8, rValue: 23, finish: 'plaster / cladding' },
  // A GLASS WALL — the whole face is glazing in a timber frame (an attached
  // greenhouse's south face), not windows punched into an opaque wall. The
  // engine treats its face area as glass: solar gain, glazing heat loss,
  // glazing-rate cost.
  'glazed':           { key: 'glazed',           label: 'Glazed (glass wall)', thicknessFt: 0.35, color: 0xaecfd8, rValue: 2,  finish: 'timber-framed glazing' }
};

function wallAssemblyKeyFromText(text) {
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

function resolveWallSide(spec, side, level = 1) {
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
    exteriorFinish: u.exteriorFinish || ground.exteriorFinish
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
  // Council opinions are OPT-IN (the Council Loop button / Review tab) — they
  // don't ride along on every ordinary edit reply.
  return `${opening}${assumptions}`;
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

function structuredPlanSummary(report) {
  const opening = report.actions.length
    ? `${report.summary}\n\nWhat changed:\n${report.actions.slice(0, 10).map((action) => `- ${action}`).join('\n')}`
    : `${report.summary}\n\nNothing was changed in the model.`;
  const warnings = report.warnings.length ? `\n\nWatch out: ${report.warnings.join(' ')}` : '';
  const assumptions = report.assumptions.length ? `\n\nI assumed: ${report.assumptions.join(' ')}` : '';
  const questions = report.questions.length ? `\n\nTo do this better, tell me:\n${report.questions.map((item) => `- ${item}`).join('\n')}` : '';
  // Council opinions are OPT-IN (Council Loop button / Review tab), not a
  // sermon appended to every reply.
  return `${opening}${warnings}${assumptions}${questions}`;
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
// "This design, built the other way": swap the CONSTRUCTION systems between
// natural and standard while leaving the geometry AND the site services
// (water/waste/power — those are site decisions, not construction ones)
// untouched. Feed the result to deriveDesign for an honest apples-to-apples
// cost / carbon / heat comparison of the same house.
function convertSpecApproach(spec, target) {
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

function deriveDesign(spec, wallSections) {
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
  const wallCostPsf = { 'straw-bale': 12, 'hemp-lime': 20, cob: 20, 'rammed-earth': 22, cordwood: 16, 'light-straw-clay': 15, framed: 18, glazed: utilities.windowQuality === 'triple' ? 70 : 45 };
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
  const wallsCost = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCostPsf[wall.assemblyKey] ?? 16), 0) + partitionCost;
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
  const wallCarbonPsf = { 'straw-bale': 6, 'rammed-earth': 20, cob: 8, 'hemp-lime': 4, cordwood: 8, 'light-straw-clay': 7, framed: 8, glazed: 15 };
  const wallCarbonRaw = wallSections.reduce((sum, wall) => sum + wallFaceArea(wall) * (wallCarbonPsf[wall.assemblyKey] ?? 8), 0) + partitionCarbon;
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

const fmtMoney = (value) => `$${Math.round(value).toLocaleString()}`;
const fmtNum = (value) => Math.round(value).toLocaleString();

const SYSTEM_GROUPS = [
  { label: 'Land & program', keys: ['site', 'rooms'] },
  { label: 'The building', keys: ['shell', 'foundation', 'frame', 'flooring', 'walls', 'roof', 'windows'] },
  { label: 'Systems', keys: ['heat', 'water', 'waste', 'power', 'outdoors'] }
];

// The cost breakdown reads derived.cost — one row per system, each linked back
// to the page that drives it, so a big number is one tap from the controls.
const COST_ROWS = [
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

const SYSTEM_META = {
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
  tower: '#7a5f49', outbuilding: '#a08a5f', foundation: '#8f8b80', partition: '#6b6257',
  chimney: '#9a5944', deck: '#8e7049', custom: '#8b786d'
};

// Label ink by fill luminance — dark ink on light fills, paper ink on dark
// fills (slab plates, partitions, chimneys were unreadable with dark-on-dark).
function planLabelInk(hex) {
  const n = parseInt(String(hex || '#8a7768').slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? '#1a1f1d' : '#f4f1e6';
}

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
// Parametric 2D connection details — real cross-sections drawn from the live
// spec, so editing a thickness / stem height / overhang in the fields beside
// the drawing redraws the joint. Feet are the SVG unit.
const hexOf = (color) => `#${Number(color || 0x8a8a8a).toString(16).padStart(6, '0')}`;
function JointDetail({ spec, derived, kind, side = 'south', opening = null }) {
  const u = utilitiesOf(spec);
  const label = (x, y, text, anchor = 'start') => (
    <text x={x} y={y} fontSize={0.52} fill="var(--ink2)" textAnchor={anchor}>{text}</text>
  );
  const dim = (x1, y1, x2, y2, text) => (
    <g stroke="var(--ink3)" strokeWidth={0.04}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1} y1={y1 - 0.2} x2={x1} y2={y1 + 0.2} />
      <line x1={x2} y1={y2 - 0.2} x2={x2} y2={y2 + 0.2} />
      <text x={(x1 + x2) / 2} y={y1 - 0.25} fontSize={0.5} fill="var(--ink3)" textAnchor="middle" stroke="none">{text}</text>
    </g>
  );

  if (kind === 'wall') {
    const r = resolveWallSide(spec, side);
    const t = r.thicknessFt;
    // Draw what's actually designed: a stem wall's real height, a slab's edge,
    // or a rubble trench's low plinth. Straw bale must ride ≥12″ above grade —
    // if this wall doesn't, the drawing says so in red (and Review flags it).
    const stemH = u.foundationType === 'stemwall' ? Math.min(6, Math.max(0.5, Number(u.stemwallHeightFt) || 1.5)) : u.foundationType === 'slab' ? 0.5 : 0.3;
    const baleAtRisk = r.assemblyKey === 'straw-bale' && stemH < 1;
    const wallTop = 0, wallBot = 3.2, grade = wallBot + stemH;
    const finish = FLOORING_TYPES[resolveFlooring(spec)]?.label || 'finish floor';
    const insul = INSULATION_TYPES[resolveInsulation(u.floorInsulation, 'cellulose')]?.label || 'insulation';
    const deck = SUBFLOOR_TYPES[resolveSubfloor(spec)]?.label.split(' —')[0] || 'deck';
    return (
      <svg viewBox="-3.4 -0.9 13.4 8.6" className="jointSvg">
        {/* wall leaf + plasters */}
        <rect x={0} y={wallTop} width={t} height={wallBot} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
        <line x1={-0.12} y1={wallTop} x2={-0.12} y2={wallBot} stroke="var(--straw, #C9A24B)" strokeWidth={0.1} />
        <line x1={t + 0.12} y1={wallTop} x2={t + 0.12} y2={wallBot} stroke="var(--ink2)" strokeWidth={0.08} />
        {/* foundation / stem + footing */}
        <rect x={-0.35} y={wallBot} width={t + 0.7} height={stemH} fill="#9a958b" stroke="var(--ink3)" strokeWidth={0.05} />
        <rect x={-0.8} y={grade} width={t + 1.6} height={1.1} fill="none" stroke="var(--ink3)" strokeWidth={0.05} strokeDasharray="0.25 0.18" />
        {/* grade line + hatch */}
        <line x1={-3.2} y1={grade} x2={-0.35} y2={grade} stroke="var(--ink2)" strokeWidth={0.09} />
        {[-2.9, -2.3, -1.7, -1.1].map((gx) => <line key={gx} x1={gx} y1={grade} x2={gx - 0.4} y2={grade + 0.4} stroke="var(--ink3)" strokeWidth={0.05} />)}
        {/* interior floor assembly bands */}
        <rect x={t + 0.35} y={wallBot - 0.16} width={4.6} height={0.16} fill="var(--straw, #C9A24B)" />
        <rect x={t + 0.35} y={wallBot + 0.0} width={4.6} height={0.42} fill="var(--limesage, #7E8A6A)" opacity={0.8} />
        <rect x={t + 0.35} y={wallBot + 0.42} width={4.6} height={0.24} fill="#8a7458" />
        {label(t + 0.5, wallBot - 0.32, finish)}
        {label(t + 0.5, wallBot + 0.3, insul)}
        {label(t + 0.5, wallBot + 0.62, deck)}
        {label(-3.2, wallTop + 0.5, 'exterior')}
        {label(-0.4, wallBot - 0.4, `${r.assembly.label}`, 'end')}
        {label(t + 1.1, grade + 0.8, `${u.foundationType} foundation`)}
        {dim(0, -0.45, t, -0.45, `${t.toFixed(2)}′`)}
        {u.foundationType === 'stemwall' && dim(-1.6, wallBot, -1.6, grade, '')}
        {u.foundationType === 'stemwall' && label(-3.2, wallBot + stemH / 2 + 0.2, `${Math.round(stemH * 12)}″ stem wall`)}
        {baleAtRisk && (
          <g>
            {/* the stem wall this bale wall REQUIRES but doesn't have */}
            <rect x={-0.35} y={wallBot - 1 + stemH} width={t + 0.7} height={1} fill="none" stroke="#AE452F" strokeWidth={0.09} strokeDasharray="0.3 0.2" />
            <text x={t + 0.6} y={wallBot - 1.5} fontSize={0.5} fill="#AE452F" fontWeight="700">⚠ bales need a ≥12″ stem wall</text>
            <text x={t + 0.6} y={wallBot - 0.85} fontSize={0.42} fill="#AE452F">splash + damp rot the bottom course — see Review</text>
          </g>
        )}
      </svg>
    );
  }

  if (kind === 'roof') {
    const o = resolveOverhangs(spec.shell).south;
    const pitch = Number(spec.shell.roofPitch || 0.32);
    const t = resolveWallSide(spec, 'south').thicknessFt;
    const insul = INSULATION_TYPES[resolveInsulation(u.roofInsulation, 'cellulose')]?.label || 'insulation';
    const eaveY = 2.4, run = 5;
    const rise = run * pitch;
    return (
      <svg viewBox={`${-o - 1.6} -2.4 ${o + run + 3.4} 7.6`} className="jointSvg">
        {/* wall top + plate */}
        <rect x={0} y={eaveY} width={t} height={2.6} fill={hexOf(resolveWallSide(spec, 'south').assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
        <rect x={-0.05} y={eaveY - 0.22} width={t + 0.1} height={0.22} fill="#8a7458" />
        {/* rafter from overhang tip up the slope */}
        <line x1={-o} y1={eaveY} x2={run} y2={eaveY - rise} stroke="#8a7458" strokeWidth={0.28} />
        <line x1={-o} y1={eaveY - 0.5} x2={run} y2={eaveY - rise - 0.5} stroke="var(--ink2)" strokeWidth={0.12} />
        {/* insulation band between rafter and covering */}
        <line x1={0.4} y1={eaveY - 0.38} x2={run} y2={eaveY - rise - 0.28} stroke="var(--limesage, #7E8A6A)" strokeWidth={0.3} opacity={0.85} />
        {label(-o, eaveY + 0.6, `${o.toFixed(1)}′ overhang`)}
        {label(run - 3.4, eaveY - rise - 0.85, 'roof covering')}
        {label(1.2, eaveY - 0.85, insul)}
        {label(0.1, eaveY + 1.6, resolveWallSide(spec, 'south').assembly.label)}
        {label(-o - 1.4, eaveY - 0.3, 'eave')}
        {dim(-o, eaveY + 1.1, 0, eaveY + 1.1, `${o.toFixed(1)}′`)}
        {label(run - 3.4, eaveY - rise + 0.6, `pitch ≈ ${Math.round(pitch * 12)}:12 · sun ${Math.round(derived.sunWinterDeg)}°–${Math.round(derived.sunSummerDeg)}°`)}
      </svg>
    );
  }

  // opening: vertical section through a window/door in its wall
  const profile = OPENING_TYPES[opening?.type] || OPENING_TYPES.window;
  const r = resolveWallSide(spec, opening?.wall && opening.wall !== 'roof' ? opening.wall : 'south');
  const t = r.thicknessFt;
  const sill = profile.sill, head = profile.sill + profile.h;
  const top = 0.4;
  const scaleY = 5.6 / Math.max(head + 1.5, 8);
  const y = (ft) => top + (Math.max(head + 1.5, 8) - ft) * scaleY;
  return (
    <svg viewBox={`-2.6 0 ${t + 8} 7.2`} className="jointSvg">
      {/* wall above header and below sill */}
      <rect x={0} y={y(head + 1.2)} width={t} height={y(head) - y(head + 1.2)} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
      <rect x={0} y={y(sill)} width={t} height={y(0) - y(sill)} fill={hexOf(r.assembly.color)} stroke="var(--ink3)" strokeWidth={0.05} />
      {/* header + buck + sill */}
      <rect x={-0.1} y={y(head) - 0.3} width={t + 0.2} height={0.3} fill="#8a7458" />
      <line x1={t * 0.35} y1={y(head)} x2={t * 0.35} y2={y(sill)} stroke="var(--ink2)" strokeWidth={0.1} />
      <line x1={t * 0.45} y1={y(head)} x2={t * 0.45} y2={y(sill)} stroke="var(--ink2)" strokeWidth={0.1} />
      <polygon points={`${-0.4},${y(sill) + 0.28} ${t * 0.6},${y(sill)} ${t * 0.6},${y(sill) + 0.22} ${-0.4},${y(sill) + 0.5}`} fill="#8a7458" />
      {label(t + 0.5, y(head) - 0.4, `header over ${opening?.widthFt || profile.defaultW}′ ${profile.label.toLowerCase()}`)}
      {label(t + 0.5, (y(head) + y(sill)) / 2, profile.glazed ? `glazing (${u.windowQuality} pane)` : 'leaf')}
      {label(t + 0.5, y(sill) + 0.55, `sloped sill · ${Math.round(sill * 12)}″ above floor`)}
      {label(t + 0.5, y(0) - 0.2, r.assembly.label)}
    </svg>
  );
}

const PLAN_CONTEXT_LABEL = {
  foundation: 'Foundation plan — drag the footprint corner to resize',
  shell: 'Footprint plan — drag the corner to resize',
  frame: 'Frame plan — the footprint the frame carries',
  flooring: 'Floor plan — the footprint the floor covers',
  walls: 'Wall plan — tap a wall in the model to edit it',
  roof: 'Roof plan — footprint the roof covers',
  site: 'Site plan — place and drag outbuildings',
  outdoors: 'Site plan — place and drag outbuildings',
  rooms: 'Room plan — drag to move, corners to resize',
  windows: 'Openings plan — white gaps mark windows & doors'
};
function PlanView({ spec, selectedRoom, onSelect, onMove, onResize, onResizeShell, onMoveEdge, onMoveOpening, context = null, activeFloor = 1 }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [shellGhost, setShellGhost] = useState(null);
  const [edgeDrag, setEdgeDrag] = useState(null);
  const [openingDrag, setOpeningDrag] = useState(null);
  const W = Number(spec.shell.widthFt) || 36;
  const D = Number(spec.shell.depthFt) || 28;
  const pad = Math.max(6, Math.round(Math.max(W, D) * 0.14));
  const snap = (v) => Math.round(v * 2) / 2;
  const buildingContext = ['foundation', 'shell', 'frame', 'flooring', 'roof'].includes(context);
  const siteContext = context === 'site' || context === 'outdoors';
  const fpCustom = hasCustomFootprint(spec);
  const fpPoly = footprintPolygon(spec);
  const fpEdgesList = footprintEdges(spec);
  // In a building context the footprint is the subject; dim the room fill so it
  // recedes. In a site context the outbuildings are the subject; dim the house.
  const roomsDim = buildingContext ? 0.18 : siteContext ? 0.28 : 1;

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

  // Drag a wall EDGE perpendicular to itself — "move a wall" / make an L.
  function startEdgeDrag(event, edge) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    setEdgeDrag({ index: edge.index, edge, startFx: fx, startFy: fy, offset: 0 });
    onSelect?.(`wall-${edge.key}`);
  }
  function onEdgeMove(event) {
    if (!edgeDrag) return;
    const { fx, fy } = clientToFeet(event);
    // outward component of the pointer delta along the edge normal
    const raw = (fx - edgeDrag.startFx) * edgeDrag.edge.nx + (fy - edgeDrag.startFy) * edgeDrag.edge.ny;
    setEdgeDrag((current) => current && { ...current, offset: clamp(snap(raw), -48, 48) });
  }
  function endEdgeDrag() {
    if (!edgeDrag) return;
    if (Math.abs(edgeDrag.offset) >= 0.5 && onMoveEdge) onMoveEdge(edgeDrag.index, edgeDrag.offset);
    setEdgeDrag(null);
  }

  // Drag an opening ALONG its wall — windows and doors find their real spot
  // on the plan, the natural home for that decision.
  function startOpeningDrag(event, index, opening) {
    if (!onMoveOpening) return;
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const { fx, fy } = clientToFeet(event);
    const horizontal = opening.wall === 'north' || opening.wall === 'south';
    const along0 = Number(horizontal ? opening.x : opening.y) || 0;
    setOpeningDrag({ index, horizontal, start: horizontal ? fx : fy, along0, along: along0, width: Number(opening.widthFt) || 3 });
    onSelect?.(`opening-${index}`);
  }
  function onOpeningMove(event) {
    if (!openingDrag) return;
    const { fx, fy } = clientToFeet(event);
    const cur = openingDrag.horizontal ? fx : fy;
    const maxAlong = Math.max(0, (openingDrag.horizontal ? W : D) - openingDrag.width);
    setOpeningDrag((current) => current && { ...current, along: clamp(snap(current.along0 + (cur - current.start)), 0, maxAlong) });
  }
  function endOpeningDrag() {
    if (!openingDrag) return;
    if (Math.abs(openingDrag.along - openingDrag.along0) >= 0.25) onMoveOpening(openingDrag.index, openingDrag.along);
    setOpeningDrag(null);
  }

  function startShellDrag(event) {
    event.stopPropagation();
    event.preventDefault();
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    setShellGhost({ ghostW: W, ghostD: D });
  }
  function onShellMove(event) {
    if (!shellGhost) return;
    const { fx, fy } = clientToFeet(event);
    setShellGhost((current) => current && { ...current, ghostW: clamp(snap(fx), 12, 96), ghostD: clamp(snap(fy), 12, 80) });
  }
  function endShellDrag() {
    if (!shellGhost) return;
    const w = shellGhost.ghostW ?? W;
    const d = shellGhost.ghostD ?? D;
    if ((w !== W || d !== D) && onResizeShell) onResizeShell(w, d);
    setShellGhost(null);
  }
  const shellW = shellGhost?.ghostW ?? W;
  const shellD = shellGhost?.ghostD ?? D;

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
        onPointerMove={(event) => { onPointerMove(event); onShellMove(event); onEdgeMove(event); onOpeningMove(event); }}
        onPointerUp={(event) => { endDrag(); endShellDrag(event); endEdgeDrag(); endOpeningDrag(); }}
        onPointerLeave={(event) => { endDrag(); endShellDrag(event); endEdgeDrag(); endOpeningDrag(); }}
        onClick={() => {}}
      >
        {/* site around the house */}
        <rect x={-pad} y={-pad} width={W + pad * 2} height={D + pad * 2} fill="var(--canvas)" />
        {gridLines}
        {/* shell / exterior wall — the footprint (editable in a building context) */}
        {fpCustom ? (
          <>
            <polygon points={fpPoly.map(([px, py]) => `${px},${py}`).join(' ')} fill={buildingContext ? 'var(--active-line)' : 'none'} fillOpacity={buildingContext ? 0.08 : 0} stroke={buildingContext ? 'var(--active-line)' : 'var(--ink3)'} strokeWidth={buildingContext ? 0.5 : 1} />
            {shellGhost && <rect x={0} y={0} width={shellW} height={shellD} fill="none" stroke="var(--active-line)" strokeWidth={0.2} strokeDasharray="1 0.6" pointerEvents="none" />}
          </>
        ) : (
          <>
            <rect x={0} y={0} width={shellW} height={shellD} fill={buildingContext ? 'var(--active-line)' : 'none'} fillOpacity={buildingContext ? 0.08 : 0} stroke={buildingContext ? 'var(--active-line)' : 'var(--ink3)'} strokeWidth={buildingContext ? 0.5 : 1} />
            <rect x={0.7} y={0.7} width={Math.max(0, shellW - 1.4)} height={Math.max(0, shellD - 1.4)} fill="none" stroke="var(--line2)" strokeWidth={0.12} />
          </>
        )}
        {buildingContext && onResizeShell && (
          <>
            <circle cx={shellW} cy={shellD} r={1.1} fill="var(--active-line)" stroke="#fff" strokeWidth={0.18} style={{ cursor: 'se-resize' }} onPointerDown={startShellDrag} />
            {shellGhost && <text x={shellW / 2} y={shellD / 2} textAnchor="middle" fontSize={2.4} fill="var(--active-line)" fontWeight="700" pointerEvents="none">{shellW}′ × {shellD}′</text>}
          </>
        )}
        {/* wall edges: grab-and-slide in a building context ("move a wall") */}
        {buildingContext && onMoveEdge && fpEdgesList.map((edge) => {
          const active = edgeDrag && edgeDrag.index === edge.index;
          const gx = active ? edge.nx * edgeDrag.offset : 0;
          const gy = active ? edge.ny * edgeDrag.offset : 0;
          return (
            <g key={edge.key}>
              {active && (
                <>
                  <line x1={edge.x0 + gx} y1={edge.y0 + gy} x2={edge.x1 + gx} y2={edge.y1 + gy} stroke="var(--active-line)" strokeWidth={0.6} strokeDasharray="1 0.6" pointerEvents="none" />
                  <line x1={edge.x0} y1={edge.y0} x2={edge.x0 + gx} y2={edge.y0 + gy} stroke="var(--active-line)" strokeWidth={0.15} strokeDasharray="0.5 0.5" pointerEvents="none" />
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x1 + gx} y2={edge.y1 + gy} stroke="var(--active-line)" strokeWidth={0.15} strokeDasharray="0.5 0.5" pointerEvents="none" />
                  <text x={(edge.x0 + edge.x1) / 2 + gx + edge.nx * 2.2} y={(edge.y0 + edge.y1) / 2 + gy + edge.ny * 2.2} textAnchor="middle" fontSize={2.2} fill="var(--active-line)" fontWeight="700" pointerEvents="none">
                    {edgeDrag.offset > 0 ? '+' : ''}{edgeDrag.offset}′
                  </text>
                </>
              )}
              <line
                x1={edge.x0} y1={edge.y0} x2={edge.x1} y2={edge.y1}
                stroke="var(--active-line)" strokeWidth={1.6} strokeOpacity={active ? 0.35 : 0.001}
                style={{ cursor: edge.horizontal ? 'ns-resize' : 'ew-resize' }}
                onPointerDown={(event) => startEdgeDrag(event, edge)}
              />
            </g>
          );
        })}
        {/* the plan reflects the selection: a selected wall's edge glows */}
        {(() => {
          const em = /^wall-e(\d+)/.exec(String(selectedRoom || ''));
          if (em) {
            const edge = fpEdgesList[Number(em[1])];
            if (!edge) return null;
            return <line x1={edge.x0} y1={edge.y0} x2={edge.x1} y2={edge.y1} stroke="var(--active-line)" strokeWidth={0.7} opacity={0.9} pointerEvents="none" />;
          }
          const m = /^wall-(north|south|east|west)/.exec(String(selectedRoom || ''));
          if (!m) return null;
          const s = m[1];
          const pts = s === 'north' ? [0, 0, W, 0] : s === 'south' ? [0, D, W, D] : s === 'east' ? [W, 0, W, D] : [0, 0, 0, D];
          return <line x1={pts[0]} y1={pts[1]} x2={pts[2]} y2={pts[3]} stroke="var(--active-line)" strokeWidth={0.7} opacity={0.9} pointerEvents="none" />;
        })()}
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
                fillOpacity={(isSel ? 0.9 : 0.66) * roomsDim}
                stroke={isSel ? 'var(--active-line)' : 'var(--line)'}
                strokeWidth={isSel ? 0.4 : 0.18}
                pointerEvents={buildingContext || siteContext ? 'none' : undefined}
                onPointerDown={(event) => startDrag(event, raw, 'move')}
              />
              <text x={room.x + room.w / 2} y={room.y + room.d / 2 - 0.3} textAnchor="middle" fontSize={Math.min(2, room.w / 5)} fill={planLabelInk(PLAN_ZONE_HEX[raw.type] || '#79a7a8')} fontWeight="600" pointerEvents="none">{raw.name}</text>
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
        {(spec.elements || []).filter((el) => (el.category === 'floor'
          ? (activeFloor > 1 && Number(el.level || 1) === activeFloor)
          : (Number(el.level || 1) === activeFloor || (/stair|ladder/i.test(el.name || '')
            && Number(el.level || 1) === (activeFloor === 1 && basementInfo(spec.shell).present ? BASEMENT_LEVEL : activeFloor - 1))))).map((raw) => {
          const el = roomAt(raw);
          const isSel = raw.id === selectedRoom;
          const w = Number(el.w) || 4;
          const d = Number(el.d) || 4;
          return (
            <g key={raw.id} style={{ cursor: drag ? 'grabbing' : 'grab' }}>
              <rect
                x={el.x} y={el.y} width={w} height={d}
                fill={PLAN_ELEMENT_HEX[raw.category] || '#8a7768'}
                fillOpacity={raw.category === 'partition' ? (isSel ? 1 : 0.95) : (isSel ? 0.92 : 0.7) * (buildingContext && raw.category !== 'floor' ? 0.25 : 1)}
                stroke={isSel ? 'var(--active-line)' : '#5a5348'}
                strokeWidth={isSel ? 0.4 : 0.22}
                strokeDasharray={raw.category === 'partition' ? undefined : '0.8 0.5'}
                pointerEvents={buildingContext && raw.category !== 'floor' ? 'none' : undefined}
                onPointerDown={(event) => startDrag(event, raw, 'move')}
              />
              <text x={el.x + w / 2} y={el.y + d / 2 + 0.5} textAnchor="middle" fontSize={Math.min(1.5, Math.max(w, d) / 5)} fill={planLabelInk(PLAN_ELEMENT_HEX[raw.category] || '#8a7768')} fontWeight="600" pointerEvents="none">{raw.name}</text>
              {isSel && ['nw', 'ne', 'sw', 'se'].map((corner) => {
                const cx = el.x + (corner.includes('e') ? w : 0);
                const cy = el.y + (corner.includes('s') ? d : 0);
                return <circle key={corner} cx={cx} cy={cy} r={0.8} fill="var(--active-line)" stroke="#fff" strokeWidth={0.15} style={{ cursor: `${corner}-resize` }} onPointerDown={(event) => startDrag(event, raw, corner)} />;
              })}
            </g>
          );
        })}
        {/* openings as white gaps on the walls — DRAGGABLE along their wall
            (windows and doors find their spot on the plan). On a custom
            footprint each gap draws on the opening's actual polygon edge. */}
        {openings.map((o) => {
          const index = (spec.openings || []).indexOf(o);
          const wide = Number(o.widthFt) || 3;
          const horizontal = o.wall === 'north' || o.wall === 'south';
          const oEdge = fpCustom ? edgeForOpening(spec, o) : null;
          const lineC = horizontal
            ? (oEdge && oEdge.horizontal ? oEdge.y0 : (o.wall === 'north' ? 0 : D))
            : (oEdge && !oEdge.horizontal ? oEdge.x0 : (o.wall === 'east' ? W : 0));
          const dragging = openingDrag && openingDrag.index === index;
          const along = dragging ? openingDrag.along : (Number(horizontal ? o.x : o.y) || 0);
          const isSel = String(selectedRoom || '') === `opening-${index}`;
          const stroke = dragging || isSel ? 'var(--active-line)' : '#e8e6dd';
          const sw = dragging || isSel ? 1.5 : 1.1;
          const x1 = horizontal ? along : lineC;
          const y1 = horizontal ? lineC : along;
          const x2 = horizontal ? along + wide : lineC;
          const y2 = horizontal ? lineC : along + wide;
          const draggable = Boolean(onMoveOpening) && activeFloor === 1 && !buildingContext && !siteContext;
          return (
            <g key={index}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} />
              {dragging && (
                <text
                  x={horizontal ? along + wide / 2 : lineC + (o.wall === 'east' ? -2.6 : 2.6)}
                  y={horizontal ? lineC + (o.wall === 'north' ? 2.8 : -1.6) : along + wide / 2}
                  textAnchor="middle" fontSize={2.2} fill="var(--active-line)" fontWeight="700" pointerEvents="none"
                >{along}′</text>
              )}
              {draggable && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="var(--active-line)" strokeWidth={2.4} strokeOpacity={0.001}
                  style={{ cursor: horizontal ? 'ew-resize' : 'ns-resize' }}
                  onPointerDown={(event) => startOpeningDrag(event, index, o)}
                />
              )}
            </g>
          );
        })}
        {/* dimensions */}
        <text x={W / 2} y={-pad + 1.6} textAnchor="middle" fontSize={2} fill="var(--ink2)">{W}′</text>
        <text x={-pad + 1.6} y={D / 2} textAnchor="middle" fontSize={2} fill="var(--ink2)" transform={`rotate(-90 ${-pad + 1.6} ${D / 2})`}>{D}′</text>
      </svg>
      <div className="planNorth">▲ N</div>
      <div className="planHint">{buildingContext && onMoveEdge ? `${PLAN_CONTEXT_LABEL[context] || 'Footprint'} · drag a wall edge to move that wall · corner dot resizes the whole plan` : PLAN_CONTEXT_LABEL[context] || `${floorLabel(spec, activeFloor)} plan · drag to move, drag corners to resize (½ ft snap)`}{floorCount(spec) > 1 ? ' · switch floors top-left' : ''}</div>
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
    // Cool low fill from the opposite quarter so shaded faces keep their form
    // instead of going flat — the single biggest "clip-art" tell.
    const fill = new THREE.DirectionalLight(0xdfe8f2, 0.4);
    fill.position.set(-34, 22, -26);
    scene.add(fill);
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

    // Procedural material grain — the difference between clip-art and a
    // building. Each kind is drawn ONCE as a near-white canvas (cached), so
    // material.color tints it: one plaster texture serves straw bale, cob,
    // and hemp-lime alike, each in its own color.
    const grainCache = new Map();
    function grainTexture(kind) {
      if (grainCache.has(kind)) return grainCache.get(kind);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      const speckle = (count, alphaMax, sizeMax, dark = true) => {
        for (let i = 0; i < count; i += 1) {
          const a = Math.random() * alphaMax;
          g.fillStyle = dark && Math.random() < 0.72 ? `rgba(70,60,48,${a})` : `rgba(255,255,255,${a * 1.4})`;
          const s = 0.5 + Math.random() * sizeMax;
          g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
        }
      };
      if (kind === 'plaster') {
        speckle(2600, 0.05, 2.2);
        // faint horizontal trowel drift
        for (let y = 0; y < 256; y += 7 + Math.random() * 9) {
          g.fillStyle = `rgba(90,78,60,${0.015 + Math.random() * 0.025})`;
          g.fillRect(0, y, 256, 1.4);
        }
      } else if (kind === 'metal') {
        // standing-seam roofing: crisp vertical seams over a soft sheen
        speckle(600, 0.03, 1.5);
        for (let x = 0; x < 256; x += 21) {
          g.fillStyle = 'rgba(45,50,52,0.30)';
          g.fillRect(x, 0, 1.6, 256);
          g.fillStyle = 'rgba(255,255,255,0.20)';
          g.fillRect(x + 2, 0, 1, 256);
        }
      } else if (kind === 'concrete') {
        speckle(4200, 0.075, 1.6);
      } else if (kind === 'earth') {
        speckle(3000, 0.10, 2.8);
      } else if (kind === 'grass') {
        speckle(5200, 0.09, 1.8);
        for (let i = 0; i < 700; i += 1) {
          g.fillStyle = `rgba(96,116,60,${Math.random() * 0.12})`;
          g.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 3);
        }
      } else if (kind === 'wood') {
        for (let y = 0; y < 256; y += 3) {
          g.fillStyle = `rgba(96,66,38,${0.05 + Math.random() * 0.10})`;
          g.fillRect(0, y, 256, 1 + Math.random() * 2);
        }
        speckle(500, 0.05, 1.4);
      }
      const texture = new THREE.CanvasTexture(c);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
      grainCache.set(kind, texture);
      return texture;
    }

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
      const basementH = basementInfo(spec.shell).heightFt;
      const wallHeight = roofSpec.highWallHeightFt + storeyLift;
      const southWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.southWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const northWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.northWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const wallProfile = wallAssemblyProfile(spec.systems.envelope);
      const wallT = wallProfile.thicknessFt;

      const slabMat = new THREE.MeshStandardMaterial({ color: 0xc0b49b, roughness: 0.92, map: grainTexture('earth') });
      const wallMat = new THREE.MeshStandardMaterial({ color: wallProfile.color, roughness: 0.88, map: grainTexture('plaster') });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a938f, roughness: 0.5, metalness: 0.22, map: grainTexture('metal'), side: THREE.DoubleSide });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc3d8, transparent: true, opacity: 0.5, roughness: 0.06, metalness: 0.25 });
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.7, map: grainTexture('wood') });
      const doorMatWood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.72, map: grainTexture('wood') });
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
        outbuilding: 0xa08a5f,
        foundation: 0x8f8b80,
        partition: 0x6b6257,
        chimney: 0x9a5944,
        deck: 0x8e7049,
        custom: 0x8b786d
      };

      const slab = box(padRect.w, padRect.h, padRect.d, padRect.x + padRect.w / 2, -padRect.h / 2, padRect.y + padRect.d / 2, slabMat);
      slab.name = `Site pad (${padRect.w}' x ${padRect.d}')`;
      slab.userData.roomId = 'site-pad';
      slab.userData.footprint = { w: padRect.w, d: padRect.d };
      // On a sloped site the huge DEFAULT pad would hover over the falling
      // ground — the terrain is the ground there. A pad the user placed/sized
      // (shell.sitePad) still renders: that's a deliberate leveled terrace.
      const flatPadOk = !(Math.max(0, Number(siteOf(spec).slopeFt) || 0) > 0 && !spec.shell.sitePad);
      slab.visible = layers.pad && flatPadOk;
      if (layers.pad && flatPadOk) roomMeshes.push(slab);
      if (layers.pad && flatPadOk && selectedRoom === 'site-pad') {
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
      // Wall construction varies by storey: each side renders as a ground band
      // plus (when storeys > 1) an upper band with the UPPER storey's assembly
      // color/thickness and its own id (wall-side-u) so tapping it edits the
      // upper wall. Shed east/west walls are raked — they stay one mesh in the
      // ground assembly (their band split is geometric, noted honestly).
      const wallUpper = {
        north: resolveWallSide(spec, 'north', 2),
        south: resolveWallSide(spec, 'south', 2),
        east: resolveWallSide(spec, 'east', 2),
        west: resolveWallSide(spec, 'west', 2)
      };
      // X-ray AND exploded views both need see-through walls — exploded pulls
      // the shell apart, translucency lets the interior read through it.
      // A glazed assembly renders as glass — translucent, smooth, no plaster grain.
      const wallMatOf = (resolved) => resolved.assemblyKey === 'glazed'
        ? new THREE.MeshStandardMaterial({ color: 0xcfe5ea, roughness: 0.12, metalness: 0.05, transparent: true, opacity: layers.xray ? 0.22 : 0.38 })
        : new THREE.MeshStandardMaterial({ color: resolved.assembly.color, roughness: 0.88, map: grainTexture('plaster'), transparent: layers.xray || layers.explode, opacity: layers.xray ? 0.34 : layers.explode ? 0.55 : 1 });
      const wallMatFor = (side) => wallMatOf(wallResolved[side]);
      const tN = wallResolved.north.thicknessFt;
      const tS = wallResolved.south.thicknessFt;
      const tE = wallResolved.east.thicknessFt;
      const tW = wallResolved.west.thicknessFt;
      const hN = roofSpec.roofType === 'shed' ? northWallHeight : wallResolved.north.heightFt + storeyLift;
      const hS = roofSpec.roofType === 'shed' ? southWallHeight : wallResolved.south.heightFt + storeyLift;
      const hE = wallResolved.east.heightFt + storeyLift;
      const hW = wallResolved.west.heightFt + storeyLift;
      // Upper bands ring the storey's EXTENT plate — a second storey can sit
      // over only one side of the building. No plate = the full footprint.
      const plate2 = upperPlateRect(spec, 2) || { x: 0, y: 0, w: width, d: depth };
      const wallMeshSpecs = [];
      const customFp = hasCustomFootprint(spec);
      const fpPoly = customFp ? footprintPolygon(spec) : null;
      const fpEdges = customFp ? footprintEdges(spec) : null;
      const pushSideBoxes = (side, totalH, thickness, place) => {
        const groundH = Math.max(1, totalH - storeyLift);
        wallMeshSpecs.push({ side, storey: 'ground', mesh: place(thickness, groundH, 0) });
        if (storeyLift > 0) {
          const u = wallUpper[side];
          const tU = u.thicknessFt;
          const p = plate2;
          const upperMesh = side === 'north' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + tU / 2, wallMatOf(u))
            : side === 'south' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + p.d - tU / 2, wallMatOf(u))
            : side === 'west' ? box(tU, storeyLift, p.d, p.x + tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u))
            : box(tU, storeyLift, p.d, p.x + p.w - tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u));
          wallMeshSpecs.push({ side, storey: 'upper', mesh: upperMesh });
        }
      };
      if (customFp) {
        // Custom footprint: one wall per polygon edge, thickness inward.
        // Construction resolves by facing, so every north-facing segment wears
        // the 'north' wall system. Under a shed roof the eave line runs
        // north→south: horizontal segments seat at their own y, vertical
        // segments rake between their two end heights.
        const shed = roofSpec.roofType === 'shed';
        const eaveAt = (yy) => northWallHeight + (southWallHeight - northWallHeight) * clamp(depth > 0 ? yy / depth : 0, 0, 1);
        const hasPlate = Boolean(upperPlateRect(spec, 2));
        fpEdges.forEach((edge) => {
          const rG = wallResolved[edge.facing];
          if (rG.omitted || omittedWalls.has(edge.facing)) return;
          const t = rG.thicknessFt;
          const midX = (edge.x0 + edge.x1) / 2;
          const midY = (edge.y0 + edge.y1) / 2;
          const cx = midX - edge.nx * (t / 2);
          const cy = midY - edge.ny * (t / 2);
          const len = edge.lengthFt;
          const totalH = shed
            ? (edge.horizontal ? eaveAt(edge.y0) : Math.max(eaveAt(edge.y0), eaveAt(edge.y1)))
            : rG.heightFt + storeyLift;
          const groundH = Math.max(1, totalH - storeyLift);
          let mesh;
          if (shed && !edge.horizontal) {
            const z0 = Math.min(edge.y0, edge.y1);
            const z1 = Math.max(edge.y0, edge.y1);
            mesh = makeRakedWallSegment(cx - t / 2, cx + t / 2, z0, z1, Math.max(1, eaveAt(z0) - (hasPlate ? storeyLift : 0)), Math.max(1, eaveAt(z1) - (hasPlate ? storeyLift : 0)), wallMatOf(rG));
          } else {
            mesh = edge.horizontal
              ? box(len, groundH, t, cx, groundH / 2, cy, wallMatOf(rG))
              : box(t, groundH, len, cx, groundH / 2, cy, wallMatOf(rG));
          }
          wallMeshSpecs.push({ side: edge.facing, storey: 'ground', edgeKey: edge.key, mesh });
          // No extent plate: the upper band rides this same edge.
          if (storeyLift > 0 && !hasPlate) {
            const u = wallUpper[edge.facing];
            const tU = u.thicknessFt;
            const ux = midX - edge.nx * (tU / 2);
            const uy = midY - edge.ny * (tU / 2);
            const upperMesh = edge.horizontal
              ? box(len, storeyLift, tU, ux, groundH + storeyLift / 2, uy, wallMatOf(u))
              : box(tU, storeyLift, len, ux, groundH + storeyLift / 2, uy, wallMatOf(u));
            wallMeshSpecs.push({ side: edge.facing, storey: 'upper', edgeKey: edge.key, mesh: upperMesh });
          }
        });
        // With a plate, upper bands ring IT — same cardinal ids as a rectangle.
        if (storeyLift > 0 && hasPlate) {
          const p = plate2;
          WALL_SIDES.forEach((side) => {
            if (omittedWalls.has(side) || wallResolved[side].omitted) return;
            const u = wallUpper[side];
            const tU = u.thicknessFt;
            const groundH = Math.max(1, (shed ? Math.max(northWallHeight, southWallHeight) : wallResolved[side].heightFt + storeyLift) - storeyLift);
            const upperMesh = side === 'north' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + tU / 2, wallMatOf(u))
              : side === 'south' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + p.d - tU / 2, wallMatOf(u))
              : side === 'west' ? box(tU, storeyLift, p.d, p.x + tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u))
              : box(tU, storeyLift, p.d, p.x + p.w - tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u));
            wallMeshSpecs.push({ side, storey: 'upper', mesh: upperMesh });
          });
        }
      } else if (roofSpec.roofType === 'shed') {
        pushSideBoxes('north', hN, tN, (t, h, y0) => box(width, h, t, width / 2, y0 + h / 2, t / 2, wallMatFor('north')));
        pushSideBoxes('south', hS, tS, (t, h, y0) => box(width, h, t, width / 2, y0 + h / 2, depth - t / 2, wallMatFor('south')));
        wallMeshSpecs.push({ side: 'west', storey: 'ground', mesh: makeShedSideWall(0, tW, depth, northWallHeight, southWallHeight, wallMatFor('west')) });
        wallMeshSpecs.push({ side: 'east', storey: 'ground', mesh: makeShedSideWall(width - tE, tE, depth, northWallHeight, southWallHeight, wallMatFor('east')) });
      } else {
        pushSideBoxes('north', hN, tN, (t, h, y0) => box(width, h, t, width / 2, y0 + h / 2, t / 2, wallMatFor('north')));
        pushSideBoxes('south', hS, tS, (t, h, y0) => box(width, h, t, width / 2, y0 + h / 2, depth - t / 2, wallMatFor('south')));
        pushSideBoxes('west', hW, tW, (t, h, y0) => box(t, h, depth, t / 2, y0 + h / 2, depth / 2, wallMatFor('west')));
        pushSideBoxes('east', hE, tE, (t, h, y0) => box(t, h, depth, width - t / 2, y0 + h / 2, depth / 2, wallMatFor('east')));
      }
      wallMeshSpecs.forEach(({ side, storey, mesh, edgeKey }) => {
        if (omittedWalls.has(side) || wallResolved[side].omitted) return;
        if (!layers[`wall${titleCase(side)}`]) return;
        const resolved = storey === 'upper' ? wallUpper[side] : wallResolved[side];
        mesh.name = `${titleCase(side)} Wall${storey === 'upper' ? ' (upper)' : ''} - ${resolved.assembly.label}`;
        mesh.userData.roomId = edgeKey
          ? (storey === 'upper' ? `wall-${edgeKey}-u` : `wall-${edgeKey}`)
          : (storey === 'upper' ? `wall-${side}-u` : `wall-${side}`);
        mesh.userData.wallSide = side;
        roomMeshes.push(mesh);
        group.add(mesh);
      });

      // Sun glazing: a wall lower than the eave with sunGlazing on gets an
      // ANGLED glass plane from its top up to the eave, with timber battens
      // riding the same angle — the attached-greenhouse face: bale kneewall
      // below, tilted glazing above, all carried by the frame. The tilt leans
      // the top INTO the house so the footprint stays honest. Rect footprints
      // v1 (custom outlines: set the side low and ask — noted in TESTING.md).
      if (!customFp) {
        WALL_SIDES.forEach((side) => {
          const rSg = wallResolved[side];
          if (!rSg.sunGlazing || rSg.omitted || omittedWalls.has(side)) return;
          if (!layers[`wall${titleCase(side)}`]) return;
          const kneeH = rSg.heightFt;
          const eaveH = roofSpec.roofType === 'shed'
            ? (side === 'south' ? southWallHeight : side === 'north' ? northWallHeight : Math.max(northWallHeight, southWallHeight))
            : wallHeight;
          const gapH = eaveH - kneeH;
          if (gapH < 1.5) return;
          const tiltRad = clamp(Number(rSg.sunGlazingTiltDeg ?? 30), 0, 45) * Math.PI / 180;
          const slantLen = gapH / Math.cos(tiltRad);
          const inset = gapH * Math.tan(tiltRad);
          const runLen = (side === 'north' || side === 'south' ? width : depth) - 1;
          const bandGlassMat = new THREE.MeshStandardMaterial({ color: 0xcfe5ea, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.36, side: THREE.DoubleSide });
          const bandPart = (m) => { m.userData.roomId = `wall-${side}`; m.userData.wallSide = side; m.userData.generated = true; group.add(m); return m; };
          const midY = kneeH + gapH / 2;
          const place = (thick, isBatten, along = 0) => {
            let m;
            if (side === 'south') { m = box(isBatten ? 0.3 : runLen, slantLen, thick, width / 2 + along, midY, depth - inset / 2, isBatten ? frameMat : bandGlassMat); m.rotation.x = -tiltRad; }
            else if (side === 'north') { m = box(isBatten ? 0.3 : runLen, slantLen, thick, width / 2 + along, midY, inset / 2, isBatten ? frameMat : bandGlassMat); m.rotation.x = tiltRad; }
            else if (side === 'east') { m = box(thick, slantLen, isBatten ? 0.3 : runLen, width - inset / 2, midY, depth / 2 + along, isBatten ? frameMat : bandGlassMat); m.rotation.z = tiltRad; }
            else { m = box(thick, slantLen, isBatten ? 0.3 : runLen, inset / 2, midY, depth / 2 + along, isBatten ? frameMat : bandGlassMat); m.rotation.z = -tiltRad; }
            return bandPart(m);
          };
          const pane = place(0.14, false);
          roomMeshes.push(pane);
          const bays = Math.max(2, Math.round(runLen / 4));
          for (let b = 0; b <= bays; b += 1) {
            place(0.24, true, runLen * (b / bays) - runLen / 2);
          }
        });
      }

      // The structural FRAME is a real, selectable object: posts at bay
      // spacing along each wall (inside face) with a plate beam on top — tap
      // any member to work its numbers (system, bay spacing). Load-bearing
      // walls have no separate frame; custom outlines come later (v1 rect).
      const frameKey3d = resolveFrameType(spec, 1);
      if (!customFp && frameKey3d !== 'load-bearing') {
        const bay = clamp(Number(spec.frame?.baySpacingFt) || 8, 4, 16);
        const postT = frameKey3d === 'timber' || frameKey3d === 'post-beam' ? 0.66 : 0.4;
        const framePart = (m) => {
          m.userData.roomId = 'frame-main';
          m.userData.generated = true;
          roomMeshes.push(m);
          group.add(m);
          return m;
        };
        [
          { side: 'north', horiz: true, line: tN + postT / 2 + 0.08, h: hN },
          { side: 'south', horiz: true, line: depth - tS - postT / 2 - 0.08, h: hS },
          { side: 'west', horiz: false, line: tW + postT / 2 + 0.08, h: hW },
          { side: 'east', horiz: false, line: width - tE - postT / 2 - 0.08, h: hE }
        ].forEach(({ side, horiz, line, h }) => {
          if (omittedWalls.has(side) || wallResolved[side].omitted) return;
          const run = horiz ? width : depth;
          const bays = Math.max(1, Math.round(run / bay));
          for (let i = 0; i <= bays; i += 1) {
            const along = clamp((run * i) / bays, postT, run - postT);
            framePart(horiz
              ? box(postT, Math.max(1, h - 0.4), postT, along, Math.max(1, h - 0.4) / 2, line, frameMat)
              : box(postT, Math.max(1, h - 0.4), postT, line, Math.max(1, h - 0.4) / 2, along, frameMat));
          }
          framePart(horiz
            ? box(run - postT, 0.45, postT, width / 2, h - 0.2, line, frameMat)
            : box(postT, 0.45, run - postT, line, h - 0.2, depth / 2, frameMat));
        });
      }

      // (The old floating assembly-summary chip is gone — that information
      // lives in the selection chip and the Walls page; it was pure clutter.)

      // Stem wall foundation: a visible concrete plinth ring under the walls.
      if (utilitiesOf(spec).foundationType === 'stemwall') {
        const stemH = Math.min(6, Math.max(0.5, Number(utilitiesOf(spec).stemwallHeightFt) || 1.5));
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95, map: grainTexture('concrete') });
        const lip = 0.25;
        const ring = customFp
          // Custom footprint: the plinth follows every polygon edge.
          ? fpEdges.map((edge) => {
            const t = wallResolved[edge.facing].thicknessFt;
            const cx = (edge.x0 + edge.x1) / 2 - edge.nx * (t / 2);
            const cy = (edge.y0 + edge.y1) / 2 - edge.ny * (t / 2);
            return edge.horizontal
              ? box(edge.lengthFt + lip * 2, stemH, t + lip, cx, stemH / 2, cy, stemMat)
              : box(t + lip, stemH, edge.lengthFt + lip * 2, cx, stemH / 2, cy, stemMat);
          })
          : [
            box(width + lip * 2, stemH, tN + lip, width / 2, stemH / 2, tN / 2, stemMat),
            box(width + lip * 2, stemH, tS + lip, width / 2, stemH / 2, depth - tS / 2, stemMat),
            box(tW + lip, stemH, depth + lip * 2, tW / 2, stemH / 2, depth / 2, stemMat),
            box(tE + lip, stemH, depth + lip * 2, width - tE / 2, stemH / 2, depth / 2, stemMat)
          ];
        ring.forEach((segment) => { segment.name = 'Stem wall foundation'; group.add(segment); });
      }

      // Topography: when the site slopes, the foundation steps DOWN to meet
      // grade around the perimeter — taller (a walkout basement) on the
      // downhill side, the exact condition the elevations/sections show. Each
      // footprint edge gets a concrete face from the sill (y≈0) to the grade
      // line at its two ends, so the bottom follows the falling ground.
      const slopeNow = Math.max(0, Number(siteOf(spec).slopeFt) || 0);
      if (slopeNow > 0) {
        const foundMat = new THREE.MeshStandardMaterial({ color: 0x9c988c, roughness: 0.96, map: grainTexture('concrete'), side: THREE.DoubleSide });
        footprintEdges(spec).forEach((edge) => {
          const gA = gradeElevationAt(spec, edge.x0, edge.y0);
          const gB = gradeElevationAt(spec, edge.x1, edge.y1);
          if (gA > -0.12 && gB > -0.12) return; // flush with the floor — nothing to show
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            edge.x0, 0.05, edge.y0, edge.x1, 0.05, edge.y1, edge.x1, gB, edge.y1,
            edge.x0, 0.05, edge.y0, edge.x1, gB, edge.y1, edge.x0, gA, edge.y0
          ]), 3));
          geo.computeVertexNormals();
          const face = new THREE.Mesh(geo, foundMat);
          face.name = 'Foundation to grade';
          face.userData.generated = true;
          face.castShadow = true;
          face.receiveShadow = true;
          group.add(face);
        });
      }

      // Basement: a real below-grade storey. Concrete perimeter walls with a
      // small stem reveal above grade, and a slab at the bottom. On a sloped
      // site the terrain falls below 0 downhill, exposing the wall — that IS
      // the walkout. Bounding-rect walls (same honest simplification as the
      // Blender/permit exports on custom footprints).
      if (basementH > 0) {
        const bMat = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.95, map: grainTexture('concrete') });
        const bT = 0.8;
        const reveal = 0.55;
        const bWallH = basementH + reveal;
        [
          [width + bT * 2, bT, width / 2, -bT / 2],
          [width + bT * 2, bT, width / 2, depth + bT / 2],
          [bT, depth, -bT / 2, depth / 2],
          [bT, depth, width + bT / 2, depth / 2]
        ].forEach(([w, d, cx, cz], i) => {
          const wallB = box(w, bWallH, d, cx, -basementH + bWallH / 2, cz, bMat);
          wallB.name = `Basement wall ${['north', 'south', 'west', 'east'][i]}`;
          wallB.userData.generated = true;
          group.add(wallB);
        });
        const slabB = box(width, 0.4, depth, width / 2, -basementH - 0.2 + 0.2, depth / 2, bMat);
        slabB.name = 'Basement slab';
        slabB.userData.generated = true;
        group.add(slabB);
      }

      // Upper floor plate: only auto-drawn when the storey has no extent-plate
      // element (which renders — and drags — through the elements pass).
      if (storeys > 1 && layers.upperFloors && !upperPlateRect(spec, 2)) {
        const plateMat = new THREE.MeshStandardMaterial({ color: 0xb3a284, roughness: 0.85, transparent: true, opacity: 0.92 });
        // A stair below the plate punches a real stairwell void through it.
        const stairCuts = (spec.elements || []).filter((el) => /stair/i.test(el.name || '') && !/ladder/i.test(el.name || '') && Number(el.level || 1) === 1);
        let plateRects = [{ x: tW, y: tN, w: Math.max(1, width - tE - tW), d: Math.max(1, depth - tN - tS) }];
        stairCuts.forEach((cut) => {
          const cutRect = { x: cut.x - 0.2, y: cut.y - 0.2, w: cut.w + 0.4, d: cut.d + 0.4 };
          plateRects = plateRects.flatMap((r) => subtractRect(r, cutRect));
        });
        plateRects.forEach((r) => {
          const plate = box(r.w, 0.4, r.d, r.x + r.w / 2, baseStoreyFt + 0.2, r.y + r.d / 2, plateMat);
          plate.name = `Upper floor plate (level 2, ${storeys === 1.5 ? 'loft' : 'full storey'})`;
          group.add(plate);
        });
      }

      if (layers.rooms) spec.rooms.forEach((room) => {
        const roomLevel = Number(room.level || 1);
        const roomLift = roomLevel === BASEMENT_LEVEL
          ? -basementH + 0.12
          : (Math.max(1, roomLevel) - 1) * baseStoreyFt + (roomLevel > 1 ? 0.42 : 0);
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
        let elementHeight = element.h || 1.2;
        let elevation = Number(element.z || 0);
        let mesh;
        if (element.category === 'foundation') {
          // A foundation RUN under a specific wall line: gravel trench below
          // grade, and (per its construction) a concrete stem standing proud —
          // the greenhouse-divider detail. The stem (or the ground-level cap)
          // is the drag/select handle; the trench rides along on commit.
          const construction = FOUNDATION_RUN_TYPES[element.construction] ? element.construction : 'rubble';
          const stemH = Math.max(0.25, Number(element.h) || 0.3);
          const cx = element.x + element.w / 2;
          const cz = element.y + element.d / 2;
          const gravelMat = new THREE.MeshStandardMaterial({ color: 0x77725f, roughness: 1, map: grainTexture('concrete'), transparent: true, opacity: element.id === selectedRoom ? 0.95 : 0.75 });
          const stemMatRun = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95, map: grainTexture('concrete'), transparent: true, opacity: element.id === selectedRoom ? 0.98 : 0.9 });
          if (construction === 'rubble' || construction === 'rubble-stem') {
            const trench = box(element.w, 1.2, element.d, cx, -0.75, cz, gravelMat);
            trench.name = `${element.name} (rubble trench)`;
            trench.userData.roomId = element.id;
            roomMeshes.push(trench);
            group.add(trench);
          }
          if (construction === 'rubble-stem' || construction === 'stemwall') {
            mesh = box(element.w, stemH + 0.1, element.d, cx, (stemH + 0.1) / 2 - 0.05, cz, stemMatRun);
            elementHeight = stemH;
          } else if (construction === 'thickened') {
            mesh = box(element.w, 1.1, element.d, cx, -0.45, cz, stemMatRun);
            elementHeight = 0.2;
          } else {
            // rubble-only: a thin gravel cap at grade so it stays visible/clickable
            mesh = box(element.w, 0.22, element.d, cx, 0.02, cz, gravelMat);
            elementHeight = 0.22;
          }
          elevation = 0;
        } else if (element.category === 'partition') {
          // An interior partition wall: a real thin wall between rooms, with an
          // optional doorway (doorWFt/doorAtFt along the run). Segments and the
          // header all carry the element's roomId so selection and explode move
          // the wall as one; the raycast/drag handle is the full-run box.
          const pType = PARTITION_TYPES[element.construction] ? element.construction : 'framed';
          const pMat = new THREE.MeshStandardMaterial({ color: PARTITION_TYPES[pType].color, roughness: 0.9, map: grainTexture('plaster') });
          const alongX = element.w >= element.d;
          const runLen = alongX ? element.w : element.d;
          const thick = alongX ? element.d : element.w;
          const hWall = Math.max(2, Number(element.h) || 8);
          elementHeight = hWall;
          const segBox = (s0, s1, y0, y1) => {
            const len = s1 - s0;
            const m = alongX
              ? box(len, y1 - y0, thick, element.x + s0 + len / 2, elevation + (y0 + y1) / 2, element.y + thick / 2, pMat)
              : box(thick, y1 - y0, len, element.x + thick / 2, elevation + (y0 + y1) / 2, element.y + s0 + len / 2, pMat);
            m.userData.roomId = element.id;
            m.userData.generated = true;
            group.add(m);
            return m;
          };
          const doorW = Math.min(Number(element.doorWFt) || 0, Math.max(0, runLen - 1));
          if (doorW > 0.5) {
            const doorH = Math.min(6.8, hWall - 0.3);
            const at = Math.min(Math.max(Number(element.doorAtFt) || (runLen - doorW) / 2, 0.2), runLen - doorW - 0.2);
            if (at > 0.15) segBox(0, at, 0, hWall);
            if (runLen - (at + doorW) > 0.15) segBox(at + doorW, runLen, 0, hWall);
            segBox(at, at + doorW, doorH, hWall);
            const handleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false });
            mesh = alongX
              ? box(element.w, hWall, thick, element.x + element.w / 2, elevation + hWall / 2, element.y + thick / 2, handleMat)
              : box(thick, hWall, element.d, element.x + thick / 2, elevation + hWall / 2, element.y + element.d / 2, handleMat);
          } else {
            mesh = segBox(0, runLen, 0, hWall);
          }
        } else if (element.category === 'floor') {
          // Storey extent plate — with a real stairwell VOID where a stair on
          // the floor below comes up through it (subtractRect remainders).
          // The full-extent invisible handle keeps drag/resize working.
          const plateLevel = Number(element.level || 1);
          const cuts = (spec.elements || []).filter((el) => el.id !== element.id
            && /stair/i.test(el.name || '') && !/ladder/i.test(el.name || '')
            && Number(el.level || 1) === plateLevel - 1
            && el.x < element.x + element.w && el.x + el.w > element.x
            && el.y < element.y + element.d && el.y + el.d > element.y);
          const plateMat2 = new THREE.MeshStandardMaterial({
            color: elementPalette.floor,
            transparent: true,
            opacity: element.id === selectedRoom ? 0.9 : 0.72,
            roughness: 0.85
          });
          if (!cuts.length) {
            mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateMat2);
          } else {
            let rects = [{ x: element.x, y: element.y, w: element.w, d: element.d }];
            cuts.forEach((cut) => {
              const cutRect = { x: cut.x - 0.2, y: cut.y - 0.2, w: cut.w + 0.4, d: cut.d + 0.4 };
              rects = rects.flatMap((r) => subtractRect(r, cutRect));
            });
            rects.forEach((r) => {
              const m = box(r.w, elementHeight, r.d, r.x + r.w / 2, elevation + elementHeight / 2, r.y + r.d / 2, plateMat2);
              m.userData.roomId = element.id;
              m.userData.generated = true;
              group.add(m);
            });
            const plateHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
            mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateHandle);
          }
        } else if (/stair/i.test(element.name || '') && !/ladder/i.test(element.name || '')) {
          // A real stair run: treads and risers climbing the storey (or out of
          // the basement), not a floating box. The invisible full-volume box
          // stays as the drag/select handle.
          const alongX = element.w >= element.d;
          const runLen = Math.max(3, alongX ? element.w : element.d);
          const stairWide = Math.max(2, alongX ? element.d : element.w);
          const lvlS = Number(element.level || 1);
          const rise = lvlS === BASEMENT_LEVEL
            ? Math.max(4, basementH)
            : (storeys > 1 ? baseStoreyFt + 0.45 : Math.max(4, Number(element.h) || 8));
          elementHeight = rise;
          const treadMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4e, roughness: 0.8, map: grainTexture('wood') });
          const steps = Math.max(3, Math.round(rise / 0.646));
          const treadD = runLen / steps;
          const stepH = rise / steps;
          for (let s = 0; s < steps; s += 1) {
            const topY = elevation + (s + 1) * stepH;
            const tread = alongX
              ? box(treadD, 0.22, stairWide, element.x + s * treadD + treadD / 2, topY - 0.11, element.y + stairWide / 2, treadMat)
              : box(stairWide, 0.22, treadD, element.x + stairWide / 2, topY - 0.11, element.y + s * treadD + treadD / 2, treadMat);
            tread.userData.roomId = element.id;
            tread.userData.generated = true;
            group.add(tread);
            const riser = alongX
              ? box(0.16, stepH, stairWide, element.x + s * treadD + 0.1, topY - stepH / 2, element.y + stairWide / 2, treadMat)
              : box(stairWide, stepH, 0.16, element.x + stairWide / 2, topY - stepH / 2, element.y + s * treadD + 0.1, treadMat);
            riser.userData.roomId = element.id;
            riser.userData.generated = true;
            group.add(riser);
          }
          const stairHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false });
          mesh = box(element.w, rise, element.d, element.x + element.w / 2, elevation + rise / 2, element.y + element.d / 2, stairHandle);
        } else {
        const material = new THREE.MeshStandardMaterial({
          color: elementPalette[element.category] || 0x8a7768,
          transparent: true,
          opacity: element.id === selectedRoom ? 0.9 : 0.66,
          roughness: 0.85
        });
        mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, material);
        }
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

        // A covered porch / deck / carport: the element carries roofType but
        // nothing ever rendered it. A canopy now draws on four corner posts —
        // gable gets a small ridge, anything else a shed panel tilted down
        // away from the house. All parts carry the element's roomId so
        // selection glow and explode move the assembly as one.
        if (element.roofType && element.category !== 'foundation' && element.category !== 'floor') {
          const deckTop = elevation + elementHeight;
          const eave = deckTop + 6.8;
          const canopyPart = (m) => { m.userData.roomId = element.id; m.userData.generated = true; group.add(m); };
          [[element.x + 0.4, element.y + 0.4], [element.x + element.w - 0.4, element.y + 0.4],
            [element.x + 0.4, element.y + element.d - 0.4], [element.x + element.w - 0.4, element.y + element.d - 0.4]]
            .forEach(([pxp, pzp]) => canopyPart(box(0.42, eave - deckTop, 0.42, pxp, deckTop + (eave - deckTop) / 2, pzp, frameMat)));
          const cxm = element.x + element.w / 2;
          const czm = element.y + element.d / 2;
          const ow = 0.9;
          if (element.roofType === 'gable') {
            const alongX = element.w >= element.d;
            const span = (alongX ? element.d : element.w) / 2 + ow;
            const rise = Math.max(0.9, span * 0.3);
            const panelLen = Math.hypot(span, rise);
            for (const dir of [-1, 1]) {
              const panel = alongX
                ? box(element.w + ow * 2, 0.16, panelLen, cxm, eave + rise / 2, czm + dir * span / 2, roofMat)
                : box(panelLen, 0.16, element.d + ow * 2, cxm + dir * span / 2, eave + rise / 2, czm, roofMat);
              if (alongX) panel.rotation.x = dir * Math.atan2(rise, span);
              else panel.rotation.z = -dir * Math.atan2(rise, span);
              canopyPart(panel);
            }
          } else {
            const spanW = element.w + ow * 2;
            const spanD = element.d + ow * 2;
            const towardX = Math.abs(cxm - width / 2) > Math.abs(czm - depth / 2);
            const rise = Math.max(0.8, (towardX ? spanW : spanD) * 0.12);
            const panel = box(spanW, 0.16, spanD, cxm, eave + rise / 2, czm, roofMat);
            if (towardX) panel.rotation.z = (cxm >= width / 2 ? -1 : 1) * Math.atan2(rise, spanW);
            else panel.rotation.x = (czm >= depth / 2 ? 1 : -1) * Math.atan2(rise, spanD);
            canopyPart(panel);
          }
        }

        // A chimney rises past the roof plane instead of dying inside its box:
        // masonry heaters / wood stoves inside the footprint get a flue that
        // clears the roof by ~2.5' (roof height approximated at the stack's
        // plan position — stepped/L roofs use the main-roof math, honest-ish).
        // Category is planner-chosen and varies ('thermal', 'chimney', ...) —
        // match by name too so a traced "Masonry Chimney" gets its flue.
        if ((element.category === 'thermal' && /chimney|masonry|stove|heater|rocket/i.test(element.name || ''))
          || element.category === 'chimney' || /\b(chimney|flue)\b/i.test(element.name || '')) {
          const cxm = element.x + element.w / 2;
          const czm = element.y + element.d / 2;
          const inside = cxm >= 0 && cxm <= width && czm >= 0 && czm <= depth;
          const gRise = depth * Number(spec.shell.roofPitch || 0.32);
          let flueTop;
          if (!inside) flueTop = elevation + elementHeight + 6;
          else if (roofSpec.roofType === 'shed') flueTop = northWallHeight + (southWallHeight - northWallHeight) * Math.min(1, Math.max(0, czm / depth)) + 2.5;
          else if (roofSpec.roofType === 'flat') flueTop = wallHeight + 3;
          else flueTop = wallHeight + Math.max(0, gRise - 0.25) * (1 - Math.min(1, Math.abs(cxm - width / 2) / (width / 2 || 1))) + 2.5;
          const flueBase = elevation + Math.max(0.5, elementHeight - 0.5);
          if (flueTop > flueBase + 0.5) {
            const flueMat = new THREE.MeshStandardMaterial({ color: 0x8d6b5a, roughness: 0.9, map: grainTexture('concrete') });
            const flue = box(1.4, flueTop - flueBase, 1.4, cxm, flueBase + (flueTop - flueBase) / 2, czm, flueMat);
            flue.name = `${element.name} flue`;
            flue.userData.roomId = element.id;
            flue.userData.generated = true;
            roomMeshes.push(flue);
            group.add(flue);
            const cap = box(2, 0.25, 2, cxm, flueTop + 0.12, czm, flueMat);
            cap.userData.roomId = element.id;
            cap.userData.generated = true;
            group.add(cap);
          }
        }

        // Element labels only when SELECTED — a chip over every fixture,
        // partition, and plate buried the model in text. Names live in the
        // selector and the plan.
        if (layers.labels && element.id === selectedRoom) {
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
        } else {
          // The wall line the opening sits on: on a custom footprint it is the
          // containing polygon edge; on a rectangle these are the classic
          // 0 / depth / width / 0 lines (edgeForOpening returns exactly those).
          const oEdge = customFp ? edgeForOpening(spec, opening) : null;
          const lineNS = oEdge && oEdge.horizontal ? oEdge.y0 : (opening.wall === 'north' ? 0 : depth);
          const lineEW = oEdge && !oEdge.horizontal ? oEdge.x0 : (opening.wall === 'east' ? width : 0);
          if (profile.bay) {
            // Bay window: a wood-framed box pushed out from the wall, glass on its face.
            const bayD = 1.4;
            let glassFace = null;
            if (opening.wall === 'south') {
              mesh = box(size, openH, bayD, opening.x + size / 2, centerY, lineNS + bayD / 2, bayFrameMat);
              glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, lineNS + bayD + 0.06, glassMat);
            } else if (opening.wall === 'north') {
              mesh = box(size, openH, bayD, opening.x + size / 2, centerY, lineNS - bayD / 2, bayFrameMat);
              glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, lineNS - bayD - 0.06, glassMat);
            } else if (opening.wall === 'east') {
              mesh = box(bayD, openH, size, lineEW + bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
              glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), lineEW + bayD + 0.06, centerY, opening.y + size / 2, glassMat);
            } else {
              mesh = box(bayD, openH, size, lineEW - bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
              glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), lineEW - bayD - 0.06, centerY, opening.y + size / 2, glassMat);
            }
            if (glassFace) group.add(glassFace);
          } else {
            // A real opening assembly instead of a pasted-on box: wood frame
            // (head, sill member, jambs) standing proud of the wall, an inset
            // glass pane or door slab, divided lites on windows, a projecting
            // sill ledge, and a knob on doors. Every part carries the opening
            // id so selection glow and the exploded view treat it as one thing.
            const horizontalWall = opening.wall === 'north' || opening.wall === 'south';
            const line = horizontalWall ? lineNS : lineEW;
            const dirOut = opening.wall === 'south' || opening.wall === 'east' ? 1 : -1;
            const along0 = horizontalWall ? Number(opening.x) || 0 : Number(opening.y) || 0;
            const mid = along0 + size / 2;
            const part = (alongLen, h, deep, alongC, yC, out, material) => {
              const m = horizontalWall
                ? box(alongLen, h, deep, alongC, yC, line + dirOut * out, material)
                : box(deep, h, alongLen, line + dirOut * out, yC, alongC, material);
              m.userData.roomId = `opening-${index}`;
              group.add(m);
              return m;
            };
            const fw = 0.22;
            part(size + fw * 2, fw, 0.3, mid, profile.sill + openH + fw / 2, 0.14, frameMat);
            part(size + fw * 2, fw, 0.3, mid, Math.max(fw / 2, profile.sill - fw / 2), 0.14, frameMat);
            part(fw, openH, 0.3, mid - size / 2 - fw / 2, centerY, 0.14, frameMat);
            part(fw, openH, 0.3, mid + size / 2 + fw / 2, centerY, 0.14, frameMat);
            const paneMat = profile.glazed ? glassMat : doorMatWood;
            mesh = part(Math.max(0.6, size - 0.08), openH, 0.14, mid, centerY, 0.05, paneMat);
            if (profile.glazed && !profile.entry && size >= 2) {
              // divided lites — one vertical + one horizontal muntin
              part(0.09, openH, 0.2, mid, centerY, 0.13, frameMat);
              part(size, 0.09, 0.2, mid, centerY, 0.13, frameMat);
            }
            if (opening.type === 'french' || opening.type === 'slider') {
              part(0.12, openH, 0.24, mid, centerY, 0.13, frameMat);
            }
            if (profile.entry && !profile.glazed) {
              // door hardware — a small knob at the latch side
              part(0.14, 0.14, 0.14, mid + size * 0.34, profile.sill + Math.min(3.1, openH * 0.45), 0.2, frameMat);
            }
            if (profile.sill > 0.6) {
              // projecting exterior sill ledge under windows
              part(size + 0.5, 0.13, 0.5, mid, profile.sill - fw - 0.04, 0.22, frameMat);
            }
          }
        }
        if (mesh) {
          mesh.name = opening.label || `${opening.wall} ${opening.type}`;
          mesh.userData.roomId = `opening-${index}`;
          roomMeshes.push(mesh);
          group.add(mesh);
        }
      });

      if (layers.roof) {
        if (layers.xray || layers.explode) {
          roofMat.transparent = true;
          roofMat.opacity = layers.xray ? 0.4 : 0.55;
        }
        const oAll = resolveOverhangs(spec.shell);
        const plateReal = upperPlateRect(spec, 2);
        const fpAreaNow = customFp ? polygonArea(fpPoly) : width * depth;
        // The roof STEPS when an upper storey covers only part of the plan:
        // an upper roof over the extent plate, low wings over the remainder.
        const steps = storeyLift > 0 && plateReal && plateReal.w * plateReal.d < fpAreaNow - 1;
        if (!customFp && !steps) {
          // Legacy path, byte-for-byte: one roof over the whole rectangle.
          const roof = makeRoof(width, depth, wallHeight, spec.shell.roofPitch, roofMat, roofSpec, oAll);
          roof.userData.roomId = 'roof-main';
          roomMeshes.push(roof);
          group.add(roof);
        } else {
          // Roof as SEGMENTS — per rectangle of an L/T/U footprint and/or the
          // stepped upper-block + wings. Valleys are not modeled; segments meet.
          const pitchNow = Number(spec.shell.roofPitch || 0.32);
          const insideFp = (px, py) => (customFp
            ? pointInFootprint(fpPoly, px, py)
            : px > 0.01 && px < width - 0.01 && py > 0.01 && py < depth - 0.01);
          const inPlate = (px, py) => Boolean(steps && plateReal
            && px > plateReal.x + 0.01 && px < plateReal.x + plateReal.w - 0.01
            && py > plateReal.y + 0.01 && py < plateReal.y + plateReal.d - 0.01);
          // A segment side is a true eave only when nothing lies beyond it:
          // probe just outside — upper wall → tuck under it; neighbor segment
          // → hairline lap; open air → the shell overhang for that facing.
          const segOverhangs = (rect, isUpper) => {
            const probe = 0.4;
            const probes = {
              north: [rect.x + rect.w / 2, rect.y - probe],
              south: [rect.x + rect.w / 2, rect.y + rect.d + probe],
              west: [rect.x - probe, rect.y + rect.d / 2],
              east: [rect.x + rect.w + probe, rect.y + rect.d / 2]
            };
            const out = {};
            for (const side of WALL_SIDES) {
              const [px, py] = probes[side];
              if (!isUpper && inPlate(px, py)) out[side] = 0.35;
              else if (insideFp(px, py)) out[side] = 0.05;
              else out[side] = oAll[side];
            }
            return out;
          };
          const segments = [];
          if (steps) {
            segments.push({ rect: { x: plateReal.x, y: plateReal.y, w: plateReal.w, d: plateReal.d }, eave: wallHeight, kind: 'full', upper: true });
            const lowers = customFp
              ? subtractRectFromFootprint(fpPoly, plateReal)
              : subtractRect({ x: 0, y: 0, w: width, d: depth }, plateReal);
            const groundEave = roofSpec.highWallHeightFt;
            lowers.forEach((rect) => {
              const overlapX = rect.x < plateReal.x + plateReal.w && rect.x + rect.w > plateReal.x;
              const overlapY = rect.y < plateReal.y + plateReal.d && rect.y + rect.d > plateReal.y;
              const touch = Math.abs(rect.y + rect.d - plateReal.y) < 0.05 && overlapX ? 'south'
                : Math.abs(rect.y - (plateReal.y + plateReal.d)) < 0.05 && overlapX ? 'north'
                : Math.abs(rect.x + rect.w - plateReal.x) < 0.05 && overlapY ? 'east'
                : Math.abs(rect.x - (plateReal.x + plateReal.w)) < 0.05 && overlapY ? 'west'
                : (Math.abs((rect.x + rect.w / 2) - (plateReal.x + plateReal.w / 2)) > Math.abs((rect.y + rect.d / 2) - (plateReal.y + plateReal.d / 2))
                  ? ((rect.x + rect.w / 2) < (plateReal.x + plateReal.w / 2) ? 'east' : 'west')
                  : ((rect.y + rect.d / 2) < (plateReal.y + plateReal.d / 2) ? 'south' : 'north'));
              segments.push({ rect, eave: groundEave, kind: 'wing', highSide: touch });
            });
          } else {
            decomposeFootprint(fpPoly).forEach((rect) => segments.push({ rect, eave: wallHeight, kind: 'full', upper: true }));
          }
          // The global shed plane (eave line north→south across the whole
          // house) — 'full' shed segments are coplanar pieces of it.
          const shedYAt = (zz) => {
            const z0 = -oAll.north, z1 = depth + oAll.south;
            const nH = roofSpec.northWallHeightFt + storeyLift + 0.28;
            const sH = roofSpec.southWallHeightFt + storeyLift + 0.28;
            return nH + (sH - nH) * clamp((zz - z0) / Math.max(0.01, z1 - z0), 0, 1);
          };
          segments.forEach((seg) => {
            const o = segOverhangs(seg.rect, Boolean(seg.upper));
            let mesh = null;
            if (seg.kind === 'wing') {
              mesh = makeStepRoofPlane(seg.rect, seg.highSide, seg.eave + 0.25, pitchNow, o, roofMat);
            } else if (roofSpec.roofType === 'shed') {
              mesh = makeShedPiece(seg.rect, o, shedYAt, roofMat);
            } else if (roofSpec.roofType === 'flat') {
              mesh = makeShedPiece(seg.rect, o, () => seg.eave + 0.25, roofMat);
            } else if (roofSpec.roofType === 'hip') {
              mesh = makeRoof(seg.rect.w, seg.rect.d, seg.eave, pitchNow, roofMat, roofSpec, o);
              mesh.position.x += seg.rect.x;
              mesh.position.z += seg.rect.y;
            } else {
              mesh = makeGableSegment(seg.rect, seg.eave, pitchNow, o, roofMat);
            }
            if (mesh) {
              mesh.name = seg.kind === 'wing' ? 'Roof (lower wing)' : 'Roof';
              mesh.userData.roomId = 'roof-main';
              mesh.userData.generated = true;
              roomMeshes.push(mesh);
              group.add(mesh);
            }
          });
        }
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
      const groundSlope = Math.max(0, Number(siteOf(spec).slopeFt) || 0);
      const groundMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(groundCanvas), transparent: true, roughness: 1, side: THREE.DoubleSide });
      const gSize = fixedGridSize * 2.5;
      if (groundSlope <= 0) {
        // Flat site (legacy): one horizontal plane just below the floor datum.
        const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), groundMat);
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.set(width / 2, -0.52, depth / 2);
        groundPlane.receiveShadow = true;
        groundPlane.userData.generated = true;
        group.add(groundPlane);
      } else {
        // Sloped site: a real terrain surface warped to the grade plane, so the
        // land falls away and the house sits on it true to the drawings.
        const segs = 60;
        const gx0 = width / 2 - gSize / 2;
        const gz0 = depth / 2 - gSize / 2;
        const positions = [];
        const uvs = [];
        for (let i = 0; i <= segs; i += 1) {
          for (let j = 0; j <= segs; j += 1) {
            const wx = gx0 + (gSize * i) / segs;
            const wz = gz0 + (gSize * j) / segs;
            positions.push(wx, gradeElevationAt(spec, wx, wz) - 0.05, wz);
            uvs.push(i / segs, j / segs);
          }
        }
        const idx = (i, j) => i * (segs + 1) + j;
        const indices = [];
        for (let i = 0; i < segs; i += 1) {
          for (let j = 0; j < segs; j += 1) {
            indices.push(idx(i, j), idx(i, j + 1), idx(i + 1, j));
            indices.push(idx(i + 1, j), idx(i, j + 1), idx(i + 1, j + 1));
          }
        }
        const terrainGeo = new THREE.BufferGeometry();
        terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        terrainGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        terrainGeo.setIndex(indices);
        terrainGeo.computeVertexNormals();
        const terrain = new THREE.Mesh(terrainGeo, groundMat);
        terrain.receiveShadow = true;
        terrain.userData.generated = true;
        terrain.name = `Sloped terrain (${groundSlope}′ fall to the ${siteOf(spec).slopeDir})`;
        group.add(terrain);

        // Contour lines: iso-elevation lines across the terrain (the topo look).
        // Grade is a tilted plane, so each contour is a straight line of constant
        // elevation — solve the grade equation for the axis coordinate.
        const site = siteOf(spec);
        const interval = Math.min(10, Math.max(1, Number(site.contourInterval) || 2));
        const dir = ['north', 'south', 'east', 'west'].includes(site.slopeDir) ? site.slopeDir : 'south';
        const axisIsY = dir === 'north' || dir === 'south';
        const span = axisIsY ? depth : width;
        const contourMat = new THREE.LineBasicMaterial({ color: 0x8a8468, transparent: true, opacity: 0.55 });
        const eLo = gradeElevationAt(spec, axisIsY ? width / 2 : gx0, axisIsY ? gz0 + gSize : depth / 2);
        const eHi = gradeElevationAt(spec, axisIsY ? width / 2 : gx0 + gSize, axisIsY ? gz0 : depth / 2);
        const [lo, hi] = [Math.min(eLo, eHi), Math.max(eLo, eHi)];
        for (let e = Math.ceil(lo / interval) * interval; e <= hi; e += interval) {
          // coordinate along the slope axis where grade == e
          const frac = (-e - (Number(site.gradeFt ?? 1.5))) / groundSlope; // t in the grade eqn
          if (frac < -6 || frac > 6) continue;
          const coord = dir === 'south' ? frac * depth
            : dir === 'north' ? depth - frac * depth
              : dir === 'east' ? frac * width
                : width - frac * width;
          const pts = axisIsY
            ? [new THREE.Vector3(gx0, e - 0.02, coord), new THREE.Vector3(gx0 + gSize, e - 0.02, coord)]
            : [new THREE.Vector3(coord, e - 0.02, gz0), new THREE.Vector3(coord, e - 0.02, gz0 + gSize)];
          const cl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), contourMat);
          cl.userData.generated = true;
          group.add(cl);
        }
      }

      // The flat reference grid only makes sense on flat ground — on a sloped
      // site it floats downhill and buries uphill; the contour lines take over
      // as the scale/elevation reference there.
      if (groundSlope <= 0) {
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
      }

      // The 3D view reflects the selection like Plan and Detail do: whatever is
      // selected — wall band, roof, opening, pad — glows warm. (Rooms and
      // elements already carry their own active tint; the glow just unifies it.)
      group.traverse((node) => {
        if (!node.isMesh || !node.material || !node.material.emissive) return;
        if (String(node.userData.roomId || '') === String(selectedRoom || '')) {
          node.material.emissive = new THREE.Color(0xc88a5b);
          node.material.emissiveIntensity = 0.35;
        }
      });

      // Exploded view: pull the systems apart so their joints and layers read —
      // roof lifts, walls slide outward by side, upper bands rise a little more,
      // floor plates hover, the foundation drops. Everything stays clickable, so
      // you can still select and edit any part while it's exploded.
      if (layers.explode) {
        const sideOut = { north: [0, 0, -6], south: [0, 0, 6], east: [6, 0, 0], west: [-6, 0, 0] };
        group.traverse((node) => {
          if (!node.isMesh) return;
          const id = String(node.userData.roomId || '');
          const name = String(node.name || '');
          if (id === 'roof-main' || /roof/i.test(name)) { node.position.y += 9; return; }
          if (id.startsWith('wall-')) {
            // Edge walls (wall-e3) carry their facing in userData.wallSide.
            const side = node.userData.wallSide || id.split('-')[1];
            const off = sideOut[side];
            if (off) { node.position.x += off[0]; node.position.z += off[2]; }
            if (id.endsWith('-u')) node.position.y += 3;
            return;
          }
          if (id.startsWith('opening-')) {
            const opening = (spec.openings || [])[Number(id.replace('opening-', ''))];
            if (opening?.wall === 'roof') { node.position.y += 9; return; }
            const off = sideOut[opening?.wall];
            if (off) { node.position.x += off[0]; node.position.z += off[2]; }
            return;
          }
          if (/floor plate/i.test(name) || node.userData.category === 'floor') { node.position.y += 5; return; }
          if (id === 'site-pad' || /stem wall/i.test(name)) { node.position.y -= 2.5; }
        });
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

    // A raked wall segment between z0..z1 (heights vary along z) — the
    // per-edge cousin of makeShedSideWall for custom footprints under sheds.
    function makeRakedWallSegment(x0, x1, z0, z1, h0, h1, material) {
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        x0, 0, z0, x1, 0, z0, x1, h0, z0, x0, h0, z0,
        x0, 0, z1, x1, 0, z1, x1, h1, z1, x0, h1, z1
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

    // One sloped plane over a rect: high along highSide (tucked against the
    // upper block), falling away at the given pitch — the stepped roof's wing.
    function makeStepRoofPlane(rect, highSide, topY, pitch, o, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      const run = (highSide === 'north' || highSide === 'south') ? (z1 - z0) : (x1 - x0);
      const drop = Math.max(0.1, run * pitch);
      const yAt = (px, pz) => {
        if (highSide === 'north') return topY - ((pz - z0) / (z1 - z0)) * drop;
        if (highSide === 'south') return topY - ((z1 - pz) / (z1 - z0)) * drop;
        if (highSide === 'west') return topY - ((px - x0) / (x1 - x0)) * drop;
        return topY - ((x1 - px) / (x1 - x0)) * drop;
      };
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        x0, yAt(x0, z0), z0,
        x1, yAt(x1, z0), z0,
        x1, yAt(x1, z1), z1,
        x0, yAt(x0, z1), z1
      ]), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.generated = true;
      return mesh;
    }

    // A flat-or-sloped quad over a rect where height is any function of z —
    // flat roofs (constant) and coplanar pieces of the global shed plane.
    function makeShedPiece(rect, o, yAt, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        x0, yAt(z0), z0,
        x1, yAt(z0), z0,
        x1, yAt(z1), z1,
        x0, yAt(z1), z1
      ]), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.generated = true;
      return mesh;
    }

    // A gable over one rect segment with the ridge along its LONGER axis
    // (an L's wing gets a wing-wise ridge). Two slopes + two end triangles.
    function makeGableSegment(rect, eave, pitch, o, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      const spanX = x1 - x0, spanZ = z1 - z0;
      const alongX = spanX >= spanZ;         // ridge runs east-west when wider
      const ridgeY = eave + 0.25 + (Math.min(spanX, spanZ) / 2) * pitch;
      const base = eave + 0.25;
      const verts = [];
      const quad = (p0, p1, p2, p3) => { verts.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };
      const tri = (p0, p1, p2) => { verts.push(...p0, ...p1, ...p2); };
      if (alongX) {
        const cz = (z0 + z1) / 2;
        const rA = [x0, ridgeY, cz], rB = [x1, ridgeY, cz];
        quad([x0, base, z0], [x1, base, z0], rB, rA);               // north slope
        quad([x1, base, z1], [x0, base, z1], rA, rB);               // south slope
        tri([x0, base, z1], [x0, base, z0], rA);                    // west gable end
        tri([x1, base, z0], [x1, base, z1], rB);                    // east gable end
      } else {
        const cx = (x0 + x1) / 2;
        const rA = [cx, ridgeY, z0], rB = [cx, ridgeY, z1];
        quad([x0, base, z1], [x0, base, z0], rA, rB);               // west slope
        quad([x1, base, z0], [x1, base, z1], rB, rA);               // east slope
        tri([x0, base, z0], [x1, base, z0], rA);                    // north gable end
        tri([x1, base, z1], [x0, base, z1], rB);                    // south gable end
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
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
      // Openings slide ALONG their wall — grab a window in 3D and move it.
      if (objectId.startsWith('opening-')) {
        const openingIndex = Number(objectId.replace('opening-', ''));
        const opening = spec.openings?.[openingIndex];
        if (!opening || opening.wall === 'roof') {
          callbacksRef.current.onSelectRoom(objectId);
          return;
        }
        renderer.domElement.setPointerCapture(event.pointerId);
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const horiz = opening.wall === 'north' || opening.wall === 'south';
        const run = horiz ? Number(spec.shell.widthFt) : Number(spec.shell.depthFt);
        const startAlong = Number(horiz ? opening.x : opening.y) || 0;
        const meshes = [];
        scene.traverse((node) => { if (node.isMesh && node.userData?.roomId === objectId) meshes.push(node); });
        dragState = { mode: 'openingSlide', id: objectId, pointerId: event.pointerId, horiz, run, width: Number(opening.widthFt) || 3, startAlong, currentAlong: startAlong, startX: dragPoint.x, startZ: dragPoint.z, meshes, began: false, moved: false };
        return;
      }
      // Ground walls (and edge segments) drag IN and OUT — grab the wall and
      // push it; the footprint follows on release. Upper bands move via the
      // storey controls; the roof/pad follow the shell.
      if (objectId.startsWith('wall-') && !objectId.endsWith('-u')) {
        const side = hit.object.userData.wallSide;
        if (!side) {
          callbacksRef.current.onSelectRoom(objectId);
          return;
        }
        renderer.domElement.setPointerCapture(event.pointerId);
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const horiz = side === 'north' || side === 'south';
        const outSign = side === 'south' || side === 'east' ? 1 : -1;
        const meshes = [];
        scene.traverse((node) => { if (node.isMesh && node.userData?.roomId === objectId) meshes.push(node); });
        dragState = { mode: 'wallSlide', id: objectId, pointerId: event.pointerId, horiz, outSign, currentOffset: 0, startX: dragPoint.x, startZ: dragPoint.z, meshes, began: false, moved: false };
        return;
      }
      const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === objectId);
      if (!object) {
        callbacksRef.current.onSelectRoom(objectId);
        return;
      }
      if (objectId === 'site-pad' || objectId === 'roof-main') {
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
      if (dragState.mode === 'openingSlide') {
        const rawAlong = dragState.startAlong + (dragState.horiz ? dragPoint.x - dragState.startX : dragPoint.z - dragState.startZ);
        const along = clamp(Math.round(rawAlong * 2) / 2, 0, Math.max(0, dragState.run - dragState.width));
        const deltaAlong = along - dragState.currentAlong;
        if (deltaAlong) dragState.meshes.forEach((m) => { if (dragState.horiz) m.position.x += deltaAlong; else m.position.z += deltaAlong; });
        dragState.currentAlong = along;
        dragState.finalAlong = along;
        return;
      }
      if (dragState.mode === 'wallSlide') {
        const raw = dragState.horiz ? dragPoint.z - dragState.startZ : dragPoint.x - dragState.startX;
        const offset = clamp(Math.round(raw * 2) / 2, -24, 24);
        const delta = offset - dragState.currentOffset;
        if (delta) dragState.meshes.forEach((m) => { if (dragState.horiz) m.position.z += delta; else m.position.x += delta; });
        dragState.currentOffset = offset;
        dragState.finalOffset = offset * dragState.outSign;
        return;
      }
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
      if (finished.mode === 'openingSlide') {
        if (finished.moved && Number.isFinite(finished.finalAlong)) callbacksRef.current.onMoveEnd(finished.id, finished.finalAlong, 0);
        else callbacksRef.current.onSelectRoom(finished.id);
      } else if (finished.mode === 'wallSlide') {
        if (finished.moved && finished.finalOffset) callbacksRef.current.onMoveEnd(finished.id, finished.finalOffset, 0);
        else callbacksRef.current.onSelectRoom(finished.id);
      } else if (finished.mode === 'resize' && finished.moved && Number.isFinite(finished.finalW) && Number.isFinite(finished.finalD)) {
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
    // The container itself changes size without a window resize — hiding or
    // showing the chat column, for one. Track the mount, not just the window.
    const mountObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    mountObserver?.observe(mount);

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
      mountObserver?.disconnect();
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
  const [wallMoveFt, setWallMoveFt] = useState(2);
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
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [appMode, setAppMode] = useState('design');
  const [viewMode, setViewMode] = useState('3d');
  const [activeFloor, setActiveFloor] = useState(1);
  const [buildProgress, setBuildProgress] = useState(() => initialSaved?.buildProgress || {});
  const [inspectorView, setInspectorView] = useState('inspect');
  // The inspector lives IN the left control column (portal target) — the model
  // stays the selector surface, the left bar the single control surface.
  const [inspectorDock, setInspectorDock] = useState(null);
  const [selMenuOpen, setSelMenuOpen] = useState(false);
  // The chat column is toggle-able — hidden, the model gets its width.
  const [chatOpen, setChatOpen] = useState(() => {
    try { return window.localStorage.getItem('nbChatOpen') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('nbChatOpen', chatOpen ? '1' : '0'); } catch { /* private mode */ }
  }, [chatOpen]);
  // When the SELECTION changes (tap in the model, plan, chip, or a summary
  // row), bring the docked editor into view — it sits below the system page in
  // the left bar's general→specific sequence, so it may be off-screen.
  const lastSelectedScrollRef = useRef(null);
  useEffect(() => {
    if (lastSelectedScrollRef.current === null) { lastSelectedScrollRef.current = selectedRoom; return; }
    if (lastSelectedScrollRef.current === selectedRoom) return;
    lastSelectedScrollRef.current = selectedRoom;
    if (inspectorDock) inspectorDock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedRoom, inspectorDock]);
  const [dimensionPreview, setDimensionPreview] = useState(null);
  const [savedAt, setSavedAt] = useState(() => initialSaved?.savedAt || '');
  const [libraryActionMode, setLibraryActionMode] = useState(() => initialSaved?.libraryActionMode || 'apply');
  const [modelLayers, setModelLayers] = useState(() => ({ ...DEFAULT_MODEL_LAYERS, ...(initialSaved?.modelLayers || {}) }));
  const [layersOpen, setLayersOpen] = useState(false);
  // First run (nothing saved anywhere): ask how to begin instead of silently
  // dropping the visitor into a finished sample house. Also reusable as "New".
  // The opening card is the front door: what the app is, how to use it, and
  // continue / start-fresh choices. It shows on every open; Continue is one tap.
  // The opening card is the front door on every real page load — but an HMR
  // hot-reload mid-session must NOT slam it in the user's face. Dismissal is
  // remembered per browser tab (sessionStorage), cleared by a real reload? No:
  // sessionStorage survives reloads in the tab, so the card shows once per tab
  // session — reopen any time with the ? button in the brand.
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try { return !window.sessionStorage.getItem('nbWelcomeDismissed'); } catch { return true; }
  });
  useEffect(() => {
    try {
      if (welcomeOpen) window.sessionStorage.removeItem('nbWelcomeDismissed');
      else window.sessionStorage.setItem('nbWelcomeDismissed', '1');
    } catch { /* storage blocked — the card just reopens on HMR */ }
  }, [welcomeOpen]);
  const [welcomeIsFirstRun, setWelcomeIsFirstRun] = useState(() => !initialSaved);
  // Every design ever saved lives in the revision snapshots — the card offers
  // them back ("start other previous model").
  const [previousDesigns, setPreviousDesigns] = useState([]);
  useEffect(() => {
    if (!welcomeOpen) return;
    let cancelled = false;
    fetch('/api/projects/current/designs')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setPreviousDesigns(data?.designs || []); })
      .catch(() => { /* backend not up yet — the list just stays empty */ });
    return () => { cancelled = true; };
  }, [welcomeOpen]);

  async function restorePreviousDesign(design) {
    try {
      const response = await fetch('/api/projects/current/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: design.file })
      });
      const data = await response.json();
      if (!data?.ok || !data?.state?.spec) throw new Error(data?.error || 'restore failed');
      restoreDashboardState(data.state);
      setWelcomeOpen(false);
      setWelcomeIsFirstRun(false);
      setLastModelChange(`Restored ${design.projectName} (rev ${design.revision}).`);
    } catch (error) {
      window.alert(`Could not restore that design: ${error.message}`);
    }
  }
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

  // Start from a file or drawing: a fresh design with the sketch/PDF attached
  // to the planner and the ask pre-filled — add scale/orientation, hit Apply.
  function startFromFile(file) {
    if (!file) return;
    startNewDesign('blank');
    handleImage(file);
    setPrompt('Start this design from the attached drawing: read the footprint, the rooms and their sizes, and the windows and doors, and build them.');
    setChatMessages((items) => [
      ...items,
      { role: 'studio', speaker: 'Studio', text: `Fresh design started from ${file.name}. Tell me anything the drawing can't say — overall width in feet, which way is south — then press Apply Design and I'll build it.` }
    ]);
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
    if (activeFloor === BASEMENT_LEVEL && !basementInfo(spec.shell).present) setActiveFloor(1);
  }, [spec, activeFloor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await requestCurrentProjectState();
        if (!cancelled && result?.state?.spec) {
          restoreDashboardState(result.state);
          // A design exists — the opening card stays up as the front door,
          // now offering "Continue where you left off."
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
  }, [chatMessages, isPlanning]);

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

    // Design mode is ACTION-FIRST: everything goes to the planner. Pure
    // questions still get a conversational answer — but only when the plan
    // produces no operations, never by hijacking a build request. (The old
    // "sounds like a question" pre-check swallowed asks like "build the house
    // from this plan" into chat mode — the drawing never reached the planner.)
    const questionOnly = !attachedImages.length && isConsultativePrompt(submittedPrompt, []) && !/\b(apply|build|make|create|add|move|resize|change|set|trace|use|model|draw)\b/i.test(submittedPrompt);
    if (questionOnly) {
      await answerConsultativePrompt(submittedPrompt);
      return;
    }

    // Fast local path: "remove the duplicate/excess windows" is mechanical —
    // the backend dedupes deterministically; no AI needed (and the planner
    // used to choke on exactly this ask). Runs even with a drawing attached.
    if (/\b(remove|delete|clean\s?up|clear|get rid of|fix)\b[^.]*\b(duplicate|duplicated|excess|extra|overlap\w*|redundant)\b[^.]*\b(opening|window|door)/i.test(submittedPrompt)
      || /\b(duplicate|excess|extra|overlapping)\b[^.]*\b(openings?|windows?|doors?)\b[^.]*\b(remove|delete|clean|clear|out)\b/i.test(submittedPrompt)
      || /\bdedupe?\b.*\b(openings?|windows?|doors?)\b/i.test(submittedPrompt)) {
      setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
      setPrompt('');
      await applyBackendOperations({
        operations: [{ type: 'dedupe_openings' }],
        promptText: 'Clean up duplicate openings',
        logPrefix: 'Openings',
        chatText: 'Cleaned overlapping and duplicate windows/doors — where two openings shared the same stretch of wall, the door (or the wider one) stayed. Instant, no planner needed.'
      });
      return;
    }

    // Fast local path: simple "add a bedroom / a kitchen 14x12" requests skip
    // the slow planner entirely and go straight through the layout engine.
    const localRooms = attachedImages.length ? null : parseLocalRoomAdds(submittedPrompt);
    if (localRooms) {
      await applyLocalRoomAdds(localRooms, submittedPrompt);
      return;
    }

    // Show the user's message and the working state IMMEDIATELY — the planner
    // can take 30-60s on a full drawing takeoff and silence reads as a hang.
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
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
          { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision}.\n\n${structuredPlanSummary(structuredReport)}` }
        ]);
        setRevisionLog((items) => [`Rev ${next.revision}: Planner applied ${structuredReport.actions.length} structured BIM operation${structuredReport.actions.length === 1 ? '' : 's'}.`, ...items]);
        return;
      }

      setChatMessages((items) => [
        ...items,
        { role: 'studio', speaker: 'Studio', text: isConsultativePrompt(submittedPrompt, attachedImages) ? buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages) : `No BIM change made.\n\n${structuredPlanSummary(structuredReport)}` }
      ]);
      setRevisionLog((items) => [`No change: Planner could not turn "${submittedPrompt}" into a safe BIM operation.`, ...items]);
    } catch (error) {
      const report = applyNaturalLanguageDesign(submittedPrompt, spec, attachedImages, addToTarget, selected);
      if (isConsultativePrompt(submittedPrompt, attachedImages)) {
        const reply = buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
        setChatMessages((items) => [
          ...items,
          { role: 'studio', speaker: 'Studio', text: `${reply}\n\nNote: the BIM planner was unavailable just now (${error.message}), so I stayed in conversation mode instead of pretending that was a geometry request.` }
        ]);
        setRevisionLog((items) => [`Studio consult fallback: answered "${submittedPrompt}" while planner was unavailable.`, ...items]);
        return;
      }
      recordOperationAudit(submittedPrompt, { source: 'browser-emergency-fallback', operations: [] }, report, spec.revision, report.spec.revision);
      if (!report.actions.length) {
        setChatMessages((items) => [
          ...items,
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
        { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision} with fallback parser.\n\nPlanner error: ${error.message}\n\n${interpreterSummary(report)}` }
      ]);
      setRevisionLog((items) => [`Rev ${next.revision}: Fallback parser applied changes after planner error.`, ...items]);
    } finally {
      setIsPlanning(false);
    }
  }

  function loopRevisions() {
    rememberRevision();
    const flaggedBefore = detectIssues(spec).filter((issue) => issue.severity !== 'pass');
    let next = structuredClone(spec);
    let passes = 0;
    while (passes < 4 && detectIssues(next).some((issue) => issue.severity !== 'pass')) {
      next = reviseSpec(next);
      passes += 1;
    }
    const displayedPasses = passes || 1;
    setSpec(next);
    setRevisionLog((items) => [`Rev ${next.revision}: Council loop ran ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'} and resolved available schematic blockers.`, ...items]);
    // The council speaks when ASKED — this button is the ask. Report what it
    // found and what remains, here in the conversation.
    const remaining = detectIssues(next).filter((issue) => issue.severity !== 'pass');
    const foundText = flaggedBefore.length
      ? `The council reviewed the design and flagged:\n${flaggedBefore.slice(0, 6).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}`
      : 'The council reviewed the design and found no blocking issues.';
    const remainText = remaining.length
      ? `\n\nStill open after ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'}:\n${remaining.slice(0, 6).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}\n\nSee Review for one-tap fixes.`
      : flaggedBefore.length ? `\n\nAll of it was resolved automatically in ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'}.` : '';
    setChatMessages((items) => [...items, { role: 'studio', speaker: 'Council', text: `${foundText}${remainText}` }]);
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
    } else if (field === 'designApproach') {
      operations.push({ type: 'set_shell', field: 'designApproach', value });
    } else if (field === 'basementHeightFt') {
      // 0 removes the basement — it must NOT hit the generic 18-min shell clamp.
      operations.push({ type: 'set_shell', field, value: String(numeric > 0 ? clamp(numeric, 6, 12) : 0) });
    } else if (field === 'basementHeated') {
      operations.push({ type: 'set_shell', field, value: value === true || value === 'true' ? 'true' : 'false' });
    } else if (field === 'upperStoreyHeightFt') {
      operations.push({ type: 'set_shell', field, value: String(numeric > 0 ? clamp(numeric, 6, 14) : 0) });
    } else if (field === 'southWallHeightFt' || field === 'northWallHeightFt') {
      operations.push({ type: 'set_wall_height', wall: field === 'southWallHeightFt' ? 'south' : 'north', h: clamp(numeric, 2, 24) });
    } else {
      operations.push({ type: 'set_shell', field, value: String(field === 'roofPitch' ? clamp(numeric, 0.08, 0.75) : field === 'wallHeightFt' ? clamp(numeric, 7, 40) : field === 'storeys' ? clamp(numeric, 1, 3) : clamp(numeric, 18, field === 'depthFt' ? 80 : field === 'widthFt' ? 96 : field === 'padExtensionFt' ? 200 : 24)) });
    }
    void applyBackendOperations({ operations, promptText: `Update shell ${field}`, logPrefix: 'Shell edit' });
  }

  // Foundation Type is ONE choice with four answers — the fourth (basement) is
  // also a storey. Switching in creates it; switching away removes it and sets
  // the picked type, in a single dispatch (never two racing calls).
  function setFoundationChoice(value) {
    const hasBasement = basementInfo(spec.shell).present;
    if (value === 'basement') {
      if (!hasBasement) updateShell('basementHeightFt', 8);
      return;
    }
    const operations = [{ type: 'set_utility', field: 'foundationType', value }];
    if (hasBasement) operations.unshift({ type: 'set_shell', field: 'basementHeightFt', value: '0' });
    void applyBackendOperations({
      operations,
      promptText: `Set foundation to ${value}`,
      logPrefix: 'Foundation',
      chatText: hasBasement ? 'Removed the basement — its rooms came up to the ground floor — and set the new foundation type.' : undefined
    });
  }

  // Per-wall edit: system / height / thickness / finish / omit, per N/S/E/W side.
  function updateWallSide(side, field, rawValue, level = 1) {
    let value = rawValue;
    // Per-side heights go down to a 2' kneewall (greenhouse south face).
    if (field === 'heightFt') value = clamp(Number(rawValue), 2, 40);
    else if (field === 'thicknessFt') value = clamp(Number(rawValue), 0.2, 3.5);
    else if (field === 'sunGlazingTiltDeg') value = clamp(Number(rawValue) || 0, 0, 45);
    else if (field === 'sunGlazing' || field === 'omitted') value = Boolean(rawValue);
    void applyBackendOperations({
      operations: [{ type: 'set_wall_side', wall: side, field, value, ...(level > 1 ? { level } : {}) }],
      promptText: `Set ${level > 1 ? 'upper ' : ''}${side} wall ${field}`,
      logPrefix: 'Wall edit',
      nextSelectedId: level > 1 ? `wall-${side}-u` : `wall-${side}`
    });
  }

  // "Assembly (all sides)" on the Walls page. This MUST be a single dispatch —
  // four separate updateWallSide calls each apply to the same stale spec, so
  // only the last (west) would survive (the "goes to West no matter what" bug).
  // One plan with four ops applies them in sequence on the backend.
  function setAllWallsAssembly(value, level = 1) {
    void applyBackendOperations({
      operations: WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'assembly', value, ...(level > 1 ? { level } : {}) })),
      promptText: `Set all ${level > 1 ? 'upper-storey ' : ''}walls to ${WALL_ASSEMBLIES[value]?.label || value}`,
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

  function updateFrame(value, level) {
    void applyBackendOperations({
      operations: [{ type: 'set_frame', value, ...(level ? { level } : {}) }],
      promptText: `Set ${level > 1 ? `storey ${level} ` : ''}frame to ${FRAME_TYPES[value]?.label || value}`,
      logPrefix: 'Frame'
    });
  }

  function updateFlooring(value) {
    void applyBackendOperations({
      operations: [{ type: 'set_flooring', value }],
      promptText: `Set flooring to ${FLOORING_TYPES[value]?.label || value}`,
      logPrefix: 'Flooring'
    });
  }

  function updateSubfloor(value) {
    void applyBackendOperations({
      operations: [{ type: 'set_flooring', field: 'subfloor', value }],
      promptText: `Set subfloor to ${SUBFLOOR_TYPES[value]?.label || value}`,
      logPrefix: 'Flooring'
    });
  }

  function updateReclaimed(system, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_reclaimed', system, value: Boolean(value) }],
      promptText: `Mark ${system} as ${value ? 'reclaimed' : 'new'}`,
      logPrefix: 'Reclaimed'
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

  // The rename box edits a LOCAL draft and commits on blur/Enter. Writing
  // spec.projectName per keystroke autosaved a revision snapshot per letter,
  // littering the designs list with "Tom's Hous"-style stubs.
  const [nameDraft, setNameDraft] = useState(null);
  function commitProjectName() {
    if (nameDraft === null) return;
    const value = nameDraft.trim();
    setNameDraft(null);
    if (!value || value === spec.projectName) return;
    updateProjectName(value);
  }

  // Selecting an object anywhere — the model, a plan, or a system-page summary
  // row — routes it to the ONE editor: the Inspector below the model. This is
  // what makes "click a thing, edit it in a single place" hold across the app.
  function selectObject(id) {
    setSelectedRoom(id);
    setInspectorView('inspect');
    // The editor lives in the Systems column — make sure it's visible when
    // something is picked from the model, the plan, or the selector chip.
    setConsoleView('systems');
    setSelMenuOpen(false);
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
    if (selectedRoom === 'frame-main') {
      if (field === 'type') {
        void applyBackendOperations({ operations: [{ type: 'set_frame', value }], promptText: `Set frame to ${FRAME_TYPES[value]?.label || value}`, logPrefix: 'Frame', nextSelectedId: 'frame-main' });
      } else if (field === 'baySpacingFt') {
        void applyBackendOperations({ operations: [{ type: 'set_frame', field: 'baySpacingFt', value: String(clamp(Number(value) || 8, 4, 16)) }], promptText: `Set frame bay spacing to ${value}'`, logPrefix: 'Frame', nextSelectedId: 'frame-main' });
      }
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
      if (field === 'wall') { updated.wall = value; updated.x = 4; updated.y = 4; }
      const operations = [{ type: 'remove_object', targetId: selectedRoom, name: opening.label }, { type: 'add_opening', wall: updated.wall, openingType: OPENING_TYPES[updated.type] ? updated.type : 'window', widthFt: updated.widthFt, positionFt: updated.wall === 'north' || updated.wall === 'south' ? updated.x : updated.y, name: updated.label }];
      void applyBackendOperations({ operations, promptText: `Update opening ${opening.label}`, logPrefix: 'Opening edit', nextSelectedId: selectedRoom });
      return;
    }
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (wall) {
      const lvl = wall.level || 1;
      if (field === 'h' && lvl === 1) updateWallSide(wall.side, 'heightFt', value);
      else if (field === 'w' && lvl > 1) {
        // An upper wall's length IS its storey extent — resize the plate
        // (N/S walls set its width, E/W its depth). No plate = the storey
        // spans the whole footprint, so length follows the shell dimension.
        const plate = upperPlateRect(spec, lvl);
        const horiz = wall.side === 'north' || wall.side === 'south';
        if (plate) {
          void applyBackendOperations({
            operations: [{ type: 'resize_object', targetId: plate.id, w: horiz ? Math.max(6, Number(value) || plate.w) : plate.w, d: horiz ? plate.d : Math.max(6, Number(value) || plate.d) }],
            promptText: `Resize the ${floorLabel(spec, lvl).toLowerCase()} to ${value}′ ${horiz ? 'wide' : 'deep'}`,
            logPrefix: 'Storey',
            nextSelectedId: selectedRoom
          });
        } else updateShell(horiz ? 'widthFt' : 'depthFt', value);
      }
      else if (field === 'w' && wall.edgeKey) {
        // An edge SEGMENT's length is its own — the jog corners slide along
        // the wall line (the whole side still comes from the shell dims).
        void applyBackendOperations({
          operations: [{ type: 'resize_wall_segment', field: wall.edgeKey, value: String(Math.max(1, Number(value) || 1)) }],
          promptText: `Set ${wall.name.toLowerCase()} to ${value}' long`,
          logPrefix: 'Footprint',
          nextSelectedId: selectedRoom
        });
      }
      else if (field === 'startFt' && wall.edgeKey) {
        void applyBackendOperations({
          operations: [{ type: 'resize_wall_segment', field: wall.edgeKey, positionFt: Math.max(0.5, Number(value) || 0.5) }],
          promptText: `Slide ${wall.name.toLowerCase()} to start at ${value}'`,
          logPrefix: 'Footprint',
          nextSelectedId: selectedRoom
        });
      }
      else if (field === 'w') updateShell(wall.side === 'north' || wall.side === 'south' ? 'widthFt' : 'depthFt', value);
      else if (field === 'thickness') updateWallSide(wall.side, 'thicknessFt', value, lvl);
      else if (field === 'assembly') updateWallSide(wall.side, 'assembly', value, lvl);
      else if (field === 'sunGlazing') updateWallSide(wall.side, 'sunGlazing', value, lvl);
      else if (field === 'sunGlazingTiltDeg') updateWallSide(wall.side, 'sunGlazingTiltDeg', value, lvl);
      else if (field === 'interiorFinish') updateWallSide(wall.side, 'interiorFinish', value, lvl);
      else if (field === 'exteriorFinish') updateWallSide(wall.side, 'exteriorFinish', value, lvl);
      return;
    }
    const object = spec.rooms.find((item) => item.id === selectedRoom) || (spec.elements || []).find((item) => item.id === selectedRoom);
    if (!object) return;
    const operations = [];
    if (field === 'x' || field === 'y') {
      operations.push({ type: 'move_object', targetId: selectedRoom, name: object.name, x: field === 'x' ? Number(value) : Number(object.x || 0), y: field === 'y' ? Number(value) : Number(object.y || 0) });
    } else if (field === 'level') {
      // Level -1 is the basement; 0 is not a floor (ops treat 0 as unset).
      const rawLevel = Math.round(Number(value) || 1);
      const nextLevel = rawLevel <= BASEMENT_LEVEL && basementInfo(spec.shell).present ? BASEMENT_LEVEL : clamp(Math.max(1, rawLevel), 1, 3);
      operations.push({ type: 'update_object', targetId: selectedRoom, name: object.name, field: 'level', value: String(nextLevel) });
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
    // 3D drags route here for EVERYTHING grabbable: openings carry their new
    // position along the wall in x; walls carry their outward offset in x.
    if (objectId.startsWith('opening-')) {
      planMoveOpening(Number(objectId.replace('opening-', '')), x);
      return;
    }
    if (objectId.startsWith('wall-')) {
      const wall = wallSections.find((item) => item.id === objectId);
      const offset = clamp(Number(x) || 0, -48, 48);
      if (!wall || !offset) return;
      void applyBackendOperations({
        operations: [wall.edgeKey
          ? { type: 'move_wall_edge', field: wall.edgeKey, value: String(offset) }
          : { type: 'move_wall_edge', wall: wall.side, value: String(offset) }],
        promptText: `Move ${wall.name.toLowerCase()} ${offset > 0 ? 'out' : 'in'} ${Math.abs(offset)}′`,
        logPrefix: 'Footprint',
        nextSelectedId: objectId
      });
      return;
    }
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
    // Fixtures land on the floor you're LOOKING AT — placing a tub while on
    // the 2nd-floor plan puts it upstairs, colliding only with what's up there.
    const lvl = activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : Math.max(1, activeFloor);
    const { baseWallFt } = storeyInfo(spec.shell);
    const basementDrop = basementInfo(spec.shell).heightFt;
    const existing = (spec.rooms || []).concat((spec.elements || []).filter((e) => e.category !== 'floor'))
      .filter((o) => Number(o.level || 1) === lvl)
      .map((o) => ({ x: Number(o.x), y: Number(o.y), w: Number(o.w), d: Number(o.d) }));
    const spot = findFreeSpot(Number(spec.shell.widthFt), Number(spec.shell.depthFt), existing, fixture.w, fixture.d)
      || { x: 2, y: 2 };
    const where = lvl > 1 ? ` on the ${floorLabel(spec, lvl).toLowerCase()}` : '';
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: fixture.category, x: spot.x, y: spot.y, z: lvl === BASEMENT_LEVEL ? -basementDrop + 0.05 : lvl > 1 ? (lvl - 1) * baseWallFt + 0.45 : 0, w: fixture.w, d: fixture.d, h: fixture.h, level: lvl, reason: 'Interior fixture placed from the plan.' }],
      promptText: `Place ${name}${where}`,
      logPrefix: 'Fixture'
    });
  }

  // One click drops partition walls on every shared room edge on the floor
  // you're looking at — a single batched dispatch, skipping covered lines.
  function drawPartitions() {
    const lvl = activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : Math.max(1, activeFloor);
    const ops = derivePartitionOps(spec, lvl);
    if (!ops.length) {
      setChatMessages((current) => [...current, { role: 'studio', speaker: 'Studio', text: 'No new interior walls to draw — every shared room edge on this floor already has a partition (or no rooms touch). Drag rooms edge-to-edge first, or add one wall by hand: “add a wall between the kitchen and the living room.”' }]);
      return;
    }
    void applyBackendOperations({
      operations: ops,
      promptText: `Draw ${ops.length} interior wall${ops.length === 1 ? '' : 's'}`,
      logPrefix: 'Partitions',
      chatText: `Drew ${ops.length} interior wall${ops.length === 1 ? '' : 's'} on shared room edges, each with a 3′ doorway. Tap one to set its construction or move its door; delete any you don't want.`
    });
  }

  // Drop an outbuilding on the site (beside the house) — a real sized element
  // you can resize/move in the plan or model and give its own construction.
  function placeOutbuilding(preset) {
    const taken = new Set((spec.elements || []).map((element) => element.name));
    let name = preset.name;
    let n = 2;
    while (taken.has(name)) { name = `${preset.name} ${n}`; n += 1; }
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: 'outbuilding', x: Number(spec.shell.widthFt) + 6, y: 3, z: 0, w: preset.w, d: preset.d, h: preset.h, construction: preset.construction, reason: 'Outbuilding placed from the Site page.' }],
      promptText: `Add ${name}`,
      logPrefix: 'Outbuilding',
      chatText: `Added a ${preset.name.toLowerCase()} on the site — drag it where you want it, and set its size and construction in the Inspector.`
    });
  }

  // Drop a foundation run near the middle of the plan — the user drags and
  // stretches it under the wall it carries (greenhouse divider, mass heater).
  function placeFoundationRun(preset) {
    const taken = new Set((spec.elements || []).map((e) => e.name));
    let name = preset.name;
    let n = 2;
    while (taken.has(name)) { name = `${preset.name} ${n}`; n += 1; }
    const x = Math.max(1, Number(spec.shell.widthFt) / 2 - preset.w / 2);
    const y = Math.max(1, Number(spec.shell.depthFt) / 2 - preset.d / 2);
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: 'foundation', construction: preset.construction, x, y, w: preset.w, d: preset.d, h: preset.h, reason: 'Foundation run under a specific wall line.' }],
      promptText: `Add ${FOUNDATION_RUN_TYPES[preset.construction].label.toLowerCase()}`,
      logPrefix: 'Foundation',
      chatText: `Dropped a ${FOUNDATION_RUN_TYPES[preset.construction].label.toLowerCase()} mid-plan — drag it under the wall it carries in the Plan view and stretch it to length. It prices by the foot on the Foundation page and in Costs.`
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
      case 'enclose-rooms': {
        // Grow the shell to take in every indoor ground room left outside the
        // walls; rooms on the negative side slide in first. ONE dispatch.
        const strays = spec.rooms.filter((room) => Number(room.level || 1) === 1 && !OUTDOOR_SPACE_TYPES.has(room.type)
          && (room.x < -0.5 || room.y < -0.5 || room.x + room.w > spec.shell.widthFt + 0.5 || room.y + room.d > spec.shell.depthFt + 0.5));
        if (!strays.length) return;
        const moveOps = strays.filter((room) => room.x < 0 || room.y < 0)
          .map((room) => ({ type: 'move_object', targetId: room.id, name: room.name, x: Math.max(0.5, room.x), y: Math.max(0.5, room.y) }));
        const needW = Math.ceil(Math.max(Number(spec.shell.widthFt), ...strays.map((room) => Math.max(0.5, room.x) + room.w + 1)));
        const needD = Math.ceil(Math.max(Number(spec.shell.depthFt), ...strays.map((room) => Math.max(0.5, room.y) + room.d + 1)));
        return void applyBackendOperations({
          operations: [
            ...moveOps,
            { type: 'set_shell', field: 'widthFt', value: String(clamp(needW, 18, 120)) },
            { type: 'set_shell', field: 'depthFt', value: String(clamp(needD, 18, 120)) }
          ],
          promptText: 'Enclose the outside rooms',
          logPrefix: 'Fix',
          chatText: `Grew the walls to ${clamp(needW, 18, 120)} × ${clamp(needD, 18, 120)} ft so every ground room is inside. The upper storey still covers only its Storey extent — resize or drag that on the 2nd-floor Plan tab, and the roof steps down over the single-storey part.`
        });
      }
      case 'give-shed-fall': {
        const hi = Math.max(7, Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10));
        return void applyBackendOperations({
          operations: [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: hi, northWallHeightFt: Math.max(2, hi - 2) }],
          promptText: 'Give the shed roof its fall',
          logPrefix: 'Fix',
          chatText: `Gave the shed a 2′ fall to the north (south eave ${hi}′, north ${Math.max(2, hi - 2)}′) — the solar-classic slope. Adjust direction and fall on the Roof page.`
        });
      }
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
      case 'add-stemwall':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'foundationType', value: 'stemwall' }, { type: 'set_utility', field: 'stemwallHeightFt', value: 1.5 }], promptText: 'Add a stem wall under the bale walls', logPrefix: 'Fix', chatText: 'Switched the foundation to a stem wall, 18″ above grade — the bales now ride clear of splash and rising damp. The Detail view shows the new joint.' });
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
      case 'set-stick-frame':
        return void applyBackendOperations({ operations: [{ type: 'set_frame', value: 'stick' }], promptText: 'Add a light stick frame', logPrefix: 'Fix', chatText: 'Added a light stick frame to carry the framed wall. Adjust it on the Frame page.' });
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

  // Slide an opening along its wall from the Plan view — one dispatch.
  function planMoveOpening(index, along) {
    const opening = spec.openings?.[index];
    if (!opening || opening.wall === 'roof') return;
    const field = opening.wall === 'north' || opening.wall === 'south' ? 'x' : 'y';
    void applyBackendOperations({
      operations: [{ type: 'update_object', targetId: `opening-${index}`, name: opening.label || '', field, value: along }],
      promptText: `Move ${opening.label || 'opening'} to ${along}′`,
      logPrefix: 'Plan edit',
      nextSelectedId: `opening-${index}`
    });
  }

  // Move one wall edge of the footprint (Plan drag or inspector) — the
  // "move a wall" primitive. One dispatch; the backend keeps rooms/openings
  // anchored and re-derives the bounding box.
  function planMoveEdge(edgeIndex, offsetFt) {
    const edge = footprintEdges(spec)[edgeIndex];
    void applyBackendOperations({
      operations: [{ type: 'move_wall_edge', field: `e${edgeIndex}`, value: String(offsetFt) }],
      promptText: `Move ${edge ? `${edge.facing} wall` : 'wall'} ${offsetFt > 0 ? 'out' : 'in'} ${Math.abs(offsetFt)}′`,
      logPrefix: 'Footprint'
    });
  }

  // Move the selected wall (inspector "Move in/out"): edge segments move by
  // edge index, plain cardinal walls by facing. One dispatch either way.
  function moveSelectedWall(offsetFt) {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    const amount = clamp(Number(offsetFt) || 0, -48, 48);
    if (!wall || !amount) return;
    void applyBackendOperations({
      operations: [wall.edgeKey
        ? { type: 'move_wall_edge', field: wall.edgeKey, value: String(amount) }
        : { type: 'move_wall_edge', wall: wall.side, value: String(amount) }],
      promptText: `Move ${wall.name.toLowerCase()} ${amount > 0 ? 'out' : 'in'} ${Math.abs(amount)}′`,
      logPrefix: 'Footprint',
      chatText: `Moved ${wall.name} ${amount > 0 ? 'outward' : 'inward'} ${Math.abs(amount)} ft. The rooms and openings stayed put; the outline re-anchored around them.`
    });
  }

  // Split the selected wall into three segments so its middle can be moved —
  // the first step of an L-shape or notch. Selection follows the middle piece.
  function splitSelectedWall() {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    const edgeRef = wall.edgeKey || null;
    const operations = [{
      type: 'split_wall_edge',
      ...(edgeRef ? { field: edgeRef } : { wall: wall.side })
    }];
    const edges = footprintEdges(spec);
    const idx = edgeRef ? Number(edgeRef.slice(1)) : (edges.find((e) => e.facing === wall.side)?.index ?? 0);
    void applyBackendOperations({
      operations,
      promptText: `Split the ${wall.name.toLowerCase()}`,
      logPrefix: 'Footprint',
      nextSelectedId: `wall-e${idx + 1}`,
      chatText: `Split ${wall.name} into three segments. Drag the middle one in the Plan view (or use Move in/out here) to shape an L or a notch.`
    });
  }

  // Resize the whole footprint by dragging its corner in the Foundation plan —
  // one dispatch for both dimensions so they don't race on a stale spec.
  function resizeShellPlan(w, d) {
    void applyBackendOperations({
      operations: [
        { type: 'set_shell', field: 'widthFt', value: String(clamp(Number(w), 12, 96)) },
        { type: 'set_shell', field: 'depthFt', value: String(clamp(Number(d), 12, 80)) }
      ],
      promptText: 'Resize footprint',
      logPrefix: 'Plan edit'
    });
  }

  function addStorey() {
    const next = Math.min(3, floorCount(spec) + 1);
    // Adds the storey AND its extent plate — the plate defines how much of the
    // footprint the storey covers. Full footprint by default; drag/resize it in
    // the Plan (on that floor) to put the storey over only one side. No stair is
    // auto-dropped (a stair depends on the layout — add it when things settle).
    const hasStair = (spec.rooms || []).concat(spec.elements || []).some((o) => /stair|ladder/i.test(o.name || ''));
    const { baseWallFt } = storeyInfo(spec.shell);
    const operations = [{ type: 'set_shell', field: 'storeys', value: String(next) }];
    if (!upperPlateRect(spec, next)) {
      operations.push({
        type: 'add_element',
        name: `Storey ${next} extent`,
        category: 'floor',
        x: 0, y: 0, z: baseWallFt * (next - 1),
        w: Number(spec.shell.widthFt), d: Number(spec.shell.depthFt), h: 0.4,
        level: next,
        reason: 'How much of the footprint this storey covers — resize it in the Plan.'
      });
    }
    void applyBackendOperations({
      operations,
      promptText: `Add a storey (now ${next})`,
      logPrefix: 'Storeys',
      chatText: `Added storey ${next} over the whole footprint — switch to its floor in the Plan and resize its extent plate to put it over only part of the building.${hasStair ? '' : ' Add a stair once the layout settles.'}`
    });
    setActiveFloor(next);
  }

  function removeStorey() {
    const current = floorCount(spec);
    if (current <= 1) return;
    const next = current - 1;
    const operations = [{ type: 'set_shell', field: 'storeys', value: String(next) }];
    // The removed level's extent plates go; rooms up there come down to ground
    // rather than vanishing — removing a storey must never delete living space.
    (spec.elements || []).filter((element) => element.category === 'floor' && Number(element.level || 1) === current)
      .forEach((plate) => operations.push({ type: 'remove_object', targetId: plate.id, name: plate.name }));
    const strandedRooms = (spec.rooms || []).filter((room) => Number(room.level || 1) === current);
    strandedRooms.forEach((room) => operations.push({ type: 'update_object', targetId: room.id, name: room.name, field: 'level', value: '1' }));
    void applyBackendOperations({
      operations,
      promptText: `Remove storey ${current}`,
      logPrefix: 'Storeys',
      chatText: `Removed storey ${current}.${strandedRooms.length ? ` ${strandedRooms.length} room${strandedRooms.length === 1 ? ' that was' : 's that were'} up there moved to the ground floor — delete or rearrange as needed.` : ''}`
    });
    setActiveFloor(Math.min(activeFloor, next));
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

  // Team = consult-only, answered by the REAL studio AI in the expert's voice.
  // It never touches the model — that hard line is what keeps Team and Design
  // from muddling. Canned local answers remain only as the offline fallback.
  async function askExpert() {
    if (!expertQuestion.trim()) return;
    const submitted = expertQuestion.trim();
    const speaker = selectedExpert ? selectedExpert.name : 'Whole Team';
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submitted }]);
    setExpertQuestion('');
    setIsPlanning(true);
    try {
      const persona = selectedExpert
        ? `You are answering as the project's ${selectedExpert.name} (${selectedExpert.concern}). Consult only — do NOT propose model operations; give practical professional guidance grounded in the current design.`
        : 'You are the whole professional council answering together. Consult only — do NOT propose model operations; give practical, multi-discipline guidance grounded in the current design.';
      const result = await requestStudioResponse({
        prompt: `${persona}\n\nQuestion: ${submitted}`,
        bim: spec,
        spec,
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submitted)
      });
      const reply = result.reply || (selectedExpert
        ? expertResponse(selectedExpert, submitted, spec, issues, selectedRoom)
        : wholeTeamResponse(submitted, spec, issues, selectedRoom));
      setChatMessages((items) => [...items, { role: 'expertMsg', speaker, text: reply }]);
    } catch (error) {
      const answer = selectedExpert
        ? expertResponse(selectedExpert, submitted, spec, issues, selectedRoom)
        : wholeTeamResponse(submitted, spec, issues, selectedRoom);
      setChatMessages((items) => [...items, { role: 'expertMsg', speaker, text: `${answer}\n\n(The AI consultant was unreachable — this is the local playbook answer.)` }]);
    } finally {
      setIsPlanning(false);
    }
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

  // Frame shop drawings: elevation views of the structure (posts/beams/braces/
  // rafters) + frame plan + member schedule, drawn from the live model.
  function exportFrameDrawings() {
    downloadFile(`frame-drawings-rev-${spec.revision}.html`, createFrameDrawingSetHtml(spec), 'text/html');
  }

  const SYSTEM_LABELS = { site: 'Site', rooms: 'Rooms', shell: 'Shell', foundation: 'Foundation', walls: 'Walls', roof: 'Roof', windows: 'Windows', heat: 'Heat', water: 'Water', waste: 'Waste', power: 'Power', outdoors: 'Outdoors' };
  const systemOfRoom = (room) => {
    const t = String(room?.type || '').toLowerCase();
    if (t === 'wet') return 'water';
    if (['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant'].includes(t)) return 'outdoors';
    return 'rooms';
  };
  const systemOfElementCategory = (cat) => {
    const map = { water: 'water', thermal: 'heat', passive: 'heat', roof: 'roof', earthwork: 'foundation', floor: 'foundation', foundation: 'foundation', structure: 'walls', wall: 'walls', partition: 'rooms', chimney: 'heat', deck: 'outdoors', landscape: 'outdoors', garden: 'outdoors', animal: 'outdoors', outbuilding: 'site', loft: 'rooms', tower: 'rooms' };
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
    <main className={chatOpen ? 'app' : 'app chatClosed'}>
      <aside className="leftPanel">
        <div className="brand">
          <div className="brandMark" aria-hidden="true"><span className="brandGable" /></div>
          <div>
            <h1>Natural Building</h1>
          </div>
          <button type="button" className="brandHelp" title="What is this? — the opening card" onClick={() => setWelcomeOpen(true)}>?</button>
        </div>

        <section className="panelBlock compact consoleSummary">
          <div className="statGrid three">
            <button type="button" title="See the full cost breakdown" onClick={() => { setAppMode('design'); setConsoleView('costs'); }}><strong>${estimatedCost.toLocaleString()}</strong><span>{derived.sweat > 0 ? `est. cost · sweat saves $${Math.round(derived.sweat / 1000)}k` : 'est. cost'}</span></button>
            <button type="button" title="Open the Rooms plan" onClick={() => { setConsoleView('systems'); setSystemView('rooms'); }}><strong>{spec.rooms.length}</strong><span>room{spec.rooms.length === 1 ? '' : 's'} · {area} sf</span></button>
            <button type="button" className={openFlagCount === 0 ? 'stateStat ok' : 'stateStat bad'} title="See the checks in Review" onClick={() => setConsoleView('review')}><strong>{openFlagCount === 0 ? 'All clear' : openFlagCount}</strong><span>{openFlagCount === 0 ? 'checks pass' : `check${openFlagCount === 1 ? '' : 's'} to fix`}</span></button>
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

        {appMode === 'design' && (() => {
          const moreShown = moreTabsOpen || consoleView === 'os' || consoleView === 'audit';
          return (
            <nav className="consoleTabs" aria-label="Project console">
              <button className={consoleView === 'systems' ? 'active' : ''} onClick={() => setConsoleView('systems')}><Grid3X3 size={14} /> Systems</button>
              <button className={consoleView === 'costs' ? 'active' : ''} onClick={() => setConsoleView('costs')}><Coins size={14} /> Costs</button>
              <button className={consoleView === 'review' ? 'active' : ''} onClick={() => setConsoleView('review')}><ShieldCheck size={14} /> Review</button>
              <button className={`moreToggle${moreShown ? ' active' : ''}`} onClick={() => setMoreTabsOpen((open) => !open)} title="More views" aria-label="More views">⋯</button>
              {moreShown && <button className={consoleView === 'os' ? 'active' : ''} onClick={() => setConsoleView('os')}><ClipboardCheck size={14} /> Project</button>}
              {moreShown && <button className={consoleView === 'audit' ? 'active' : ''} onClick={() => setConsoleView('audit')}><FileJson size={14} /> History</button>}
            </nav>
          );
        })()}


        {appMode === 'design' && consoleView === 'systems' && <section className="panelBlock consolePanel systemsPanel">
          <nav className="systemNav" aria-label="Building systems">
            {SYSTEM_GROUPS.map((group) => (
              <div className="systemNavGroup" key={group.label}>
                <div className="systemNavEyebrow">{group.label}</div>
                <div className="systemTabs">
                  {group.keys.map((key) => (
                    <button key={key} className={systemView === key ? 'active' : ''} onClick={() => setSystemView(key)} title={flaggedSystems.has(key) ? 'A council check is failing in this system' : undefined}>
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
              <div className="sectionHead">Design approach</div>
              <div className="controlGrid">
                <label>Building approach
                  <select value={spec.shell.designApproach === 'standard' ? 'standard' : 'natural'} onChange={(event) => updateShell('designApproach', event.target.value)}>
                    <option value="natural">Natural building (straw bale, cob, passive solar…)</option>
                    <option value="standard">Standard construction (conventional framing)</option>
                  </select>
                </label>
              </div>
              <p className="systemNote">{spec.shell.designApproach === 'standard'
                ? 'Standard mode: the assistant models conventional construction and the passive-solar / homestead checks stand down. Natural techniques stay available — just ask for them.'
                : 'Natural mode: the assistant prefers natural systems and the full council watches the design. Switch to Standard when modeling an existing conventional house.'}</p>

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
                  <div className="storeyControl">
                    <strong>{floorCount(spec)}</strong>
                    <button type="button" className="secondary" disabled={floorCount(spec) >= 3} title="Add a storey — it gets an extent plate you can resize in the Plan" onClick={addStorey}>+ Add</button>
                    <button type="button" className="secondary" disabled={floorCount(spec) <= 1} title="Remove the top storey — rooms up there move to the ground floor" onClick={removeStorey}>− Remove</button>
                  </div>
                </label>
              </div>
              {basementInfo(spec.shell).present && (
                <div>
                  <div className="sectionHead">Basement — its own controls</div>
                  <div className="controlGrid">
                    <label>Ceiling height (ft)<input type="number" step="0.5" min="6" max="12" value={basementInfo(spec.shell).heightFt} onChange={(event) => updateShell('basementHeightFt', event.target.value)} /></label>
                    <label className="diyToggle"><input type="checkbox" checked={spec.shell.basementHeated !== false} onChange={(event) => updateShell('basementHeated', event.target.checked)} /><span>Heated space</span></label>
                  </div>
                  <p className="systemNote">The basement spans the whole footprint (it IS the foundation) — lay out its rooms on the <b>Basement</b> Plan tab. More on the Foundation page.</p>
                </div>
              )}
              {floorCount(spec) > 1 && (
                <div>
                  <div className="sectionHead">Ground floor</div>
                  <p className="systemNote">The ground storey is the shell itself: Width / Length / Wall height above are its controls, and each side can differ on the <b>Walls</b> page.</p>
                </div>
              )}
              {(spec.elements || []).filter((el) => el.category === 'floor' && Number(el.level || 1) > 1).map((plateEl) => {
                const plateDispatch = (ops, label) => applyBackendOperations({ operations: ops, promptText: label, logPrefix: 'Storey', nextSelectedId: plateEl.id });
                const num = (v) => Number(v) || 0;
                return (
                  <div key={plateEl.id}>
                    <div className="sectionHead">{floorLabel(spec, Number(plateEl.level))} — its own size, position, and height</div>
                    <div className="controlGrid">
                      <label>Ceiling height (ft)<input type="number" step="0.5" min="6" max="14" value={storeyInfo(spec.shell).upperFt} onChange={(event) => updateShell('upperStoreyHeightFt', event.target.value)} /></label>
                      <label>From west wall (ft)<input type="number" step="0.5" value={num(plateEl.x)} onChange={(event) => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: num(event.target.value), y: num(plateEl.y) }], 'Move the upper storey')} /></label>
                      <label>From north wall (ft)<input type="number" step="0.5" value={num(plateEl.y)} onChange={(event) => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: num(plateEl.x), y: num(event.target.value) }], 'Move the upper storey')} /></label>
                      <label>Width (ft)<input type="number" step="0.5" min="6" value={num(plateEl.w)} onChange={(event) => plateDispatch([{ type: 'resize_object', targetId: plateEl.id, w: Math.max(6, num(event.target.value)), d: num(plateEl.d) }], 'Resize the upper storey')} /></label>
                      <label>Depth (ft)<input type="number" step="0.5" min="6" value={num(plateEl.d)} onChange={(event) => plateDispatch([{ type: 'resize_object', targetId: plateEl.id, w: num(plateEl.w), d: Math.max(6, num(event.target.value)) }], 'Resize the upper storey')} /></label>
                    </div>
                    <div className="storeyControl">
                      <button type="button" className="secondary" title="Cover the whole ground floor" onClick={() => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: 0.01, y: 0.01 }, { type: 'resize_object', targetId: plateEl.id, w: Number(spec.shell.widthFt), d: Number(spec.shell.depthFt) }], 'Match the storey to the ground floor')}>Match ground floor</button>
                      <button type="button" className="secondary" title="Center the storey over the plan" onClick={() => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: Math.max(0.01, (Number(spec.shell.widthFt) - num(plateEl.w)) / 2), y: Math.max(0.01, (Number(spec.shell.depthFt) - num(plateEl.d)) / 2) }], 'Center the upper storey')}>Center it</button>
                    </div>
                    <p className="systemNote">The upper storey covers only this rectangle — walls ring it and the roof steps down over the rest. Its wall construction has its own section on the <b>Walls</b> page; its frame on the <b>Frame</b> page. Also draggable on the <b>{floorLabel(spec, Number(plateEl.level))}</b> Plan tab.</p>
                  </div>
                );
              })}
              <div className="sectionHead">Footprint shape</div>
              {hasCustomFootprint(spec) ? (
                <>
                  <div className="controlGrid">
                    <label>Outline
                      <div className="mixedField"><span>{footprintPolygon(spec).length} corners · {fmtNum(Math.round(polygonArea(footprintPolygon(spec))))} sf inside {spec.shell.widthFt} × {spec.shell.depthFt} ft</span></div>
                    </label>
                    <label>Back to a rectangle
                      <button type="button" className="secondary" title="Straighten the outline back to the full bounding rectangle" onClick={() => applyBackendOperations({ operations: [{ type: 'set_footprint', value: 'rect' }], promptText: 'Reset footprint to rectangle', logPrefix: 'Footprint' })}>Reset outline</button>
                    </label>
                  </div>
                  <p className="systemNote">The plan is an L / custom shape. <b>Drag any wall edge in the Plan view</b> to move that wall; tap a wall and use <b>Split into 3</b> in the inspector to add another jog. Width/Length above scale the whole outline.</p>
                </>
              ) : (
                <p className="systemNote">The plan is a plain rectangle. To make an <b>L-shape or notch</b>: tap a wall (model, Plan, or the Walls page), press <b>Split into 3</b> in the inspector, then drag the middle segment in the Plan view — or just ask the assistant ("make this an L with a 16×13 porch notch on the southeast corner").</p>
              )}
              <p className="systemNote">Footprint: {spec.shell.widthFt} × {spec.shell.depthFt} ft = {fmtNum(Math.round(derived.floor))} sf{floorCount(spec) > 1 ? ` · ${fmtNum(derived.heatedFloor)} sf heated across ${floorCount(spec)} storeys` : ''}. Each added storey gets an <b>extent plate</b> — switch to that floor in the Plan and resize it to put the storey over only part of the building (the roof steps down over the rest). Per-wall heights and systems live on the <b>Walls</b> page; put a room upstairs by setting its Level in the inspector.</p>
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

              {spec.rooms.length > 1 && (
                <>
                  <div className="sectionHead">Interior walls</div>
                  <button className="secondary" onClick={drawPartitions}>⌗ Draw walls between rooms</button>
                  <p className="systemNote">Where two rooms share an edge, this drops a real partition wall on the line — with a 3′ doorway so the plan stays walkable. Tap a wall to change its construction (framed / cob / adobe), door width, or door position; drag it in the Plan like anything else. Chat works too: “add a cob wall between the kitchen and the living room.”</p>
                </>
              )}

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
                <p className="systemNote">While all sides share one height you can set it here; once a side differs, set its height by tapping that wall below. Width is the north/south wall length; Length is the east/west wall length.</p>

                <div className="sectionHead">{storeyInfo(spec.shell).storeys > 1 ? 'Ground storey — each side' : 'Each side'}</div>
                <p className="systemNote">Tap a wall — here or in the model — to edit that side (system, height, thickness, finishes) in the Inspector below. Toggle a side open for no wall there.</p>
                <div className="pickList">
                  {resolvedSides.map(({ side, r }) => {
                    // On a custom footprint a facing can have several segments —
                    // the row selects its longest one (each is tappable in the
                    // model/plan/chip); construction stays shared per facing.
                    const facingSections = wallSections.filter((wall) => wall.side === side && wall.level === 1);
                    const rowTarget = facingSections.length
                      ? facingSections.reduce((best, wall) => (wall.lengthFt > best.lengthFt ? wall : best)).id
                      : `wall-${side}`;
                    const rowActive = facingSections.some((wall) => wall.id === selectedRoom) || selectedRoom === `wall-${side}`;
                    return (
                      <div key={side} className={`pickRow${r.omitted ? ' muted' : ''}${rowActive ? ' active' : ''}`}>
                        <button type="button" className="pickRowMain" onClick={() => selectObject(rowTarget)} disabled={r.omitted}>
                          <strong>{WALL_SIDE_LABELS[side]}{facingSections.length > 1 ? ` (${facingSections.length} segments)` : ''}</strong>
                          <small>{r.omitted ? 'open — no wall' : `${r.assembly.label} · ${r.heightFt}′ · ${r.thicknessFt.toFixed(2)}′ · ${spec.openings.filter((opening) => opening.wall === side).length} opening(s)`}</small>
                        </button>
                        <label className="pickRowToggle" title="No wall on this side">
                          <input type="checkbox" checked={r.omitted} onChange={(event) => updateWallSide(side, 'omitted', event.target.checked)} />
                          <span>open</span>
                        </label>
                      </div>
                    );
                  })}
                </div>

                {storeyInfo(spec.shell).storeys > 1 && (() => {
                  const upperSides = WALL_SIDES.map((side) => ({ side, r: resolveWallSide(spec, side, 2) })).filter(({ r }) => !r.omitted);
                  const upperKeys = new Set(upperSides.map(({ r }) => r.assemblyKey));
                  const upperGlobal = upperKeys.size === 1 ? upperSides[0]?.r.assemblyKey : '';
                  return (
                    <>
                      <div className="sectionHead">Upper storey — each side</div>
                      <div className="controlGrid">
                        <label>Assembly (all upper sides)
                          <select value={upperGlobal} onChange={(event) => setAllWallsAssembly(event.target.value, 2)}>
                            {upperKeys.size > 1 && <option value="" disabled>Mixed — see per-side</option>}
                            {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                              <option key={assembly.key} value={assembly.key}>{assembly.label} (R≈{assembly.rValue})</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="systemNote">The upper storey can run a different construction — light straw-clay or framed infill over a cob or bale ground floor is a natural-building classic (lighter loads up high).</p>
                      <div className="pickList">
                        {upperSides.map(({ side, r }) => (
                          <div key={`u-${side}`} className={`pickRow${selectedRoom === `wall-${side}-u` ? ' active' : ''}`}>
                            <button type="button" className="pickRowMain" onClick={() => selectObject(`wall-${side}-u`)}>
                              <strong>{WALL_SIDE_LABELS[side]} (upper)</strong>
                              <small>{r.assembly.label} · {r.thicknessFt.toFixed(2)}′ thick</small>
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
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
                <label>Orientation off south (°) <em className="pitchHint">{(() => { const a = Number(siteOf(spec).azimuthDeg) || 0; return a === 0 ? 'due south' : `${Math.abs(a)}° ${a < 0 ? 'east' : 'west'} of south · ${Math.round(derived.solarFactor * 100)}% sun`; })()}</em><input type="number" step="5" min="-90" max="90" value={Number(siteOf(spec).azimuthDeg) || 0} onChange={(event) => updateSite('azimuthDeg', event.target.value)} /></label>
              </div>
              <p className="systemNote">Search by name for real coordinates and last year's actual rainfall, or fine-tune by hand. Latitude sets sun angles; rain decides whether the roof can supply water. Orientation is how far the south face is turned off true south — the further you rotate, the less winter sun your south glass gathers.</p>

              <div className="sectionHead">Topography — the lay of the land</div>
              <div className="controlGrid">
                <label>Fall across the house (ft)
                  <input type="number" step="0.5" min="0" max="60" value={Number(siteOf(spec).slopeFt) || 0} onChange={(event) => updateSite('slopeFt', event.target.value)} />
                </label>
                <label>Downhill direction
                  <select value={siteOf(spec).slopeDir || 'south'} onChange={(event) => updateSite('slopeDir', event.target.value)} disabled={!(Number(siteOf(spec).slopeFt) > 0)}>
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                  </select>
                </label>
                <label>Floor above grade, uphill (ft)
                  <input type="number" step="0.25" min="0" max="12" value={Number(siteOf(spec).gradeFt ?? 1.5)} onChange={(event) => updateSite('gradeFt', event.target.value)} />
                </label>
              </div>
              <p className="systemNote">{(Number(siteOf(spec).slopeFt) || 0) > 0
                ? <>The land falls <b>{siteOf(spec).slopeFt}′ toward the {siteOf(spec).slopeDir}</b> across the footprint — the model's terrain slopes to match and the foundation steps down to meet grade, exposing up to <b>{maxFoundationExposureFt(spec).toFixed(1)}′</b> of wall on the downhill side{maxFoundationExposureFt(spec) >= 6 ? ' (a walkout/daylight basement condition)' : ''}. Drawings and sections read this same grade line.</>
                : 'Flat site. Give it a fall in feet (from a survey, contour lines, or pacing it off) and the terrain, foundation, and future drawings will follow the real ground.'}</p>

              <div className="sectionHead">Outbuildings</div>
              <div className="roomAddGrid">
                {OUTBUILDING_PRESETS.map((preset) => (
                  <button key={preset.name} className="roomAddChip" onClick={() => placeOutbuilding(preset)}>
                    <b>{preset.name}</b>
                    <small>{preset.w} × {preset.d}′ · {OUTBUILDING_CONSTRUCTION[preset.construction]?.label}</small>
                  </button>
                ))}
              </div>
              <p className="systemNote">Drop a structure on the site — drag it where it belongs in the plan or model, and set its size + construction by tapping it. Each costs by its footprint and how it's built.</p>
              {(() => {
                const outbuildings = (spec.elements || []).filter((element) => element.category === 'outbuilding');
                if (outbuildings.length === 0) return null;
                return (
                  <div className="pickList">
                    {outbuildings.map((element) => (
                      <div className={`pickRow${selectedRoom === element.id ? ' active' : ''}`} key={element.id}>
                        <button type="button" className="pickRowMain" onClick={() => selectObject(element.id)}>
                          <strong>{element.name}</strong>
                          <small>{element.w} × {element.d}′ · {OUTBUILDING_CONSTRUCTION[element.construction]?.label || 'construction: set it'} · {fmtMoney((Number(element.w) * Number(element.d) || 0) * (OUTBUILDING_CONSTRUCTION[element.construction]?.costPsf ?? 60))}</small>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
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
                  <select value={basementInfo(spec.shell).present ? 'basement' : utilitiesOf(spec).foundationType} onChange={(event) => setFoundationChoice(event.target.value)}>
                    <option value="rubble">Rubble trench — drained gravel, low cost, low carbon</option>
                    <option value="stemwall">Stem wall — perimeter wall on footing</option>
                    <option value="slab">Insulated slab — simple, the most concrete</option>
                    <option value="basement">Basement — a full storey below grade</option>
                  </select>
                </label>
                {!basementInfo(spec.shell).present && utilitiesOf(spec).foundationType === 'stemwall' && (
                  <label>Stem wall height (ft)<input type="number" step="0.25" min="0.5" max="6" value={utilitiesOf(spec).stemwallHeightFt ?? 1.5} onChange={(event) => updateUtility('stemwallHeightFt', event.target.value)} /></label>
                )}
                <label>Insulation
                  <select value={utilitiesOf(spec).foundationInsulation || 'perimeter'} onChange={(event) => updateUtility('foundationInsulation', event.target.value)}>
                    <option value="none">None — unheated / mass-coupled</option>
                    <option value="perimeter">Perimeter — insulate the edge</option>
                    <option value="full">Full under-slab / sub-grade</option>
                  </select>
                </label>
              </div>
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyFoundation} onChange={(event) => updateUtility('diyFoundation', event.target.checked)} />
                <span>I'll dig and place it myself (sweat equity)</span>
              </label>
              <p className="systemNote">Rubble trench is the natural-building favorite: half the concrete of a slab, and the biggest single carbon saving on the whole build.</p>

              {basementInfo(spec.shell).present && (
                <>
                  <div className="sectionHead">Basement — foundation and storey in one</div>
                  <div className="controlGrid">
                    <label>Ceiling height (ft)<input type="number" step="0.5" min="6" max="12" value={basementInfo(spec.shell).heightFt} onChange={(event) => updateShell('basementHeightFt', event.target.value)} /></label>
                    <label>Finished space<input value={`${Math.round(derived.basementRoomArea)} sf of rooms`} readOnly /></label>
                  </div>
                  <label className="diyToggle">
                    <input type="checkbox" checked={spec.shell.basementHeated !== false} onChange={(event) => updateShell('basementHeated', event.target.checked)} />
                    <span>Heated (conditioned) space — basement rooms count toward heated floor area</span>
                  </label>
                  <p className="systemNote">The basement plays both roles at once: down here it's the <b>foundation</b> (these concrete walls carry the house — priced and carboned on this line), and in the plan it's a <b>storey</b> — switch the preview to the <b>Basement</b> tab to lay out rooms, and give them a stair. A basement bedroom flags for egress.{Number(siteOf(spec).slopeFt) > 0 ? ' Your site slopes — the downhill side is a natural walkout.' : ''} Switching Type above to rubble / stem wall / slab removes the basement and brings its rooms up to ground.</p>
                </>
              )}

              <div className="sectionHead">Foundation runs — under specific walls</div>
              <p className="systemNote">The perimeter above carries the outside walls. Heavy INTERIOR lines need their own strip — the wall between the house and an attached greenhouse, a mass heater, a bearing partition. Drop a run, then drag and stretch it under the wall it carries in the <b>Plan</b> view.</p>
              <div className="roomAddGrid">
                {FOUNDATION_RUN_PRESETS.map((preset) => (
                  <button key={preset.construction} className="roomAddChip" onClick={() => placeFoundationRun(preset)}>
                    <b>{FOUNDATION_RUN_TYPES[preset.construction].label}</b>
                    <small>{fmtMoney(FOUNDATION_RUN_TYPES[preset.construction].costLf + FOUNDATION_RUN_TYPES[preset.construction].stemCostLfFt * preset.h)}/ft</small>
                  </button>
                ))}
              </div>
              {(() => {
                const runs = (spec.elements || []).filter((element) => element.category === 'foundation');
                if (!runs.length) return <p className="systemNote">No runs placed yet. The greenhouse detail: a <b>trench + stem</b> run under the shared wall keeps the bales dry on the house side and gives the glazing a curb to sit on.</p>;
                return (
                  <div className="pickList">
                    {runs.map((element) => {
                      const runType = FOUNDATION_RUN_TYPES[element.construction] || FOUNDATION_RUN_TYPES.rubble;
                      const lengthFt = Math.max(Number(element.w) || 0, Number(element.d) || 0);
                      const runCost = lengthFt * (runType.costLf + runType.stemCostLfFt * (Number(element.h) || 0));
                      return (
                        <div key={element.id} className={`pickRow${selectedRoom === element.id ? ' active' : ''}`}>
                          <button type="button" className="pickRowMain" onClick={() => selectObject(element.id)}>
                            <strong>{element.name}</strong>
                            <small>{runType.label} · {lengthFt}′ long · {fmtMoney(runCost)}</small>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {systemView === 'frame' && (() => {
            const reclaimed = reclaimedOf(spec);
            const storeyN = Math.ceil(storeyInfo(spec.shell).storeys);
            const levels = Array.from({ length: storeyN }, (_, i) => i + 1);
            const savings = derived.reclaimedSavings;
            return (
              <div className="systemPage">
                <div className="sectionHead">Structural frame</div>
                {storeyN <= 1 ? (
                  <div className="controlGrid">
                    <label>Frame type
                      <select value={resolveFrameType(spec, 1)} onChange={(event) => updateFrame(event.target.value)}>
                        {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
                      </select>
                    </label>
                    {resolveFrameType(spec, 1) !== 'load-bearing' && (
                      <label>Bay spacing (ft, post to post)<input type="number" step="0.5" min="4" max="16" value={Number(spec.frame?.baySpacingFt) || 8} onChange={(event) => applyBackendOperations({ operations: [{ type: 'set_frame', field: 'baySpacingFt', value: String(clamp(Number(event.target.value) || 8, 4, 16)) }], promptText: 'Set frame bay spacing', logPrefix: 'Frame' })} /></label>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="systemNote">Each storey can frame differently — heavy timber below, light stick above, say.</p>
                    <div className="controlGrid">
                      {levels.map((lvl) => (
                        <label key={lvl}>{lvl === 1 ? 'Ground' : floorLabel(spec, lvl)} frame
                          <select value={resolveFrameType(spec, lvl)} onChange={(event) => updateFrame(event.target.value, lvl)}>
                            {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p className="systemNote">{FRAME_TYPES[resolveFrameType(spec, 1)]?.note} The frame carries the roof and floors; the <b>Walls</b> page sets what fills between it (straw bale, cob, framed insulation…).</p>

                <label className="diyToggle">
                  <input type="checkbox" checked={reclaimed.frame} onChange={(event) => updateReclaimed('frame', event.target.checked)} />
                  <span>The frame timber is reclaimed / salvaged — cuts its cost and most of its embodied carbon</span>
                </label>
                <label className="diyToggle">
                  <input type="checkbox" checked={utilitiesOf(spec).diyFrame} onChange={(event) => updateUtility('diyFrame', event.target.checked)} />
                  <span>I'll raise the frame myself (sweat equity)</span>
                </label>

                <div className="sectionHead">Where materials are reclaimed</div>
                <p className="systemNote">Mark each material system you're building from salvaged stock — it flows straight into cost and embodied carbon.</p>
                <div className="reclaimedGrid">
                  {[['frame', 'Frame timber'], ['walls', 'Wall materials'], ['flooring', 'Flooring'], ['windows', 'Windows & doors'], ['roof', 'Roofing']].map(([key, label]) => (
                    <label key={key} className={reclaimed[key] ? 'reclaimedItem on' : 'reclaimedItem'}>
                      <input type="checkbox" checked={reclaimed[key]} onChange={(event) => updateReclaimed(key, event.target.checked)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {savings.count > 0
                  ? <p className="systemNote"><b>♺ Reclaimed materials are saving</b> about {fmtMoney(savings.cost)} and {(savings.carbon / 1000).toFixed(1)} t CO₂e versus buying everything new.</p>
                  : <p className="systemNote">Nothing marked reclaimed yet. Salvaged windows, timber, and roofing are the biggest, cheapest carbon wins on a natural build.</p>}

                <div className="sectionHead">Frame drawings</div>
                <p className="systemNote">Shop-drawing sheets of THIS frame — elevation views with posts, plates, braces, and rafters called out and dimensioned, a frame plan, and a member takeoff. Print at 11×17.</p>
                <button type="button" className="secondary" onClick={exportFrameDrawings}><Ruler size={15} /> Download frame drawings</button>
              </div>
            );
          })()}

          {systemView === 'flooring' && (() => {
            const flooringKey = resolveFlooring(spec);
            const subfloorKey = resolveSubfloor(spec);
            const reclaimed = reclaimedOf(spec);
            const isSlab = utilitiesOf(spec).foundationType === 'slab';
            return (
              <div className="systemPage">
                <div className="sectionHead">Subfloor (the deck)</div>
                <div className="controlGrid">
                  <label>Subfloor
                    <select value={subfloorKey} onChange={(event) => updateSubfloor(event.target.value)}>
                      {Object.entries(SUBFLOOR_TYPES).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
                    </select>
                  </label>
                  <label>Insulation <em className="pitchHint">R-{derived.floorR}</em>
                    <select value={resolveInsulation(utilitiesOf(spec).floorInsulation, 'cellulose')} onChange={(event) => updateUtility('floorInsulation', event.target.value)}>
                      {Object.entries(INSULATION_TYPES).map(([key, ins]) => <option key={key} value={key}>{ins.label} (R≈{ins.r})</option>)}
                    </select>
                  </label>
                </div>
                <p className="systemNote">{SUBFLOOR_TYPES[subfloorKey]?.note} {isSlab ? 'Your slab foundation is its own deck.' : `Your ${utilitiesOf(spec).foundationType} foundation raises the floor, so it needs a deck`}{isSlab ? '' : ` — ${fmtMoney(derived.subfloorCost)} over ${fmtNum(derived.floor)} sf`}. Change the foundation on the Foundation page and this follows.</p>

                <div className="sectionHead">Finished floor</div>
                <div className="controlGrid">
                  <label>Floor type
                    <select value={flooringKey} onChange={(event) => updateFlooring(event.target.value)}>
                      {Object.entries(FLOORING_TYPES).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="systemNote">{FLOORING_TYPES[flooringKey]?.note} Covers the whole {fmtNum(derived.heatedFloor)} sf heated floor. Floor assembly (deck + finish): {fmtMoney(derived.cost.flooring)}. A single room can differ — set its floor by tapping it (its floor shows in the schedule).</p>
                <label className="diyToggle">
                  <input type="checkbox" checked={reclaimed.flooring} onChange={(event) => updateReclaimed('flooring', event.target.checked)} />
                  <span>The flooring is reclaimed / salvaged (reclaimed boards or tile — cuts cost and carbon)</span>
                </label>
              </div>
            );
          })()}

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
              <div className="sectionHead">Every opening</div>
              {spec.openings.length === 0 && <p className="systemNote">No windows or doors yet — add one below, or tell the assistant "add a south window 5 ft wide near the kitchen".</p>}
              {spec.openings.length > 0 && <p className="systemNote">Tap an opening — here or in the model — to edit its wall, type, width, and position in the Inspector below.</p>}
              <div className="pickList">
                {spec.openings.map((opening, index) => (
                  <div className={`pickRow${selectedRoom === `opening-${index}` ? ' active' : ''}`} key={`${opening.label || opening.type}-${index}`}>
                    <button type="button" className="pickRowMain" onClick={() => selectObject(`opening-${index}`)}>
                      <strong>{opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}`}</strong>
                      <small>{titleCase(opening.wall)} · {(OPENING_TYPES[opening.type] || OPENING_TYPES.window).label} · {opening.widthFt}′ wide</small>
                    </button>
                    <button className="ghost pickRowRemove" title="Remove opening" onClick={() => removeOpening(index)}><Trash2 size={13} /></button>
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
                <label>Panels <em className="pitchHint">{Number(utilitiesOf(spec).panelCount) > 0 ? 'manual' : `auto ≈ ${derived.panels}`}</em><input type="number" min="0" max="200" step="1" placeholder={`auto (${derived.panels})`} value={Number(utilitiesOf(spec).panelCount) || ''} onChange={(event) => updateUtility('panelCount', event.target.value || 0)} /></label>
                <label>Battery (kWh) <em className="pitchHint">{Number(utilitiesOf(spec).batteryOverrideKwh) > 0 ? 'manual' : `auto ≈ ${derived.batteryKwh}`}</em><input type="number" min="0" max="500" step="1" placeholder={`auto (${derived.batteryKwh})`} value={Number(utilitiesOf(spec).batteryOverrideKwh) || ''} onChange={(event) => updateUtility('batteryOverrideKwh', event.target.value || 0)} /></label>
              </div>
              <p className="systemNote">The well pump and an electric heater land here as loads; panels and battery are auto-sized against your roof and your site's sun — leave the fields blank for auto, or type a number to override. Roof holds ~{derived.panelRoom} panels.</p>
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
                <label>Insulation <em className="pitchHint">R-{derived.roofR}</em>
                  <select value={resolveInsulation(utilitiesOf(spec).roofInsulation, 'cellulose')} onChange={(event) => updateUtility('roofInsulation', event.target.value)}>
                    {Object.entries(INSULATION_TYPES).map(([key, ins]) => <option key={key} value={key}>{ins.label} (R≈{ins.r})</option>)}
                  </select>
                </label>
              </div>
              {spec.shell.roofType === 'shed' && (() => {
                const sH = Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10);
                const nH = Number(spec.shell.northWallHeightFt || spec.shell.wallHeightFt || 10);
                const highSide = Math.max(sH, nH);
                const fallNow = Math.round(Math.abs(sH - nH) * 2) / 2;
                const drainsNow = fallNow < 0.25 ? '' : (sH >= nH ? 'north' : 'south');
                const setShedFall = (drainTo, fallFt) => {
                  const hi = Math.max(7, highSide);
                  const lo = Math.max(2, hi - Math.max(0.5, Number(fallFt) || 2));
                  void applyBackendOperations({
                    operations: [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: drainTo === 'north' ? hi : lo, northWallHeightFt: drainTo === 'north' ? lo : hi }],
                    promptText: `Shed roof drains ${drainTo}`,
                    logPrefix: 'Roof',
                    chatText: `Set the shed to drain ${drainTo}: high wall ${hi}′ falling to ${lo}′.`
                  });
                };
                return (
                  <>
                    <div className="sectionHead">Which way the shed falls</div>
                    <div className="controlGrid">
                      <label>Drains to
                        <select value={drainsNow} onChange={(event) => setShedFall(event.target.value, Math.max(2, fallNow))}>
                          {drainsNow === '' && <option value="">Flat — pick a direction</option>}
                          <option value="north">North — high south wall (solar classic)</option>
                          <option value="south">South — high north wall</option>
                        </select>
                      </label>
                      <label>Fall, high eave to low (ft)<input type="number" step="0.5" min="0.5" max="12" value={fallNow} onChange={(event) => setShedFall(drainsNow || 'north', event.target.value)} /></label>
                    </div>
                    {drainsNow === '' && <p className="systemNote">Both eaves are level right now — this “shed” is flat and won't drain. Pick a direction (or set a fall) and the wall heights follow.</p>}
                  </>
                );
              })()}
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

        {/* The inspector docks BELOW the system page (portal target): the left
            bar reads general → specific — verdict, mode, view, navigate, design
            the system, then the selected object. Tapping anything in the model
            scrolls this into view. */}
        {appMode === 'design' && consoleView === 'systems' && <div className="inspectorDock" ref={setInspectorDock} />}

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
                  <button type="button" className="costRow" key={row.key} onClick={() => { setConsoleView('systems'); setSystemView(row.system); }}>
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
              {(() => {
                // THIS design, built the other way — same rooms, same footprint,
                // same site services; only the construction systems swap.
                const currentApproach = spec.shell.designApproach === 'standard' ? 'standard' : 'natural';
                const otherApproach = currentApproach === 'standard' ? 'natural' : 'standard';
                const altSpec = convertSpecApproach(spec, otherApproach);
                const alt = deriveDesign(altSpec, getWallSections(altSpec));
                const label = otherApproach === 'standard' ? 'standard construction' : 'natural building';
                const dCost = alt.total - derived.total;
                const dCarbon = (alt.carbonKg - derived.carbonKg) / 1000;
                const dHeat = alt.heatLoadKbtu - derived.heatLoadKbtu;
                const fmtDelta = (v, unit, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`;
                return (
                  <>
                    <div className="sectionHead">Built the other way</div>
                    <p className="systemNote">The same house — rooms, footprint, site services untouched — built as <b>{label}</b> (walls, frame, foundation, floor, insulation, and heat swapped):</p>
                    <div className="compareGrid">
                      <div className="compareCell">
                        <span>Cost</span>
                        <b>{fmtMoney(alt.total)}</b>
                        <small className={dCost > 0 ? 'worse' : 'better'}>{dCost >= 0 ? '+' : '−'}{fmtMoney(Math.abs(dCost))}</small>
                      </div>
                      <div className="compareCell">
                        <span>Embodied CO₂e</span>
                        <b>{(alt.carbonKg / 1000).toFixed(1)} t</b>
                        <small className={dCarbon > 0 ? 'worse' : 'better'}>{fmtDelta(dCarbon, ' t', 1)}</small>
                      </div>
                      <div className="compareCell">
                        <span>Heat load</span>
                        <b>{Math.round(alt.heatLoadKbtu)} kBTU/h</b>
                        <small className={dHeat > 0 ? 'worse' : 'better'}>{fmtDelta(dHeat, '', 0)}</small>
                      </div>
                      <div className="compareCell">
                        <span>Avg wall R</span>
                        <b>R-{Math.round(alt.wallR)}</b>
                        <small className={alt.wallR < derived.wallR ? 'worse' : 'better'}>{fmtDelta(alt.wallR - derived.wallR, '', 0)}</small>
                      </div>
                    </div>
                    <p className="systemNote compareFine">Directional early-design numbers, both ways. Deltas read {label} minus your current {currentApproach === 'standard' ? 'standard' : 'natural'} design. The Shell page switch changes the checks and the assistant's bias — it never rebuilds your walls; ask the assistant when you want the actual systems changed.</p>
                  </>
                );
              })()}
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
              {derived.reclaimedSavings.count > 0 && (
                <p className="systemNote">♺ Reclaimed materials are already saving about {fmtMoney(derived.reclaimedSavings.cost)} and {(derived.reclaimedSavings.carbon / 1000).toFixed(1)} t CO₂e — mark more on the Frame page.</p>
              )}
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
                        <button type="button" className="issueJump" onClick={() => { setConsoleView('systems'); setSystemView(issue.system); }}>Go to {SYSTEM_META[issue.system]?.label || issue.system}</button>
                      )}
                      {issue.fixId && FIX_LABELS[issue.fixId] && (
                        <button type="button" className="issueFix" onClick={() => fixIssue(issue)}><Wrench size={13} /> {FIX_LABELS[issue.fixId]}</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="sectionHead councilHead">Ask a professional</div>
            <div className="council">
              {council.map((expert) => {
                const Icon = expert.icon;
                return (
                  <button key={expert.id} className={`expert ${expert.status}`} onClick={() => chooseChatTarget(expert.id)} title="Aim the chat at this expert, then ask in Studio">
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
            {revisionLog.length > 0 && (
              <>
                <div className="sectionHead councilHead">Revision log</div>
                <div className="log">
                  {revisionLog.slice(0, 20).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                </div>
              </>
            )}
        </section>}

      </aside>

      <section className="workspace">
        <header className="topBar">
          <div className="projectIdentity">
            <label>
              <span>Design Name</span>
              <input
                value={nameDraft ?? spec.projectName}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitProjectName}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              />
            </label>
            <p>Revision {spec.revision} · {spec.shell.widthFt}' x {spec.shell.depthFt}' · Blender/IFC export ready</p>
            {savedAt && <p className="saveStatus">Saved in app: {savedAt}</p>}
          </div>
          <div className="exportActions">
            <button className="ghost" title="Start a new design" onClick={() => setWelcomeOpen(true)}><Plus size={16} /> New</button>
            <button className="ghost backButton" onClick={goBackRevision} disabled={history.length === 0}><Undo2 size={16} /> Undo</button>
            <button className="ghost saveButton" onClick={saveHouseState}><Save size={16} /> Save</button>
            <button className="ghost" title={chatOpen ? 'Hide the Studio chat — the model gets the room' : 'Show the Studio chat'} onClick={() => setChatOpen((open) => !open)}><Send size={16} /> {chatOpen ? 'Hide chat' : 'Chat'}</button>
            <div className="exportMenu">
              <button className="ghost" onClick={() => setExportMenuOpen((open) => !open)} title="Export the design"><Download size={16} /> Export ▾</button>
              {exportMenuOpen && (
                <div className="exportMenuPop" onMouseLeave={() => setExportMenuOpen(false)}>
                  <button onClick={() => { setExportMenuOpen(false); exportSheetSet(); }}><FileText size={15} /> Permit set (SVG sheets)</button>
                  <button title="Elevation views of the frame — posts, beams, braces, rafters — with dimensions, callouts, and a member schedule" onClick={() => { setExportMenuOpen(false); exportFrameDrawings(); }}><Ruler size={15} /> Frame drawings (SVG sheets)</button>
                  <button title="Push this design to Blender and write a validated IFC4 file" onClick={async () => { setExportMenuOpen(false); try { const r = await exportIfcViaBlender(spec); window.alert(r && r.ok ? ('IFC written: ' + r.path + ' (' + r.count + ' elements). Open it in any BIM viewer.') : ('IFC export failed: ' + ((r && r.error) || 'unknown'))); } catch (e) { window.alert('Blender backend not reachable. Start Blender 5.1 with the Dashboard add-on, then retry. (' + e.message + ')'); } }}><Box size={15} /> IFC file (Blender)</button>
                  <button title="Rebuild this design in the Blender backend (starts a headless Blender automatically if needed)" onClick={async () => { setExportMenuOpen(false); try { await pushToBlender(spec); window.alert('Synced to Blender: the model is rebuilding in the Natural Building GC backend.'); } catch (e) { window.alert('Blender sync failed: ' + e.message + ' (First start can take up to a minute — try once more.)'); } }}><RefreshCcw size={15} /> Sync to Blender</button>
                  <button onClick={() => { setExportMenuOpen(false); exportBrief(); }}><Download size={15} /> Brief (coordination summary)</button>
                  <button onClick={() => { setExportMenuOpen(false); exportJson(); }}><FileJson size={15} /> BIM JSON (model data)</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="modelShell">
          {viewMode === 'detail' ? (() => {
            // Connection details live in the preview — the drawing gets the big
            // canvas, and picking another part redraws it in place.
            const detailKind = selectedIsWall ? 'wall'
              : selectedIsRoof ? 'roof'
              : (selectedIsOpening && selected?.wall !== 'roof') ? 'opening'
              : null;
            return (
              <div className="detailStage">
                {detailKind ? (
                  <>
                    <div className="detailTitle">
                      {detailKind === 'wall' ? `${selected?.name} — connection at the foundation`
                        : detailKind === 'roof' ? 'Eave — where the roof meets the wall'
                        : `${selected?.name || 'Opening'} — how it sits in its wall`}
                    </div>
                    <JointDetail
                      spec={spec}
                      derived={derived}
                      kind={detailKind}
                      side={selectedIsWall ? selected?.side : 'south'}
                      opening={selectedIsOpening ? selected : null}
                    />
                    <p className="detailHint">Drawn from the live design — edit the fields in the left bar and the joint redraws. Pick another wall, the roof, or an opening (the chip above lists them all).</p>
                  </>
                ) : (
                  <div className="detailEmpty">Select a wall, the roof, or a window/door — its connection detail draws here at full size.</div>
                )}
              </div>
            );
          })() : viewMode === 'plan' ? (
            <PlanView
              spec={spec}
              selectedRoom={selectedRoom}
              onSelect={selectObject}
              onMove={planMoveObject}
              onResize={planResizeObject}
              onResizeShell={resizeShellPlan}
              onMoveEdge={planMoveEdge}
              onMoveOpening={planMoveOpening}
              context={consoleView === 'systems' ? systemView : null}
              activeFloor={activeFloor}
            />
          ) : (
            <ThreeScene
              spec={spec}
              selectedRoom={selectedRoom}
              layers={modelLayers}
              onSelectRoom={selectObject}
              onMoveStart={beginPlanMove}
              onMoveEnd={finishPlanMove}
              onResizeEnd={finishPlanResize}
              onDimensionPreview={setDimensionPreview}
            />
          )}
          <div className="viewModeToggle">
            <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>3D</button>
            <button className={viewMode === 'plan' ? 'active' : ''} onClick={() => setViewMode('plan')}>Plan</button>
            <button className={viewMode === 'detail' ? 'active' : ''} title="Connection details — how the selected part is built" onClick={() => setViewMode('detail')}>Detail</button>
          </div>
          {viewMode !== 'detail' && (viewMode === 'plan' || floorCount(spec) > 1 || basementInfo(spec.shell).present) && <div className="floorTabs">
            {[...(basementInfo(spec.shell).present ? [BASEMENT_LEVEL] : []), ...Array.from({ length: floorCount(spec) }, (_, i) => i + 1)].map((floor) => (
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
                  {check('explode', 'Exploded view — pull the systems apart')}
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
          {/* The selector moved into the left panel (BIM Inspector header) —
              the model stays a pure tap-to-select surface. */}
        </div>

        {inspectorDock && createPortal(<div className="lowerDeck">
          <section className="bimEditor">
            <div className="bimEditorHead">
              <div>
                <div className="sectionHead"><Grid3X3 size={17} /> BIM Inspector</div>
                <nav className="inspectorTabs" aria-label="BIM inspector">
                  <button className={inspectorView === 'inspect' ? 'active' : ''} onClick={() => setInspectorView('inspect')}>Selected</button>
                  <button className={inspectorView === 'schedule' ? 'active' : ''} onClick={() => setInspectorView('schedule')}>Schedule</button>
                  <button className={inspectorView === 'assemblies' ? 'active' : ''} onClick={() => setInspectorView('assemblies')}>Library</button>
                </nav>
              </div>
              {(() => {
                // The SELECTOR lives here in the left panel (Daniel's ask):
                // the summary is a button; tapping it lists every selectable
                // object — including ones hard to click in the model (far
                // walls, upper bands). The model itself stays tap-to-select.
                const kind = selectedIsWall ? 'Wall'
                  : selectedIsOpening ? ((OPENING_TYPES[selected?.type] || OPENING_TYPES.window).label)
                  : selectedIsRoof ? 'Roof'
                  : selectedIsPad ? 'Site pad'
                  : selectedIsGrid ? 'Reference grid'
                  : selectedIsElement ? titleCase(selected?.category || 'element')
                  : 'Room';
                const detail = selectedIsWall ? `${selected?.lengthFt || 0}′ long`
                  : selectedIsOpening ? `${selected?.widthFt || selected?.w || 0}′ wide · ${titleCase(selected?.wall || '')}`
                  : (selectedIsRoof || selectedIsGrid) ? ''
                  : `${selected?.w || 0}′ × ${selected?.d || 0}′ · ${Math.round((selected?.w || 0) * (selected?.d || 0))} sf`;
                return (
                  <div className="selChipWrap inDock">
                    <button type="button" className={`selChip${selMenuOpen ? ' open' : ''}`} title="What's selected — tap to pick anything" onClick={() => setSelMenuOpen((open) => !open)}>
                      <span className="selChipKind">{kind}</span>
                      <b>{selected?.name || '—'}</b>
                      {detail && <span className="selDetail">{detail}</span>}
                      <span className="selChipCaret">▾</span>
                    </button>
                    {selMenuOpen && (
                      <div className="selMenu" onMouseLeave={() => setSelMenuOpen(false)}>
                        {(() => {
                          // Organized BY STOREY (basement / ground / upper),
                          // then the building shell, then the site — so a
                          // 2nd-floor wall or room is found under its floor.
                          const floors = [...(basementInfo(spec.shell).present ? [BASEMENT_LEVEL] : []), ...Array.from({ length: floorCount(spec) }, (_, i) => i + 1)];
                          const siteCats = new Set(['outbuilding', 'site', 'landscape', 'garden', 'animal', 'earthwork']);
                          return [
                            ...floors.map((floor) => [
                              floor === 1 ? 'Ground floor' : floorLabel(spec, floor),
                              [
                                ...(spec.rooms || []).filter((room) => Number(room.level || 1) === floor).map((room) => ({ id: room.id, label: room.name, sub: `${room.w}×${room.d}′` })),
                                ...(spec.elements || []).filter((el) => el.category !== 'floor' && !siteCats.has(el.category) && Number(el.level || 1) === floor).map((el) => ({ id: el.id, label: el.name, sub: titleCase(el.category || '') })),
                                ...(floor > 1 ? (spec.elements || []).filter((el) => el.category === 'floor' && Number(el.level || 1) === floor).map((el) => ({ id: el.id, label: el.name || 'Storey extent', sub: `${el.w}×${el.d}′ — the storey's footprint` })) : []),
                                ...wallSections.filter((wall) => (wall.level || 1) === floor && (floor > 1 || false)).map((wall) => ({ id: wall.id, label: wall.name, sub: wall.assembly })),
                                ...(floor === 1 ? (spec.openings || []).map((opening, index) => ({ id: `opening-${index}`, label: opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}`, sub: `${opening.widthFt}′ · ${titleCase(opening.wall)}` })) : [])
                              ]
                            ]),
                            ['The building', [
                              ...wallSections.filter((wall) => (wall.level || 1) === 1).map((wall) => ({ id: wall.id, label: wall.name, sub: wall.assembly })),
                              { id: 'roof-main', label: 'Roof', sub: spec.shell.roofType || 'gable' },
                              ...(resolveFrameType(spec, 1) !== 'load-bearing' ? [{ id: 'frame-main', label: 'Frame', sub: `${FRAME_TYPES[resolveFrameType(spec, 1)]?.label || ''} · ${Number(spec.frame?.baySpacingFt) || 8}′ bays` }] : [])
                            ]],
                            ['Site & outdoors', [
                              { id: 'site-pad', label: 'Site pad', sub: '' },
                              ...(spec.elements || []).filter((el) => siteCats.has(el.category)).map((el) => ({ id: el.id, label: el.name, sub: titleCase(el.category || '') }))
                            ]]
                          ];
                        })().filter(([, items]) => items.length > 0).map(([groupLabel, items]) => (
                          <div className="selMenuGroup" key={groupLabel}>
                            <span className="selMenuEyebrow">{groupLabel}</span>
                            {items.map((item) => (
                              <button type="button" key={item.id} className={selectedRoom === item.id ? 'active' : ''} onClick={() => { selectObject(item.id); setSelMenuOpen(false); }}>
                                <span>{item.label}</span>
                                {item.sub && <small>{item.sub}</small>}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
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
                  <label>{selectedIsWall ? 'Length' : 'Width'}<input type="number" value={selectedIsWall ? selected?.lengthFt || 0 : selected?.w || 0} disabled={selectedIsRoof || selectedIsGrid} title={selected?.edgeKey ? 'Length of this segment — its jog corners slide along the wall line.' : undefined} onChange={(event) => updateSelectedRoom('w', event.target.value)} /></label>
                  {selectedIsWall && selected?.edgeKey && (() => {
                    const edge = footprintEdges(spec)[Number(String(selected.edgeKey).replace(/^e/, ''))];
                    const startAt = edge ? Math.min(edge.horizontal ? edge.x0 : edge.y0, edge.horizontal ? edge.x1 : edge.y1) : 0;
                    return <label>Starts at (ft along wall)<input type="number" step="0.5" value={startAt} onChange={(event) => updateSelectedRoom('startFt', event.target.value)} /></label>;
                  })()}
                  <label>{selectedIsWall ? 'Thickness' : 'Depth'}<input type="number" step={selectedIsWall ? 0.05 : undefined} value={selectedIsWall ? selected?.thicknessFt ?? modeledWallProfile.thicknessFt : selected?.d || 0} disabled={selectedIsOpening || selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsWall ? 'thickness' : 'd', event.target.value)} /></label>
                  {selectedIsWall && <label>System
                    <select value={selected?.assemblyKey || 'framed'} onChange={(event) => updateSelectedRoom('assembly', event.target.value)}>
                      {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                        <option key={assembly.key} value={assembly.key}>{assembly.label}</option>
                      ))}
                    </select>
                  </label>}
                  {selectedIsWall && <label>Interior finish<input type="text" value={selected?.interiorFinish || ''} onChange={(event) => updateSelectedRoom('interiorFinish', event.target.value)} /></label>}
                  {selectedIsWall && <label>Exterior finish<input type="text" value={selected?.exteriorFinish || ''} onChange={(event) => updateSelectedRoom('exteriorFinish', event.target.value)} /></label>}
                  {selectedIsWall && (selected?.level || 1) === 1 && (
                    <label>Move in/out (ft)
                      <span className="wallMoveRow">
                        <input type="number" step="0.5" value={wallMoveFt} onChange={(event) => setWallMoveFt(Number(event.target.value))} />
                        <button type="button" className="secondary" title="Negative pulls the wall inward" onClick={() => moveSelectedWall(wallMoveFt)}>Move</button>
                        <button type="button" className="secondary" title="Split this wall into three segments, then move the middle to shape an L or a notch" onClick={splitSelectedWall}>Split into 3</button>
                      </span>
                    </label>
                  )}
                  {selectedIsWall && (selected?.level || 1) === 1 && !selected?.edgeKey && (() => {
                    const rW = resolveWallSide(spec, selected.side);
                    return (
                      <label>Sun glazing above (greenhouse face)
                        <span className="wallMoveRow">
                          <input type="checkbox" checked={rW.sunGlazing} title="Angled glass from the top of this wall up to the eave, carried by the frame — drop the wall to a kneewall height first (e.g. 3')" onChange={(event) => updateSelectedRoom('sunGlazing', event.target.checked)} />
                          {rW.sunGlazing && <input type="number" step="5" min="0" max="45" title="Glazing tilt in degrees from vertical — steeper aims lower winter sun" value={rW.sunGlazingTiltDeg} onChange={(event) => updateSelectedRoom('sunGlazingTiltDeg', event.target.value)} />}
                          {rW.sunGlazing && <small>° from vertical</small>}
                        </span>
                      </label>
                    );
                  })()}
                  {!selectedIsWall && <label>{selectedIsOpening ? 'Along Wall' : 'X'}<input type="number" value={selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? selected.x : selected.y) || 0 : selected?.x || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? 'x' : 'y') : 'x', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsOpening && <label>Y<input type="number" value={selected?.y || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom('y', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsSpecial && !selectedIsElement && (storeyInfo(spec.shell).storeys > 1 || basementInfo(spec.shell).present) && <label>Level ({basementInfo(spec.shell).present ? '-1 = basement' : 'floor'})<input type="number" min={basementInfo(spec.shell).present ? -1 : 1} max={Math.ceil(storeyInfo(spec.shell).storeys)} value={Number(selected?.level || 1)} onChange={(event) => updateSelectedRoom('level', event.target.value)} /></label>}
                  {(selectedIsElement || selectedIsWall || selectedIsRoof) && <label>Height<input type="number" value={selected?.h || 1.2} disabled={selectedIsOpening || selectedIsPad || selectedIsGrid || (selectedIsWall && selected?.storey === 'upper') || (selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west'))} title={selectedIsWall && selected?.storey === 'upper' ? 'Upper wall height comes from the Storeys setting on the Shell page' : selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west') ? 'Raked wall — its ends follow the north and south walls' : undefined} onChange={(event) => updateSelectedRoom('h', event.target.value)} /></label>}
                  {selectedIsOpening && <label>Wall
                    <select value={selected?.wall || 'south'} onChange={(event) => updateSelectedRoom('wall', event.target.value)}>
                      <option value="north">North</option>
                      <option value="south">South</option>
                      <option value="east">East</option>
                      <option value="west">West</option>
                      <option value="roof">Roof</option>
                    </select>
                  </label>}
                  {selectedIsSpecial && !selectedIsPad && <label>{selectedIsRoof ? 'Roof Type' : 'Opening Type'}
                    <select value={selectedIsRoof ? (selected?.type || 'gable') : (OPENING_TYPES[selected?.type] ? selected.type : 'window')} onChange={(event) => updateSelectedRoom('type', event.target.value)}>
                      {selectedIsRoof && <option value="gable">gable</option>}
                      {selectedIsRoof && <option value="shed">shed / lean-to</option>}
                      {!selectedIsRoof && Object.entries(OPENING_TYPES).map(([key, profile]) => (
                        <option key={key} value={key}>{profile.label}</option>
                      ))}
                    </select>
                  </label>}
                  {selectedIsElement && selected?.category === 'outbuilding' && <label>Construction
                    <select value={OUTBUILDING_CONSTRUCTION[selected?.construction] ? selected.construction : 'stick'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                      {Object.entries(OUTBUILDING_CONSTRUCTION).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                    </select>
                  </label>}
                  {selectedIsElement && selected?.category === 'foundation' && <label>Construction
                    <select value={FOUNDATION_RUN_TYPES[selected?.construction] ? selected.construction : 'rubble'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                      {Object.entries(FOUNDATION_RUN_TYPES).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                    </select>
                  </label>}
                  {selectedIsElement && !['foundation', 'floor', 'partition'].includes(selected?.category) && <label>Canopy roof
                    <select value={selected?.roofType || ''} onChange={(event) => updateSelectedRoom('roofType', event.target.value)}>
                      <option value="">None (open)</option>
                      <option value="shed">Shed canopy</option>
                      <option value="gable">Gable canopy</option>
                    </select>
                  </label>}
                  {selected?.id === 'frame-main' && <>
                    <label>Frame system
                      <select value={resolveFrameType(spec, 1)} onChange={(event) => updateSelectedRoom('type', event.target.value)}>
                        {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
                      </select>
                    </label>
                    <label>Bay spacing (ft, post to post)<input type="number" step="0.5" min="4" max="16" value={Number(spec.frame?.baySpacingFt) || 8} onChange={(event) => updateSelectedRoom('baySpacingFt', event.target.value)} /></label>
                  </>}
                  {selectedIsElement && selected?.category === 'partition' && <>
                    <label>Construction
                      <select value={PARTITION_TYPES[selected?.construction] ? selected.construction : 'framed'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                        {Object.entries(PARTITION_TYPES).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
                      </select>
                    </label>
                    <label>Door width (ft, 0 = solid)<input type="number" step="0.5" min="0" max="8" value={Number(selected?.doorWFt || 0)} onChange={(event) => updateSelectedRoom('doorWFt', event.target.value)} /></label>
                    {Number(selected?.doorWFt || 0) > 0 && <label>Door position along wall (ft)<input type="number" step="0.5" min="0" value={Number(selected?.doorAtFt || 0)} onChange={(event) => updateSelectedRoom('doorAtFt', event.target.value)} /></label>}
                  </>}
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
                {(selectedIsWall || selectedIsRoof || (selectedIsOpening && selected?.wall !== 'roof')) && (
                  <button type="button" className="secondary detailJump" onClick={() => setViewMode('detail')}>
                    ⌗ Connection detail — view it in the preview
                  </button>
                )}
              </div>
            )}

            {inspectorView === 'assemblies' && (
              <div className="assembliesPane fullPane">
              <p className="studioHint">Apply a ready-made assembly to the house, or place a catalog object in the model.</p>
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

          </section>
        </div>, inspectorDock)}
      </section>

      {welcomeOpen && (
        <div className="welcomeOverlay">
          <div className={`welcomeCard${(!welcomeIsFirstRun || previousDesigns.length > 0) ? ' threeCol' : ''}`}>
            <div className="welcomeSide">
            <div className="welcomeMark" aria-hidden="true"><span className="brandGable" /></div>
            <h2>Natural Building</h2>
            <p className="welcomeIntro">A design studio for natural homes — straw bale, cob, timber — that keeps a real building model with live cost, code checks, and carbon while you work.</p>
            <div className="welcomeHow">
              <div><b>Design by system</b><span>Pick a system on the left — foundation, walls, roof, water — and set its plain numbers first.</span></div>
              <div><b>Tap anything to edit it</b><span>The model is the selector: tap a wall, room, or window (or use the chip on the preview) and its controls open on the left. 3D, Plan, and Detail are three views of the same selection.</span></div>
              <div><b>Ask for the big moves</b><span>The Studio chat adds rooms, moves walls, and consults the council. Review flags what doesn't add up — most flags have a one-tap fix.</span></div>
              <div><b>Take it to the real world</b><span>Export a permit drawing set, an IFC model for any BIM tool, or a build plan with materials.</span></div>
            </div>
            </div>
            <div className="welcomeActions">
            <div className="welcomeDivider">Start a design</div>
            <label className="welcomeName">
              <span>Name your design</span>
              <input
                type="text"
                placeholder="e.g. Cedar Hollow Homestead"
                value={welcomeName}
                onChange={(event) => setWelcomeName(event.target.value)}
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
              <label className="welcomeChoice welcomeFile">
                <b>Start from a file or drawing</b>
                <small>A sketch, photo, floor plan, or PDF — the assistant reads it and builds the model from it.</small>
                <input type="file" accept="image/*,application/pdf,.pdf,.txt,.md,.csv" onChange={(event) => { startFromFile(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            </div>
            {!welcomeIsFirstRun && (
              <div className="welcomeFoot">
                <span>Starting new replaces the design that's open now.</span>
              </div>
            )}
            </div>
            {(!welcomeIsFirstRun || previousDesigns.length > 0) && (
              <div className="welcomeResume">
                {!welcomeIsFirstRun && (
                  <>
                    <div className="welcomeDivider">or continue</div>
                    <button className="welcomeContinue" onClick={() => { setWelcomeName(''); setWelcomeOpen(false); }}>
                      <b>Continue where you left off</b>
                      <small>{spec.projectName} · revision {spec.revision}</small>
                    </button>
                  </>
                )}
                {(() => {
                  const others = previousDesigns.filter((design) => design.projectName !== spec.projectName);
                  if (!others.length) return null;
                  return (
                    <div className="welcomePrevious">
                      <div className="welcomeDivider">or open a previous design</div>
                      {others.slice(0, 5).map((design) => (
                        <button key={design.file} className="welcomePrevRow" onClick={() => restorePreviousDesign(design)}>
                          <b>{design.projectName}</b>
                          <small>rev {design.revision} · {design.shell}′ · {design.roomCount} room{design.roomCount === 1 ? '' : 's'}{design.savedAt ? ` · ${design.savedAt}` : ''}</small>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      <aside className="rightPanel">
        <section className="panelBlock consolePanel chatPanel">
          <div className="blockTitle chatTitle">
            <span><Send size={16} /> Studio</span>
            <button type="button" className="chatClose" title="Close the chat — reopen with the Chat button up top" onClick={() => setChatOpen(false)}>×</button>
          </div>
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
          {isPlanning && <div className="planningBar" aria-hidden="true"><span /></div>}
          <div className="chatStream" ref={chatStreamRef}>
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chatBubble ${message.role}`}>
                {message.image && <img src={message.image} alt="Attached design reference" />}
                {message.speaker && <b>{message.speaker}</b>}
                <span>{message.text}</span>
              </div>
            ))}
            {isPlanning && (
              <div className="chatBubble studio planningBubble">
                <b>Studio</b>
                <span><span className="planningWheel" aria-hidden="true" />{chatTarget !== 'design' ? 'Consulting the team' : attachedImages.length ? 'Reading your drawing and building the model' : 'Planning the change'}<span className="planningDots"><i>.</i><i>.</i><i>.</i></span></span>
                <small>{attachedImages.length ? 'a full drawing takeoff runs a trace, then a completeness check — up to two minutes' : 'a full drawing takeoff can take up to a minute'}</small>
              </div>
            )}
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
