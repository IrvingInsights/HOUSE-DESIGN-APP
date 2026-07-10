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
  'framed':           { key: 'framed',           label: 'Framed (vapor-open)', thicknessFt: 0.55, color: 0xd9d5c8, rValue: 23, finish: 'plaster / cladding' },
  // A GLASS WALL — the whole face is glazing in a timber frame (an attached
  // greenhouse's south face), not windows punched into an opaque wall. The
  // engine treats its face area as glass: solar gain, glazing heat loss,
  // glazing-rate cost.
  'glazed':           { key: 'glazed',           label: 'Glazed (glass wall)', thicknessFt: 0.35, color: 0xaecfd8, rValue: 2,  finish: 'timber-framed glazing' }
};

// Interior partition walls — thin walls BETWEEN rooms, placed as elements
// (category 'partition'). Distinct from the envelope: no weather duty, so
// they price by face area of the chosen construction.
export const PARTITION_TYPES = {
  framed: { key: 'framed', label: 'Light framed (stud)', thicknessFt: 0.45, costPsf: 8,  carbonPsf: 3, color: 0xd9d5c8 },
  cob:    { key: 'cob',    label: 'Cob (thermal mass)',  thicknessFt: 0.8,  costPsf: 14, carbonPsf: 6, color: 0xb9835e },
  adobe:  { key: 'adobe',  label: 'Adobe brick',         thicknessFt: 0.7,  costPsf: 12, carbonPsf: 5, color: 0xa87f5e }
};

// Basement: a real below-grade storey. shell.basementHeightFt > 0 turns it on;
// rooms live at level -1 (NOT 0 — ops and readers treat 0 as "unset", the same
// zero-filled-op trap that bit storey plates and z-moves).
export const BASEMENT_LEVEL = -1;
export function basementInfo(shell = {}) {
  const raw = Number(shell?.basementHeightFt || 0);
  const heightFt = raw > 0 ? Math.min(12, Math.max(6, raw)) : 0;
  return { heightFt, present: heightFt > 0 };
}

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

// Resolve the effective spec for one wall side, falling back from per-side
// override -> global shell/envelope defaults. This is the single reader the
// UI, the 3D build, the schedule, and the Blender bridge all go through.
export function resolveWallSide(spec, side, level = 1) {
  const shell = spec.shell || {};
  const w = (spec.walls || {})[side] || {};
  const assemblyKey = w.assembly && WALL_ASSEMBLIES[w.assembly] ? w.assembly : wallAssemblyKeyFromText(shell && spec.systems ? spec.systems.envelope : '');
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
    omitted: Boolean(w.omitted) || omittedSet.has(side)
  };
  if (level <= 1) return ground;
  // Upper storeys: per-side overrides in spec.wallsUpper fall back to the
  // ground wall — so an upper storey can run a different construction
  // (light straw-clay over cob, framed over bale) without re-stating everything.
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

// --- Footprint polygon model (the geometry pass) -----------------------------
// The building outline is an explicit rectilinear polygon: ordered [x, y]
// vertices in feet, axis-aligned edges, positively oriented in plan coords
// (x → east, y → south; the derived rectangle [[0,0],[w,0],[w,d],[0,d]] walks
// north wall → east wall → south wall → west wall). No spec.shell.footprint
// field → the plain widthFt × depthFt rectangle, so EVERY legacy design keeps
// its exact current behavior. The bounding box is always anchored at (0,0):
// footprint edits re-anchor and carry rooms/openings/elements along.
// Consecutive collinear edges are allowed — they are intentional split points
// ("split this wall, then move the middle" is how an L-shape is born).

export function footprintRect(shell = {}) {
  const w = Number(shell.widthFt) || 36;
  const d = Number(shell.depthFt) || 28;
  return [[0, 0], [w, 0], [w, d], [0, d]];
}

function signedArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % vertices.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

export function polygonArea(vertices) {
  return Math.abs(signedArea(vertices || []));
}

export function polygonPerimeter(vertices) {
  let length = 0;
  for (let i = 0; i < (vertices || []).length; i += 1) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % vertices.length];
    length += Math.abs(x1 - x0) + Math.abs(y1 - y0);
  }
  return length;
}

export function footprintBounds(vertices) {
  const xs = (vertices || []).map((v) => v[0]);
  const ys = (vertices || []).map((v) => v[1]);
  if (!xs.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, d: 0 };
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

// A footprint that is just the plain rectangle (4 corners spanning its own
// bounding box) — such designs stay on the legacy field-free representation.
export function isRectFootprint(vertices) {
  if (!Array.isArray(vertices)) return false;
  const cleaned = mergeCollinear(vertices);
  if (cleaned.length !== 4) return false;
  const b = footprintBounds(cleaned);
  return cleaned.every(([x, y]) => (x === b.minX || x === b.maxX) && (y === b.minY || y === b.maxY));
}

// Validate + clean raw vertices: numbers snapped to 0.1', axis-aligned edges,
// zero-length edges dropped, positive orientation enforced. Collinear split
// points are KEPT. Returns null when the outline isn't a usable footprint.
export function normalizeFootprint(raw) {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > 24) return null;
  let vertices = raw.map((v) => [Math.round(Number(v?.[0]) * 10) / 10, Math.round(Number(v?.[1]) * 10) / 10]);
  if (vertices.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  // Snap near-axis-aligned edges; reject genuinely diagonal ones.
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dx = Math.abs(a[0] - b[0]);
    const dy = Math.abs(a[1] - b[1]);
    if (dx > 0.05 && dy > 0.05) {
      if (Math.min(dx, dy) > 0.5) return null;
      if (dx < dy) b[0] = a[0]; else b[1] = a[1];
    }
  }
  // Drop zero-length edges + backtracking spikes (a→b→a).
  let changed = true;
  while (changed && vertices.length >= 4) {
    changed = false;
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      if (a[0] === b[0] && a[1] === b[1]) { vertices.splice((i + 1) % vertices.length, 1); changed = true; break; }
      const c = vertices[(i + 2) % vertices.length];
      if (a[0] === c[0] && a[1] === c[1]) {
        // spike out-and-back — remove the far point and the duplicate
        const j = (i + 1) % vertices.length;
        vertices = vertices.filter((_, k) => k !== j && k !== (i + 2) % vertices.length);
        changed = true;
        break;
      }
    }
  }
  if (vertices.length < 4) return null;
  if (polygonArea(vertices) < 40) return null;
  if (signedArea(vertices) < 0) vertices.reverse();
  return vertices;
}

function mergeCollinear(vertices) {
  const out = [];
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const alongX = prev[1] === cur[1] && cur[1] === next[1];
    const alongY = prev[0] === cur[0] && cur[0] === next[0];
    if (!alongX && !alongY) out.push(cur);
  }
  return out.length >= 4 ? out : vertices.slice();
}

// The polygon in effect — explicit footprint, or the legacy rectangle.
export function footprintPolygon(spec) {
  const normalized = normalizeFootprint(spec?.shell?.footprint);
  return normalized || footprintRect(spec?.shell);
}

// True when the design carries a real (non-rectangular) footprint.
export function hasCustomFootprint(spec) {
  const normalized = normalizeFootprint(spec?.shell?.footprint);
  return Boolean(normalized && !isRectFootprint(normalized));
}

const FACING_BY_NORMAL = { '0,-1': 'north', '0,1': 'south', '1,0': 'east', '-1,0': 'west' };

// Walls are the edges of the polygon. Each edge knows its facing direction —
// wall construction stays keyed by facing (all north-facing edges share the
// 'north' wall settings), so resolveWallSide keeps working unchanged and the
// cardinal names remain aliases while the footprint is a plain rectangle.
export function footprintEdges(spec) {
  const vertices = footprintPolygon(spec);
  const n = vertices.length;
  const edges = [];
  const facingCount = {};
  for (let i = 0; i < n; i += 1) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    const horizontal = y0 === y1;
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    const facing = FACING_BY_NORMAL[`${dy},${-dx}`] || 'north';
    facingCount[facing] = (facingCount[facing] || 0) + 1;
    edges.push({
      index: i,
      key: `e${i}`,
      x0, y0, x1, y1,
      horizontal,
      facing,
      facingSeq: facingCount[facing],
      lengthFt: Math.abs(x1 - x0) + Math.abs(y1 - y0),
      // outward unit normal
      nx: dy,
      ny: -dx
    });
  }
  return edges;
}

export function pointInFootprint(vertices, x, y) {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Decompose the rectilinear polygon into horizontal slab rectangles that
// exactly cover it (used for roof segments, containment, and plan fills).
export function decomposeFootprint(vertices) {
  const ys = [...new Set(vertices.map((v) => v[1]))].sort((a, b) => a - b);
  const rects = [];
  for (let band = 0; band < ys.length - 1; band += 1) {
    const y0 = ys[band];
    const y1 = ys[band + 1];
    const midY = (y0 + y1) / 2;
    // x positions of vertical edges crossing this band
    const crossings = [];
    const n = vertices.length;
    for (let i = 0; i < n; i += 1) {
      const [ax, ay] = vertices[i];
      const [bx, by] = vertices[(i + 1) % n];
      if (ax === bx && Math.min(ay, by) <= midY && Math.max(ay, by) >= midY) crossings.push(ax);
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const x0 = crossings[k];
      const x1 = crossings[k + 1];
      if (x1 - x0 > 0.01) rects.push({ x: x0, y: y0, w: x1 - x0, d: y1 - y0 });
    }
  }
  // Merge vertically adjacent slabs with the same x-range so an L reads as
  // two clean rectangles, not a stack of thin bands.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i], b = rects[j];
        if (a.x === b.x && a.w === b.w && Math.abs(a.y + a.d - b.y) < 0.01) {
          rects[i] = { x: a.x, y: a.y, w: a.w, d: a.d + b.d };
          rects.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return rects;
}

function rectIntersectionArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return w > 0 && d > 0 ? w * d : 0;
}

// Exact containment for rectilinear polygons: the rect is inside iff the
// decomposed pieces cover its whole area.
export function rectInFootprint(vertices, rect) {
  const covered = decomposeFootprint(vertices).reduce((sum, piece) => sum + rectIntersectionArea(piece, rect), 0);
  return covered >= rect.w * rect.d - 0.05;
}

// rectA − rectB as up to four rectangles (the stepped-roof remainder math).
export function subtractRect(a, b) {
  const out = [];
  const ix0 = Math.max(a.x, b.x), ix1 = Math.min(a.x + a.w, b.x + b.w);
  const iy0 = Math.max(a.y, b.y), iy1 = Math.min(a.y + a.d, b.y + b.d);
  if (ix1 <= ix0 || iy1 <= iy0) return [{ ...a }];
  if (iy0 > a.y) out.push({ x: a.x, y: a.y, w: a.w, d: iy0 - a.y });
  if (iy1 < a.y + a.d) out.push({ x: a.x, y: iy1, w: a.w, d: a.y + a.d - iy1 });
  if (ix0 > a.x) out.push({ x: a.x, y: iy0, w: ix0 - a.x, d: iy1 - iy0 });
  if (ix1 < a.x + a.w) out.push({ x: ix1, y: iy0, w: a.x + a.w - ix1, d: iy1 - iy0 });
  return out.filter((r) => r.w > 0.05 && r.d > 0.05);
}

// footprint − rect, as rectangles (lower-roof regions around a partial storey).
export function subtractRectFromFootprint(vertices, rect) {
  return decomposeFootprint(vertices).flatMap((piece) => subtractRect(piece, rect));
}

// Offset every edge outward by its facing's overhang and rebuild the outline —
// exact roof-plan area over any rectilinear footprint. (Consecutive collinear
// edges get the same offset, so they are merged first.)
export function expandFootprint(vertices, offsets = {}) {
  const merged = mergeCollinear(vertices);
  const n = merged.length;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const [x0, y0] = merged[i];
    const [x1, y1] = merged[(i + 1) % n];
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    const facing = FACING_BY_NORMAL[`${dy},${-dx}`] || 'north';
    const off = Math.max(0, Number(offsets[facing]) || 0);
    lines.push(y0 === y1
      ? { horizontal: true, c: y0 + (facing === 'north' ? -off : off) }
      : { horizontal: false, c: x0 + (facing === 'east' ? off : -off) });
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    // consecutive edges alternate horizontal/vertical after merging
    const vx = cur.horizontal ? prev.c : cur.c;
    const vy = cur.horizontal ? cur.c : prev.c;
    out.push([vx, vy]);
  }
  return out;
}

// Translate an edge along its outward normal. Where a neighbor edge runs
// parallel (a collinear split point), a connector vertex is inserted so the
// jog becomes real — this is exactly how "move the middle of a split wall"
// turns a rectangle into an L. Returns normalized vertices, or null when the
// move would collapse the outline.
export function moveFootprintEdge(vertices, index, offsetFt) {
  const n = vertices.length;
  if (!Number.isFinite(offsetFt) || Math.abs(offsetFt) < 0.05) return vertices.slice();
  const i = ((index % n) + n) % n;
  const a = vertices[i];
  const b = vertices[(i + 1) % n];
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  const shiftX = dy * offsetFt;   // outward normal = (dy, -dx)
  const shiftY = -dx * offsetFt;
  const prev = vertices[(i - 1 + n) % n];
  const next = vertices[(i + 2) % n];
  const horizontal = a[1] === b[1];
  const prevParallel = horizontal ? prev[1] === a[1] : prev[0] === a[0];
  const nextParallel = horizontal ? next[1] === b[1] : next[0] === b[0];
  const movedA = [a[0] + shiftX, a[1] + shiftY];
  const movedB = [b[0] + shiftX, b[1] + shiftY];
  const out = [];
  for (let k = 0; k < n; k += 1) {
    if (k === i) {
      if (prevParallel) out.push([a[0], a[1]]);   // connector stays at the old corner
      out.push(movedA);
    } else if (k === (i + 1) % n) {
      out.push(movedB);
      if (nextParallel) out.push([b[0], b[1]]);
    } else {
      out.push(vertices[k]);
    }
  }
  return normalizeFootprint(out);
}

// Insert two split points along an edge (distances in feet from its start),
// so the middle piece can be moved independently. Defaults to thirds.
export function splitFootprintEdge(vertices, index, fromFt, toFt) {
  const n = vertices.length;
  const i = ((index % n) + n) % n;
  const a = vertices[i];
  const b = vertices[(i + 1) % n];
  const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  if (len < 6) return null; // too short to split into three walkable pieces
  let f = Number.isFinite(fromFt) && fromFt > 0 ? fromFt : len / 3;
  let t = Number.isFinite(toFt) && toFt > 0 ? toFt : (len * 2) / 3;
  f = clamp(Math.round(f * 2) / 2, 1, len - 2);
  t = clamp(Math.round(t * 2) / 2, f + 1, len - 1);
  const ux = Math.sign(b[0] - a[0]);
  const uy = Math.sign(b[1] - a[1]);
  const pA = [a[0] + ux * f, a[1] + uy * f];
  const pB = [a[0] + ux * t, a[1] + uy * t];
  const out = vertices.slice(0, i + 1);
  out.push(pA, pB);
  out.push(...vertices.slice(i + 1));
  return { vertices: out, middleIndex: i + 1 };
}

// Re-anchor the footprint's bounding box at (0,0) and carry every placed
// thing (rooms, elements, openings, site pad) along by the same shift, then
// write bbox dims back to shell.widthFt/depthFt. A footprint that is a plain
// rectangle drops the field entirely — the design returns to the legacy
// representation and behaves exactly as before the geometry pass.
export function anchorFootprint(next, vertices) {
  const bounds = footprintBounds(vertices);
  const dx = -bounds.minX;
  const dy = -bounds.minY;
  const shifted = vertices.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
  if (dx !== 0 || dy !== 0) {
    (next.rooms || []).forEach((room) => { room.x = Number(room.x || 0) + dx; room.y = Number(room.y || 0) + dy; });
    (next.elements || []).forEach((el) => { el.x = Number(el.x || 0) + dx; el.y = Number(el.y || 0) + dy; });
    (next.openings || []).forEach((opening) => {
      if (opening.wall === 'roof') { opening.x = Number(opening.x || 0) + dx; opening.y = Number(opening.y || 0) + dy; }
      else if (opening.wall === 'north' || opening.wall === 'south') opening.x = Number(opening.x || 0) + dx;
      else opening.y = Number(opening.y || 0) + dy;
    });
    if (next.shell.sitePad) {
      next.shell.sitePad.x = Number(next.shell.sitePad.x || 0) + dx;
      next.shell.sitePad.y = Number(next.shell.sitePad.y || 0) + dy;
    }
  }
  next.shell.widthFt = Math.round(bounds.w * 10) / 10;
  next.shell.depthFt = Math.round(bounds.d * 10) / 10;
  // Only a PURE 4-corner rectangle returns to the legacy representation —
  // a split rectangle (collinear points) must keep its field, or the split
  // would be erased before the middle segment could ever be moved.
  if (shifted.length === 4 && isRectFootprint(shifted)) delete next.shell.footprint;
  else next.shell.footprint = shifted;
}

// With a custom footprint, widthFt/depthFt describe the bounding box — a
// plain resize scales the polygon proportionally so the shape survives.
export function scaleFootprintAxis(next, axis, newSize) {
  if (!hasCustomFootprint(next)) return false;
  const poly = footprintPolygon(next);
  const bounds = footprintBounds(poly);
  const oldSize = axis === 'x' ? bounds.w : bounds.d;
  if (!(oldSize > 0) || Math.abs(newSize - oldSize) < 0.05) return true;
  const factor = newSize / oldSize;
  const scaled = poly.map(([x, y]) => (axis === 'x' ? [Math.round(x * factor * 2) / 2, y] : [x, Math.round(y * factor * 2) / 2]));
  const normalized = normalizeFootprint(scaled);
  if (normalized) anchorFootprint(next, normalized);
  return true;
}

// Which polygon edge an opening lives on: the edge with the opening's facing
// whose span contains it (fallback: the longest edge facing that way). On a
// plain rectangle this is always the single cardinal edge — legacy unchanged.
export function edgeForOpening(spec, opening) {
  const edges = footprintEdges(spec);
  const facing = opening?.wall;
  const candidates = edges.filter((edge) => edge.facing === facing);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const along = Number((facing === 'north' || facing === 'south') ? opening.x : opening.y) || 0;
  const mid = along + (Number(opening.widthFt) || 3) / 2;
  const containing = candidates.find((edge) => {
    const lo = Math.min(facing === 'north' || facing === 'south' ? edge.x0 : edge.y0, facing === 'north' || facing === 'south' ? edge.x1 : edge.y1);
    const hi = Math.max(facing === 'north' || facing === 'south' ? edge.x0 : edge.y0, facing === 'north' || facing === 'south' ? edge.x1 : edge.y1);
    return mid >= lo && mid <= hi;
  });
  return containing || candidates.reduce((best, edge) => (edge.lengthFt > best.lengthFt ? edge : best));
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
      // Partitions are legitimately thin — don't fatten a 0.45' stud wall to 1'.
      const minDim = element.category === 'partition' ? 0.3 : 1;
      const resized = {
        ...element,
        w: clamp(Number(element.w) || 1, minDim, spec.shell.widthFt + 48),
        d: clamp(Number(element.d) || 1, minDim, spec.shell.depthFt + 48)
      };
      return { ...resized, ...clampObjectPosition(spec, resized, resized.x || 0, resized.y || 0) };
    });
  }
}

function detectIssues(spec) {
  const issues = [];
  const poly = footprintPolygon(spec);
  const custom = hasCustomFootprint(spec);
  const enclosedRooms = spec.rooms.filter((room) => (custom
    ? rectInFootprint(poly, { x: room.x, y: room.y, w: room.w, d: room.d })
    : room.x >= 0 && room.y >= 0 && room.x + room.w <= spec.shell.widthFt && room.y + room.d <= spec.shell.depthFt));
  const conditionedArea = enclosedRooms.reduce((sum, room) => sum + room.w * room.d, 0);
  const shellArea = polygonArea(poly);

  // The passive-solar / homestead checks are the NATURAL approach's opinions —
  // valuable when chosen, noise when modeling a conventional house as-built.
  const naturalApproach = (spec.shell?.designApproach || 'natural') !== 'standard';
  if (conditionedArea > shellArea * 1.08) issues.push({ severity: 'critical', title: 'Room program exceeds shell area', owner: 'Architect', fix: 'Reduce room footprints or enlarge the shell before issuing drawings.' });
  if (!spec.rooms.some((room) => room.type === 'wet')) issues.push({ severity: 'critical', title: 'No wet core defined', owner: 'Engineer', fix: 'Add a bathroom/mechanical wet core and align plumbing walls.' });
  if (naturalApproach && !spec.openings.some((item) => item.type === 'door' && item.wall === 'south')) issues.push({ severity: 'warning', title: 'Primary entry lacks clear solar-side approach', owner: 'Designer', fix: 'Add or move the main entry to a legible approach with weather protection.' });
  if (naturalApproach && !spec.openings.some((item) => item.type === 'window' && item.wall === 'south')) issues.push({ severity: 'warning', title: 'Insufficient south-facing daylight strategy', owner: 'Permaculture', fix: 'Add balanced south glazing with summer shading and winter solar gain.' });
  if (spec.shell.wallHeightFt > 12) issues.push({ severity: 'warning', title: 'Tall walls need explicit lateral strategy', owner: 'Engineer', fix: 'Add shear wall schedule, hold-downs, and diaphragm notes.' });
  const glazedOffSouth = WALL_SIDES.filter((side) => { const r = resolveWallSide(spec, side); return !r.omitted && r.assemblyKey === 'glazed' && side !== 'south'; });
  if (naturalApproach && glazedOffSouth.length) issues.push({ severity: 'warning', title: `Glass wall faces ${glazedOffSouth.join(' + ')} — little solar gain, big heat leak`, owner: 'Natural Builder', fix: 'A glazed wall earns its keep facing south. Off-south glass loses heat all winter for little gain — face it south, or accept the heat cost knowingly.' });
  const basementBedroom = basementInfo(spec.shell).present && spec.rooms.find((room) => Number(room.level || 1) === BASEMENT_LEVEL && room.type === 'sleeping');
  if (basementBedroom) issues.push({ severity: 'critical', title: `${basementBedroom.name} is a basement bedroom — egress required`, owner: 'Engineer', fix: 'A below-grade sleeping room needs an egress window or a walkout door (min clear opening per code). Plan the well or walkout on the downhill side.' });
  if (String(spec.systems.envelope || '').toLowerCase().includes('natural') && !String(spec.systems.envelope || '').toLowerCase().includes('rainscreen')) issues.push({ severity: 'warning', title: 'Natural wall lacks drying layer', owner: 'Natural Builder', fix: 'Include rainscreen, generous roof overhangs, and capillary breaks.' });
  if (naturalApproach && !spec.rooms.some((room) => /mud|laundry|service/i.test(room.name))) issues.push({ severity: 'warning', title: 'Farm workflow has no dirty entry', owner: 'Homestead/Farm', fix: 'Add a mud/laundry buffer between exterior work and clean living space.' });
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
  // An empty name must NOT name-match ("x".includes('') is always true —
  // an op carrying only a targetId would silently hit the first room).
  const normalizedName = normalizeDesignLabel(name);
  const nameMatches = (label) => Boolean(normalizedName) && (normalizeDesignLabel(label) === normalizedName || normalizeDesignLabel(label).includes(normalizedName));
  return (spec.rooms || []).find((room) => room.id === targetId || nameMatches(room.name))
    || (spec.elements || []).find((element) => element.id === targetId || nameMatches(element.name))
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
  if (op.type === 'set_frame') return `Set ${Number(op.level) > 1 ? `storey ${op.level} ` : ''}frame${op.value ? ` to ${op.value}` : ''}.`;
  if (op.type === 'set_reclaimed') return `Marked ${op.system || 'materials'} as ${op.value ? 'reclaimed / salvaged' : 'new'}.`;
  if (op.type === 'set_flooring') return `Set flooring${op.value ? ` to ${op.value}` : ''}.`;
  if (op.type === 'set_shell' || op.type === 'add_pad_extension') return `Updated shell ${op.field || 'padExtensionFt'} to ${op.value || op.w}.`;
  if (op.type === 'set_footprint') return 'Set the building footprint outline.';
  if (op.type === 'move_wall_edge') return `Moved the ${op.wall || op.field || 'selected'} wall ${Number(op.value) > 0 ? 'out' : 'in'} ${Math.abs(Number(op.value) || 0)} ft.`;
  if (op.type === 'split_wall_edge') return `Split the ${op.wall || op.field || 'selected'} wall into segments.`;
  if (op.type === 'add_opening') return `Added ${op.widthFt || 3}' ${op.openingType || 'opening'} on the ${op.wall} wall.`;
  if (op.type === 'add_opening_from_reference' || op.type === 'trace_image_request') return op.reason || 'Image tracing needs wall, type, width, and location before BIM openings can be placed.';
  if (op.type === 'request_clarification') return op.reason || 'More information is needed before changing the BIM.';
  if (op.type === 'move_object') return `Moved ${op.name || op.targetId || 'object'} to X ${op.x}', Y ${op.y}'.`;
  if (op.type === 'resize_object') return `Resized ${op.name || op.targetId || 'object'} to ${op.w}' x ${op.d}'.`;
  if (op.type === 'update_object') return `Updated ${op.name || op.targetId || 'object'} ${op.field}.`;
  if (op.type === 'remove_object') return `Removed ${op.name || op.targetId || 'object'}.`;
  return op.reason || 'No model change.';
}

// The full opening vocabulary. h/sill in feet drive the 3D render, the IFC/
// Blender bridge, and the passive-solar math (glazed openings count toward
// south glass); entry marks types that satisfy the main-entry check.
export const OPENING_TYPES = {
  window: { label: 'Window', h: 4, sill: 3, glazed: true, defaultW: 5 },
  picture: { label: 'Picture window (fixed)', h: 5, sill: 2, glazed: true, defaultW: 6 },
  awning: { label: 'Awning / vent window', h: 1.8, sill: 6, glazed: true, defaultW: 3 },
  clerestory: { label: 'Clerestory window', h: 2, sill: 8, glazed: true, defaultW: 6 },
  door: { label: 'Door', h: 6.8, sill: 0, glazed: false, defaultW: 3, entry: true },
  french: { label: 'French doors', h: 6.8, sill: 0, glazed: true, defaultW: 5, entry: true },
  slider: { label: 'Sliding glass door', h: 6.8, sill: 0, glazed: true, defaultW: 6, entry: true },
  dutch: { label: 'Dutch door', h: 6.8, sill: 0, glazed: false, defaultW: 3, entry: true },
  barn: { label: 'Barn / equipment door', h: 8, sill: 0, glazed: false, defaultW: 8, entry: true },
  bay: { label: 'Bay window / window seat', h: 4.5, sill: 1.5, glazed: true, defaultW: 6, bay: true },
  skylight: { label: 'Skylight / roof window', h: 0, sill: 0, glazed: true, defaultW: 2.5, roof: true }
};

export const UTILITY_DEFAULTS = {
  waterSource: 'well',
  tankGal: 0,
  wasteMethod: 'septic',
  wellSepticFt: 120,
  powerMode: 'offgrid',
  heatSource: 'wood_stove',
  foundationType: 'rubble',
  foundationInsulation: 'perimeter',
  stemwallHeightFt: 1.5,
  roofInsulation: 'cellulose',
  floorInsulation: 'cellulose',
  windowQuality: 'double',
  panelCount: 0,
  batteryOverrideKwh: 0,
  diyWalls: false,
  diyRoof: false,
  diyHeat: false,
  diyFoundation: false,
  diyFrame: false
};

// Topography: the site is not flat. slopeFt = total fall of grade across the
// building footprint in the downhill direction; slopeDir = which way it falls;
// gradeFt = how far the finish floor (the model's y=0 datum) sits above grade
// at the UPHILL building edge (a normal stem wall). Downhill, grade drops by
// slopeFt more, so that much foundation/basement wall is exposed — the walkout
// condition the drawings show. slopeFt = 0 → flat site (legacy behavior).
export const SITE_DEFAULTS = { zip: '', placeName: '', latitudeDeg: 43, rainInYr: 38, slopeFt: 0, slopeDir: 'south', gradeFt: 1.5, contourInterval: 2 };

// Grade elevation (feet, relative to the finish-floor datum; negative = below
// the floor) at a plan point. A tilted plane through the footprint, extended
// linearly beyond it so the whole site slopes. This is the single source both
// the 3D terrain and every derived view (elevations, sections) read.
export function gradeElevationAt(spec, x, y) {
  const site = { ...SITE_DEFAULTS, ...(spec?.site || {}) };
  const slopeFt = Math.max(0, Number(site.slopeFt) || 0);
  const gradeFt = Math.max(0, Number(site.gradeFt ?? 1.5));
  if (slopeFt <= 0) return -gradeFt;
  const W = Number(spec?.shell?.widthFt) || 36;
  const D = Number(spec?.shell?.depthFt) || 28;
  const dir = ['north', 'south', 'east', 'west'].includes(site.slopeDir) ? site.slopeDir : 'south';
  // t = downhill fraction across the footprint (0 at the high edge, 1 at the
  // low edge); linear beyond [0,1] so the site keeps sloping past the house.
  const t = dir === 'south' ? y / D
    : dir === 'north' ? (D - y) / D
      : dir === 'east' ? x / W
        : (W - x) / W;
  return -gradeFt - slopeFt * t;
}

// The lowest grade anywhere on the footprint perimeter — how deep the deepest
// (downhill) foundation goes. Drives the "walkout basement" check + display.
export function maxFoundationExposureFt(spec) {
  const site = { ...SITE_DEFAULTS, ...(spec?.site || {}) };
  return Math.max(0, Number(site.gradeFt ?? 1.5)) + Math.max(0, Number(site.slopeFt) || 0);
}

// Structural frame — the skeleton the roof and floors hang on. It sits BETWEEN
// the foundation and the wall infill: a timber frame can carry straw-bale
// infill, or a load-bearing wall can be its own structure (no separate frame).
// costPsf / carbonPsf are per sf of framed wall area; reclaimed timber cuts both.
export const FRAME_TYPES = {
  'load-bearing': { label: 'Load-bearing walls (no separate frame)', costPsf: 0, carbonPsf: 0, structural: false, note: 'The wall itself carries the roof — classic for straw bale, cob, cordwood, and rammed earth.' },
  timber: { label: 'Timber frame (heavy posts & beams)', costPsf: 15, carbonPsf: 6, structural: true, note: 'Mortise-and-tenon bents; the walls become infill. Beautiful and DIY-friendly with a jig.' },
  'post-beam': { label: 'Post & beam', costPsf: 11, carbonPsf: 6, structural: true, note: 'Simpler bolted posts and beams with diagonal bracing.' },
  stick: { label: 'Light stick frame (2× studs)', costPsf: 9, carbonPsf: 8, structural: true, note: 'Conventional dimensional-lumber framing — familiar and fast.' },
  'double-stud': { label: 'Double-stud wall', costPsf: 13, carbonPsf: 10, structural: true, note: 'Two stud walls with a deep insulation cavity between them.' },
  pole: { label: 'Round-wood / pole frame', costPsf: 7, carbonPsf: 3, structural: true, note: 'Debarked poles or small-diameter logs; very low embodied energy.' }
};

export const FRAME_DEFAULTS = { type: 'load-bearing', storeyTypes: {} };

// Flooring — the finished floor over the foundation. costPsf/carbonPsf per sf of
// heated floor. Earthen and stone lean on thermal mass; wood/cork are warmer
// underfoot. A per-room override (room.floor free text) can still differ.
export const FLOORING_TYPES = {
  earthen: { label: 'Earthen / lime slab', costPsf: 4, carbonPsf: 2, note: 'Poured earth or lime; high thermal mass, very low carbon, DIY-friendly.' },
  concrete: { label: 'Polished concrete', costPsf: 9, carbonPsf: 14, note: 'Durable mass floor, but the most embodied carbon of the floors.' },
  wood: { label: 'Wood boards', costPsf: 10, carbonPsf: 4, note: 'Warm underfoot; reclaimed boards cut cost and carbon sharply.' },
  cork: { label: 'Cork', costPsf: 8, carbonPsf: 2, note: 'Soft, warm, renewable; good over radiant.' },
  tile: { label: 'Tile / stone', costPsf: 12, carbonPsf: 6, note: 'Hard-wearing mass floor, good in wet cores and sun-tempered rooms.' },
  bamboo: { label: 'Bamboo', costPsf: 7, carbonPsf: 3, note: 'Fast-renewable and hard; a warm low-carbon choice.' }
};
export const FLOORING_DEFAULTS = { type: 'earthen' };
export function resolveFlooring(spec) {
  const key = spec.flooring?.type;
  return FLOORING_TYPES[key] ? key : 'earthen';
}

// Subfloor — the structural deck under the finished floor. On a slab foundation
// the poured floor IS the structure (no separate deck, cost folded into the
// foundation). On a rubble or stem-wall foundation the floor is raised, so it
// needs a joisted deck — insulated if you want to slow floor heat loss.
export const SUBFLOOR_TYPES = {
  slab: { label: 'Slab — the foundation is the floor', costPsf: 0, carbonPsf: 0, note: 'For a slab foundation: the poured floor is the deck. Nothing extra to build.' },
  joist: { label: 'Wood joist deck', costPsf: 6, carbonPsf: 3, note: 'Dimensional joists and subfloor sheathing over the foundation.' },
  insulated: { label: 'Insulated wood deck', costPsf: 9, carbonPsf: 4, note: 'Joists with dense-pack or wool insulation and sheathing — warmer feet, less floor loss.' },
  timber: { label: 'Timber deck over posts', costPsf: 8, carbonPsf: 4, note: 'Heavy timber joists on piers or a low stem wall; a natural-building classic.' }
};
// Default follows the foundation: a slab is its own deck; a raised (rubble /
// stem-wall) foundation gets an insulated deck unless overridden.
export function resolveSubfloor(spec) {
  const key = spec.flooring?.subfloor;
  if (SUBFLOOR_TYPES[key]) return key;
  return (spec.utilities?.foundationType === 'slab') ? 'slab' : 'insulated';
}

// Insulation — an explicit layer of the roof and floor assemblies. r = typical
// installed R for a deep cavity; costPsf / carbonPsf per sf of insulated area.
// Natural options (cellulose, wool, straw-clay, wood fiber) sit low on carbon;
// rigid foam insulates hard but carries the most embodied carbon.
export const INSULATION_TYPES = {
  none: { label: 'None', r: 3, costPsf: 0, carbonPsf: 0 },
  cellulose: { label: 'Dense-pack cellulose', r: 38, costPsf: 1.6, carbonPsf: 0.3 },
  wool: { label: 'Sheep wool', r: 34, costPsf: 3.2, carbonPsf: 0.4 },
  strawclay: { label: 'Straw / light clay', r: 24, costPsf: 0.8, carbonPsf: 0.2 },
  woodfiber: { label: 'Wood fiber board', r: 32, costPsf: 2.6, carbonPsf: 0.5 },
  mineralwool: { label: 'Mineral wool', r: 40, costPsf: 2.0, carbonPsf: 1.0 },
  rigid: { label: 'Rigid foam board', r: 45, costPsf: 2.4, carbonPsf: 3.5 }
};
export function resolveInsulation(key, fallback = 'cellulose') {
  return INSULATION_TYPES[key] ? key : fallback;
}

export const RECLAIMED_SYSTEMS = ['frame', 'walls', 'flooring', 'windows', 'roof'];
export const RECLAIMED_DEFAULTS = { frame: false, walls: false, flooring: false, windows: false, roof: false };

// The frame in effect on a given storey — a per-storey override falls back to
// the base frame type. level 1 (or unset) is the ground/base.
export function resolveFrameType(spec, level = 1) {
  const frame = spec.frame || FRAME_DEFAULTS;
  const perStorey = frame.storeyTypes || {};
  const key = perStorey[String(level)];
  return FRAME_TYPES[key] ? key : (FRAME_TYPES[frame.type] ? frame.type : 'load-bearing');
}

export function applyBimOperations(currentSpec, plan) {
  const next = structuredClone(currentSpec);
  next.rooms ||= [];
  next.elements ||= [];
  next.openings ||= [];
  next.levels ||= [{ id: 'level-1', name: 'Level 01', elevationFt: 0, heightFt: next.shell.wallHeightFt || 10 }];
  next.walls ||= {};
  next.site = { ...SITE_DEFAULTS, ...(next.site || {}) };
  next.utilities = { ...UTILITY_DEFAULTS, ...(next.utilities || {}) };

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
      // Planners (and people) naturally say "the shell is 40.5 × 23" — accept
      // w/d numbers directly when no single field is named.
      if (operation.type === 'set_shell' && !operation.field && (Number(operation.w) > 0 || Number(operation.d) > 0)) {
        if (Number(operation.w) > 0 && !scaleFootprintAxis(next, 'x', clamp(Number(operation.w), 18, 120))) next.shell.widthFt = clamp(Number(operation.w), 18, 120);
        if (Number(operation.d) > 0 && !scaleFootprintAxis(next, 'y', clamp(Number(operation.d), 18, 120))) next.shell.depthFt = clamp(Number(operation.d), 18, 120);
        if (Number(operation.h) > 0) {
          const h = clamp(Number(operation.h), 7, 40);
          next.shell.wallHeightFt = h;
          next.shell.southWallHeightFt = h;
          next.shell.northWallHeightFt = h;
        }
        actions.push(`Set shell to ${next.shell.widthFt}' x ${next.shell.depthFt}'.`);
        continue;
      }
      const field = operation.field || 'padExtensionFt';
      const numeric = Number(operation.value || operation.w);
      if (field === 'widthFt') {
        if (!scaleFootprintAxis(next, 'x', clamp(numeric, 18, 120))) next.shell.widthFt = clamp(numeric, 18, 120);
        // absorb a companion depth riding in the same op (planner shorthand)
        if (Number(operation.d) > 0 && !scaleFootprintAxis(next, 'y', clamp(Number(operation.d), 18, 120))) {
          next.shell.depthFt = clamp(Number(operation.d), 18, 120);
        }
      }
      else if (field === 'depthFt') {
        if (!scaleFootprintAxis(next, 'y', clamp(numeric, 18, 120))) next.shell.depthFt = clamp(numeric, 18, 120);
        if (Number(operation.w) > 0 && Number(operation.w) !== numeric && !scaleFootprintAxis(next, 'x', clamp(Number(operation.w), 18, 120))) {
          next.shell.widthFt = clamp(Number(operation.w), 18, 120);
        }
      }
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
      else if (field === 'basementHeightFt') {
        // 0 removes the basement; rooms stranded at level -1 come back to ground.
        const v = Math.max(0, numeric || 0);
        if (v > 0) next.shell.basementHeightFt = clamp(v, 6, 12);
        else {
          delete next.shell.basementHeightFt;
          next.rooms = next.rooms.map((room) => (Number(room.level || 1) === BASEMENT_LEVEL ? { ...room, level: 1 } : room));
          next.elements = (next.elements || []).map((el) => (Number(el.level || 1) === BASEMENT_LEVEL ? { ...el, level: 1, z: 0 } : el));
        }
      }
      else if (field === 'overhangFt') {
        // Global overhang = one value all around: clear per-side overrides.
        next.shell.overhangFt = clamp(numeric, 0, 12);
        delete next.shell.overhangs;
      }
      else if (field === 'roofType') next.shell.roofType = String(operation.value || next.shell.roofType || 'gable');
      else if (field === 'designApproach') next.shell.designApproach = operation.value === 'standard' ? 'standard' : 'natural';
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
      // Upper-storey walls keep their own overrides — construction can vary
      // by storey. Height/omit stay ground-level concepts.
      if (Number(operation.level) > 1) {
        next.wallsUpper ||= {};
        next.wallsUpper[side] ||= {};
        if (field === 'assembly') next.wallsUpper[side].assembly = WALL_ASSEMBLIES[operation.value] ? operation.value : 'framed';
        else if (field === 'thicknessFt') next.wallsUpper[side].thicknessFt = clamp(Number(operation.value), 0.2, 3.5);
        else if (field === 'interiorFinish' || field === 'exteriorFinish') next.wallsUpper[side][field] = String(operation.value || '');
        actions.push(`Set upper-storey ${side} wall ${field} to ${operation.value}.`);
        continue;
      }
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

    // --- Footprint ops (the geometry pass) ---------------------------------
    if (operation.type === 'set_footprint') {
      const raw = typeof operation.value === 'string' && operation.value && operation.value !== 'rect'
        ? (() => { try { return JSON.parse(operation.value); } catch { return null; } })()
        : Array.isArray(operation.value) ? operation.value : null;
      if (operation.value === 'rect' || operation.value === '' || (Array.isArray(raw) && raw.length === 0)) {
        delete next.shell.footprint;
        actions.push('Reset the footprint to a plain rectangle.');
        continue;
      }
      const normalized = normalizeFootprint(raw);
      if (!normalized) {
        warnings.push('The footprint outline was not usable — it needs 4–24 corners, straight north/south/east/west walls, and a real enclosed area.');
        rejectedOperations.push(operation);
        continue;
      }
      anchorFootprint(next, normalized);
      actions.push(`Set the footprint outline (${normalized.length} corners, ${Math.round(polygonArea(normalized))} sf).`);
      continue;
    }

    if (operation.type === 'move_wall_edge') {
      const poly = footprintPolygon(next);
      const edges = footprintEdges(next);
      let edgeIndex = -1;
      if (/^e\d+$/.test(String(operation.field))) edgeIndex = Number(String(operation.field).slice(1));
      if (edgeIndex < 0 && WALL_SIDES.includes(operation.wall)) {
        const facing = edges.filter((edge) => edge.facing === operation.wall);
        const best = facing.reduce((a, b) => (!a || b.lengthFt > a.lengthFt ? b : a), null);
        edgeIndex = best ? best.index : -1;
      }
      if (edgeIndex < 0 || edgeIndex >= edges.length) {
        warnings.push(`Could not find the wall edge to move (${operation.field || operation.wall || 'unspecified'}).`);
        rejectedOperations.push(operation);
        continue;
      }
      const offset = clamp(Number(operation.value ?? operation.w), -48, 48);
      const moved = moveFootprintEdge(poly, edgeIndex, offset);
      if (!moved) {
        warnings.push('That wall move would collapse the building outline — try a smaller offset.');
        rejectedOperations.push(operation);
        continue;
      }
      anchorFootprint(next, moved);
      const edge = edges[edgeIndex];
      actions.push(`Moved the ${edge.facing} wall ${edge.facingSeq > 1 ? `(segment ${edge.facingSeq}) ` : ''}${offset > 0 ? 'out' : 'in'} ${Math.abs(offset)} ft.`);
      continue;
    }

    if (operation.type === 'split_wall_edge') {
      const poly = footprintPolygon(next);
      const edges = footprintEdges(next);
      let edgeIndex = -1;
      if (/^e\d+$/.test(String(operation.field))) edgeIndex = Number(String(operation.field).slice(1));
      if (edgeIndex < 0 && WALL_SIDES.includes(operation.wall)) {
        const facing = edges.filter((edge) => edge.facing === operation.wall);
        const best = facing.reduce((a, b) => (!a || b.lengthFt > a.lengthFt ? b : a), null);
        edgeIndex = best ? best.index : -1;
      }
      if (edgeIndex < 0 || edgeIndex >= edges.length) {
        warnings.push(`Could not find the wall edge to split (${operation.field || operation.wall || 'unspecified'}).`);
        rejectedOperations.push(operation);
        continue;
      }
      const split = splitFootprintEdge(poly, edgeIndex, Number(operation.x) || undefined, Number(operation.y) || undefined);
      if (!split) {
        warnings.push('That wall is too short to split into three pieces.');
        rejectedOperations.push(operation);
        continue;
      }
      // Splitting alone changes nothing visible; the optional value nudges the
      // middle piece right away (an instant L / notch in one op).
      const nudge = clamp(Number(operation.value) || 0, -48, 48);
      const result = nudge ? moveFootprintEdge(split.vertices, split.middleIndex, nudge) : normalizeFootprint(split.vertices);
      if (!result) {
        warnings.push('That wall split/move would collapse the building outline.');
        rejectedOperations.push(operation);
        continue;
      }
      anchorFootprint(next, result);
      const edge = edges[edgeIndex];
      actions.push(nudge
        ? `Split the ${edge.facing} wall and moved its middle ${nudge > 0 ? 'out' : 'in'} ${Math.abs(nudge)} ft.`
        : `Split the ${edge.facing} wall into three segments — drag the middle one in the Plan to make an L.`);
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
      else if (field === 'azimuthDeg') next.site.azimuthDeg = clamp(Number(operation.value) || 0, -90, 90);
      else if (field === 'slopeFt') next.site.slopeFt = clamp(Number(operation.value) || 0, 0, 60);
      else if (field === 'slopeDir') next.site.slopeDir = ['north', 'south', 'east', 'west'].includes(operation.value) ? operation.value : next.site.slopeDir;
      else if (field === 'gradeFt') next.site.gradeFt = clamp(Number(operation.value) || 0, 0, 12);
      else if (field === 'contourInterval') next.site.contourInterval = clamp(Number(operation.value) || 2, 1, 10);
      actions.push(`Set site ${field} to ${operation.value}.`);
      continue;
    }

    if (operation.type === 'set_flooring') {
      next.flooring ||= { type: 'earthen' };
      if (operation.field === 'subfloor') {
        if (SUBFLOOR_TYPES[operation.value]) next.flooring.subfloor = operation.value;
        actions.push(`Set subfloor to ${SUBFLOOR_TYPES[next.flooring.subfloor]?.label || next.flooring.subfloor}.`);
      } else {
        next.flooring.type = FLOORING_TYPES[operation.value] ? operation.value : next.flooring.type;
        actions.push(`Set flooring to ${FLOORING_TYPES[next.flooring.type]?.label || next.flooring.type}.`);
      }
      continue;
    }

    if (operation.type === 'set_utility') {
      const field = operation.field;
      const value = String(operation.value || '');
      const allowed = {
        waterSource: ['well', 'spring', 'catchment', 'town'],
        wasteMethod: ['septic', 'composting', 'reedbed'],
        powerMode: ['offgrid', 'hybrid', 'gridtie'],
        heatSource: ['rocket_mass', 'masonry', 'wood_stove', 'minisplit'],
        foundationType: ['rubble', 'stemwall', 'slab'],
        foundationInsulation: ['none', 'perimeter', 'full'],
        roofInsulation: ['none', 'cellulose', 'wool', 'strawclay', 'woodfiber', 'mineralwool', 'rigid'],
        floorInsulation: ['none', 'cellulose', 'wool', 'strawclay', 'woodfiber', 'mineralwool', 'rigid'],
        windowQuality: ['double', 'triple']
      };
      if (field === 'tankGal') next.utilities.tankGal = clamp(Number(operation.value) || 0, 0, 50000);
      else if (field === 'stemwallHeightFt') next.utilities.stemwallHeightFt = clamp(Number(operation.value) || 1.5, 0.5, 6);
      else if (field === 'wellSepticFt') next.utilities.wellSepticFt = clamp(Number(operation.value) || 0, 0, 2000);
      else if (field === 'roofRValue') next.utilities.roofRValue = clamp(Number(operation.value) || 38, 10, 100);
      else if (field === 'panelCount') next.utilities.panelCount = clamp(Math.round(Number(operation.value) || 0), 0, 200);
      else if (field === 'batteryOverrideKwh') next.utilities.batteryOverrideKwh = clamp(Number(operation.value) || 0, 0, 500);
      else if (field === 'diyWalls' || field === 'diyRoof' || field === 'diyHeat' || field === 'diyFoundation' || field === 'diyFrame') {
        next.utilities[field] = value === 'true' || operation.value === true || value === '1';
      } else if (allowed[field]) {
        next.utilities[field] = allowed[field].includes(value) ? value : next.utilities[field];
        // Keep the free-text systems summary in step for briefs/exports.
        if (field === 'waterSource') next.systems.water = { well: 'drilled well', spring: 'gravity spring', catchment: 'roof rain catchment', town: 'municipal water' }[next.utilities.waterSource];
        if (field === 'powerMode') next.systems.energy = { offgrid: 'off-grid solar + battery', hybrid: 'grid-tied solar with battery backup', gridtie: 'grid power' }[next.utilities.powerMode];
      }
      actions.push(`Set ${field} to ${operation.value}.`);
      continue;
    }

    if (operation.type === 'set_frame') {
      next.frame ||= { type: 'load-bearing', storeyTypes: {} };
      next.frame.storeyTypes ||= {};
      const value = FRAME_TYPES[operation.value] ? operation.value : 'load-bearing';
      const level = Number(operation.level || 0);
      if (level > 1) next.frame.storeyTypes[String(level)] = value;
      else next.frame.type = value;
      actions.push(`Set ${level > 1 ? `storey ${level} ` : ''}frame to ${FRAME_TYPES[value].label}.`);
      continue;
    }

    if (operation.type === 'set_reclaimed') {
      next.reclaimed ||= { ...RECLAIMED_DEFAULTS };
      const system = RECLAIMED_SYSTEMS.includes(operation.system) ? operation.system : null;
      if (system) {
        next.reclaimed[system] = operation.value === true || operation.value === 'true' || operation.value === 1 || operation.value === '1';
        actions.push(`Marked ${system} materials as ${next.reclaimed[system] ? 'reclaimed / salvaged' : 'new'}.`);
      }
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
      const requestedType = OPENING_TYPES[operation.openingType] ? operation.openingType : 'window';
      const wall = operation.wall === 'roof' || OPENING_TYPES[requestedType].roof ? 'roof' : operation.wall || 'south';
      const openingType = wall === 'roof' ? 'skylight' : requestedType === 'skylight' ? 'window' : requestedType;
      const widthFt = clamp(Number(operation.widthFt || 3), 1, 24);
      const label = operation.name || `${titleCase(wall)} ${OPENING_TYPES[openingType].label} ${next.openings.length + 1}`;
      if (wall === 'roof') {
        // Skylights sit on the roof plane and need both plan coordinates.
        const x = clamp(Number(operation.x ?? operation.positionFt ?? 4), 0, Math.max(0, next.shell.widthFt - widthFt));
        const y = clamp(Number(operation.y ?? 4), 0, Math.max(0, next.shell.depthFt - widthFt));
        next.openings.push({ type: 'skylight', wall: 'roof', x, y, widthFt, label });
      } else {
        const maxAlong = wall === 'north' || wall === 'south' ? next.shell.widthFt : next.shell.depthFt;
        const explicitPos = Number(operation.positionFt) > 0;
        let along = clamp(Number(operation.positionFt || 0), 0, Math.max(0, maxAlong - widthFt));
        const overlapsAt = (start) => next.openings.some((existing) => {
          if (existing.wall !== wall) return false;
          const e0 = Number(existing.x ?? existing.y ?? 0);
          const e1 = e0 + (Number(existing.widthFt) || 3);
          return start < e1 - 0.05 && start + widthFt > e0 + 0.05;
        });
        // No stated position (planners get lazy — everything lands at 0):
        // slide along the wall to the first free stretch so distinct openings
        // stay distinct instead of piling onto the corner.
        if (!explicitPos && overlapsAt(along)) {
          for (let candidate = 1; candidate <= maxAlong - widthFt; candidate += 1) {
            if (!overlapsAt(candidate)) { along = candidate; break; }
          }
        }
        const incoming = wall === 'north' || wall === 'south'
          ? { type: openingType, wall, x: along, widthFt, label }
          : { type: openingType, wall, y: along, widthFt, label };
        // Openings have no ids, so a re-trace lands the same window again a
        // foot to the left — forever. An EXPLICITLY placed opening that
        // overlaps an existing one REPLACES it instead of stacking (two doors
        // can't share the same stretch of wall in the real world either).
        const a0 = along, a1 = along + widthFt;
        const clashIndex = next.openings.findIndex((existing) => {
          if (existing.wall !== wall) return false;
          const e0 = Number(existing.x ?? existing.y ?? 0);
          const e1 = e0 + (Number(existing.widthFt) || 3);
          return a0 < e1 - 0.05 && a1 > e0 + 0.05;
        });
        if (clashIndex >= 0) {
          next.openings[clashIndex] = { ...incoming, label: operation.name || next.openings[clashIndex].label };
        } else {
          next.openings.push(incoming);
        }
      }
      actions.push(operationDescription(operation, next));
      continue;
    }

    // Wholesale opening cleanup: collapse overlapping/duplicate openings per
    // wall (keep the widest of each overlapping cluster; doors beat windows).
    // Mechanical work — the UI and the local chat parser can run it without
    // any AI, and the planner can emit it instead of enumerating removals.
    if (operation.type === 'dedupe_openings') {
      const scope = WALL_SIDES.includes(operation.wall) || operation.wall === 'roof' ? operation.wall : null;
      const before = next.openings.length;
      const keep = [];
      for (const opening of next.openings) {
        if (scope && opening.wall !== scope) { keep.push(opening); continue; }
        const o0 = Number(opening.x ?? opening.y ?? 0);
        const o1 = o0 + (Number(opening.widthFt) || 3);
        const rivalIndex = keep.findIndex((existing) => {
          if (existing.wall !== opening.wall) return false;
          if (opening.wall === 'roof') {
            return Math.abs(Number(existing.x || 0) - Number(opening.x || 0)) < 2 && Math.abs(Number(existing.y || 0) - Number(opening.y || 0)) < 2;
          }
          const e0 = Number(existing.x ?? existing.y ?? 0);
          const e1 = e0 + (Number(existing.widthFt) || 3);
          return o0 < e1 - 0.05 && o1 > e0 + 0.05;
        });
        if (rivalIndex < 0) { keep.push(opening); continue; }
        const rival = keep[rivalIndex];
        const openingIsDoor = Boolean(OPENING_TYPES[opening.type]?.entry);
        const rivalIsDoor = Boolean(OPENING_TYPES[rival.type]?.entry);
        // doors win over windows; otherwise the wider one stays
        if ((openingIsDoor && !rivalIsDoor) || (openingIsDoor === rivalIsDoor && (Number(opening.widthFt) || 0) > (Number(rival.widthFt) || 0))) {
          keep[rivalIndex] = opening;
        }
      }
      next.openings = keep;
      const removed = before - next.openings.length;
      actions.push(removed > 0
        ? `Removed ${removed} duplicate/overlapping opening${removed === 1 ? '' : 's'}${scope ? ` on the ${scope} wall` : ''} (${next.openings.length} remain).`
        : 'No overlapping openings found — nothing to clean.');
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
        // Respect the planner's placement ("above the kitchen"), not 0,0.
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
        // "0 is unset" here because emptyBimOperation zero-fills — but a floor
        // (storey extent) plate belongs ON the house, not beside it, so its
        // unset default is the origin. Fixes storey plates landing at x=16,y=3.
        x: Number(operation.x || (operation.category === 'floor' ? 0 : next.shell.widthFt + 3)),
        y: Number(operation.y || (operation.category === 'floor' ? 0 : 3)),
        z: Number(operation.z || 0),
        w: Math.max(1, Number(operation.w || 10)),
        d: Math.max(1, Number(operation.d || 10)),
        h: Math.max(0.2, Number(operation.h || 1.2)),
        level: Number(operation.level || 1),
        roofType: operation.roofType || '',
        construction: operation.construction || '',
        // Partitions reuse the opening fields for their door: widthFt = door
        // width (0 = solid wall), positionFt = distance along the wall run.
        doorWFt: operation.category === 'partition' ? Number(operation.widthFt || 0) : 0,
        doorAtFt: operation.category === 'partition' ? Number(operation.positionFt || 0) : 0,
        type: operation.category || 'custom'
      };
      // A partition defaults to a full-height thin wall, not the 10x10x1.2
      // generic element box: thickness from its construction, height from the
      // storey it stands on.
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
      rejectedOperations.push(operation);
      warnings.push(`Could not find target for operation: ${operationDescription(operation, next)}`);
      continue;
    }

    if (operation.type === 'move_object') {
      const position = clampObjectPosition(next, target, operation.x, operation.y);
      target.x = position.x;
      target.y = position.y;
      // Ops are zero-filled, so z=0 means "not a z move" — a plain plan drag
      // must not drop an elevated element (storey plate, loft) to the ground.
      // An explicit drop-to-ground goes through update_object field z.
      if (Number.isFinite(operation.z) && operation.z !== 0) target.z = operation.z;
      changedIds.push(target.id);
      actions.push(operationDescription({ ...operation, name: target.name }, next));
    } else if (operation.type === 'resize_object') {
      const minDim = target.category === 'partition' ? 0.3 : 1;
      target.w = Math.max(minDim, Number(operation.w || target.w));
      target.d = Math.max(minDim, Number(operation.d || target.d));
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
