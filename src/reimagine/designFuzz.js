// DESIGN-SPACE FUZZ — the generator behind "correct for ANY house".
// Builds random designs as random OP SEQUENCES through the real op applier
// (never hand-assembled specs), sampling the whole surface a person can
// reach: every roof, wall system, storey count, footprint, opening type,
// deck option, and per-storey override — plus the occasional junk op the
// applier must shrug off. Seeded: the same seed always builds the same
// design, so every failure replays exactly.
//
// Shared by tools/design_space_test.mjs (node, 300 designs) and the live
// seam-audit battery (browser, a dozen per run) — one generator, one truth.
import {
  applyBimOperations, OPENING_TYPES, WALL_ASSEMBLIES, WALL_SIDES,
  CLADDING_TYPES, FLOORING_TYPES, SUBFLOOR_TYPES, FRAME_TYPES
} from '../../backend/bim-core.mjs';

export function makeFuzzRng(seedNum) {
  let s = (Number(seedNum) >>> 0) || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

const pickOf = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const rangeOf = (rnd, lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 2) / 2;

export function freshFuzzSpec() {
  return {
    projectName: 'Fuzz House', revision: 1,
    shell: { widthFt: 32, depthFt: 26, wallHeightFt: 10, southWallHeightFt: 10, northWallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, storeys: 1 },
    systems: { envelope: 'straw bale walls with lime plaster', structure: 'timber', water: 'well', energy: 'off-grid solar' },
    rooms: [{ id: 'seed-room', name: 'Great Room', x: 2, y: 2, w: 14, d: 12, h: 0.22, level: 1, type: 'living' }],
    elements: [], openings: [], levels: [], walls: {}, notes: ''
  };
}

// One op (or a small batch) per step. `ctx` is the generator's loose model of
// the design (the engine's clamps are the real law); `pool` is names/ids we
// created and may later move, resize, retarget, or remove.
const STEPS = [
  { w: 3, gen: (rnd) => [{ type: 'set_shell', field: 'widthFt', value: rangeOf(rnd, 12, 96) }] },
  { w: 3, gen: (rnd) => [{ type: 'set_shell', field: 'depthFt', value: rangeOf(rnd, 12, 80) }] },
  { w: 2, gen: (rnd) => [{ type: 'set_shell', w: rangeOf(rnd, 14, 60), d: rangeOf(rnd, 14, 50) }] },
  { w: 3, gen: (rnd, ctx) => { ctx.storeys = pickOf(rnd, [1, 1.5, 2, 3]); return [{ type: 'set_shell', field: 'storeys', value: String(ctx.storeys) }]; } },
  { w: 2, gen: (rnd) => [{ type: 'set_storey_height', level: pickOf(rnd, [1, 2, 3]), value: rangeOf(rnd, 3, 18) }] },
  { w: 3, gen: (rnd) => {
    const t = pickOf(rnd, ['gable', 'shed', 'hip', 'flat']);
    if (t !== 'shed') return [{ type: 'set_shell', field: 'roofType', value: t }];
    return rnd() < 0.5
      ? [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: rangeOf(rnd, 2, 24), northWallHeightFt: rangeOf(rnd, 2, 24) }]
      : [{ type: 'set_roof_profile', roofType: 'shed', eastWallHeightFt: rangeOf(rnd, 2, 24), westWallHeightFt: rangeOf(rnd, 2, 24) }];
  } },
  { w: 1, gen: (rnd) => [{ type: 'set_roof', pitch: rangeOf(rnd, 0.05, 1.2) }] },
  { w: 1, gen: (rnd, ctx) => {
    const W = ctx.W; const D = ctx.D; const half = (v) => Math.round(v * 2) / 2;
    const shape = pickOf(rnd, ['rect', 'round', 'l', 'u']);
    if (shape === 'rect') return [{ type: 'set_footprint', value: 'rect' }];
    if (shape === 'round') return [{ type: 'set_footprint', value: 'round' }];
    const poly = shape === 'l'
      ? [[0, 0], [W, 0], [W, half(D * 0.55)], [half(W * 0.6), half(D * 0.55)], [half(W * 0.6), D], [0, D]]
      : [[0, 0], [W, 0], [W, D], [half(W * 0.7), D], [half(W * 0.7), half(D * 0.45)], [half(W * 0.3), half(D * 0.45)], [half(W * 0.3), D], [0, D]];
    return [{ type: 'set_footprint', value: JSON.stringify(poly) }];
  } },
  { w: 1, gen: (rnd) => [{ type: 'split_wall_edge', wall: pickOf(rnd, WALL_SIDES) }] },
  { w: 4, gen: (rnd) => {
    const side = pickOf(rnd, WALL_SIDES);
    const field = pickOf(rnd, ['assembly', 'heightFt', 'thicknessFt', 'cladding', 'omitted', 'sunGlazing', 'sunGlazingTiltDeg']);
    const value = field === 'assembly' ? pickOf(rnd, Object.keys(WALL_ASSEMBLIES))
      : field === 'heightFt' ? rangeOf(rnd, 2, 40)
      : field === 'thicknessFt' ? rangeOf(rnd, 0.2, 3.5)
      : field === 'cladding' ? pickOf(rnd, Object.keys(CLADDING_TYPES))
      : field === 'omitted' ? rnd() < 0.5
      : field === 'sunGlazing' ? rnd() < 0.7
      : rangeOf(rnd, 0, 45);
    const level = (field === 'assembly' || field === 'thicknessFt' || field === 'cladding') && rnd() < 0.35 ? pickOf(rnd, [2, 3]) : undefined;
    return [{ type: 'set_wall_side', wall: side, field, value, ...(level ? { level } : {}) }];
  } },
  { w: 4, gen: (rnd, ctx, pool) => {
    const type = pickOf(rnd, Object.keys(OPENING_TYPES));
    const wall = OPENING_TYPES[type].roof ? 'roof' : pickOf(rnd, WALL_SIDES);
    const horiz = wall === 'north' || wall === 'south';
    const op = { type: 'add_opening', opening: type, wall, widthFt: rangeOf(rnd, 1, 12), level: pickOf(rnd, [1, 1, 1, 2, 3]) };
    op[horiz || wall === 'roof' ? 'x' : 'y'] = rangeOf(rnd, 0, 40);
    if (rnd() < 0.4) op.sillFt = rangeOf(rnd, -2, 30);   // absurd sills on purpose
    if (rnd() < 0.25) op.shadeFt = rangeOf(rnd, 0, 6);
    if (rnd() < 0.2) op.tiltDeg = rangeOf(rnd, 0, 60);
    if (rnd() < 0.2) op.dormerStyle = pickOf(rnd, ['gable', 'shed', 'junk']);
    pool.push(`opening-${pool.filter((p) => p.startsWith('opening-')).length}`);
    return [op];
  } },
  { w: 3, gen: (rnd, ctx, pool) => {
    const name = `Room ${Math.floor(rnd() * 90)}`;
    pool.push(name);
    return [{ type: 'add_room', name, x: rangeOf(rnd, -4, 50), y: rangeOf(rnd, -4, 40), w: rangeOf(rnd, 2, 20), d: rangeOf(rnd, 2, 20), level: pickOf(rnd, [1, 1, 2, 3]), roomType: pickOf(rnd, ['living', 'sleeping', 'wet', 'service', 'storage', 'work', 'plant', 'outdoor']) }];
  } },
  { w: 3, gen: (rnd, ctx, pool) => {
    const kind = pickOf(rnd, ['deck', 'foundation', 'partition', 'stairs', 'plate']);
    if (kind === 'deck') {
      const name = `Deck ${Math.floor(rnd() * 90)}`; pool.push(name);
      return [{ type: 'add_element', name, category: 'deck', x: rangeOf(rnd, -12, 60), y: rangeOf(rnd, -12, 50), w: rangeOf(rnd, 4, 20), d: rangeOf(rnd, 4, 16), h: 0.35, level: pickOf(rnd, [1, 1, 2, 3]),
        deckSurface: pickOf(rnd, ['wood', 'composite', 'stone']), deckPlacement: pickOf(rnd, ['raised', 'grade']), deckRail: pickOf(rnd, ['wood', 'cable', 'none']), deckRoof: pickOf(rnd, ['', 'shed', 'gable']), deckStairs: pickOf(rnd, ['auto', 'none', 'north', 'south', 'east', 'west']) }];
    }
    if (kind === 'foundation') {
      const name = `Run ${Math.floor(rnd() * 90)}`; pool.push(name);
      return [{ type: 'add_element', name, category: 'foundation', construction: pickOf(rnd, ['rubble-stem', 'slabpad']), x: rangeOf(rnd, -20, 60), y: rangeOf(rnd, -16, 50), w: rangeOf(rnd, 2, 30), d: rangeOf(rnd, 2, 24), h: rnd() < 0.5 ? 0.35 : 1.5, level: 1 }];
    }
    if (kind === 'partition') {
      const name = `Wall ${Math.floor(rnd() * 90)}`; pool.push(name);
      return [{ type: 'add_element', name, category: 'partition', construction: pickOf(rnd, ['framed', 'cob']), x: rangeOf(rnd, 1, 30), y: rangeOf(rnd, 1, 24), w: rangeOf(rnd, 0, 14), d: rangeOf(rnd, 0, 12) }];
    }
    if (kind === 'stairs') {
      pool.push('Stairs');
      return [{ type: 'add_element', name: 'Stairs', category: 'structure', x: rangeOf(rnd, 1, 26), y: rangeOf(rnd, 1, 20), w: 3.5, d: 10, h: 8, level: pickOf(rnd, [1, 1, 2]) }];
    }
    const lv = pickOf(rnd, [2, 3]);
    const name = `Storey ${lv} extent`; pool.push(name);
    return [{ type: 'add_element', name, category: 'floor', level: lv, x: rangeOf(rnd, 0, 20), y: rangeOf(rnd, 0, 16), w: rangeOf(rnd, 8, 30), d: rangeOf(rnd, 8, 26), h: 0.4,
      ...(rnd() < 0.4 ? { roofShape: pickOf(rnd, ['shed', 'gable', 'flat']) } : {}),
      ...(rnd() < 0.3 ? { roofFall: pickOf(rnd, WALL_SIDES) } : {}),
      ...(rnd() < 0.3 ? { roofOverhangFt: rangeOf(rnd, 0, 12) } : {}),
      ...(rnd() < 0.3 ? { topTreatment: pickOf(rnd, ['roof', 'porch']) } : {}) }];
  } },
  { w: 2, gen: (rnd, ctx, pool) => {
    if (!pool.length) return [];
    const target = pickOf(rnd, pool);
    const move = rnd() < 0.5;
    return [move
      ? { type: 'move_object', targetId: target, name: target, x: rangeOf(rnd, -10, 50), y: rangeOf(rnd, -10, 44) }
      : { type: 'resize_object', targetId: target, name: target, w: rangeOf(rnd, 1, 24), d: rangeOf(rnd, 1, 20), h: rangeOf(rnd, 0.2, 9) }];
  } },
  { w: 2, gen: (rnd, ctx, pool) => {
    const openings = pool.filter((p) => p.startsWith('opening-'));
    if (!openings.length) return [];
    const t = pickOf(rnd, openings);
    const field = pickOf(rnd, ['sillFt', 'widthFt', 'shadeFt', 'level', 'dormerStyle']);
    const value = field === 'sillFt' ? rangeOf(rnd, -3, 40)
      : field === 'widthFt' ? rangeOf(rnd, 0.5, 30)
      : field === 'shadeFt' ? rangeOf(rnd, 0, 9)
      : field === 'level' ? pickOf(rnd, [1, 2, 3, 5])
      : pickOf(rnd, ['gable', 'shed', '']);
    return [{ type: 'update_object', targetId: t, field, value }];
  } },
  { w: 1, gen: (rnd, ctx, pool) => {
    if (pool.length < 3 || rnd() < 0.5) return [];
    const idx = Math.floor(rnd() * pool.length);
    const target = pool.splice(idx, 1)[0];
    return [{ type: 'remove_object', targetId: target, name: target }];
  } },
  { w: 2, gen: (rnd) => (rnd() < 0.5
    ? [{ type: 'set_frame', value: pickOf(rnd, Object.keys(FRAME_TYPES)), ...(rnd() < 0.4 ? { level: pickOf(rnd, [2, 3]) } : {}) }]
    : [{ type: 'set_frame', field: 'baySpacingFt', value: rangeOf(rnd, 4, 16) }]) },
  { w: 2, gen: (rnd) => [{ type: 'set_utility', field: pickOf(rnd, ['waterSource', 'wasteMethod', 'powerMode', 'heatSource', 'foundationType', 'stemwallHeightFt', 'roofInsulation']),
    value: pickOf(rnd, ['well', 'catchment', 'septic', 'offgrid', 'hybrid', 'wood_stove', 'masonry', 'rocket_mass', 'rubble', 'stemwall', 'slab', 'basement', 'woodfiber', 'cellulose', 2, 4, 'junk-value']) }] },
  { w: 1, gen: (rnd) => [{ type: 'set_flooring', ...(rnd() < 0.5 ? {} : { field: 'subfloor' }), value: pickOf(rnd, [...Object.keys(FLOORING_TYPES), ...Object.keys(SUBFLOOR_TYPES)]) }] },
  { w: 1, gen: (rnd) => [{ type: 'set_reclaimed', system: pickOf(rnd, ['frame', 'walls', 'flooring', 'windows', 'roof']), value: rnd() < 0.6 }] },
  { w: 2, gen: (rnd) => [{ type: 'set_overhang', side: pickOf(rnd, ['all', ...WALL_SIDES]), value: rangeOf(rnd, 0, 12) }] },
  { w: 1, gen: (rnd) => [{ type: 'set_shell', field: pickOf(rnd, ['gutters', 'discharge']), value: pickOf(rnd, ['eaves', 'all', 'none', 'grade', 'barrels', 'cistern', 'drywell']) }] },
  { w: 1, gen: (rnd) => [{ type: 'add_floor' }] },
  // deliberate junk — the applier must reject gracefully, never throw
  { w: 0.5, gen: (rnd) => [pickOf(rnd, [
    { type: 'paint_the_cat', value: 'tabby' },
    { type: 'set_shell', field: 'widthFt', value: 'NaN' },
    { type: 'add_opening', opening: 'porthole', wall: 'ceiling', x: 'here' },
    { type: 'move_object', targetId: 'the-vibes', x: null, y: undefined }
  ])] }
];

const TOTAL_W = STEPS.reduce((s, st) => s + st.w, 0);
function pickStep(rnd) {
  let roll = rnd() * TOTAL_W;
  for (const st of STEPS) { roll -= st.w; if (roll <= 0) return st; }
  return STEPS[0];
}

// Build one design. Returns { spec, seed, opsRun, threw } — `threw` carries
// the eight-line replay recipe when an op throws (the harness fails on it).
export function generateFuzzDesign(seedNum, { minOps = 15, maxOps = 60 } = {}) {
  const rnd = makeFuzzRng(seedNum);
  const nOps = Math.floor(minOps + rnd() * (maxOps - minOps));
  const ctx = { W: 32, D: 26, storeys: 1 };
  const pool = ['Great Room'];
  let spec = freshFuzzSpec();
  const opsRun = [];
  let threw = null;
  for (let i = 0; i < nOps; i += 1) {
    const ops = pickStep(rnd).gen(rnd, ctx, pool);
    if (!ops.length) continue;
    if (ops[0]?.type === 'set_shell' && ops[0].field === 'widthFt' && Number.isFinite(Number(ops[0].value))) ctx.W = Number(ops[0].value);
    if (ops[0]?.type === 'set_shell' && ops[0].field === 'depthFt' && Number.isFinite(Number(ops[0].value))) ctx.D = Number(ops[0].value);
    try {
      const r = applyBimOperations(spec, { operations: ops });
      spec = r.spec || r;
      opsRun.push(...ops);
    } catch (e) {
      threw = { atOp: i, op: ops[0], error: String(e && e.message || e) };
      break;
    }
  }
  return { spec, seed: seedNum, opsRun, threw };
}

// The known LEGACY DAMAGE classes — old stacking models, desynced height
// fields, junk numerics. A loaded design carrying any of these must heal and
// then satisfy every invariant a fresh one does.
export function injectLegacyDamage(spec, seedNum) {
  const rnd = makeFuzzRng((seedNum ^ 0x5a5a5a5a) >>> 0);
  const s = JSON.parse(JSON.stringify(spec));
  const picks = [];
  const maybe = (p, fn) => { if (rnd() < p) { fn(); picks.push(fn.name || 'damage'); } };
  maybe(0.6, function staleWallHeight() {
    const side = pickOf(rnd, WALL_SIDES);
    s.walls = s.walls || {};
    s.walls[side] = { ...(s.walls[side] || {}), heightFt: rangeOf(rnd, 2, 30) };
    delete (s.walls[side] || {}).sunGlazing;
  });
  maybe(0.4, function stalePlateZ() {
    for (const el of s.elements || []) {
      if (el.category === 'floor') el.z = rangeOf(rnd, 0, 40);
    }
  });
  maybe(0.3, function duplicatePlate() {
    const plate = (s.elements || []).find((el) => el.category === 'floor');
    if (plate) s.elements.push({ ...plate, id: `${plate.id || 'plate'}-dup` });
  });
  maybe(0.3, function junkLevels() {
    s.levels = [{ id: 'lv-x', name: 'Old Level', elevationFt: rangeOf(rnd, -4, 30), heightFt: rangeOf(rnd, 0, 30) }];
  });
  maybe(0.4, function absurdSills() {
    for (const o of s.openings || []) { if (rnd() < 0.5) o.sillFt = pickOf(rnd, [-6, 45, 12]); }
  });
  maybe(0.3, function stringNumerics() {
    if (s.shell) s.shell.wallHeightFt = String(s.shell.wallHeightFt);
    for (const r of s.rooms || []) { if (rnd() < 0.3) r.w = String(r.w); }
  });
  maybe(0.25, function junkOpening() {
    (s.openings = s.openings || []).push({ type: 'porthole', wall: 'ceiling', x: 'left', widthFt: 'wide', level: 9 });
  });
  maybe(0.25, function strayLevel() {
    for (const r of s.rooms || []) { if (rnd() < 0.25) r.level = pickOf(rnd, [0, 5, -1]); }
  });
  return { spec: s, damages: picks };
}
