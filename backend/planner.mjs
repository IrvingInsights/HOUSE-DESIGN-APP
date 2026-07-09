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
              'set_site', 'set_utility', 'set_overhang'
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
  const traceMandate = hasAttachments ? `
A DRAWING OR DOCUMENT IS ATTACHED. Your job is a COMPLETE takeoff, not a summary:
1. set_shell from the overall plan dimensions: ONE op carrying BOTH numbers — w AND d (e.g. w:40.5, d:23, field:'', value:''). Never set only one dimension. Read dimension strings; if none, scale from a labeled element like a 3'-0" door and record that in assumptions. If the drawing shows multiple above-grade storeys, also set_shell field:'storeys'.
2. ONE add_room PER ROOM visible on the floor plan — every single one — with its real name and x/y/w/d in feet. Plan coordinates: origin at the northwest corner of the shell, x increases east, y increases south. Rooms on an upper floor get level 2 (or 3).
3. ONE add_opening PER WINDOW AND DOOR with wall (north/south/east/west), openingType, widthFt, and positionFt along that wall.
4. Porches, decks, garages, and outbuildings: add_element with a fitting category and real dimensions.
RULES: If the plan shows 11 rooms, emit 11 add_room operations. NEVER write "noted for future refinement" or defer anything — emit the operation instead. Basements/below-grade storeys are NOT modeled: put their contents in warnings, model only above-grade storeys. In the summary, report counts: "Traced: shell WxD, N rooms, M openings." If a page is illegible, say which page in warnings and keep going with the rest.
MODEL WHAT THE DRAWING SHOWS — many documents are EXISTING conventional houses being modified, not natural builds. A framed house gets framed walls (set_wall_side field=assembly value=framed, or set_assembly), a slab stays a slab (set_utility foundationType), standard storeys stay standard. Do NOT convert the building to natural systems unless the user asks. Mine EVERY page for usable data: dimension strings, room and door/window schedules, elevation heights (wall heights, storeys), roof type and pitch, site plans (lot, setbacks, orientation -> set_site), and existing-condition notes (put constraints the model can't express into warnings/assumptions so nothing is lost).
` : '';

  const content = [
    {
      type: 'input_text',
      text: `You are the BIM planning brain for a natural building 3D design dashboard.
Return only structured operations. Do not invent dimensions from drawings unless visible and reasonably inferable.
${traceMandate}
Prefer real model changes over prose. If the user asks for floors, lofts, towers, site objects, unusual natural-building forms, or arbitrary elements, create add_level or add_element operations.
Stacking: for localized requests like "a loft above the kitchen" or "a tower above that", look up the base room's x/y/w/d in the BIM state and REUSE that footprint. Use add_loft (category loft) or add_tower (category tower) as VOLUMES: set z to the top of whatever it sits on (ground rooms top out at shell.wallHeightFt; a stacked element's top is its z + h) and give a real h (a loft 7-8 ft, a tower room 8-10 ft per storey). Chain them: the second element's z = the first element's z + its h. Reserve add_level for a full new storey across the whole footprint.
For wall system changes, use set_assembly. For roofs, use set_roof. For openings, use add_opening with wall/type/width/position; openingType may be window, picture, awning, clerestory, door, french (french doors), slider, dutch, barn, bay (bay window), or skylight (wall "roof", place with x and y plan coordinates).
For water/waste/power/heat choices use set_utility with field one of waterSource (well|spring|catchment|town), wasteMethod (septic|composting|reedbed), powerMode (offgrid|hybrid|gridtie), heatSource (rocket_mass|masonry|wood_stove|minisplit), foundationType (rubble|stemwall|slab), tankGal, wellSepticFt, stemwallHeightFt (feet, for stem wall foundations), diyWalls/diyRoof/diyHeat/diyFoundation. For location use set_site with field zip, latitudeDeg, or rainInYr.
For roof overhangs use set_overhang with wall (north|south|east|west|all) and value in feet.
Validate basic constructability and put concerns in warnings, not as refusal.

Current BIM state:
${JSON.stringify(compactSpec)}

Context packet:
${JSON.stringify(payload.contextPacket || {}, null, 2)}

User prompt:
${payload.prompt}`
    }
  ];

  for (const image of (payload.attachedImages || []).slice(0, OPENAI_IMAGE_MAX)) {
    if (/^data:(image\/|application\/pdf|text\/)/.test(image.src || '')) {
      content.push({ type: 'input_image', image_url: image.src });
    }
  }

  if (hasGemini()) {
    const res = await callGemini({ parts: geminiParts(content), responseSchema: geminiSchema(operationSchema) });
    if (!res.ok) {
      const fallback = localPlan(payload);
      fallback.warnings.unshift(`AI planner unavailable: ${res.status} ${res.errorText.slice(0, 160)}`);
      return fallback;
    }
    let plan;
    try {
      plan = JSON.parse(res.text);
    } catch (error) {
      const fallback = localPlan(payload);
      fallback.warnings.unshift(`AI planner returned unreadable JSON: ${String(error?.message || error).slice(0, 120)}`);
      return fallback;
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
