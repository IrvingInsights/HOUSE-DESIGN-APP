import { OPENAI_IMAGE_MAX, OPENAI_PLANNER_MODEL } from './config.mjs';
import { callGemini, geminiParts, geminiSchema, hasGemini } from './gemini.mjs';
import { getCached, makeCacheKey, setCached } from './cache.mjs';
import { slugify } from './utils.mjs';

const operationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'operations', 'warnings', 'assumptions', 'questions'],
  properties: {
    summary: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'id', 'targetId', 'name', 'category', 'field', 'value', 'x', 'y', 'z', 'w', 'd', 'h', 'level', 'wall', 'openingType', 'widthFt', 'heightFt', 'positionFt', 'roofType', 'pitch', 'southWallHeightFt', 'northWallHeightFt', 'reason'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'add_room', 'add_element', 'update_object', 'move_object', 'resize_object', 'remove_object',
              'add_opening', 'set_shell', 'set_roof', 'set_assembly', 'add_level', 'no_change',
              'set_wall_height', 'set_wall_assembly', 'set_wall_segment_assembly', 'add_roof_plane',
              'set_roof_profile', 'add_opening_from_reference', 'add_site_element', 'add_pad_extension',
              'add_loft', 'add_tower', 'add_floor', 'edit_level', 'trace_image_request', 'request_clarification',
              'set_site', 'set_utility', 'set_overhang',
              'set_footprint', 'move_wall_edge', 'split_wall_edge', 'dedupe_openings',
              // Ops the prompt teaches MUST be in this enum or Gemini cannot
              // emit them — per-side walls/cladding, frame, flooring, segments
              // were being silently dropped from traces and chat plans.
              'set_wall_side', 'set_frame', 'set_reclaimed', 'set_flooring', 'resize_wall_segment'
            ]
          },
          id: { type: 'string' },
          targetId: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          field: { type: 'string' },
          value: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
          w: { type: 'number' },
          d: { type: 'number' },
          h: { type: 'number' },
          level: { type: 'number' },
          wall: { type: 'string', enum: ['', 'north', 'south', 'east', 'west', 'roof', 'all'] },
          openingType: { type: 'string', enum: ['', 'window', 'picture', 'awning', 'clerestory', 'door', 'french', 'slider', 'dutch', 'barn', 'bay', 'skylight', 'opening'] },
          widthFt: { type: 'number' },
          heightFt: { type: 'number' },
          positionFt: { type: 'number' },
          roofType: { type: 'string', enum: ['', 'gable', 'shed', 'flat', 'hip', 'green', 'reciprocal'] },
          pitch: { type: 'number' },
          southWallHeightFt: { type: 'number' },
          northWallHeightFt: { type: 'number' },
          reason: { type: 'string' }
        }
      }
    },
    warnings: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } }
  }
};

function dimensionsFromText(text, fallback = { w: 10, d: 10, h: 1.2 }) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:x|by)?\s*(\d+(?:\.\d+)?)?/i);
  if (!match) return fallback;
  return {
    w: Number(match[1]),
    d: Number(match[2]),
    h: Number(match[3] || fallback.h)
  };
}

export function localPlan(payload) {
  const prompt = String(payload.prompt || '');
  const text = prompt.toLowerCase();
  const spec = payload.spec || payload.bim || {};
  const shell = spec.shell || { widthFt: 36, depthFt: 28, wallHeightFt: 10 };
  const operations = [];
  const warnings = [];
  const assumptions = [];
  const questions = [];

  const push = (operation) => operations.push({
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
  });

  const roomByName = (label) => {
    const normalized = slugify(label).replace(/-/g, ' ');
    return (spec.rooms || []).find((room) => {
      const name = slugify(room.name || room.id).replace(/-/g, ' ');
      return name.includes(normalized) || normalized.includes(name);
    });
  };

  const directionalHeight = (directions) => {
    const directionPattern = directions.join('|');
    const afterDirection = new RegExp(`\\b(?:${directionPattern})\\b[^.;\\n]{0,80}?(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')`, 'i');
    const beforeDirection = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')[^.;\\n]{0,80}?\\b(?:${directionPattern})\\b`, 'i');
    return Number(text.match(afterDirection)?.[1] || text.match(beforeDirection)?.[1] || 0);
  };

  if (/\b(more room|larger|expand|extend|bigger)\b/.test(text) && /\b(grid|site|yard|outdoor|outside|garden|animals)\b/.test(text)) {
    push({
      type: 'set_shell',
      field: 'padExtensionFt',
      value: '64',
      reason: 'Expanded the editable site pad/grid for outdoor building and homestead elements.'
    });
  }

  if (/\b(pad|slab|site pad|grid)\b/.test(text) && /\b(select|work with|edit|resize|extend)\b/.test(text)) {
    push({
      type: 'add_pad_extension',
      field: 'padExtensionFt',
      value: String(Math.max(96, Number(shell.padExtensionFt || 64))),
      reason: 'Made the site pad/grid a larger editable BIM site object.'
    });
  }

  if (/\b(straw|strawbale|straw bale)\b/.test(text) && /\b(wall|walls|envelope|assembly|assemblies|house|all)\b/.test(text)) {
    push({
      type: 'set_assembly',
      field: 'envelope',
      value: 'straw bale wall assembly with lime/clay plaster, raised base, capillary break, rainscreen cladding, wide eaves, and engineered lateral/connection detailing',
      reason: 'Recognized whole-house straw bale wall system request.'
    });
  }

  if (/\b(timber frame|post and beam|post-and-beam)\b/.test(text)) {
    push({
      type: 'set_assembly',
      field: 'structure',
      value: 'engineered timber frame / post-and-beam structure with explicit bent layout, bracing, lateral load path, joinery schedule, and infill coordination',
      reason: 'Recognized structural system change.'
    });
  }

  const southWallHeight = directionalHeight(['south', 's']);
  const northWallHeight = directionalHeight(['north', 'n']);
  const hasOpposingWallHeights = southWallHeight > 0 && northWallHeight > 0 && /\b(wall|walls|height|tall)\b/.test(text);
  if (hasOpposingWallHeights) {
    push({
      type: 'set_roof_profile',
      roofType: 'shed',
      southWallHeightFt: southWallHeight,
      northWallHeightFt: northWallHeight,
      pitch: Math.max(0.02, Math.abs(southWallHeight - northWallHeight) / Math.max(1, Number(shell.depthFt || 28))),
      reason: 'Interpreted opposing south/north wall heights as a shed roof profile; east and west walls follow the roof slope.'
    });
  }

  const roofIsForNestedElement = /\b(tower|loft|mezzanine)\b/.test(text)
    && !/\b(?:main|whole|house|building|shell)\s+roof\b|\broof\s+(?:of|on|for)\s+(?:the\s+)?(?:main|house|building|shell)\b/.test(text);
  if (!hasOpposingWallHeights && !roofIsForNestedElement && /\b(roof|shed|lean[-\s=]*to|single slope|mono pitch|monopitch)\b/.test(text)) {
    const south = southWallHeight || 14;
    const north = northWallHeight || 10;
    push({
      type: 'set_roof_profile',
      roofType: /shed|lean|single slope|mono/.test(text) ? 'shed' : 'gable',
      southWallHeightFt: south,
      northWallHeightFt: north,
      pitch: Math.max(0.08, Math.abs(south - north) / Math.max(1, Number(shell.depthFt || 28))),
      reason: 'Recognized roof form or roof/wall height request.'
    });
  }

  const explicitDoorCommand = /\b(add|place|insert|create|put|make|resize|move|change|set)\b[^.;\n]{0,40}\b(door|doors)\b/.test(text);
  const openingIntent = (
    /\b(opening|openings|window|windows|slider|sliders)\b/.test(text)
    || explicitDoorCommand
    || payload.addToTarget === 'openings'
  );
  if (openingIntent && /\b(north|south|east|west|n|s|e|w)\b/.test(text)) {
    const wallRaw = text.match(/\b(north|south|east|west|n|s|e|w)\b/)?.[1] || '';
    const wall = { n: 'north', s: 'south', e: 'east', w: 'west' }[wallRaw] || wallRaw;
    const widthFt = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*(?:wide|window|door|slider|opening)/)?.[1] || (/door|slider/.test(text) ? 3 : 5));
    push({
      type: 'add_opening',
      wall,
      openingType: /slider/.test(text) ? 'slider' : /door/.test(text) ? 'door' : 'window',
      widthFt,
      heightFt: /door|slider/.test(text) ? 7 : 4,
      positionFt: Number(text.match(/\b(?:at|from|offset)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 0),
      reason: 'Recognized opening request with wall direction.'
    });
  } else if (openingIntent && payload.attachedImages?.length) {
    warnings.push('A drawing is attached, but local fallback cannot read symbols. The AI planner can trace images when OPENAI_API_KEY is configured.');
    questions.push('Name the wall and approximate opening locations, or configure the AI planner for vision-based tracing.');
  }

  if (/\bgarden\b/.test(text)) {
    push({ type: 'add_site_element', id: 'kitchen-garden', name: 'Kitchen Garden', category: 'garden', x: Number(shell.widthFt || 36) + 8, y: Number(shell.depthFt || 28) + 8, z: 0, w: 30, d: 24, h: 0.35, reason: 'Added a garden zone outside the house footprint.' });
  }
  if (/\b(chicken|chickens|coop)\b/.test(text)) {
    push({ type: 'add_site_element', id: 'chicken-coop-and-run', name: 'Chicken Coop and Run', category: 'animal', x: Number(shell.widthFt || 36) + 8, y: -18, z: 0, w: 18, d: 14, h: 6, reason: 'Added a chicken coop/run as an outdoor homestead element.' });
  }
  if (/\b(goat|goats)\b/.test(text)) {
    push({ type: 'add_site_element', id: 'goat-paddock', name: 'Goat Paddock', category: 'animal', x: Number(shell.widthFt || 36) + 30, y: -20, z: 0, w: 34, d: 28, h: 4, reason: 'Added a goat paddock as an outdoor homestead element.' });
  }
  if (/\bdog\s+run\b/.test(text)) {
    push({ type: 'add_site_element', id: 'dog-run-against-west-door', name: 'Dog Run Against West Door', category: 'animal', x: -16, y: Math.max(0, Number(shell.depthFt || 28) * 0.35), z: 0, w: 14, d: 18, h: 4, reason: 'Added dog run against the west side near the west door.' });
  }
  if (/\bloft|mezzanine\b/.test(text)) {
    const kitchen = roomByName('kitchen');
    const kitchenCeiling = Number(text.match(/\bkitchen\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 10);
    const loftCeiling = Number(text.match(/\bloft\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 8);
    push({
      type: 'add_loft',
      id: 'kitchen-loft',
      name: 'Kitchen Loft',
      category: 'loft',
      x: Number(kitchen?.x ?? Math.max(2, Number(shell.widthFt || 36) - 14)),
      y: Number(kitchen?.y ?? Math.max(2, Number(shell.depthFt || 28) - 12)),
      z: kitchenCeiling,
      w: Number(kitchen?.w || 14),
      d: Number(kitchen?.d || 12),
      h: loftCeiling,
      level: 2,
      reason: `Added loft above kitchen: kitchen ceiling ${kitchenCeiling}', loft ceiling ${loftCeiling}'.`
    });
  }
  if (/\btower\b/.test(text)) {
    const kitchen = roomByName('kitchen');
    const kitchenCeiling = Number(text.match(/\bkitchen\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 10);
    const loftCeiling = Number(text.match(/\bloft\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 8);
    const towerHeight = Number(text.match(/\bextra\s+(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s+above/)?.[1] || 4);
    const w = Math.min(12, Number(kitchen?.w || 12));
    const d = Math.min(12, Number(kitchen?.d || 12));
    push({
      type: 'add_tower',
      id: 'gabled-tower-above-kitchen-loft',
      name: 'Gabled Tower Above Kitchen Loft',
      category: 'tower',
      x: Number(kitchen?.x ?? 20) + Math.max(0, (Number(kitchen?.w || 14) - w) / 2),
      y: Number(kitchen?.y ?? 12) + Math.max(0, (Number(kitchen?.d || 12) - d) / 2),
      z: kitchenCeiling + loftCeiling,
      w,
      d,
      h: towerHeight,
      level: 3,
      roofType: /\bgable\b/.test(text) ? 'gable' : '',
      reason: `Added tower above loft with ${towerHeight}' extra height${/\bgable\b/.test(text) ? ' and gable roof' : ''}.`
    });
  }

  if (/\b(add|include|create|build|place|put|need|want)\b/.test(text)) {
    const dims = dimensionsFromText(text);
    const isTower = /\btower\b/.test(text);
    const isLoft = /\bloft|mezzanine\b/.test(text);
    const isFloor = /\b(second floor|third floor|upper floor|story|storey|level)\b/.test(text);
    const isOutdoor = /\b(outdoor|outside|yard|site|garden|greenhouse|porch|deck|patio|summer kitchen|cistern|food forest)\b/.test(text);
    const knownRoom = /\b(bedroom|bath|bathroom|kitchen|pantry|office|study|mud|laundry|room|space)\b/.test(text);
    if (isFloor) {
      const level = /third/.test(text) ? 3 : 2;
      push({
        type: 'add_level',
        name: level === 3 ? 'Level 03' : 'Level 02',
        level,
        h: Number(shell.wallHeightFt || 10),
        reason: 'Recognized request for an additional floor/level.'
      });
    } else if ((isLoft || isTower) && operations.some((operation) => operation.category === 'loft' || operation.category === 'tower')) {
      assumptions.push('Loft/tower request was handled as specific stacked BIM elements, so I skipped generic object creation.');
    } else if (isOutdoor && operations.some((operation) => ['garden', 'animal'].includes(operation.category))) {
      assumptions.push('Outdoor homestead elements were handled individually, so I skipped generic site object creation.');
    } else if (isLoft || isTower || isOutdoor || !knownRoom) {
      const nameMatch = prompt.match(/\b(?:add|include|create|build|place|put|need|want)\s+(?:a|an|the)?\s*([^.,;\n]+)/i);
      const rawName = (nameMatch?.[1] || 'Custom Building Element').replace(/\b(?:at|near|beside|outside|inside|with|using|as)\b.*$/i, '').trim();
      const name = isTower ? rawName || 'Tower' : isLoft ? rawName || 'Loft' : rawName || 'Custom Building Element';
      push({
        type: 'add_element',
        id: slugify(name),
        name,
        category: isTower ? 'tower' : isLoft ? 'loft' : isOutdoor ? 'site' : 'custom',
        x: isOutdoor ? Number(shell.widthFt || 36) + 3 : Math.max(2, Number(shell.widthFt || 36) - dims.w - 2),
        y: isOutdoor ? 3 : Math.max(2, Number(shell.depthFt || 28) - dims.d - 2),
        z: isLoft ? Number(shell.wallHeightFt || 10) * 0.55 : 0,
        w: dims.w,
        d: dims.d,
        h: isTower ? Math.max(18, dims.h || 22) : isLoft ? 0.8 : dims.h,
        level: isLoft ? 2 : 1,
        reason: 'Recognized add/build/place request for a BIM element.'
      });
    }
  }

  if (!operations.length) {
    push({
      type: 'no_change',
      reason: 'Local fallback could not confidently map this prompt to a BIM operation.'
    });
  }

  return {
    source: 'local-fallback',
    summary: operations.some((operation) => operation.type !== 'no_change')
      ? 'Created a structured local BIM plan from the prompt.'
      : 'No confident BIM operation found.',
    operations,
    warnings,
    assumptions,
    questions
  };
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// A takeoff of an attached drawing should be COMPLETE: real rooms AND real
// openings. gemini-flash is capable but inconsistent — on an unlucky pass it
// sets the shell and then defers the layout ("noted for future refinement",
// the phrase the mandate bans). Detect that so we can repair it.
export function traceLooksIncomplete(plan, sourceSpec) {
  const ops = plan.operations || [];
  const addRooms = ops.filter((o) => o.type === 'add_room').length;
  const addOpenings = ops.filter((o) => o.type === 'add_opening').length;
  const totalRooms = (sourceSpec.rooms || []).length + addRooms;
  const text = `${plan.summary || ''} ${(plan.assumptions || []).join(' ')} ${(plan.warnings || []).join(' ')}`;
  // A layout-scoped deferral (rooms/openings pushed to "later"), NOT a legit
  // material warning like "chimney not fully modeled".
  const deferral = /(room|layout|opening|window|door|space|floor plan)s?[^.]{0,60}(future refinement|refined later|to be (?:added|placed|detailed|refined|modeled|drawn)|not (?:yet )?(?:fully )?(?:placed|added|detailed|drawn)|placeholder|later)/i;
  const deferred = deferral.test(text);
  // A multi-storey (or basement) plan ALWAYS draws a stair — a takeoff without
  // one is missing something the drawing shows.
  const impliesUpper = ops.some((o) => o.type === 'set_shell' && o.field === 'storeys' && Number(o.value) > 1)
    || Number(sourceSpec.shell?.storeys || 1) > 1
    || ops.some((o) => o.type === 'set_shell' && o.field === 'basementHeightFt' && Number(o.value) > 0)
    || Number(sourceSpec.shell?.basementHeightFt || 0) > 0;
  const hasStair = ops.some((o) => o.type === 'add_element' && /stair/i.test(o.name || ''))
    || (sourceSpec.elements || []).some((el) => /stair/i.test(el.name || ''));
  const noStair = impliesUpper && !hasStair;
  // GARBAGE GEOMETRY: a pass that placed rooms without measuring them —
  // negative coordinates (the model's own origin, not the plan's) or many
  // rooms sharing one identical default size. The rooms exist but their
  // numbers are fiction; the repair pass must re-measure, not just add.
  const roomOps = ops.filter((o) => o.type === 'add_room');
  const negative = roomOps.some((o) => Number(o.x) < 0 || Number(o.y) < 0);
  const sizeCounts = new Map();
  roomOps.forEach((o) => {
    const key = `${Number(o.w) || 0}x${Number(o.d) || 0}`;
    sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1);
  });
  const modal = Math.max(0, ...sizeCounts.values());
  const unmeasured = roomOps.length >= 5 && modal / roomOps.length >= 0.7;
  const badGeometry = negative || unmeasured;
  return { incomplete: deferred || addOpenings === 0 || totalRooms < 2 || noStair || badGeometry, addRooms, addOpenings, totalRooms, deferred, noStair, badGeometry };
}

// Deterministic tower rescue: when a takeoff says storeys > 1 but leaves the
// tower/lookout room on the ground floor with no storey-extent plate, the
// model would grow a FULL second storey — not the drawn tower. A tower with
// a LOFT beneath it is a three-level stack: loft level 2, tower level 3 (the
// tower shaft is what gives the loft its headroom). Lift the rooms to their
// levels and give each upper storey an extent plate over its bay.
// Exported for unit tests.
export function repairTowerStorey(plan, sourceSpec) {
  const ops = plan.operations || [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const storeysOp = ops.find((o) => o.type === 'set_shell' && o.field === 'storeys' && Number(o.value) > 1);
  const storeys = storeysOp ? Number(storeysOp.value) : Number(sourceSpec?.shell?.storeys || 1);
  if (storeys < 2) return plan;
  let upperRooms = ops.filter((o) => o.type === 'add_room' && Number(o.level) >= 2);
  if (!upperRooms.length) {
    const grounded = (re) => ops.find((o) => o.type === 'add_room' && (!o.level || Number(o.level) <= 1) && re.test(o.name || ''));
    const towerRoom = grounded(/tower|lookout|crow'?s ?nest|widow'?s ?walk|studio above/i);
    const loftRoom = grounded(/\bloft\b|mezzanine/i);
    if (!towerRoom && !loftRoom) return plan;
    if (towerRoom && loftRoom && towerRoom !== loftRoom) {
      // tower over loft: a 3rd floor — the tower absorbs the loft's headroom
      loftRoom.level = 2;
      towerRoom.level = 3;
      upperRooms = [loftRoom, towerRoom];
      if (storeysOp && Number(storeysOp.value) < 3) storeysOp.value = 3;
      else if (!storeysOp && storeys < 3) plan.operations = ops.concat([{ type: 'set_shell', field: 'storeys', value: 3 }]);
      plan.warnings = [...(plan.warnings || []), `${loftRoom.name} modeled as level 2 with ${towerRoom.name} as level 3 above it.`];
    } else {
      const room = towerRoom || loftRoom;
      room.level = 2;
      upperRooms = [room];
      plan.warnings = [...(plan.warnings || []), `${room.name} modeled as the upper storey (it is drawn above the main roof).`];
    }
  }
  // Normalize plates the AI emitted itself: an extent plate without its level
  // (or elevation) is invisible to the roof/wall step logic.
  const allOps = plan.operations;
  let baseWallFt = num(sourceSpec?.shell?.wallHeightFt) || 10;
  const wallHOp = allOps.find((o) => o.type === 'set_shell' && o.field === 'wallHeightFt' && num(o.value));
  if (wallHOp) baseWallFt = num(wallHOp.value);
  for (const op of allOps) {
    if (op.type !== 'add_element') continue;
    const isPlate = op.category === 'floor' || /storey \d+ extent/i.test(op.name || '');
    if (!isPlate) continue;
    const n = (op.name || '').match(/storey (\d+)/i);
    const lvl = n ? Number(n[1]) : 2;
    if (!op.level || Number(op.level) < 2) op.level = lvl;
    if (!num(op.z)) op.z = baseWallFt * (lvl - 1);
  }
  // One extent plate per upper level, sized to that level's rooms.
  const levels = [...new Set(upperRooms.map((o) => Number(o.level)))].sort();
  const added = [];
  for (const lvl of levels) {
    const hasPlate = allOps.some((o) => o.type === 'add_element' && Number(o.level) === lvl && (o.category === 'floor' || /storey \d+ extent/i.test(o.name || '')))
      || (sourceSpec?.elements || []).some((el) => el.category === 'floor' && Number(el.level) === lvl);
    if (hasPlate) continue;
    const roomsAt = upperRooms.filter((o) => Number(o.level) === lvl);
    if (!roomsAt.length) continue;
    const minX = Math.min(...roomsAt.map((o) => num(o.x)));
    const minY = Math.min(...roomsAt.map((o) => num(o.y)));
    const maxX = Math.max(...roomsAt.map((o) => num(o.x) + Math.max(1, num(o.w))));
    const maxY = Math.max(...roomsAt.map((o) => num(o.y) + Math.max(1, num(o.d))));
    added.push({
      type: 'add_element', category: 'floor', name: `Storey ${lvl} extent`, level: lvl,
      x: minX, y: minY, w: Math.max(4, maxX - minX), d: Math.max(4, maxY - minY), h: 0.35, z: baseWallFt * (lvl - 1)
    });
  }
  if (added.length) {
    plan.operations = [...allOps, ...added];
    plan.warnings = [...(plan.warnings || []), 'Each upper storey covers only its drawn bay — the roof steps down around it.'];
  }
  return plan;
}

// Deterministic geometry rescue for fresh takeoffs — no AI, always safe:
// an unlucky pass can emit rooms in its own coordinate frame (negative x/y)
// or a shell SMALLER than the rooms it just placed (the "9x18 house with ten
// rooms" failure — every later drag then snaps back inside the tiny shell).
// Re-anchor everything to the northwest origin and grow the planned shell to
// enclose the ground-floor rooms. Exported for unit tests.
export function repairTraceGeometry(plan, sourceSpec) {
  const ops = plan.operations || [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rooms = ops.filter((o) => o.type === 'add_room');
  if (!rooms.length) return plan;
  const ground = rooms.filter((o) => !o.level || Number(o.level) <= 1);
  const scan = ground.length ? ground : rooms;
  const minX = Math.min(...scan.map((o) => num(o.x)));
  const minY = Math.min(...scan.map((o) => num(o.y)));
  const dx = minX < 0 ? -minX : 0;
  const dy = minY < 0 ? -minY : 0;
  if (dx || dy) {
    for (const op of ops) {
      if (op.type === 'add_room') {
        op.x = num(op.x) + dx;
        op.y = num(op.y) + dy;
      } else if (op.type === 'add_element' && (num(op.x) || num(op.y))) {
        // zero-filled element coords mean "unset" — only shift explicit ones
        op.x = num(op.x) + dx;
        op.y = num(op.y) + dy;
      }
    }
    plan.warnings = [...(plan.warnings || []), 'Takeoff coordinates were re-anchored to the northwest corner.'];
  }
  const extentW = Math.ceil(Math.max(...scan.map((o) => num(o.x) + Math.max(1, num(o.w)))) * 2) / 2;
  const extentD = Math.ceil(Math.max(...scan.map((o) => num(o.y) + Math.max(1, num(o.d)))) * 2) / 2;
  // What shell does the plan intend? set_shell carries w/d directly and/or
  // field widthFt/depthFt value pairs; fall back to the current model.
  let shellW = 0;
  let shellD = 0;
  for (const op of ops) {
    if (op.type !== 'set_shell') continue;
    if (num(op.w)) shellW = num(op.w);
    if (num(op.d)) shellD = num(op.d);
    if (op.field === 'widthFt' && num(op.value)) shellW = num(op.value);
    if (op.field === 'depthFt' && num(op.value)) shellD = num(op.value);
  }
  if (!shellW) shellW = num(sourceSpec?.shell?.widthFt);
  if (!shellD) shellD = num(sourceSpec?.shell?.depthFt);
  const needW = extentW > shellW ? extentW : 0;
  const needD = extentD > shellD ? extentD : 0;
  if (needW || needD) {
    let fixedInPlace = false;
    for (const op of ops) {
      if (op.type !== 'set_shell') continue;
      if (needW && (num(op.w) || op.field === 'widthFt')) { if (num(op.w)) op.w = needW; if (op.field === 'widthFt') op.value = needW; fixedInPlace = true; }
      if (needD && (num(op.d) || op.field === 'depthFt')) { if (num(op.d)) op.d = needD; if (op.field === 'depthFt') op.value = needD; fixedInPlace = true; }
    }
    // No set_shell to correct: prepend one so rooms never clamp against the
    // old, smaller shell while they're being added.
    const injected = [];
    if (!fixedInPlace) {
      if (needW) injected.push({ type: 'set_shell', field: 'widthFt', value: needW });
      if (needD) injected.push({ type: 'set_shell', field: 'depthFt', value: needD });
    }
    plan.operations = [...injected, ...ops];
    plan.warnings = [...(plan.warnings || []), `Shell grown to ${needW || shellW}x${needD || shellD} ft so it encloses every ground-floor room from the drawing.`];
  }
  return plan;
}

// Rewrite a summary that still brags about deferral so the user never sees the
// banned phrase; state the real counts instead.
export function scrubDeferralSummary(plan) {
  const ops = plan.operations || [];
  const rooms = ops.filter((o) => o.type === 'add_room').length;
  const openings = ops.filter((o) => o.type === 'add_opening').length;
  if (/future refinement|refined later|placeholder|to be (?:added|placed|detailed)/i.test(plan.summary || '')) {
    plan.summary = `Traced the drawing: ${rooms} room${rooms === 1 ? '' : 's'}, ${openings} opening${openings === 1 ? '' : 's'} placed from the plan.`;
  }
  return plan;
}

// One focused repair call: hand the model what it already produced and the
// same drawing, and ask ONLY for the rooms/openings it still owes. Merge the
// missing pieces in (dedup rooms by name). Model-agnostic — makes a flaky
// single pass reliable without a full multi-stage rework.
async function repairTraceIfNeeded(plan, { attachmentParts, sourceSpec }) {
  const check = traceLooksIncomplete(plan, sourceSpec);
  if (!check.incomplete) return scrubDeferralSummary(plan);

  const already = [
    ...(sourceSpec.rooms || []).map((r) => r.name),
    ...(plan.operations || []).filter((o) => o.type === 'add_room').map((o) => o.name)
  ].filter(Boolean);

  const repairText = {
    text: `REPAIR PASS — your previous takeoff of the attached drawing was INCOMPLETE and must be finished now.
Rooms already in the model: ${already.length ? already.join(', ') : '(none)'}.
Openings placed so far: ${check.addOpenings}.
Emit ONLY the operations still MISSING to complete the takeoff:
- one add_room for EVERY room on the floor plan(s) not already listed above (do not repeat those names); real name + x/y/w/d in feet, origin NW corner, x east, y south. Upper-floor rooms get level 2, basement rooms level -1.
- one add_opening for EVERY exterior window and door (wall north/south/east/west, openingType, widthFt, positionFt).
- if the elevations or sections show an upper floor (gable windows, a second row of windows, two levels in section), set_shell field:'storeys' value:'2'. A basement in the section = set_shell field:'basementHeightFt'.
- if the plan has two storeys or a basement and no stair exists yet, add_element named 'Stairs' (category 'structure') at its drawn plan position and size, level = the floor it climbs FROM (1 ground, -1 basement).
- interior walls drawn between rooms that are still missing: add_element category:'partition' per wall run, widthFt/positionFt for its doorway.
${check.badGeometry ? `- YOUR ROOM GEOMETRY WAS NOT MEASURED (identical default sizes and/or negative coordinates). For EVERY room already listed above, emit ONE update pass: move_object (name, x, y) + resize_object (name, w, d) with that room's REAL measured position and size from the floor plan, in feet, origin at the shell's northwest corner, all coordinates >= 0. Rooms come in different sizes — read each one off the plan.
- Also re-check the shell: set_shell w and d must be the conditioned footprint's overall dimension strings from the drawing.` : ''}
Do NOT restate the shell or footprint unless the earlier value is wrong. NEVER defer, summarize, or write "future refinement" — emit the operations. Report final counts in summary.`
  };

  const res = await callGemini({ parts: [repairText, ...attachmentParts], responseSchema: geminiSchema(operationSchema) });
  if (!res.ok) return scrubDeferralSummary(plan);
  let extra;
  try { extra = JSON.parse(res.text); } catch { return scrubDeferralSummary(plan); }
  return mergeTracePlans(plan, extra, sourceSpec, already, { allowShellDims: check.badGeometry });
}

// Merge a repair pass into the first plan: append the missing rooms/openings/
// storeys, drop repeated rooms (by name), never let the repair restate the
// shell or footprint. Pure + exported so the dedup logic is unit-tested.
export function mergeTracePlans(plan, extra, sourceSpec, alreadyNames, options = {}) {
  const already = alreadyNames || [
    ...(sourceSpec.rooms || []).map((r) => r.name),
    ...(plan.operations || []).filter((o) => o.type === 'add_room').map((o) => o.name)
  ].filter(Boolean);
  const takenNames = new Set(already.map(normName));
  // Elements dedupe by name too — otherwise both passes contribute a 'Stairs'.
  const takenElements = new Set([
    ...(plan.operations || []).filter((o) => o.type === 'add_element').map((o) => normName(o.name)),
    ...((sourceSpec?.elements || []).map((el) => normName(el.name)))
  ].filter(Boolean));
  const extraOps = (extra.operations || []).filter((op) => {
    if (op.type === 'add_room') {
      const key = normName(op.name);
      if (!key || takenNames.has(key)) return false;
      takenNames.add(key);
      return true;
    }
    if (op.type === 'add_element') {
      const key = normName(op.name);
      if (key && takenElements.has(key)) return false;
      if (key) takenElements.add(key);
      return true;
    }
    if (op.type === 'add_opening') return true;
    // re-measured geometry from a badGeometry repair rides move/resize/update
    if (op.type === 'move_object' || op.type === 'resize_object' || op.type === 'update_object') return true;
    // storeys, the basement, and the tower's storey height may always be set;
    // shell DIMS only when this repair was fixing unmeasured geometry —
    // otherwise a flaky second pass would churn a good first-pass shell.
    if (op.type === 'set_shell' && (op.field === 'storeys' || op.field === 'basementHeightFt' || op.field === 'upperStoreyHeightFt')) return true;
    if (op.type === 'set_shell' && options.allowShellDims && (op.field === 'widthFt' || op.field === 'depthFt' || Number(op.w) || Number(op.d))) return true;
    return false;
  });

  const merged = {
    ...plan,
    operations: [...(plan.operations || []), ...extraOps],
    warnings: [...new Set([...(plan.warnings || []), ...(extra.warnings || [])])],
    assumptions: [...new Set([...(plan.assumptions || []), ...(extra.assumptions || [])])]
  };
  const rooms = merged.operations.filter((o) => o.type === 'add_room').length + (sourceSpec.rooms || []).length;
  const openings = merged.operations.filter((o) => o.type === 'add_opening').length;
  merged.summary = `Traced the drawing: ${rooms} room${rooms === 1 ? '' : 's'}, ${openings} opening${openings === 1 ? '' : 's'} (completed in two passes).`;
  return merged;
}

export async function aiPlan(payload) {
  if (!hasGemini() && !process.env.OPENAI_API_KEY) return localPlan(payload);

  const cacheKey = makeCacheKey({
    kind: 'planner',
    prompt: payload.prompt,
    revision: payload?.bim?.revision || payload?.spec?.revision,
    selectedObjectId: payload.selectedObjectId,
    addToTarget: payload.addToTarget,
    imageNames: (payload.attachedImages || []).map((image) => image.name),
    shell: payload?.bim?.shell || payload?.spec?.shell
  });
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, source: `${cached.source || 'ai-planner'}-cache` };

  const sourceSpec = payload.bim || payload.spec || {};
  const compactSpec = {
    projectName: sourceSpec?.projectName,
    shell: sourceSpec?.shell,
    systems: sourceSpec?.systems,
    rooms: sourceSpec?.rooms,
    elements: sourceSpec?.elements,
    openings: sourceSpec?.openings,
    levels: sourceSpec?.levels,
    selected: payload.selected,
    selectedObjectId: payload.selectedObjectId,
    addToTarget: payload.addToTarget
  };

  const hasAttachments = (payload.attachedImages || []).length > 0;
  // The FULL takeoff mandate runs only when we're actually building the model
  // from the drawing: a mostly-empty design, or an explicit ask to (re)trace.
  // On follow-up edits the drawing is REFERENCE — re-running the takeoff on
  // every turn is what piled up duplicate windows and flip-flopped storeys.
  const existingRooms = (sourceSpec.rooms || []).length;
  const existingOpenings = (sourceSpec.openings || []).length;
  const promptText = String(payload.prompt || '');
  const asksForTrace = /\b(re-?trace|trace|take ?off|start (?:this|the|a) design from|build (?:it|this|the (?:house|model|design)) from|read the (?:drawing|plans?|pdf)|from the (?:attached|drawing|plans?|pdf)|rebuild from|match the drawings?|everything must match)\b/i.test(promptText);
  const freshTrace = hasAttachments && (asksForTrace || (existingRooms <= 1 && existingOpenings <= 2));
  const traceMandate = freshTrace ? `
A DRAWING OR DOCUMENT IS ATTACHED. Your job is a COMPLETE takeoff, not a summary:
1. set_shell from the overall plan dimensions: ONE op carrying BOTH numbers — w AND d (e.g. w:40.5, d:23, field:'', value:''). Never set only one dimension. Read dimension strings; if none, scale from a labeled element like a 3'-0" door and record that in assumptions. If the drawing shows multiple above-grade storeys, also set_shell field:'storeys'.
2. ONE add_room PER ROOM visible on the floor plan — every single one — with its real name and x/y/w/d in feet. Plan coordinates: origin at the northwest corner of the shell, x increases east, y increases south. Rooms on an upper floor get level 2 (or 3). If the CURRENT BIM STATE below already lists some rooms, KEEP them and ADD every remaining room from the drawing — never stop just because a few rooms already exist.
2b. STOREYS: count the above-grade floors from the elevations and sections. A story-and-a-half or two-storey house (windows up in the gable, a second row of windows, two occupied levels in the section) gets set_shell field:'storeys' value:'2', with the upper rooms on level 2. A basement is below grade — do NOT count it as a storey.
2c. A TOWER / lookout / studio ABOVE part of the plan (a dashed "above" rectangle on the floor plan, a small box rising past the main roof in section): model it as a PARTIAL upper storey — set_shell field:'storeys' one more than the main house, add_element category:'floor' named 'Storey 2 extent' (or 'Storey 3 extent') level:2 with the tower bay's exact x/y/w/d from the plan, and the tower's room as add_room at that level with the same footprint. A LOFT or mezzanine BENEATH the tower is its own level: loft rooms level 2, the tower room level 3, storeys 3, one extent plate per upper level over its bay (the tower shaft is what gives the loft its headroom). If the tower's own eave heights are dimensioned in section, set_shell field:'upperStoreyHeightFt' with its wall height. The main roof steps down around the tower automatically. A roof deck / perch on the lower roof cannot be modeled yet — record it in warnings so nothing is lost.
3. ONE add_opening PER WINDOW AND DOOR with wall (north/south/east/west), openingType, widthFt, and positionFt along that wall. A real floor plan ALWAYS has at least a front door plus several windows — never return zero openings.
4. Porches, decks, garages, and outbuildings: add_element with a fitting category and real dimensions. A COVERED porch/deck/carport also gets roofType 'shed' or 'gable' on the add_element so its canopy is drawn.
5. STAIRS: a plan with two storeys or a basement ALWAYS shows a stair — ONE add_element named 'Stairs' (category 'structure') at its real plan position and size, level = the floor it climbs FROM (1 for ground up, -1 for basement up). Never skip it.
6. INTERIOR WALLS: the wall lines between rooms are drawn on the plan — add_element category:'partition' for each interior wall RUN as drawn (x/y plus the run as w x d; thickness comes from construction). Where the plan shows a doorway between two rooms, put it on the partition with widthFt (door width) and positionFt (along the run) — interior doors belong to partitions, add_opening is ONLY for exterior walls. An open-concept plan legitimately has few partitions.
7. A chimney or fireplace symbol: add_element category:'chimney' at its plan position (its flue is drawn through the roof automatically).
RULES: If the plan shows 11 rooms, emit 11 add_room operations. MEASURE, never default: every room's x/y/w/d must be read from the plan — real rooms come in different sizes, so emitting many rooms with identical w x d is an ERROR, not a takeoff. All coordinates are ≥ 0 from the shell's northwest corner. The shell w x d is the CONDITIONED footprint's overall dimension strings; attached greenhouses, sunspaces, and covered outdoor areas drawn OUTSIDE the conditioned line are add_element items, NOT part of the shell. NEVER write "noted for future refinement" or defer anything — emit the operation instead. BASEMENTS ARE MODELED: a below-grade storey = set_shell field:'basementHeightFt' value:'8' (read the real height from the section if drawn) plus ONE add_room with level:-1 per basement room. A basement still does NOT count toward field:'storeys' (that's above-grade only). In the summary, report counts: "Traced: shell WxD, N rooms, M openings." If a page is illegible, say which page in warnings and keep going with the rest.
MODEL WHAT THE DRAWING SHOWS — many documents are EXISTING conventional houses being modified, not natural builds. A framed house gets framed walls (set_wall_side field=assembly value=framed, or set_assembly), a slab stays a slab (set_utility foundationType), standard storeys stay standard, AND emit set_shell field:'designApproach' value:'standard' so the app's natural-building checks stand down for this design. Do NOT convert the building to natural systems unless the user asks. Mine EVERY page for usable data: dimension strings, room and door/window schedules, elevation heights (wall heights, storeys), roof type and pitch, site plans (lot, setbacks, orientation -> set_site), and existing-condition notes (put constraints the model can't express into warnings/assumptions so nothing is lost).
` : '';

  // Follow-up turns with a drawing attached: the drawing is a REFERENCE for
  // the requested edit, not a takeoff order. Change ONLY what the user asks.
  // Re-sending an 11-page PDF on every reference turn cost 2-3 minutes per
  // reply, so the file only rides along when the turn actually needs eyes on
  // it: a fresh trace, or a prompt that talks about the drawing itself.
  const mentionsDrawing = /\b(drawings?|pdf|plans?|sheets?|pages?|elevations?|sections?|blueprints?|documents?|attach(?:ed|ment)?|images?|photos?|schedules?)\b/i.test(promptText);
  const sendAttachments = hasAttachments && (freshTrace || mentionsDrawing);
  const referenceNote = sendAttachments && !freshTrace ? `
THE ATTACHED DRAWING IS REFERENCE MATERIAL — the model is ALREADY BUILT (state below). Do NOT re-trace it.
- Make ONLY the specific change the user asks for. Do NOT re-add rooms or openings that already exist in the state.
- To fix something, prefer update_object / move_object / resize_object / remove_object on existing ids over adding new objects.
- To clean duplicate or overlapping windows/doors, emit dedupe_openings (optionally with wall) — do not enumerate removals one by one.
- If the user asks whether the model matches the drawing, answer via a no_change op with the comparison in its reason, plus at most the few ops that fix real mismatches.
` : '';

  // The build approach is the USER'S choice: natural techniques are available,
  // never enforced. A conventional as-built stays conventional.
  const approach = String(sourceSpec?.shell?.designApproach || 'natural');
  const approachNote = approach === 'standard'
    ? `DESIGN APPROACH: STANDARD/CONVENTIONAL construction. Do not introduce natural-building systems (straw bale, cob, rocket mass heaters, composting toilets, off-grid) unless the user explicitly asks. Use framed walls, standard foundations, and conventional assumptions.`
    : `DESIGN APPROACH: natural building preferred, but it is a preference, not a rule — when tracing an existing/conventional drawing or when the user asks for standard construction, model it conventionally.`;

  const content = [
    {
      type: 'input_text',
      text: `You are the BIM planning brain for a home design studio. You know ALL building styles and techniques — conventional stick framing, timber framing, masonry, AND natural building.
Return only structured operations. Do not invent dimensions from drawings unless visible and reasonably inferable.
${approachNote}
${traceMandate}${referenceNote}
Prefer real model changes over prose. If the user asks for floors, lofts, towers, site objects, unusual natural-building forms, or arbitrary elements, create add_level or add_element operations. A covered porch, veranda, or carport is add_element with roofType 'shed' or 'gable' (its canopy renders on posts); to cover an EXISTING element use update_object with field 'roofType'.
THE SHELL ENCLOSES THE WHOLE GROUND FLOOR: every indoor level-1 room must lie inside set_shell w x d (or the footprint outline). A two-storey CORE over a larger ground floor is NOT a small shell with rooms outside it — the shell covers the FULL ground floor, and the storey-2 extent plate (the 'floor'-category element addStorey creates, level 2) is resized/positioned over just the core with resize_object/move_object; the roof steps down over the single-storey part automatically.
Stacking: for localized requests like "a loft above the kitchen" or "a tower above that", look up the base room's x/y/w/d in the BIM state and REUSE that footprint. Use add_loft (category loft) or add_tower (category tower) as VOLUMES: set z to the top of whatever it sits on (ground rooms top out at shell.wallHeightFt; a stacked element's top is its z + h) and give a real h (a loft 7-8 ft, a tower room 8-10 ft per storey). Chain them: the second element's z = the first element's z + its h. Reserve add_level for a full new storey across the whole footprint.
For wall system changes, use set_assembly. Per-side wall systems use set_wall_side with wall and field 'assembly'; assembly values include straw-bale, hemp-lime, cob, rammed-earth, cordwood, light-straw-clay, framed, sips (fast standard panel), ply-insulated (marine ply + rigid insulation — light and quick for upper storeys), icf, and glazed — 'glazed' is a GLASS WALL (a whole face of glazing, e.g. an attached greenhouse or sunspace south face), not windows in a wall.
EXTERIOR CLADDING: set_wall_side field 'cladding' with render (plaster, the default) | lap (wood lap siding) | boardbatten | shingle (cedar) | metal (standing seam) | stucco | stone | brick — per wall side, priced per face sf and drawn with its own material.
ATTACHED SOLAR GREENHOUSE FACE (kneewall + angled glazing): per-side heights go down to 2' — set_wall_side field 'heightFt' value 3 makes a bale kneewall; then set_wall_side field 'sunGlazing' value 'true' (+ optional field 'sunGlazingTiltDeg', 0-45 from vertical, default 30) draws angled glazing from the kneewall top to the eave, carried by the structural frame and counted in solar gain.
WALL SEGMENTS: on a custom outline, resize_wall_segment with field 'e<index>' sets one segment's length (value, ft) and/or its start along the wall (positionFt, ft; 0 = keep). The jog corners slide with it.
FRAME: set_frame value = load-bearing | timber | post-beam | stick | double-stud | pole (optional level for upper storeys); set_frame field 'baySpacingFt' value = post spacing in feet (4-16). The frame renders as posts + plates and is selectable in the model.
For roofs, use set_roof. For openings, use add_opening with wall/type/width/position; openingType may be window, picture, awning, clerestory, door, french (french doors), slider, dutch, barn, bay (bay window), or skylight (wall "roof", place with x and y plan coordinates).
For water/waste/power/heat choices use set_utility with field one of waterSource (well|spring|catchment|town), wasteMethod (septic|composting|reedbed), powerMode (offgrid|hybrid|gridtie), heatSource (rocket_mass|masonry|wood_stove|minisplit), foundationType (rubble|stemwall|slab), tankGal, wellSepticFt, stemwallHeightFt (feet, for stem wall foundations), diyWalls/diyRoof/diyHeat/diyFoundation. For location use set_site with field zip, latitudeDeg, or rainInYr. For TOPOGRAPHY (sloped sites — read contour lines / spot elevations on a site plan or survey): set_site field:'slopeFt' value = total fall in feet across the building footprint, field:'slopeDir' value = downhill direction (north|south|east|west), field:'gradeFt' value = feet the finish floor sits above grade at the uphill side. A steep fall exposes the downhill foundation as a walkout basement — model it, don't flatten the site.
For roof overhangs use set_overhang with wall (north|south|east|west|all) and value in feet.
SHED DRAINAGE: a shed roof drains toward its LOW eave — set_roof_profile roofType 'shed' with DIFFERENT southWallHeightFt/northWallHeightFt (high south draining north is the solar classic). Equal heights = a flat roof that won't drain; never emit that.
PER-STOREY HEIGHTS: set_shell field 'wallHeightFt' is the GROUND storey; set_shell field 'upperStoreyHeightFt' (6-14 ft) gives upper storeys their own height (e.g. a 10' ground floor under an 8' second storey).
BASEMENT: one of the four foundation choices AND a storey at once. Create it with set_shell field:'basementHeightFt' value in feet (6-12; value 0 removes it) — set_utility foundationType 'basement' also works. Basement rooms are add_room with level:-1 (never level 0). set_shell field:'basementHeated' value 'true'|'false' says whether it is conditioned space (counts toward heated floor area). On a sloped site the downhill wall becomes a walkout automatically. A basement does not count toward storeys.
INTERIOR WALLS: a wall BETWEEN rooms = add_element category:'partition' with x/y and the wall run as w×d (the long side is the run; thickness comes from construction: framed | cob | adobe). A doorway in it: widthFt = door width (0 = solid wall) and positionFt = distance along the run. Example — a 12' framed partition running east-west at x:10,y:14 with a 3' door 4' in: add_element category:'partition' x:10 y:14 w:12 d:0.45 widthFt:3 positionFt:4.
FOUNDATION RUNS: a strip of foundation under a SPECIFIC line (a load-bearing interior wall, the wall between the house and an attached greenhouse, a mass heater) = add_element with category 'foundation', construction one of rubble | rubble-stem (trench + stem wall, the natural detail) | stemwall | thickened (grade beam), x/y/w/d as the strip's plan rectangle in feet (length along w or d), h = stem height above floor. The perimeter foundation stays a separate global choice (set_utility foundationType).
FOOTPRINT SHAPE: the building outline may be a rectilinear polygon (shell.footprint = ordered [x,y] corners in feet, axis-aligned edges; absent = plain widthFt x depthFt rectangle). To move a whole wall in/out use move_wall_edge with wall (north|south|east|west) or field "e<index>" for a specific polygon edge, and value = offset in feet (positive = outward). To make an L-shape or notch, use split_wall_edge (wall or field "e<index>"; optional x/y = split points in feet along the wall; optional value = feet to push the middle segment, negative = inward notch). For a whole custom outline (L, T, U) emit set_footprint with value = JSON string of the corner list, e.g. "[[0,0],[40,0],[40,15],[24,15],[24,28],[0,28]]". If a traced drawing shows a non-rectangular plan, emit set_footprint from its outline INSTEAD of a plain set_shell (still list every room and opening).
Validate basic constructability and put concerns in warnings, not as refusal.

Current BIM state:
${JSON.stringify(compactSpec)}

Context packet:
${JSON.stringify(payload.contextPacket || {}, null, 2)}

User prompt:
${payload.prompt}`
    }
  ];

  if (sendAttachments) {
    for (const image of (payload.attachedImages || []).slice(0, OPENAI_IMAGE_MAX)) {
      if (/^data:(image\/|application\/pdf|text\/)/.test(image.src || '')) {
        content.push({ type: 'input_image', image_url: image.src });
      }
    }
  }

  if (hasGemini()) {
    // Gemini gets a SLIM op schema: only `type` is required, so it omits the
    // ~20 zero/empty fields per op (emptyBimOperation fills defaults anyway).
    // The fat all-fields-required schema was hitting the output-token cap mid
    // string on big takeoffs -> "unreadable JSON" -> the whole turn was lost.
    const slimSchema = structuredClone(operationSchema);
    slimSchema.properties.operations.items.required = ['type'];
    const geminiResponseSchema = geminiSchema(slimSchema);

    let res = await callGemini({ parts: geminiParts(content), responseSchema: geminiResponseSchema });
    if (!res.ok) {
      const fallback = localPlan(payload);
      fallback.warnings.unshift(`AI planner unavailable: ${res.status} ${res.errorText.slice(0, 160)}`);
      return fallback;
    }
    let plan;
    try {
      plan = JSON.parse(res.text);
    } catch {
      // Truncated/garbled output: one retry asking for a tighter plan instead
      // of dropping the user's turn on the floor.
      res = await callGemini({
        parts: [{ text: 'Your previous response was truncated mid-JSON. Reply again with FEWER, higher-level operations (at most 30, most important first) and shorter reason strings.' }, ...geminiParts(content)],
        responseSchema: geminiResponseSchema
      });
      try {
        plan = res.ok ? JSON.parse(res.text) : null;
      } catch { plan = null; }
      if (!plan) {
        const fallback = localPlan(payload);
        fallback.warnings.unshift('AI planner returned unreadable JSON twice — try again, or break the request into smaller steps.');
        return fallback;
      }
    }
    // A FRESH drawing takeoff must be complete — verify and repair a punted
    // pass. Follow-up edits skip this (repairing an edit re-adds duplicates).
    if (freshTrace) {
      // Deterministic geometry rescue first (origin + shell), then the AI
      // repair for anything missing or unmeasured, then rescue again in case
      // the repair itself added rooms in a stray frame.
      plan = repairTraceGeometry(plan, sourceSpec);
      const attachmentParts = geminiParts(content.filter((c) => c.type === 'input_image'));
      plan = await repairTraceIfNeeded(plan, { attachmentParts, sourceSpec });
      plan = repairTraceGeometry(plan, sourceSpec);
      plan = repairTowerStorey(plan, sourceSpec);
    }
    return setCached(cacheKey, { source: 'ai-planner-gemini', ...plan }, 3 * 60 * 1000);
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_PLANNER_MODEL,
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'bim_design_plan',
          strict: true,
          schema: operationSchema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const fallback = localPlan(payload);
    fallback.warnings.unshift(`AI planner unavailable: ${response.status} ${errorText.slice(0, 160)}`);
    return fallback;
  }

  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text || '';
  const plan = JSON.parse(text);
  return setCached(cacheKey, { source: 'ai-planner', ...plan }, 3 * 60 * 1000);
}
