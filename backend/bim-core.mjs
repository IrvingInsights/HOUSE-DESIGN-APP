const DEFAULT_SITE_PAD_EXTENSION_FT = 64;
const DEFAULT_OUTDOOR_GRID_SIZE_FT = 240;
const OUTDOOR_SPACE_TYPES = new Set(['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead']);

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function padExtension(shell = {}) {
  return Math.max(0, Number(shell.padExtensionFt ?? DEFAULT_SITE_PAD_EXTENSION_FT));
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function slugify(value) {
  return String(value || 'space').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'space';
}

function normalizeDesignLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bbederoom\b/g, 'bedroom')
    .replace(/\bbr\b/g, 'bedroom')
    .replace(/\bprimary bed\b/g, 'primary bedroom')
    .replace(/\bmaster\b/g, 'primary')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomProfile(name) {
  const text = String(name || '').toLowerCase();
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

function wallAssemblyProfile(envelopeText = '') {
  const text = String(envelopeText).toLowerCase();
  if (/straw bale|straw/.test(text)) return { key: 'straw-bale', label: 'Straw Bale Wall Assembly', thicknessFt: 1.6 };
  if (/hemp-lime|hemp/.test(text)) return { key: 'hemp-lime', label: 'Hemp-Lime Wall Assembly', thicknessFt: 1.25 };
  if (/cob/.test(text)) return { key: 'cob', label: 'Cob Thermal Wall Assembly', thicknessFt: 1.8 };
  if (/rammed earth/.test(text)) return { key: 'rammed-earth', label: 'Rammed Earth Wall Assembly', thicknessFt: 1.35 };
  if (/cordwood/.test(text)) return { key: 'cordwood', label: 'Cordwood Wall Assembly', thicknessFt: 1.25 };
  return { key: 'framed', label: 'Framed Vapor-Open Wall Assembly', thicknessFt: 0.55 };
}

// --- Per-wall assembly model (shared shape with the client in src/main.jsx) ---
export const WALL_SIDES = ['north', 'south', 'east', 'west'];

export const WALL_ASSEMBLIES = {
  'straw-bale':       { key: 'straw-bale',       label: 'Straw Bale',          thicknessFt: 1.6,  color: 0xd8bf79, rValue: 33, finish: 'lime / clay plaster' },
  'hemp-lime':        { key: 'hemp-lime',        label: 'Hemp-Lime',           thicknessFt: 1.25, color: 0xb9c49b, rValue: 22, finish: 'vapor-open plaster' },
  'cob':              { key: 'cob',              label: 'Cob',                 thicknessFt: 1.8,  color: 0xb9835e, rValue: 14, finish: 'earthen plaster' },
  'rammed-earth':     { key: 'rammed-earth',     label: 'Rammed Earth',        thicknessFt: 1.35, color: 0x9d7456, rValue: 12, finish: 'sealed / waxed earth' },
  'cordwood':         { key: 'cordwood',         label: 'Cordwood',            thicknessFt: 1.25, color: 0x9b7652, rValue: 18, finish: 'lime mortar joints' },
  'light-straw-clay': { key: 'light-straw-clay', label: 'Light Straw-Clay',    thicknessFt: 1.0,  color: 0xc6b077, rValue: 20, finish: 'clay plaster' },
  'framed':           { key: 'framed',           label: 'Framed (vapor-open)', thicknessFt: 0.55, color: 0xd9d5c8, rValue: 23, finish: 'plaster / cladding' }
};

export function wallAssemblyKeyFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/light straw|straw.?clay/.test(t)) return 'light-straw-clay';
  if (/straw bale|strawbale|straw/.test(t)) return 'straw-bale';
  if (/hemp/.test(t)) return 'hemp-lime';
  if (/cob/.test(t)) return 'cob';
  if (/rammed/.test(t)) return 'rammed-earth';
  if (/cordwood/.test(t)) return 'cordwood';
  return 'framed';
}

// Resolve the effective spec for one wall side, falling back from per-side
// override -> global shell/envelope defaults. This is the single reader the
// UI, the 3D build, the schedule, and the Blender bridge all go through.
export function resolveWallSide(spec, side) {
  const shell = spec.shell || {};
  const w = (spec.walls || {})[side] || {};
  const assemblyKey = w.assembly && WALL_ASSEMBLIES[w.assembly] ? w.assembly : wallAssemblyKeyFromText(shell && spec.systems ? spec.systems.envelope : '');
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
    x: clamp(Math.round(Number(x || 0) * 10) / 10, bounds.minX, Math.max(bounds.minX, bounds.maxX - w)),
    y: clamp(Math.round(Number(y || 0) * 10) / 10, bounds.minY, Math.max(bounds.minY, bounds.maxY - d))
  };
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

function detectIssues(spec) {
  const issues = [];
  const enclosedRooms = spec.rooms.filter((room) => room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt);
  const conditionedArea = enclosedRooms.reduce((sum, room) => sum + room.w * room.d, 0);
  const shellArea = spec.shell.widthFt * spec.shell.depthFt;

  if (conditionedArea > shellArea * 1.08) issues.push({ severity: 'critical', title: 'Room program exceeds shell area', owner: 'Architect', fix: 'Reduce room footprints or enlarge the shell before issuing drawings.' });
  if (!spec.rooms.some((room) => room.type === 'wet')) issues.push({ severity: 'critical', title: 'No wet core defined', owner: 'Engineer', fix: 'Add a bathroom/mechanical wet core and align plumbing walls.' });
  if (!spec.openings.some((item) => item.type === 'door' && item.wall === 'south')) issues.push({ severity: 'warning', title: 'Primary entry lacks clear solar-side approach', owner: 'Designer', fix: 'Add or move the main entry to a legible approach with weather protection.' });
  if (!spec.openings.some((item) => item.type === 'window' && item.wall === 'south')) issues.push({ severity: 'warning', title: 'Insufficient south-facing daylight strategy', owner: 'Permaculture', fix: 'Add balanced south glazing with summer shading and winter solar gain.' });
  if (spec.shell.wallHeightFt > 12) issues.push({ severity: 'warning', title: 'Tall walls need explicit lateral strategy', owner: 'Engineer', fix: 'Add shear wall schedule, hold-downs, and diaphragm notes.' });
  if (String(spec.systems.envelope || '').toLowerCase().includes('natural') && !String(spec.systems.envelope || '').toLowerCase().includes('rainscreen')) issues.push({ severity: 'warning', title: 'Natural wall lacks drying layer', owner: 'Natural Builder', fix: 'Include rainscreen, generous roof overhangs, and capillary breaks.' });
  if (!spec.rooms.some((room) => /mud|laundry|service/i.test(room.name))) issues.push({ severity: 'warning', title: 'Farm workflow has no dirty entry', owner: 'Homestead/Farm', fix: 'Add a mud/laundry buffer between exterior work and clean living space.' });
  if (issues.length === 0) issues.push({ severity: 'pass', title: 'Schematic passes current council checks', owner: 'Project Manager', fix: 'Ready for PE/architect review, structural sizing, jurisdictional code check, and stamped drawing development.' });
  return issues;
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
  const taken = new Set([...(spec.rooms || []).map((room) => room.id), ...(spec.elements || []).map((element) => element.id)]);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function findDesignObject(spec, targetId, name = '') {
  if (!targetId && !name) return null;
  if (String(targetId).startsWith('opening-')) {
    const openingIndex = Number(String(targetId).replace('opening-', ''));
    const opening = (spec.openings || [])[openingIndex];
    if (opening) return { ...opening, id: targetId, __kind: 'opening', __openingIndex: openingIndex, name: opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}` };
  }
  const normalizedName = normalizeDesignLabel(name);
  return (spec.rooms || []).find((room) => room.id === targetId || normalizeDesignLabel(room.name) === normalizedName || normalizeDesignLabel(room.name).includes(normalizedName))
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
  if (op.type === 'set_wall_side') return `Set ${op.wall || 'wall'} wall ${op.field || 'property'} to ${op.value}.`;
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

export function applyBimOperations(currentSpec, plan) {
  const next = structuredClone(currentSpec);
  next.rooms ||= [];
  next.elements ||= [];
  next.openings ||= [];
  next.levels ||= [{ id: 'level-1', name: 'Level 01', elevationFt: 0, heightFt: next.shell.wallHeightFt || 10 }];
  next.walls ||= {};

  const actions = [];
  const warnings = [...(plan?.warnings || [])];
  const assumptions = [...(plan?.assumptions || [])];
  const changedIds = [];
  const rejectedOperations = [];
  const operations = (plan?.operations || []).map(emptyBimOperation);

  for (const operation of operations) {
    if (operation.type === 'no_change') {
      if (operation.reason) assumptions.push(operation.reason);
      continue;
    }

    if (operation.type === 'set_shell' || operation.type === 'add_pad_extension') {
      const field = operation.field || 'padExtensionFt';
      const numeric = Number(operation.value || operation.w);
      if (field === 'widthFt') next.shell.widthFt = clamp(numeric, 18, 120);
      else if (field === 'depthFt') next.shell.depthFt = clamp(numeric, 18, 120);
      else if (field === 'wallHeightFt') {
        // Global wall height = "one height for all": reset the S/N mirrors and
        // clear any per-side height overrides so every wall follows it again.
        const h = clamp(numeric, 7, 40);
        next.shell.wallHeightFt = h;
        next.shell.southWallHeightFt = h;
        next.shell.northWallHeightFt = h;
        for (const side of WALL_SIDES) {
          if (next.walls[side]) delete next.walls[side].heightFt;
        }
      }
      else if (field === 'padExtensionFt') next.shell.padExtensionFt = clamp(numeric, 0, 240);
      else if (field === 'storeys') next.shell.storeys = clamp(numeric, 1, 3);
      else if (field === 'roofType') next.shell.roofType = String(operation.value || next.shell.roofType || 'gable');
      else if (field === 'projectName') next.projectName = String(operation.value || next.projectName || 'Untitled Natural Building Study');
      else if (field === 'sitePad') {
        const currentPad = next.shell.sitePad || { x: -padExtension(next.shell), y: -padExtension(next.shell), w: next.shell.widthFt + padExtension(next.shell) * 2, d: next.shell.depthFt + padExtension(next.shell) * 2, h: 0.45 };
        const incoming = typeof operation.value === 'string' ? JSON.parse(operation.value) : (operation.value || {});
        next.shell.sitePad = {
          x: Math.round(Number(incoming.x ?? currentPad.x) * 10) / 10,
          y: Math.round(Number(incoming.y ?? currentPad.y) * 10) / 10,
          w: Math.max(4, Math.round(Number(incoming.w ?? currentPad.w) * 10) / 10),
          d: Math.max(4, Math.round(Number(incoming.d ?? currentPad.d) * 10) / 10),
          h: Number(incoming.h ?? currentPad.h ?? 0.45)
        };
        next.shell.padExtensionFt = Math.max(
          0,
          Math.round(Math.max(
            Math.abs(next.shell.sitePad.x),
            Math.abs(next.shell.sitePad.y),
            next.shell.sitePad.x + next.shell.sitePad.w - next.shell.widthFt,
            next.shell.sitePad.y + next.shell.sitePad.d - next.shell.depthFt
          ) * 10) / 10
        );
      }
      else if (field) next.shell[field] = operation.value;
      actions.push(operationDescription(operation, next));
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

    if (operation.type === 'set_wall_side') {
      const side = WALL_SIDES.includes(operation.wall) ? operation.wall : 'south';
      const field = operation.field;
      next.walls[side] ||= {};
      if (field === 'heightFt') {
        const h = clamp(Number(operation.value), 7, 40);
        next.walls[side].heightFt = h;
        if (side === 'south') next.shell.southWallHeightFt = h;
        if (side === 'north') next.shell.northWallHeightFt = h;
        const profile = roofProfile(next.shell);
        next.shell.wallHeightFt = profile.highWallHeightFt;
        next.shell.roofPitch = Math.round(profile.pitch * 1000) / 1000;
      } else if (field === 'assembly') {
        next.walls[side].assembly = WALL_ASSEMBLIES[operation.value] ? operation.value : 'framed';
      } else if (field === 'thicknessFt') {
        next.walls[side].thicknessFt = clamp(Number(operation.value), 0.2, 3.5);
      } else if (field === 'interiorFinish' || field === 'exteriorFinish') {
        next.walls[side][field] = String(operation.value || '');
      } else if (field === 'omitted') {
        const omit = operation.value === true || operation.value === 'true' || operation.value === 1 || operation.value === '1';
        next.walls[side].omitted = omit;
        const set = new Set(next.shell.omittedWalls || []);
        if (omit) set.add(side); else set.delete(side);
        next.shell.omittedWalls = [...set];
      }
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
      const openingType = operation.openingType === 'slider' ? 'door' : operation.openingType || 'window';
      const label = operation.name || `${titleCase(wall)} ${titleCase(operation.openingType || openingType)} ${next.openings.length + 1}`;
      next.openings.push(wall === 'north' || wall === 'south'
        ? { type: openingType, wall, x: along, widthFt, label }
        : { type: openingType, wall, y: along, widthFt, label });
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
        x: 0,
        y: 0,
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
      const profile = roomProfile(operation.name || '');
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
        type: operation.category || profile.type,
        floor: profile.floor
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
      rejectedOperations.push(operation);
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
      if (target.__kind === 'opening' && operation.field) {
        const opening = next.openings[target.__openingIndex];
        if (opening) {
          if (operation.field === 'name') opening.label = operation.value;
          else opening[operation.field] = operation.value;
        }
      } else if (operation.field) target[operation.field] = operation.value;
      changedIds.push(target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    } else if (operation.type === 'remove_object') {
      if (target.__kind === 'opening') next.openings = next.openings.filter((_, index) => index !== target.__openingIndex);
      else {
        next.rooms = next.rooms.filter((room) => room.id !== target.id);
        next.elements = next.elements.filter((element) => element.id !== target.id);
      }
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
    rejectedOperations,
    source: plan?.source || 'planner',
    summary: plan?.summary || 'Structured BIM plan applied.',
    issues: detectIssues(next).filter((issue) => issue.severity !== 'pass')
  };
}
