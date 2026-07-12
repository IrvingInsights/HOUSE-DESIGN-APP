import { GEMINI_PRO_MODEL, OPENAI_IMAGE_MAX, OPENAI_PLANNER_MODEL } from './config.mjs';
import { callGemini, geminiParts, geminiSchema, hasGemini } from './gemini.mjs';
import { getCached, makeCacheKey, setCached } from './cache.mjs';
import { slugify } from './utils.mjs';
import { applyBimOperations, isDimensionShorthandShellOp, shellShorthandDims, parseWxD, scoreTraceSpecChecks } from './bim-core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(?:x|by|×)?\s*(\d+(?:\.\d+)?)?/i);
  if (!match) return fallback;
  return {
    w: Number(match[1]),
    d: Number(match[2]),
    h: Number(match[3] || fallback.h)
  };
}

// "a loft 18 × 14" / "tower 10x10" — the pair of numbers nearest the word.
function dimensionsNearWord(text, word) {
  const match = text.match(new RegExp(`\\b${word}\\b[^.;\\n]{0,50}?(\\d+(?:\\.\\d+)?)\\s*(?:ft|feet|foot|')?\\s*(?:x|by|×)\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
  return match ? { w: Number(match[1]), d: Number(match[2]) } : null;
}

const capWords = (value) => String(value || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Does the prompt depend on READING an attached drawing/document? The local
// fallback has no eyes, so these asks must fail honestly instead of inventing
// a generic object and claiming a takeoff happened.
export function promptNeedsDrawing(promptText) {
  return /\battach(?:ed|ment)?\b|\btrace\b|\btake ?-?offs?\b|\b(?:the|this|that|my)\s+(?:drawing|sketch|blueprint|floor ?plans?|pdf|survey|document|file|image|photo|picture)\b|\bfrom\s+(?:the|this|a|an|my)\s+(?:drawing|sketch|blueprint|pdf|file|image|photo|plans?)\b/i.test(String(promptText || ''));
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

  // HONESTY GATE: this parser cannot read drawings, PDFs, or photos. When the
  // request depends on one, say so and change NOTHING — a fabricated "trace"
  // (the infamous single-letter "m" element) destroys trust in every later
  // success message.
  if (promptNeedsDrawing(prompt)) {
    const hasFiles = (payload.attachedImages || []).length > 0;
    return {
      source: 'local-fallback',
      summary: hasFiles
        ? 'I can\'t read drawings right now, so nothing was changed.'
        : 'No readable drawing is attached, so nothing was changed.',
      operations: [],
      warnings: [hasFiles
        ? 'Reading drawings needs the AI planner, and this copy is running without one (no AI key is configured on the server).'
        : 'The attachment may have failed to read — re-attach it, or continue by hand.'],
      assumptions: [],
      questions: ['Tell me the numbers instead and I\'ll build from those: overall width × depth in feet, which way is south, and each room with its size (e.g. "kitchen 12×14, two bedrooms 11×12"). The Shell and Rooms pages work too.']
    };
  }

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

  const finishLocalPlan = () => {
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
  };

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
  const towerIntent = /\btower\b/.test(text);
  const loftMentioned = /\bloft\b|\bmezzanine\b/.test(text);
  // "a tower above the kitchen loft" NAMES the loft as a location — it is not
  // an ask to create one. Re-creating the loft on every tower retry is how
  // duplicate lofts piled up.
  const loftIsReference = towerIntent && /\b(?:above|over|atop|on top of)\s+(?:the|that|this|my)?\s*(?:[\w-]+\s+){0,2}(?:loft|mezzanine)\b/.test(text);
  const wantsAnother = /\banother\b|\bsecond\b|\bone more\b/.test(text);
  const existingLoft = (spec.elements || []).find((el) => el.category === 'loft' || /\bloft\b/i.test(el.name || ''));
  const existingTower = (spec.elements || []).find((el) => el.category === 'tower' || /\btower\b/i.test(el.name || ''));
  const wallHeightFt = Number(shell.wallHeightFt || 10);
  let loftSkipped = false;
  let towerSkipped = false;
  let loftOp = null;

  if (loftMentioned && !loftIsReference) {
    if (existingLoft && !wantsAnother) {
      loftSkipped = true;
      assumptions.push(`${existingLoft.name} already exists, so I didn't add a second one — say "another loft" if you want two.`);
    } else {
      // Name and place the loft from what the prompt actually says — "over the
      // east bay" is not a kitchen loft.
      const overMatch = text.match(/\b(?:over|above)\s+(?:the\s+)?([a-z][a-z\- ]{1,28}?)(?=\s+(?:and|with|so|then)\b|[.,;\n]|$)/);
      const overName = overMatch?.[1]?.trim();
      const baseRoom = overName ? roomByName(overName) : roomByName('kitchen');
      const dims = dimensionsNearWord(text, '(?:loft|mezzanine)') || { w: Number(baseRoom?.w || 14), d: Number(baseRoom?.d || 12) };
      const baseCeiling = Number(text.match(/\b(?:kitchen|room)\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || wallHeightFt);
      const loftCeiling = Number(text.match(/\bloft\s+ceiling\s+(?:will\s+be|is|at)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?/)?.[1] || 8);
      const name = baseRoom ? `${baseRoom.name} Loft` : overName ? `${capWords(overName)} Loft` : 'Loft';
      loftOp = {
        type: 'add_loft',
        id: slugify(name),
        name,
        category: 'loft',
        x: Number(baseRoom?.x ?? Math.max(2, Number(shell.widthFt || 36) - dims.w - 2)),
        y: Number(baseRoom?.y ?? Math.max(2, Number(shell.depthFt || 28) - dims.d - 2)),
        z: baseCeiling,
        w: dims.w,
        d: dims.d,
        h: loftCeiling,
        level: 2,
        reason: `Added ${name.toLowerCase()}${baseRoom ? ` above the ${baseRoom.name}` : ''}: ${dims.w}' × ${dims.d}', ceiling ${loftCeiling}'.`
      };
      push(loftOp);
    }
  }
  if (towerIntent) {
    if (existingTower && !wantsAnother) {
      towerSkipped = true;
      assumptions.push(`${existingTower.name} already exists, so I didn't add a second one — say "another tower" if you want two.`);
    } else {
      // The tower stacks on the loft when one exists (in this plan or already
      // in the model) — level 3 with the loft's headroom beneath it.
      const baseEl = loftOp || existingLoft;
      const dims = dimensionsNearWord(text, 'tower') || { w: Math.min(12, Number(baseEl?.w || 10)), d: Math.min(12, Number(baseEl?.d || 10)) };
      const towerHeight = Number(text.match(/\bextra\s+(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s+above/)?.[1] || 8);
      const z = baseEl ? Number(baseEl.z || wallHeightFt) + Number(baseEl.h || 8) : wallHeightFt;
      const gabled = /\bgable\b/.test(text);
      const name = gabled ? 'Gabled Tower' : 'Tower';
      push({
        type: 'add_tower',
        id: slugify(name),
        name,
        category: 'tower',
        x: Number(baseEl?.x ?? Math.max(2, Number(shell.widthFt || 36) - dims.w - 2)) + Math.max(0, (Number(baseEl?.w || dims.w) - dims.w) / 2),
        y: Number(baseEl?.y ?? Math.max(2, Number(shell.depthFt || 28) - dims.d - 2)) + Math.max(0, (Number(baseEl?.d || dims.d) - dims.d) / 2),
        z,
        w: dims.w,
        d: dims.d,
        h: towerHeight,
        level: baseEl ? 3 : 2,
        roofType: gabled ? 'gable' : '',
        reason: `Added ${name.toLowerCase()} ${dims.w}' × ${dims.d}'${baseEl ? ` above ${baseEl.name}` : ''} (${towerHeight}' tall).`
      });
    }
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
    } else if ((isLoft || isTower) && (operations.some((operation) => operation.category === 'loft' || operation.category === 'tower') || loftSkipped || towerSkipped || loftIsReference)) {
      assumptions.push('Loft/tower request was handled as specific stacked BIM elements, so I skipped generic object creation.');
    } else if (isOutdoor && operations.some((operation) => ['garden', 'animal'].includes(operation.category))) {
      assumptions.push('Outdoor homestead elements were handled individually, so I skipped generic site object creation.');
    } else if (isLoft || isTower || isOutdoor || !knownRoom) {
      // The article must be word-bounded: an unbounded (?:a|an|the)? once ate
      // the "the" inside "them" and created an element literally named "m".
      const nameMatch = prompt.match(/\b(?:add|include|create|build|place|put|need|want)\s+(?:(?:a|an|the)\s+)?([^.,;\n]+)/i);
      const rawName = (nameMatch?.[1] || 'Custom Building Element').replace(/\b(?:at|near|beside|outside|inside|with|using|as)\b.*$/i, '').trim();
      // A name that isn't a real word is a parse failure, not an object.
      if (rawName.replace(/[^a-zA-Z0-9]/g, '').length < 3) {
        questions.push('What should I add? Give it a name and a size — "add a wood shed 8 × 10" — and I\'ll place it.');
        return finishLocalPlan();
      }
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

  return finishLocalPlan();
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Compare a takeoff against the drawing's OWN index (the manifest that
// extractDrawingManifest pulls from the sheets): which labeled rooms are
// missing from the plan, whether the opening count falls far short, whether
// the storey count disagrees. Pure + exported for unit tests — the Gemini
// extraction is stochastic, this comparison is not. Returns null without a
// manifest so callers keep today's behavior exactly.
export function manifestGaps(plan, sourceSpec, manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const ops = plan.operations || [];
  const roomNames = (Array.isArray(manifest.roomNames) ? manifest.roomNames : [])
    .map((n) => String(n || '').trim()).filter(Boolean);
  const have = new Set([
    ...((sourceSpec?.rooms || []).map((r) => normName(r.name))),
    ...ops.filter((o) => o.type === 'add_room').map((o) => normName(o.name))
  ].filter(Boolean));
  const missingRooms = roomNames.filter((name) => !have.has(normName(name)));
  const windowCount = Math.max(0, Number(manifest.windowCount) || 0);
  const doorCount = Math.max(0, Number(manifest.doorCount) || 0);
  const expectedOpenings = windowCount + doorCount;
  const plannedOpenings = ops.filter((o) => o.type === 'add_opening').length + (sourceSpec?.openings || []).length;
  const lowOpenings = expectedOpenings > 0 && plannedOpenings < expectedOpenings * 0.6;
  const storeysAboveGrade = Number(manifest.storeysAboveGrade) || 0;
  let plannedStoreys = Number(sourceSpec?.shell?.storeys || 1);
  for (const op of ops) {
    if (op.type === 'set_shell' && op.field === 'storeys' && Number(op.value) > plannedStoreys) plannedStoreys = Number(op.value);
  }
  const storeysShort = storeysAboveGrade >= 2 && plannedStoreys < 2;
  const sheetCount = Array.isArray(manifest.sheets) ? manifest.sheets.length : 0;
  // Shell vs the drawing's OWN dimension strings (conditioned envelope): the
  // universal guard against the shell swallowing a carport or porch.
  const expectedW = Number(manifest.overallWidthFt) || 0;
  const expectedD = Number(manifest.overallDepthFt) || 0;
  let plannedW = Number(sourceSpec?.shell?.widthFt) || 0;
  let plannedD = Number(sourceSpec?.shell?.depthFt) || 0;
  for (const op of ops) {
    if (op.type !== 'set_shell') continue;
    if (Number(op.w) > 0) plannedW = Number(op.w);
    if (Number(op.d) > 0) plannedD = Number(op.d);
    if (op.field === 'widthFt' && Number(op.value) > 0) plannedW = Number(op.value);
    if (op.field === 'depthFt' && Number(op.value) > 0) plannedD = Number(op.value);
  }
  const off = (planned, expected) => expected > 6 && planned > 0 && Math.abs(planned - expected) / expected > 0.15;
  const shellDeviation = off(plannedW, expectedW) || off(plannedD, expectedD);
  return {
    roomNames, missingRooms, roomsCovered: roomNames.length - missingRooms.length,
    windowCount, doorCount, expectedOpenings, plannedOpenings, lowOpenings,
    storeysAboveGrade, storeysShort, sheetCount,
    expectedW, expectedD, plannedW, plannedD, shellDeviation
  };
}

// A takeoff of an attached drawing should be COMPLETE: real rooms AND real
// openings. gemini-flash is capable but inconsistent — on an unlucky pass it
// sets the shell and then defers the layout ("noted for future refinement",
// the phrase the mandate bans). Detect that so we can repair it. Optional
// third arg: the drawing's own manifest (extractDrawingManifest) — when
// present, the takeoff is also held against what the sheets actually list.
export function traceLooksIncomplete(plan, sourceSpec, manifest = null) {
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
  // Elements deserve the same standard as rooms: three-plus site/structure
  // elements emitted with NO dimensions means the pass placed default boxes,
  // not the drawn features (the 10×10-everything pile).
  const elementOps = ops.filter((o) => o.type === 'add_element' && o.category !== 'partition' && o.category !== 'floor' && o.category !== 'foundation');
  const dimless = elementOps.filter((o) => !Number(o.w) && !Number(o.d));
  const unmeasuredElements = dimless.length >= 3;
  const unmeasuredElementNames = dimless.map((o) => o.name).filter(Boolean);
  // ZERO-SIZED ROOMS: "Added Living & Dining at 0' x 0'" — the op arrived with
  // no w/d, so the backend drops in a silent 10x10 placeholder. The AI's prose
  // usually PROVES it read the dimension strings; the numbers just never made
  // it into the operation. Name each such room so the repair pass re-measures.
  const zeroSized = roomOps.filter((o) => !Number(o.w) || !Number(o.d));
  // DEFAULT-SIZE RUNS: three-plus rooms at literally 10x10 (the backend's own
  // default) is the same laziness with the numbers written down — a real plan
  // never has three identical default-sized rooms in a row. (Columbia REV1:
  // Bedroom/Bathroom/Bedroom all 10x10 slipped past the absent-dims check.)
  const defaultSized = roomOps.filter((o) => Number(o.w) === 10 && Number(o.d) === 10);
  const suspectRooms = [...zeroSized, ...(defaultSized.length >= 3 ? defaultSized : [])];
  const unmeasuredRooms = suspectRooms.length > 0;
  const unmeasuredRoomNames = [...new Set(suspectRooms.map((o) => o.name).filter(Boolean))];
  // OVERLAPPING ROOMS: rooms share walls — they never sit on top of each
  // other. Heavy overlap between same-level rooms means positions are fiction.
  const effRects = roomOps.map((o) => ({ name: o.name, level: Number(o.level) || 1, x: Number(o.x) || 0, y: Number(o.y) || 0, w: Number(o.w) || 10, d: Number(o.d) || 10 }));
  const overlapNames = new Set();
  for (let i = 0; i < effRects.length; i += 1) {
    for (let j = i + 1; j < effRects.length; j += 1) {
      const a = effRects[i];
      const b = effRects[j];
      if (a.level !== b.level) continue;
      const ov = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));
      if (ov > 0.35 * Math.min(a.w * a.d, b.w * b.d)) { overlapNames.add(a.name); overlapNames.add(b.name); }
    }
  }
  const overlappingRooms = overlapNames.size > 0;
  const overlappingRoomNames = [...overlapNames].filter(Boolean);
  // SPARSE COVERAGE: a dwelling's rooms tile most of its floor plate. Traced
  // ground rooms covering under 45% of the shell means enclosed spaces were
  // skipped — the failure mode of UNLABELED as-built plans (Columbia REV1:
  // no room names on the sheets, the AI read 2 rooms and stopped).
  let planShellW = Number(sourceSpec.shell?.widthFt) || 0;
  let planShellD = Number(sourceSpec.shell?.depthFt) || 0;
  for (const o of ops) {
    if (o.type !== 'set_shell') continue;
    if (Number(o.w) > 0) planShellW = Number(o.w);
    if (Number(o.d) > 0) planShellD = Number(o.d);
    if (o.field === 'widthFt' && Number(o.value) > 0) planShellW = Number(o.value);
    if (o.field === 'depthFt' && Number(o.value) > 0) planShellD = Number(o.value);
  }
  const groundArea = effRects.filter((r) => r.level === 1).reduce((sum, r) => sum + r.w * r.d, 0)
    + (sourceSpec.rooms || []).filter((r) => Number(r.level || 1) === 1).reduce((sum, r) => sum + (Number(r.w) || 0) * (Number(r.d) || 0), 0);
  const sparseRooms = planShellW > 12 && planShellD > 12 && (addRooms + (sourceSpec.rooms || []).length) > 0
    && groundArea < 0.45 * planShellW * planShellD;
  // OPENINGS FLOOR: any dwelling has a door and windows in proportion to its
  // rooms — the same floor the corpus scores. Zero already flagged; a handful
  // on an 8-room house is an under-read, not a traced set.
  const totalOpenings = addOpenings + (sourceSpec.openings || []).length;
  const fewOpenings = totalOpenings > 0 && totalOpenings < Math.max(4, Math.min(totalRooms, 8));
  // MANIFEST cross-check: rooms the drawing's own index lists that the takeoff
  // lacks, or an opening count far short of the schedules.
  const gaps = manifest ? manifestGaps(plan, sourceSpec, manifest) : null;
  const missingRooms = Boolean(gaps && gaps.missingRooms.length);
  const lowOpenings = Boolean(gaps && gaps.lowOpenings);
  const shellDeviation = Boolean(gaps && gaps.shellDeviation);
  return {
    incomplete: deferred || addOpenings === 0 || totalRooms < 2 || noStair || badGeometry || unmeasuredElements || unmeasuredRooms || overlappingRooms || sparseRooms || fewOpenings || missingRooms || lowOpenings || shellDeviation,
    addRooms, addOpenings, totalRooms, deferred, noStair, badGeometry,
    unmeasuredElements, unmeasuredElementNames,
    unmeasuredRooms, unmeasuredRoomNames,
    overlappingRooms, overlappingRoomNames,
    sparseRooms, fewOpenings,
    missingRooms, lowOpenings, gaps
  };
}

// A drawing index that "found" almost nothing is a MISREAD, and worse than no
// index at all: "takeoff covers 2 of 2 rooms" suppresses every completeness
// repair. Fewer than 3 named rooms = distrust it entirely.
export function sanitizeManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.roomNames)) return null;
  if (manifest.roomNames.filter((n) => String(n).trim()).length < 3) return null;
  return manifest;
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
// CLASS FIX (corpus: fl0-carport): schematics label unenclosed spaces like
// rooms — GREENHOUSE, CARPORT, WEST PORCH arrived as level-1 rooms standing
// outside the shell, and the shell-grow step must never swallow them. Any
// add_room whose NAME says it is an outdoor/unenclosed space becomes the
// matching add_element instead, carrying its measured footprint.
const OUTDOOR_ROOM_LEXICON = [
  [/green\s*house|sun\s*space|sunroom/i, 'greenhouse'],
  [/car\s*port|garage/i, 'carport'],
  [/porch|veranda|stoop/i, 'porch'],
  [/patio|terrace|courtyard/i, 'patio'],
  [/deck|balcony/i, 'deck'],
  [/fire\s*wood|wood\s*(store|shed|split)/i, 'structure']
];
export function reclassifyOutdoorRooms(plan) {
  const ops = plan.operations || [];
  const moved = [];
  plan.operations = ops.map((op) => {
    if (op?.type !== 'add_room') return op;
    const hit = OUTDOOR_ROOM_LEXICON.find(([re]) => re.test(String(op.name || '')));
    if (!hit) return op;
    moved.push(op.name);
    return { ...op, type: 'add_element', category: hit[1] };
  });
  if (moved.length) {
    plan.warnings = [...(plan.warnings || []), `Unenclosed spaces modeled as site elements, not rooms: ${moved.join(', ')}.`];
  }
  return plan;
}

// CLASS FIX (corpus: columbia-st): rooms NAMED for the basement must live on
// the basement level whenever the takeoff has one — the AI keeps reading the
// basement plan correctly and then leaving its rooms on level 1.
export function repairBasementRooms(plan, sourceSpec) {
  const ops = plan.operations || [];
  const hasBasement = Number(sourceSpec?.shell?.basementHeightFt) > 0
    || ops.some((o) => o?.type === 'set_shell' && o.field === 'basementHeightFt' && Number(o.value) > 0)
    || ops.some((o) => o?.type === 'set_utility' && o.field === 'foundationType' && o.value === 'basement');
  if (!hasBasement) return plan;
  for (const op of ops) {
    if (op?.type === 'add_room' && /basement|cellar/i.test(String(op.name || '')) && Number(op.level || 1) !== -1) {
      op.level = -1;
    }
  }
  return plan;
}

// A set_footprint op's polygon, or null when it isn't one ('rect' resets to
// the legacy rectangle and keeps the current dims).
const parseFootprintCorners = (value) => {
  if (Array.isArray(value)) return value.length >= 3 ? value : null;
  const text = String(value || '').trim();
  if (!text || text === 'rect') return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) && parsed.length >= 3 ? parsed : null;
  } catch {
    return null;
  }
};

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
  // EFFECTIVE final rects (corpus class fix): the audit corrects by MOVING
  // rooms after they're added — the grow must see where each room ENDS UP,
  // not where it started. Track each add_room through later move/resize ops.
  const effectiveRects = new Map();
  for (const o of scan) {
    effectiveRects.set(normName(o.name), { x: num(o.x), y: num(o.y), w: Math.max(1, num(o.w)), d: Math.max(1, num(o.d)) });
  }
  for (const op of ops) {
    if (op.type !== 'move_object' && op.type !== 'resize_object' && op.type !== 'update_object') continue;
    const key = normName(String(op.name || op.targetId || '').replace(/-/g, ' '));
    const r = effectiveRects.get(key);
    if (!r) continue;
    if (op.type === 'move_object') {
      if (Number.isFinite(Number(op.x))) r.x = num(op.x);
      if (Number.isFinite(Number(op.y))) r.y = num(op.y);
    } else if (op.type === 'resize_object') {
      if (num(op.w)) r.w = num(op.w);
      if (num(op.d)) r.d = num(op.d);
    } else if (op.type === 'update_object' && ['x', 'y', 'w', 'd'].includes(op.field) && Number.isFinite(Number(op.value))) {
      r[op.field] = num(op.value);
    }
  }
  const finalRects = [...effectiveRects.values()];
  const extentW = Math.ceil(Math.max(...finalRects.map((r) => r.x + r.w)) * 2) / 2;
  const extentD = Math.ceil(Math.max(...finalRects.map((r) => r.y + r.d)) * 2) / 2;
  // What shell does the plan intend? Walk the ops IN ORDER, mirroring exactly
  // what the engine will honor (last write wins): dimension-shorthand set_shell
  // ops (shared predicate — junk-field ops the field ladder would swallow do
  // NOT count as intent unless the engine honors them), widthFt/depthFt field
  // writes, and set_footprint polygons whose bbox becomes the shell.
  let shellW = 0;
  let shellD = 0;
  for (const op of ops) {
    if (op.type === 'set_footprint') {
      const corners = parseFootprintCorners(op.value);
      if (corners) {
        const xs = corners.map((c) => num(c[0]));
        const ys = corners.map((c) => num(c[1]));
        shellW = Math.max(...xs) - Math.min(...xs);
        shellD = Math.max(...ys) - Math.min(...ys);
      }
      continue;
    }
    if (op.type !== 'set_shell') continue;
    if (isDimensionShorthandShellOp(op)) {
      const dims = shellShorthandDims(op);
      if (dims.w) shellW = dims.w;
      if (dims.d) shellD = dims.d;
    } else if (op.field === 'widthFt' && num(op.value)) shellW = num(op.value);
    else if (op.field === 'depthFt' && num(op.value)) shellD = num(op.value);
  }
  if (!shellW) shellW = num(sourceSpec?.shell?.widthFt);
  if (!shellD) shellD = num(sourceSpec?.shell?.depthFt);
  const needW = extentW > shellW ? extentW : 0;
  const needD = extentD > shellD ? extentD : 0;
  if (needW || needD) {
    let fixedInPlace = false;
    for (const op of ops) {
      // A footprint outline smaller than the rooms: stretch its far edges out
      // to the needed extent (preserves drawn jogs; the polygon is anchored at
      // the origin, so max-x/max-y points ARE the east/south walls).
      if (op.type === 'set_footprint') {
        const corners = parseFootprintCorners(op.value);
        if (!corners) continue;
        const xs = corners.map((c) => num(c[0]));
        const ys = corners.map((c) => num(c[1]));
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const stretched = corners.map(([x, y]) => [
          needW && Math.abs(num(x) - maxX) < 0.26 ? Math.max(num(x), needW) : num(x),
          needD && Math.abs(num(y) - maxY) < 0.26 ? Math.max(num(y), needD) : num(y)
        ]);
        if (JSON.stringify(stretched) !== JSON.stringify(corners.map(([x, y]) => [num(x), num(y)]))) {
          op.value = JSON.stringify(stretched);
          fixedInPlace = true;
        }
        continue;
      }
      if (op.type !== 'set_shell') continue;
      // Only edit ops the ENGINE will honor — growing a junk op it ignores
      // logs "shell grown" while the model stays small (fl0-v6 stray-room bug).
      if (isDimensionShorthandShellOp(op)) {
        if (needW) op.w = needW;
        if (needD) op.d = needD;
        // w/d now carry the truth; a stale "24x28" value string must not win.
        if (parseWxD(op.value)) op.value = '';
        fixedInPlace = true;
      } else if (op.field === 'widthFt' && needW) { op.value = needW; fixedInPlace = true; }
      else if (op.field === 'depthFt' && needD) { op.value = needD; fixedInPlace = true; }
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
  // CLASS FIX (corpus: fl0-v6): stray interior walls — clamp partition
  // elements into the (possibly just-grown) shell rectangle.
  const shellWNow = (() => {
    let w = num(sourceSpec?.shell?.widthFt) || 0;
    let d = num(sourceSpec?.shell?.depthFt) || 0;
    for (const op of ops) {
      if (op.type !== 'set_shell') continue;
      if (num(op.w) > 0) w = num(op.w);
      if (num(op.d) > 0) d = num(op.d);
      if (op.field === 'widthFt' && num(op.value) > 0) w = num(op.value);
      if (op.field === 'depthFt' && num(op.value) > 0) d = num(op.value);
    }
    return { w, d };
  })();
  if (shellWNow.w > 4 && shellWNow.d > 4) {
    const partNames = new Set();
    for (const op of ops) {
      if (op.type !== 'add_element' || op.category !== 'partition') continue;
      partNames.add(normName(op.name));
      const w = Math.min(num(op.w) || 1, shellWNow.w);
      const d = Math.min(num(op.d) || 1, shellWNow.d);
      op.x = Math.max(0, Math.min(num(op.x), shellWNow.w - w));
      op.y = Math.max(0, Math.min(num(op.y), shellWNow.d - d));
    }
    // …and the moves/updates the audit aims at them (same class: corrections
    // that relocate a partition must not relocate it into the yard).
    for (const op of ops) {
      const targetsPartition = partNames.has(normName(String(op.name || op.targetId || '').replace(/-/g, ' ')));
      if (!targetsPartition) continue;
      if (op.type === 'move_object') {
        if (Number.isFinite(Number(op.x))) op.x = Math.max(0, Math.min(num(op.x), shellWNow.w - 1));
        if (Number.isFinite(Number(op.y))) op.y = Math.max(0, Math.min(num(op.y), shellWNow.d - 1));
      } else if (op.type === 'update_object' && (op.field === 'x' || op.field === 'y') && Number.isFinite(Number(op.value))) {
        const cap = op.field === 'x' ? shellWNow.w - 1 : shellWNow.d - 1;
        op.value = Math.max(0, Math.min(num(op.value), cap));
      }
    }
  }
  return plan;
}

// Element hygiene for fresh takeoffs — deterministic, no AI. The room pass got
// reliable, but elements kept arriving UNMEASURED (default 10×10 pads piled on
// top of each other) and DOUBLED (a "Greenhouse" room plus a "Greenhouse"
// element for the same thing). Exported for unit tests.
const OUTDOOR_ELEMENT_CATS = new Set(['porch', 'deck', 'greenhouse', 'carport', 'garden', 'animal', 'site', 'outbuilding']);
export function cleanTraceElements(plan, sourceSpec) {
  const ops = plan.operations || [];
  // 1) An element that duplicates a ROOM by name is the same thing twice —
  //    the measured room wins.
  const roomNames = new Set([
    ...((sourceSpec.rooms || []).map((r) => normName(r.name))),
    ...ops.filter((o) => o.type === 'add_room').map((o) => normName(o.name))
  ].filter(Boolean));
  const dropped = [];
  plan.operations = ops.filter((op) => {
    if (op.type !== 'add_element' || OUTDOOR_ELEMENT_CATS.has(op.category) === false) return true;
    const key = normName(op.name);
    if (key && roomNames.has(key)) { dropped.push(op.name); return false; }
    return true;
  });
  if (dropped.length) {
    plan.warnings = [...(plan.warnings || []), `${dropped.join(', ')}: traced as both a room and a site element — kept the measured room.`];
  }
  // 2) ATTACHED structures (a greenhouse, sunspace, or porch) belong flush
  //    against a wall, not floating in the yard — schematics draw them beside
  //    the outline and the rank below would drag them further out. A solar
  //    greenhouse attaches to the SOUTH face by convention; a porch to its
  //    nearest face. Already-flush elements are left alone.
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let shellW = num(sourceSpec?.shell?.widthFt) || 36;
  let shellD = num(sourceSpec?.shell?.depthFt) || 28;
  for (const op of plan.operations) {
    if (op.type !== 'set_shell') continue;
    if (num(op.w)) shellW = num(op.w);
    if (num(op.d)) shellD = num(op.d);
    if (op.field === 'widthFt' && num(op.value)) shellW = num(op.value);
    if (op.field === 'depthFt' && num(op.value)) shellD = num(op.value);
  }
  const rectOf = (o) => ({ x: num(o.x), y: num(o.y), w: num(o.w) || 10, d: num(o.d) || 10 });
  const isAttachedKind = (o) => o.category === 'greenhouse' || o.category === 'porch'
    || /\b(greenhouse|sunspace|sunroom)\b/i.test(String(o.name || ''));
  const touchesFace = (r) => {
    const xOverlap = Math.min(r.x + r.w, shellW) - Math.max(r.x, 0);
    const yOverlap = Math.min(r.y + r.d, shellD) - Math.max(r.y, 0);
    return (Math.abs(r.y - shellD) < 0.6 && xOverlap >= 3) // south
      || (Math.abs(r.y + r.d) < 0.6 && xOverlap >= 3)      // north
      || (Math.abs(r.x - shellW) < 0.6 && yOverlap >= 3)   // east
      || (Math.abs(r.x + r.w) < 0.6 && yOverlap >= 3);     // west
  };
  const snapped = [];
  for (const op of plan.operations) {
    if (op.type !== 'add_element' || !isAttachedKind(op) || num(op.z)) continue;
    const r = rectOf(op);
    if (touchesFace(r)) continue;
    let face;
    if (op.category === 'greenhouse' || /\b(greenhouse|sunspace|sunroom)\b/i.test(String(op.name || ''))) face = 'south';
    else {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.d / 2;
      const dists = { south: Math.abs(cy - shellD), north: Math.abs(cy), east: Math.abs(cx - shellW), west: Math.abs(cx) };
      face = Object.keys(dists).reduce((a, b) => (dists[b] < dists[a] ? b : a));
    }
    // Slide along the face to a spot clear of anything already sitting there.
    const axis = (face === 'south' || face === 'north') ? 'x' : 'y';
    const runLen = axis === 'x' ? r.w : r.d;
    const faceLen = axis === 'x' ? shellW : shellD;
    const others = plan.operations.filter((o) => o !== op && o.type === 'add_element' && OUTDOOR_ELEMENT_CATS.has(o.category))
      .map(rectOf)
      .filter((o) => (face === 'south' ? Math.abs(o.y - shellD) < 0.6 : face === 'north' ? Math.abs(o.y + o.d) < 0.6
        : face === 'east' ? Math.abs(o.x - shellW) < 0.6 : Math.abs(o.x + o.w) < 0.6))
      .map((o) => (axis === 'x' ? [o.x, o.x + o.w] : [o.y, o.y + o.d]));
    let along = Math.max(0, Math.min(axis === 'x' ? r.x : r.y, faceLen - runLen));
    const collides = (a) => others.some(([s, e]) => a < e && a + runLen > s);
    if (collides(along)) {
      let best = null;
      for (let a = 0; a + runLen <= faceLen + 0.01; a += 0.5) {
        if (!collides(a)) { best = a; break; }
      }
      if (best !== null) along = best;
    }
    if (face === 'south') { op.y = shellD; op.x = along; }
    else if (face === 'north') { op.y = -r.d; op.x = along; }
    else if (face === 'east') { op.x = shellW; op.y = along; }
    else { op.x = -r.w; op.y = along; }
    snapped.push(op.name || op.category);
  }
  if (snapped.length) {
    plan.warnings = [...(plan.warnings || []), `${snapped.join(', ')}: attached to the house wall (traces often float these in the yard).`];
  }
  // 3) Overlapping outdoor elements are a pile, not a site plan: when they
  //    collide, re-lay ALL of them in a readable rank beside the house.
  //    Attached structures stay put — the rank would tear them off the wall.
  const outdoor = plan.operations.filter((o) => o.type === 'add_element' && OUTDOOR_ELEMENT_CATS.has(o.category) && !num(o.z) && !isAttachedKind(o));
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));
  const piled = outdoor.some((a, i) => outdoor.some((b, j) => {
    if (j <= i) return false;
    const ra = rectOf(a); const rb = rectOf(b);
    return overlapArea(ra, rb) > 0.4 * Math.min(ra.w * ra.d, rb.w * rb.d);
  }));
  if (piled && outdoor.length > 1) {
    let colX = shellW + 3;
    let atY = 2;
    for (const op of outdoor) {
      const r = rectOf(op);
      if (atY + r.d > 46) { colX += 14; atY = 2; } // next column when the rank gets long
      op.x = colX;
      op.y = atY;
      atY += r.d + 2;
    }
    plan.warnings = [...(plan.warnings || []), 'The outdoor structures overlapped each other, so they were laid out in a rank beside the house — drag each one where it belongs.'];
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

// Drop operations that LOOK like actions but do nothing: update_object with a
// name but no field and no non-zero geometry prints "Updated Kitchen ." and
// changes nothing; add_room with no name creates an unnameable placeholder.
// Both erode trust — the action log claims work the model never received.
// Deterministic, no AI. Exported for unit tests.
export function scrubDeadOperations(plan) {
  const ops = plan.operations || [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const kept = ops.filter((op) => {
    if (!op || typeof op !== 'object') return false;
    if (op.type === 'update_object') {
      const hasField = String(op.field || '').trim() !== '';
      const hasGeometry = ['x', 'y', 'z', 'w', 'd', 'h'].some((k) => num(op[k]) !== 0);
      return hasField || hasGeometry;
    }
    if (op.type === 'add_room') return String(op.name || '').trim() !== '';
    return true;
  });
  const dropped = ops.length - kept.length;
  if (dropped > 0) {
    plan.operations = kept;
    plan.warnings = [...(plan.warnings || []), `Dropped ${dropped} empty operation${dropped === 1 ? '' : 's'} the AI emitted without content.`];
  }
  return plan;
}

// Overlapping same-level rooms slide apart by the minimal translation — the
// deterministic answer to a net the AI repair keeps missing on unlabeled
// plans (its estimated rects collide by a foot or two). TRACE-TIME ONLY:
// this runs in the rescue chain, never on a user's own edits, so it can't
// fight a hand-drag. Works on EFFECTIVE rects (adds folded through later
// moves/resizes) and emits move_object ops so the engine applies the slide.
export function separateOverlappingRooms(plan, sourceSpec) {
  const ops = plan.operations || [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let shellW = num(sourceSpec?.shell?.widthFt) || 36;
  let shellD = num(sourceSpec?.shell?.depthFt) || 28;
  for (const op of ops) {
    if (op.type !== 'set_shell') continue;
    if (num(op.w)) shellW = num(op.w);
    if (num(op.d)) shellD = num(op.d);
    if (op.field === 'widthFt' && num(op.value)) shellW = num(op.value);
    if (op.field === 'depthFt' && num(op.value)) shellD = num(op.value);
  }
  const rects = new Map();
  for (const o of ops.filter((o) => o.type === 'add_room')) {
    rects.set(normName(o.name), { name: o.name, level: num(o.level) || 1, x: num(o.x), y: num(o.y), w: num(o.w) || 10, d: num(o.d) || 10 });
  }
  for (const op of ops) {
    if (op.type !== 'move_object' && op.type !== 'resize_object') continue;
    const r = rects.get(normName(String(op.name || op.targetId || '').replace(/-/g, ' ')));
    if (!r) continue;
    if (op.type === 'move_object') {
      if (Number.isFinite(Number(op.x))) r.x = num(op.x);
      if (Number.isFinite(Number(op.y))) r.y = num(op.y);
    } else {
      if (num(op.w)) r.w = num(op.w);
      if (num(op.d)) r.d = num(op.d);
    }
  }
  const slid = [];
  const list = [...rects.values()];
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const a = list[i];
        const b = list[j];
        if (a.level !== b.level) continue;
        const ovW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const ovD = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
        if (ovW <= 0 || ovD <= 0) continue;
        if (ovW * ovD <= 0.35 * Math.min(a.w * a.d, b.w * b.d)) continue;
        // slide the SMALLER room by the minimal translation that clears it
        const mover = a.w * a.d <= b.w * b.d ? a : b;
        const anchor = mover === a ? b : a;
        const pushes = [
          { dx: anchor.x - (mover.x + mover.w), dy: 0 },
          { dx: (anchor.x + anchor.w) - mover.x, dy: 0 },
          { dx: 0, dy: anchor.y - (mover.y + mover.d) },
          { dx: 0, dy: (anchor.y + anchor.d) - mover.y }
        ].sort((p, q) => (Math.abs(p.dx) + Math.abs(p.dy)) - (Math.abs(q.dx) + Math.abs(q.dy)));
        for (const push of pushes) {
          const nx = Math.max(0, Math.min(mover.x + push.dx, shellW - mover.w));
          const ny = Math.max(0, Math.min(mover.y + push.dy, shellD - mover.d));
          const cleared = !(Math.min(anchor.x + anchor.w, nx + mover.w) - Math.max(anchor.x, nx) > 0
            && Math.min(anchor.y + anchor.d, ny + mover.d) - Math.max(anchor.y, ny) > 0);
          if (cleared || push === pushes[pushes.length - 1]) {
            if (nx !== mover.x || ny !== mover.y) {
              mover.x = nx;
              mover.y = ny;
              slid.push(mover.name);
            }
            break;
          }
        }
      }
    }
  }
  if (slid.length) {
    for (const name of new Set(slid)) {
      const r = [...rects.values()].find((v) => v.name === name);
      ops.push({ type: 'move_object', name, x: r.x || 0.01, y: r.y || 0.01 });
    }
    plan.warnings = [...(plan.warnings || []), `Rooms overlapped on the plan — slid ${[...new Set(slid)].join(', ')} to clear.`];
  }
  return plan;
}

// THE deterministic rescue chain, in one place so every AI stage gets the
// same treatment after it: the audit loop merges brand-new ops (it once added
// a greenhouse "room" below the south wall), so whatever runs after the first
// trace must also run after the repair AND after the audit — running a subset
// is how audit-added rooms escaped reclassification (corpus fl0-v6).
export function applyDeterministicRescues(plan, sourceSpec) {
  plan = scrubDeadOperations(plan);
  plan = reclassifyOutdoorRooms(plan);
  plan = repairBasementRooms(plan, sourceSpec);
  plan = repairTraceGeometry(plan, sourceSpec);
  plan = separateOverlappingRooms(plan, sourceSpec);
  // separating rooms can push one against the shell edge — re-grow if needed
  plan = repairTraceGeometry(plan, sourceSpec);
  plan = repairTowerStorey(plan, sourceSpec);
  plan = cleanTraceElements(plan, sourceSpec);
  return plan;
}

// SLIM manifest schema: only roomNames is required — the codebase learned the
// hard way that fat required-lists push responses past the token cap.
const manifestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['roomNames'],
  properties: {
    sheets: { type: 'array', items: { type: 'string' } },
    storeysAboveGrade: { type: 'number' },
    hasBasement: { type: 'boolean' },
    roomNames: { type: 'array', items: { type: 'string' } },
    windowCount: { type: 'number' },
    doorCount: { type: 'number' },
    overallWidthFt: { type: 'number' },
    overallDepthFt: { type: 'number' },
    notes: { type: 'string' }
  }
};

// One small dedicated Gemini call that reads the drawing set as an INDEX, not
// a takeoff: sheet list, storey count, room names, opening totals. The later
// completeness checks hold the trace against this checklist. Failure-tolerant:
// any error returns null and the pipeline behaves exactly as it does today.
export async function extractDrawingManifest({ attachmentParts }) {
  if (!attachmentParts?.length) return null;
  const prompt = {
    text: 'Inventory the attached construction drawing set. List sheet names/numbers you can see, count storeys above grade, whether there is a basement level, every room NAME labeled on the floor plans (each once), and total exterior windows and doors (from schedules if present, else count the plans). Also read the overall dimension strings of the CONDITIONED envelope: overallWidthFt and overallDepthFt in feet — the enclosed heated building only, EXCLUDING unenclosed structures (carports, porches, decks, detached garages). Report only what the drawings show.'
  };
  // One retry — a flaky first inventory call shouldn't silently cost the
  // whole checklist (it did, on the Columbia set).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await callGemini({ parts: [prompt, ...attachmentParts], responseSchema: geminiSchema(manifestSchema) });
      if (!res?.ok) continue;
      const manifest = JSON.parse(res.text);
      if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.roomNames) || !manifest.roomNames.length) continue;
      return manifest;
    } catch { /* retry once, then give up */ }
  }
  return null;
}

// One focused repair call: hand the model what it already produced and the
// same drawing, and ask ONLY for the rooms/openings it still owes. Merge the
// missing pieces in (dedup rooms by name). Model-agnostic — makes a flaky
// single pass reliable without a full multi-stage rework.
async function repairTraceIfNeeded(plan, { attachmentParts, sourceSpec, manifest = null, escalate = false }) {
  const check = traceLooksIncomplete(plan, sourceSpec, manifest);
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
${check.unmeasuredElements ? `- THESE ELEMENTS WERE EMITTED WITHOUT SIZES: ${check.unmeasuredElementNames.join(', ')}. For EACH one, emit resize_object (name, w, d) + move_object (name, x, y) with its REAL measured footprint and position from the plan — a stair is a stair-sized rectangle, a heater a heater-sized one; porches and decks have drawn outlines. Never leave an element at a default size.` : ''}
${check.unmeasuredRooms ? `- THESE ROOMS WERE ADDED WITHOUT MEASUREMENTS: ${check.unmeasuredRoomNames.join(', ')}. Your notes prove you read the dimension strings — for EACH, emit resize_object (name, w, d) + move_object (name, x, y) with its measured size and position in feet from the plan. A room without a size is not traced.` : ''}
${check.overlappingRooms ? `- THESE ROOMS SIT ON TOP OF EACH OTHER: ${check.overlappingRoomNames.join(', ')}. Rooms share walls — they NEVER overlap. Re-read the floor plan and emit move_object (name, x, y) and resize_object (name, w, d) for each so they tile the plan the way the drawing shows.` : ''}
${check.sparseRooms ? '- THE TRACED ROOMS COVER LESS THAN HALF THE FLOOR PLAN. Walk EVERY enclosed space on the plan, wall by wall — a dwelling\'s rooms tile nearly its whole floor plate. If the plan has NO room name labels, name each space from its fixtures (tub/toilet = Bathroom, counters/stove = Kitchen, large open space = Living, small enclosed rooms with doors = Bedrooms, washer/dryer = Laundry) and add a warning that names were inferred from fixtures.' : ''}
${check.fewOpenings ? `- ONLY ${check.addOpenings} OPENINGS WERE READ for a ${check.totalRooms}-room dwelling. Re-read every exterior wall on the plans AND the elevation sheets (openings show clearly there) and emit an add_opening for every window and door you can see.` : ''}
${check.gaps && (check.missingRooms || check.lowOpenings || check.gaps.storeysShort) ? `- THE DRAWING'S OWN INDEX SAYS: rooms ${check.gaps.roomNames.join(', ')}; ~${check.gaps.windowCount} windows, ${check.gaps.doorCount} doors.${check.missingRooms ? ` Missing from your takeoff: ${check.gaps.missingRooms.join(', ')}. Add each with measured size and position.` : ''}${check.lowOpenings ? ` Only ${check.gaps.plannedOpenings} opening${check.gaps.plannedOpenings === 1 ? ' is' : 's are'} placed so far — trace the rest from the plans and schedules.` : ''}${check.gaps.storeysShort ? ` The index counts ${check.gaps.storeysAboveGrade} storeys above grade but the takeoff has fewer — set_shell field:'storeys' with the drawn count and put the upper-floor rooms on level 2.` : ''}` : ''}
${check.gaps?.shellDeviation ? `- THE DRAWING'S DIMENSION STRINGS say the CONDITIONED envelope is ${check.gaps.expectedW} x ${check.gaps.expectedD} ft, but the takeoff shell is ${check.gaps.plannedW} x ${check.gaps.plannedD} ft. Correct it with set_shell (w and d) — the shell is ONLY the enclosed heated building; carports, porches, and decks are add_element, never part of the shell.` : ''}
Do NOT restate the shell or footprint unless the earlier value is wrong. NEVER defer, summarize, or write "future refinement" — emit the operations. Report final counts in summary.`
  };

  const res = await callGemini({
    parts: [repairText, ...attachmentParts],
    responseSchema: geminiSchema(operationSchema),
    model: escalate ? GEMINI_PRO_MODEL : undefined
  });
  if (!res.ok) return scrubDeferralSummary(plan);
  let extra;
  try { extra = JSON.parse(res.text); } catch { return scrubDeferralSummary(plan); }
  return mergeTracePlans(plan, extra, sourceSpec, already, { allowShellDims: check.badGeometry || Boolean(check.gaps?.shellDeviation) });
}

// ---- The trace CYCLE: build → compare against the drawing → fix → compare
// again. The one-shot trace (plus the incompleteness repair above) catches
// what's MISSING; this loop catches what's WRONG — a room traced 4 ft short,
// a window on the wrong wall — by simulating the applied model server-side
// and showing the AI its own result next to the drawing it traced.

// Compact, id-bearing snapshot of the model — what the audit pass reads.
// Pure + exported for unit tests.
export function describeModelForAudit(spec) {
  const s = spec.shell || {};
  const lines = [];
  lines.push(`Shell: ${s.widthFt}x${s.depthFt} ft, roof ${s.roofType || 'gable'}${s.roofType === 'shed' ? ` (south wall ${s.southWallHeightFt} ft, north wall ${s.northWallHeightFt} ft)` : ` (wall height ${s.wallHeightFt} ft)`}, storeys ${s.storeys || 1}${Number(s.basementHeightFt) > 0 ? `, basement ${s.basementHeightFt} ft` : ''}.`);
  if (Array.isArray(s.footprint) && s.footprint.length) {
    lines.push(`Footprint corners (ft): ${s.footprint.map((p) => `(${p[0]},${p[1]})`).join(' ')}`);
  }
  lines.push('ROOMS (id | name | x,y | w x d ft | level):');
  (spec.rooms || []).forEach((r) => lines.push(`  ${r.id} | ${r.name} | ${r.x},${r.y} | ${r.w}x${r.d} | L${r.level || 1}`));
  lines.push('OPENINGS (targetId | wall | type | width ft | position ft along wall):');
  (spec.openings || []).forEach((o, i) => lines.push(`  opening-${i} | ${o.wall} | ${o.type} | ${o.widthFt} | ${o.wall === 'north' || o.wall === 'south' ? (o.x ?? 0) : (o.y ?? 0)}`));
  lines.push('ELEMENTS (id | category | name | x,y | w x d ft | level):');
  (spec.elements || []).forEach((e) => lines.push(`  ${e.id} | ${e.category || 'custom'} | ${e.name} | ${e.x},${e.y} | ${e.w}x${e.d} | L${e.level || 1}`));
  return lines.join('\n');
}

// The audit reply may only CORRECT — cap the flood and drop anything the
// backend wouldn't honor anyway. Pure + exported for unit tests.
const AUDIT_OP_TYPES = new Set([
  'move_object', 'resize_object', 'update_object', 'remove_object',
  'add_room', 'add_opening', 'dedupe_openings', 'add_element',
  'set_shell', 'set_roof', 'set_roof_profile', 'set_wall_side',
  'set_wall_height', 'set_footprint', 'move_wall_edge', 'set_frame', 'set_overhang'
]);
export function sanitizeAuditOperations(ops, cap = 20, removeCap = 4) {
  // Corrections may prune, but never gut: an over-eager audit round once
  // removed a whole house's openings down to 3. Cap removals per round.
  let removals = 0;
  return (Array.isArray(ops) ? ops : [])
    .filter((op) => op && typeof op === 'object' && AUDIT_OP_TYPES.has(op.type))
    .filter((op) => op.type !== 'remove_object' || ++removals <= removeCap)
    .slice(0, cap);
}

const AUDIT_ROUNDS = 2;
// The browser waits on this one request — past ~5 minutes it gives up while
// the server keeps working, which reads as "the engine died". Budget the
// loop: a round only STARTS while total planning time is under this.
const AUDIT_TIME_BUDGET_MS = 200 * 1000;
async function auditTraceLoop(plan, { attachmentParts, sourceSpec, startedAt = Date.now(), force = false, budgetMs = AUDIT_TIME_BUDGET_MS, note = null, escalate = false }) {
  if (!attachmentParts?.length) return plan;
  if (!(plan.operations || []).length && !force) return plan;
  plan.operations ||= [];
  let working;
  try {
    working = plan.operations.length
      ? applyBimOperations(sourceSpec, { operations: plan.operations }).spec
      : structuredClone(sourceSpec); // audit-only: check the model as it stands
  } catch {
    return plan; // simulation failed — ship the plan as-is rather than stall
  }
  for (let round = 1; round <= AUDIT_ROUNDS; round += 1) {
    if (Date.now() - startedAt > budgetMs) {
      plan.warnings = [...(plan.warnings || []), `Self-check stopped after ${round - 1} round${round === 2 ? '' : 's'} — a large drawing set uses the time up; say "re-check the trace against the drawing" to run another pass.`];
      break;
    }
    note?.(`Self-check round ${round}…`);
    const auditText = {
      text: `AUDIT PASS${round > 1 ? ` (round ${round}: the previous round's corrections are ALREADY APPLIED below — report ONLY discrepancies that remain; if the model now matches the drawing, return ZERO operations)` : ''} — you already traced the attached drawing(s) into a BIM model. Below is the model EXACTLY as it stands after your trace. Compare it against the drawings and correct real discrepancies.

${describeModelForAudit(working)}

Emit operations that FIX what differs from the drawing:
- a room/opening/element whose size or position is off by 1 ft or more: move_object / resize_object / update_object with its exact id from the list above
- anything the drawing shows that is missing (add it). Remove something ONLY when CERTAIN the drawing does not show it — for a misplaced window or door, MOVE it (update_object) instead of removing it; a real house always has more than a handful of openings
- wrong storey count, wall heights, roof type or fall direction, footprint shape
Rules: correct EXISTING items by id — never re-add something already listed. If the model is faithful to the drawing, return ZERO operations. At most 20 operations, most important first. summary = one short line naming what you corrected. Never invent detail the drawing does not show.`
    };
    let res;
    try {
      res = await callGemini({
        parts: [auditText, ...attachmentParts],
        responseSchema: geminiSchema(operationSchema),
        model: escalate ? GEMINI_PRO_MODEL : undefined
      });
    } catch { break; }
    if (!res?.ok) break;
    let verdict;
    try { verdict = JSON.parse(res.text); } catch { break; }
    const fixes = sanitizeAuditOperations(verdict?.operations);
    if (!fixes.length) {
      plan.warnings = [...(plan.warnings || []), round === 1
        ? 'Self-check: compared the model against the drawing — it matches.'
        : `Self-check round ${round}: no further corrections needed.`];
      break;
    }
    plan.operations = [...plan.operations, ...fixes];
    plan.warnings = [...(plan.warnings || []),
      `Self-check round ${round}: corrected ${fixes.length} discrepanc${fixes.length === 1 ? 'y' : 'ies'} against the drawing${verdict?.summary ? ` — ${String(verdict.summary).slice(0, 140)}` : ''}.`];
    try {
      working = applyBimOperations(sourceSpec, { operations: plan.operations }).spec;
    } catch { break; }
  }
  return plan;
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

// ---- STAGED READ: four focused specialist passes over the same drawing
// set instead of one giant gulp — how a human traces. Each pass has a
// narrow mandate and a WHITELISTED op vocabulary; the merged plan then runs
// the same repair + audit chain. Job mode only (the async budget pays for
// the extra calls); any structural failure returns null = classic one-call
// trace, so this can only improve things, never lose a turn. ----
const TRACE_CONVENTIONS = 'Coordinates: FEET; origin at the shell\'s northwest corner; x increases east, y increases south. Read the dimension strings — never estimate something that is dimensioned. Report only what the drawings show.';

const TRACE_PASSES = [
  {
    key: 'structure',
    note: 'Reading the structure (outline, heights, storeys)…',
    required: true,
    types: ['set_shell', 'set_footprint', 'set_roof', 'set_roof_profile', 'set_wall_height', 'set_site', 'set_utility', 'set_overhang'],
    text: `STRUCTURE PASS — read ONLY the building structure from the attached drawings: the floor plans for the outline, the elevations/sections for heights and storeys, the site plan for topography.
Emit ONLY these operation types: set_shell (fields w and d = the overall conditioned footprint from the dimension strings; also field storeys, wallHeightFt, upperStoreyHeightFt, basementHeightFt when the sections/elevations show them), set_footprint (JSON corner list, ONLY if the outline is not a plain rectangle), set_roof (roofType, pitch), set_roof_profile (sheds only — different south/north heights), set_wall_height, set_site (slopeFt/slopeDir/gradeFt from contours or spot elevations, zip if shown), set_utility (foundationType; basement = set_shell basementHeightFt), set_overhang.
The shell is the CONDITIONED envelope only — exclude carports, porches, decks, and any unenclosed structure from set_shell/set_footprint (they come later as elements). No rooms, no openings, no elements in this pass.`
  },
  {
    key: 'rooms',
    note: 'Reading the rooms, level by level…',
    required: true,
    types: ['add_room'],
    text: `ROOMS PASS — emit ONE add_room per ENCLOSED SPACE on EVERY level of the attached floor plans, with its name and MEASURED x, y, w, d in feet. level 1 = ground floor, 2 = upper floor, -1 = basement.
Labeled plans: use the drawn names. UNLABELED plans (many as-builts have no room text): the rooms are still there as enclosed spaces — walk every one wall by wall and name it from its fixtures (tub/toilet = Bathroom, counter/stove run = Kitchen, washer/dryer = Laundry, the big open space = Living, small doored rooms = Bedrooms). Rooms tile the floor plate — if your rooms cover well under the plan's area, you missed spaces.
A room without measured w and d is not traced — measure every one from the plan and its dimension strings.
CONDITIONED indoor rooms ONLY — do NOT emit carports, porches, patios, decks, or greenhouses here (the elements pass covers them).
ONLY add_room operations.`
  },
  {
    key: 'openings',
    note: 'Reading the windows and doors…',
    required: false,
    types: ['add_opening'],
    text: `OPENINGS PASS — emit ONE add_opening per EXTERIOR window and door: wall (north|south|east|west), openingType (window, picture, awning, clerestory, door, french, slider, dutch, barn, bay, skylight), widthFt, positionFt (distance along that wall from its west end for north/south walls, from its north end for east/west walls).
Use the window/door SCHEDULE when the set has one; otherwise count the symbols on the plans. Every drawn exterior opening, exactly once.
ONLY add_opening operations.`
  },
  {
    key: 'elements',
    note: 'Reading stairs, decks, chimneys, interior walls…',
    required: false,
    types: ['add_element'],
    text: `ELEMENTS PASS — emit add_element operations, each at its MEASURED plan position and size, for: stairs (name containing 'Stairs', level = the floor it climbs FROM: 1 ground, -1 basement), decks/porches/patios (category deck|porch|patio), carports (category carport), chimneys and fireplaces (category chimney), and INTERIOR partition walls (category partition; w×d = the wall run with the long side the run; widthFt = its doorway width, positionFt = doorway distance along the run).
ONLY add_element operations.`
  }
];

// A pass-specific response schema: ONLY the fields that pass emits. The
// full ~24-field op schema invited a degeneration failure — the model
// looped digits inside one of the many zero-filled number fields until it
// hit the token cap (evidence: a 33k-char reply ending in '000…').
const PASS_FIELDS = {
  structure: { field: { type: 'string' }, value: { type: 'string' }, w: { type: 'number' }, d: { type: 'number' }, wall: { type: 'string' }, roofType: { type: 'string' }, pitch: { type: 'number' }, southWallHeightFt: { type: 'number' }, northWallHeightFt: { type: 'number' }, h: { type: 'number' } },
  rooms: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, d: { type: 'number' }, level: { type: 'number' } },
  openings: { wall: { type: 'string' }, openingType: { type: 'string' }, widthFt: { type: 'number' }, positionFt: { type: 'number' } },
  elements: { name: { type: 'string' }, category: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, d: { type: 'number' }, h: { type: 'number' }, level: { type: 'number' }, widthFt: { type: 'number' }, positionFt: { type: 'number' }, construction: { type: 'string' } }
};
export function passResponseSchema(passKey, types) {
  return geminiSchema({
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      summary: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: { type: { type: 'string', enum: types }, ...(PASS_FIELDS[passKey] || {}) }
        }
      }
    }
  });
}

// Pure: keep only the pass's whitelisted op types. Exported for tests.
export function filterOpsForPass(ops, types) {
  const allowed = new Set(types);
  return (Array.isArray(ops) ? ops : []).filter((op) => op && allowed.has(op.type));
}

async function stagedTracePlan({ attachmentParts, geminiResponseSchema, note, escalate = false }) {
  const collected = { structure: [], rooms: [], openings: [], elements: [] };
  for (const pass of TRACE_PASSES) {
    note?.(pass.note);
    let res;
    try {
      // Pass-specific schema + tight cap: the full 24-field op schema invited
      // a digit-loop degeneration (33k chars of '0' logged) — fewer number
      // fields to loop in, and any future loop dies at 8k tokens in seconds.
      const model = (escalate && (pass.key === 'rooms' || pass.key === 'openings')) ? GEMINI_PRO_MODEL : undefined;
      res = await callGemini({ parts: [{ text: `${pass.text}\n${TRACE_CONVENTIONS}` }, ...attachmentParts], responseSchema: passResponseSchema(pass.key, pass.types), maxOutputTokens: 8192, model });
    } catch {
      res = null;
    }
    let ops = null;
    let raw = 0;
    if (res?.ok) {
      try {
        const parsed = JSON.parse(res.text)?.operations;
        raw = Array.isArray(parsed) ? parsed.length : 0;
        ops = filterOpsForPass(parsed, pass.types);
      } catch { ops = null; }
    }
    if (ops === null) {
      // Unreadable usually means the reply outran the token cap — one retry
      // asking for a tighter list (the classic single call retries the same).
      try {
        const model = (escalate && (pass.key === 'rooms' || pass.key === 'openings')) ? GEMINI_PRO_MODEL : undefined;
        res = await callGemini({ parts: [{ text: `Your previous reply was truncated or unreadable. Same task again, but reply with FEWER, tighter operations — at most 30, the most important first.
${pass.text}
${TRACE_CONVENTIONS}` }, ...attachmentParts], responseSchema: passResponseSchema(pass.key, pass.types), maxOutputTokens: 8192, model });
      } catch { res = null; }
      if (res?.ok) {
        try {
          const parsed = JSON.parse(res.text)?.operations;
          raw = Array.isArray(parsed) ? parsed.length : 0;
          ops = filterOpsForPass(parsed, pass.types);
        } catch { ops = null; }
      }
    }
    if (ops === null || (pass.required && !ops.length)) {
      // Say exactly HOW a pass came up short — "the call failed",
      // "unreadable reply", and "wrong op types" point at different fixes.
      const why = !res?.ok ? 'the call failed' : ops === null ? 'unreadable reply' : raw > 0 ? `${raw} ops of the wrong type` : 'empty reply';
      if (ops === null && res?.ok) {
        // Keep the evidence: WHY do staged replies still truncate with
        // thinking off? The tail of the raw text is the diagnosis.
        try {
          fs.appendFileSync('.data/server-errors.log', `${new Date().toISOString()} staged-pass-unreadable ${pass.key} len=${res.text?.length || 0} tail=${JSON.stringify(String(res.text || '').slice(-300))}
`);
        } catch { /* logging never breaks tracing */ }
      }
      note?.(`${pass.key} pass came up short (${why})${pass.required ? ' — falling back to a whole-set read…' : ', continuing…'}`);
      if (pass.required) return null; // structural pass failed — classic trace
      collected[pass.key] = [];
      continue;
    }
    note?.(`${pass.key}: ${ops.length} read`);
    collected[pass.key] = ops;
  }
  const roomCount = collected.rooms.length;
  if (roomCount < 2) return null;
  return {
    summary: `Traced in ${TRACE_PASSES.length} focused passes: ${roomCount} rooms, ${collected.openings.length} openings, ${collected.elements.length} elements.`,
    operations: [...collected.structure, ...collected.rooms, ...collected.openings, ...collected.elements],
    warnings: [],
    assumptions: [],
    questions: []
  };
}

export async function aiPlan(payload) {
  if (!hasGemini() && !process.env.OPENAI_API_KEY) return localPlan(payload);
  const startedAt = Date.now();
  // Progress notes for the async trace-job path; absent = no-op everywhere.
  const note = typeof payload.onNote === 'function' ? payload.onNote : null;
  const auditBudgetMs = Number(payload.auditBudgetMs) || AUDIT_TIME_BUDGET_MS;
  if ((payload.attachedImages || []).length) note?.('Reading the drawing…');

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
  if (cached && payload.bypassCache !== true) return { ...cached, source: `${cached.source || 'ai-planner'}-cache` };

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
  // "Re-check the trace against the drawing" = audit-only: compare the model
  // as it stands to the drawing and fix discrepancies — NOT a full re-trace.
  const asksAudit = /\b(re-?check|audit|verify|double-?check)\b[^.?!]*\b(trace|traced|drawing|plans?|pdf|model)\b/i.test(promptText);
  const freshTrace = hasAttachments && !asksAudit && (asksForTrace || (existingRooms <= 1 && existingOpenings <= 2));
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
RULES: If the plan shows 11 rooms, emit 11 add_room operations. MEASURE, never default: every room's x/y/w/d must be read from the plan — real rooms come in different sizes, so emitting many rooms with identical w x d is an ERROR, not a takeoff. UNLABELED PLANS: many as-built plans have NO room name text — the rooms are still there, drawn as enclosed spaces. Walk every enclosed space wall by wall, measure it against the overall dimension strings and the graphic scale, and NAME it from its fixtures (tub/toilet = Bathroom, counters/stove/sink run = Kitchen, washer/dryer = Laundry, the large open space = Living, small doored rooms = Bedrooms); add a warning that names were inferred from fixtures. Rooms tile the floor plate: if your rooms cover well under the shell's area, you missed spaces. All coordinates are ≥ 0 from the shell's northwest corner. The shell w x d is the CONDITIONED footprint's overall dimension strings; attached greenhouses, sunspaces, and covered outdoor areas drawn OUTSIDE the conditioned line are add_element items, NOT part of the shell. NEVER write "noted for future refinement" or defer anything — emit the operation instead. BASEMENTS ARE MODELED: a below-grade storey = set_shell field:'basementHeightFt' value:'8' (read the real height from the section if drawn) plus ONE add_room with level:-1 per basement room. A basement still does NOT count toward field:'storeys' (that's above-grade only). In the summary, report counts: "Traced: shell WxD, N rooms, M openings." If a page is illegible, say which page in warnings and keep going with the rest.
THE SHELL IS THE CONDITIONED ENVELOPE — set_shell w/d (or set_footprint) covers ONLY the enclosed heated building read from its dimension strings. Carports, porches, decks, and detached structures are NEVER part of the shell: each is its own add_element (category carport/porch/deck) at its drawn position.
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
FLOOR STACKS: when the user says a room IS a floor ("the loft is the 2nd floor", "the tower is a 3rd floor above the loft"), set that ROOM's level with update_object field:'level' value:'2' (or '3') — the app raises the storey count, moves the room to its storey's elevation, and keeps one extent plate per level automatically. If the named room doesn't exist yet (e.g. no loft room), add_room it with level:N over its base room's bay. Never emit a full-footprint floor plate for a partial storey, and never invent a z — the app computes storey elevations.
Stacking: for localized requests like "a loft above the kitchen" or "a tower above that", look up the base room's x/y/w/d in the BIM state and REUSE that footprint. Use add_loft (category loft) or add_tower (category tower) as VOLUMES: set z to the top of whatever it sits on (ground rooms top out at shell.wallHeightFt; a stacked element's top is its z + h) and give a real h (a loft 7-8 ft, a tower room 8-10 ft per storey). Chain them: the second element's z = the first element's z + its h. Reserve add_level for a full new storey across the whole footprint.
For wall system changes, use set_assembly. Per-side wall systems use set_wall_side with wall and field 'assembly'; assembly values include straw-bale, hemp-lime, cob, rammed-earth, cordwood, light-straw-clay, framed, sips (fast standard panel), ply-insulated (marine ply + rigid insulation — light and quick for upper storeys), icf, and glazed — 'glazed' is a GLASS WALL (a whole face of glazing, e.g. an attached greenhouse or sunspace south face), not windows in a wall.
EXTERIOR CLADDING: set_wall_side field 'cladding' with render (plaster, the default) | lap (wood lap siding) | boardbatten | shingle (cedar) | metal (standing seam) | stucco | stone | brick — per wall side, priced per face sf and drawn with its own material.
ATTACHED SOLAR GREENHOUSE FACE (kneewall + angled glazing): per-side heights go down to 2' — set_wall_side field 'heightFt' value 3 makes a bale kneewall; then set_wall_side field 'sunGlazing' value 'true' (+ optional field 'sunGlazingTiltDeg', 0-45 from vertical, default 30) draws angled glazing from the kneewall top to the eave, carried by the structural frame and counted in solar gain.
WALL SEGMENTS: on a custom outline, resize_wall_segment with field 'e<index>' sets one segment's length (value, ft) and/or its start along the wall (positionFt, ft; 0 = keep). The jog corners slide with it. A segment can also run its OWN construction — set_wall_side with wall set to the edge key (e0, e1, …) and field 'assembly'/'thicknessFt'/'cladding'/'interiorFinish'/'exteriorFinish' changes just that piece, so one side can mix frame sections with infill sections (e.g. "the east wall is timber-frame bays with straw-clay infill between": split_wall_edge wall:'east' first if it is still one piece, then set the middle e-key to 'framed' and the outer e-keys to 'light-straw-clay'). Assembly value '' hands the section back to its side. Height and omit stay whole-side fields.
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

    // Job-mode fresh traces read the set in FOCUSED PASSES first; anything
    // less than a structural success falls through to the classic one call.
    let plan = null;
    if (freshTrace) {
      const runTakeoff = async (escalate) => {
        let takeoffPlan = null;
        if (payload.jobMode === true) {
          const stagedParts = geminiParts(content.filter((c) => c.type === 'input_image'));
          if (stagedParts.length) {
            takeoffPlan = await stagedTracePlan({ attachmentParts: stagedParts, geminiResponseSchema, note, escalate });
            if (takeoffPlan) takeoffPlan.warnings.push('Read the set in four focused passes (structure, rooms, openings, elements).');
            else note?.('Focused passes came up short — reading the whole set in one pass instead…');
          }
        }
        if (!takeoffPlan) {
          let res = await callGemini({ parts: geminiParts(content), responseSchema: geminiResponseSchema, model: escalate ? GEMINI_PRO_MODEL : undefined });
          if (!res.ok) {
            const fallback = localPlan(payload);
            fallback.warnings.unshift(`AI planner unavailable: ${res.status} ${res.errorText.slice(0, 160)}`);
            return fallback;
          }
          try {
            takeoffPlan = JSON.parse(res.text);
          } catch {
            // Truncated/garbled output: one retry asking for a tighter plan instead
            // of dropping the user's turn on the floor.
            res = await callGemini({
              parts: [{ text: 'Your previous response was truncated mid-JSON. Reply again with FEWER, higher-level operations (at most 30, most important first) and shorter reason strings.' }, ...geminiParts(content)],
              responseSchema: geminiResponseSchema,
              model: escalate ? GEMINI_PRO_MODEL : undefined
            });
            try {
              takeoffPlan = res.ok ? JSON.parse(res.text) : null;
            } catch { takeoffPlan = null; }
            if (!takeoffPlan) {
              const fallback = localPlan(payload);
              fallback.warnings.unshift('AI planner returned unreadable JSON twice — try again, or break the request into smaller steps.');
              return fallback;
            }
          }
        }

        const attachmentParts = geminiParts(content.filter((c) => c.type === 'input_image'));
        note?.('Indexing the drawing set…');
        let manifest = null;
        try { manifest = sanitizeManifest(await extractDrawingManifest({ attachmentParts })); } catch { manifest = null; }
        
        takeoffPlan = scrubDeadOperations(takeoffPlan);
        takeoffPlan = reclassifyOutdoorRooms(takeoffPlan);
        takeoffPlan = repairBasementRooms(takeoffPlan, sourceSpec);
        takeoffPlan = repairTraceGeometry(takeoffPlan, sourceSpec);
        note?.('Completeness check…');
        takeoffPlan = await repairTraceIfNeeded(takeoffPlan, { attachmentParts, sourceSpec, manifest, escalate });
        takeoffPlan = applyDeterministicRescues(takeoffPlan, sourceSpec);
        
        // A hard set (an unlabeled as-built) can need a SECOND focused repair —
        // one round fixed the room list but left sizes/openings under-read.
        // repairTraceIfNeeded no-ops when the check is already clean.
        if (traceLooksIncomplete(takeoffPlan, sourceSpec, manifest).incomplete) {
          note?.('Second completeness pass…');
          takeoffPlan = await repairTraceIfNeeded(takeoffPlan, { attachmentParts, sourceSpec, manifest, escalate });
          takeoffPlan = applyDeterministicRescues(takeoffPlan, sourceSpec);
        }
        // CYCLE until faithful: simulate the applied model, show the AI its own
        // result next to the drawing, take its corrections, check again.
        takeoffPlan = await auditTraceLoop(takeoffPlan, { attachmentParts, sourceSpec, startedAt, budgetMs: auditBudgetMs, note, escalate });
        // The audit merges NEW ops (it added a greenhouse "room" once) — every
        // deterministic rescue must run again on them, not just a subset.
        takeoffPlan = applyDeterministicRescues(takeoffPlan, sourceSpec);
        // Surface the index honestly: what the sheets list vs what got traced.
        if (manifest) {
          const finalGaps = manifestGaps(takeoffPlan, sourceSpec, manifest);
          if (finalGaps) {
            takeoffPlan.warnings = [...(takeoffPlan.warnings || []),
              `Drawing index: ${finalGaps.roomNames.length} rooms, ${finalGaps.windowCount} windows, ${finalGaps.doorCount} doors across ${finalGaps.sheetCount} sheet${finalGaps.sheetCount === 1 ? '' : 's'} — takeoff covers ${finalGaps.roomsCovered} of ${finalGaps.roomNames.length} rooms.`];
          }
        }
        return takeoffPlan;
      };

      plan = await runTakeoff(false);
      const isFallback = String(plan?.source || '').startsWith('local');
      if (!isFallback) {
        let report = applyBimOperations(sourceSpec, plan);
        let checks = scoreTrace(report.spec, plan);
        let passedCount = checks.filter((c) => c.pass).length;
        const totalChecks = checks.length;
        
        autoCaptureTrace(payload.attachedImages, plan, report.spec, checks);

        if (passedCount < 10) {
          note?.(`Trace score below gate (${passedCount}/${totalChecks} checks passed) — auto-retrying once with escalated model tier…`);
          plan = await runTakeoff(true);
          report = applyBimOperations(sourceSpec, plan);
          checks = scoreTrace(report.spec, plan);
          passedCount = checks.filter((c) => c.pass).length;
          autoCaptureTrace(payload.attachedImages, plan, report.spec, checks);
        }

        const scoreMessage = formatPlainLanguageScore(checks);
        plan.summary = `${scoreMessage}\n\n${plan.summary || ''}`;
        // Ride the score on the plan: applyBimOperations stamps it onto the
        // design (spec.traceReview) so the doubts show as Review flags.
        plan.traceScore = {
          when: new Date().toISOString(),
          passed: passedCount,
          total: totalChecks,
          checks
        };
      }
    } else {
      let res = await callGemini({ parts: geminiParts(content), responseSchema: geminiResponseSchema });
      if (!res.ok) {
        const fallback = localPlan(payload);
        fallback.warnings.unshift(`AI planner unavailable: ${res.status} ${res.errorText.slice(0, 160)}`);
        return fallback;
      }
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

export function scoreTrace(spec, plan) {
  // Support both (spec, plan) and ({ spec, plan })
  let targetSpec = spec;
  let targetPlan = plan;
  if (spec && !plan && spec.spec && spec.plan) {
    targetSpec = spec.spec;
    targetPlan = spec.plan;
  }

  // The spec-derived invariants live in bim-core (scoreTraceSpecChecks) so the
  // Review panel can re-run them live against the current design. This fixes a
  // real bug too: the old inline copies read `spec.` instead of `targetSpec.`
  // in the basement and partition checks, so those passed vacuously whenever
  // scoreTrace was called with the ({ spec, plan }) object form (the corpus
  // test calls it exactly that way).
  const checks = scoreTraceSpecChecks(targetSpec);
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail });

  // Shell agrees with the drawing's own dimension strings (when indexed)
  const idx = (targetPlan?.warnings || []).find((w) => /drawing index/i.test(w)) || '';
  const devWarn = (targetPlan?.warnings || []).some((w) => /dimension strings say/i.test(w));
  add('shell matches the drawing index (or no index)', !devWarn, idx.slice(0, 60));

  // Self-check convergence: corrections must not grow round over round
  const roundFixes = (targetPlan?.warnings || [])
    .map((w) => /self-check round (\d+): corrected (\d+)/i.exec(w))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => Number(m[2]));
  add('self-check converging (fixes not growing)', roundFixes.length < 2 || roundFixes[1] <= roundFixes[0], roundFixes.join(' -> '));

  return checks;
}

export function formatPlainLanguageScore(checks) {
  const passed = checks.filter(c => c.pass).length;
  const total = checks.length;
  if (passed === total) {
    return `Read your drawing — ${passed} of ${total} checks passed.`;
  }

  const failedList = checks.filter(c => !c.pass);
  const details = failedList.map(c => {
    if (c.name === 'every ground-floor room inside the shell') return 'some rooms sit outside the building';
    if (c.name === "rooms don't pile on each other") return 'some rooms overlap';
    if (c.name === 'rooms cover the floor plan (no skipped spaces)') return 'some spaces were skipped';
    if (c.name === 'a believable number of openings') return 'some windows or doors were missed';
    if (c.name === 'openings sit within their walls') return 'some openings are out of range';
    if (c.name === 'interior walls inside the shell') return 'some partition walls are misplaced';
    if (c.name === 'rooms individually measured (no placeholder run)') return 'some rooms have default sizes';
    if (c.name === 'traced at least 2 rooms') return 'too few rooms were detected';
    return c.name;
  }).join(' and ');

  return `Read your drawing — ${passed} of ${total} checks passed. (${details || 'some items may sit wrong'}; tap Review to see them.)`;
}

export function autoCaptureTrace(attachedImages, plan, spec, checks, baseDir = process.cwd()) {
  // Every real trace quietly builds the regression corpus. Captures live in
  // trace-corpus/captured/ — a SUBFOLDER, because the corpus sweep runs every
  // PDF in the top-level folder and would otherwise re-run (and pay for)
  // every capture on every sweep. Curating a capture into the corpus = moving
  // its PDF up one level. The same drawing traced twice keeps ONE pdf (content
  // hash in the name) and one result json per run.
  try {
    const capturedDir = path.join(baseDir, '.data', 'trace-corpus', 'captured');
    if (!fs.existsSync(capturedDir)) {
      fs.mkdirSync(capturedDir, { recursive: true });
    }

    for (const image of (attachedImages || [])) {
      if (typeof image.src === 'string' && image.src.startsWith('data:application/pdf;base64,')) {
        const match = image.src.match(/^data:application\/pdf;base64,(.*)$/);
        if (!match) continue;
        const buffer = Buffer.from(match[1], 'base64');

        const cleanName = slugify(image.name.replace(/\.[^/.]+$/, ''));
        const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 8);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const pdfFilename = `${cleanName}-${hash}.pdf`;
        const jsonFilename = `${cleanName}-${hash}-${timestamp}.result.json`;

        const pdfPath = path.join(capturedDir, pdfFilename);
        if (!fs.existsSync(pdfPath)) fs.writeFileSync(pdfPath, buffer);

        const meta = {
          when: new Date().toISOString(),
          originalName: image.name,
          pdf: pdfFilename,
          score: {
            passed: checks.filter(c => c.pass).length,
            total: checks.length,
            checks
          },
          plan,
          spec
        };
        fs.writeFileSync(path.join(capturedDir, jsonFilename), JSON.stringify(meta, null, 2));
      }
    }
  } catch (error) {
    console.error('Failed to auto-capture trace:', error);
  }
}
