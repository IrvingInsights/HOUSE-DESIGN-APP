// THE FACE-LAW BATTERY — pins the 2D face math (src/reimagine/faceLaw.js)
// to HAND-VERIFIED values of the 3D scene's own laws, so a drift between
// what the plan/wall/stack views draw and what the model builds fails HERE
// instead of reaching the user's eyes ("the 2D views and the 3D model do
// not match" — the class this file exists to kill). Every case below was
// first computed by hand against threeScene's formulas (tierWallTop,
// shedEaveAt, the legacy stacked model, the attached lean-to branch), and
// the ultra-review regressions are pinned by name.
//
//   node tools/face_law_test.mjs
import { buildFaceLaw } from '../src/reimagine/faceLaw.js';
import { sunspacePartitions, detectIssues, seedSpec } from '../src/engine.js';

let pass = 0; let fail = 0;
const problems = [];
function check(ok, label, detail = '') {
  if (ok) { pass += 1; return; }
  fail += 1;
  problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
const near = (a, b, tol = 0.06) => Number.isFinite(a) && Math.abs(a - b) <= tol;

const baseSpec = (shell, elements = [], rooms = []) => ({
  shell, elements, rooms, openings: [], walls: {}, systems: { envelope: '' }
});

// ── 1. REGRESSION (ultra finding 1): the shed slope is SIGNED ────────────────
// West-high shed (W16/E8) falls EAST: a set-back storey's wall top must FALL
// toward +x from its plate edge, exactly as tierWallTop does — the first cut
// used |rise|/run and drew the rake mirrored.
{
  const spec = baseSpec(
    { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofType: 'shed', westWallHeightFt: 16, eastWallHeightFt: 8, southWallHeightFt: 10, northWallHeightFt: 10, storeys: 2, storeyHeights: { 1: 10, 2: 10 } },
    [{ id: 'p2', category: 'floor', level: 2, x: 0, y: 0, w: 20, d: 28 }]
  );
  const law = buildFaceLaw(spec, 'south');
  const tier = law.tiers.find((b) => b.lv === 2);
  check(!!tier, 'west-high: tier band exists');
  if (tier) {
    // slope = (8−16)/36 = −0.2222; top at plate west edge = 20, at east edge 20 − 0.2222·20 = 15.556
    check(near(tier.topAt(0.02), 20, 0.1), 'west-high: tier top at plate west edge = 20', String(tier.topAt(0.02)));
    check(near(tier.topAt(19.98), 15.56, 0.1), 'west-high: tier top FALLS east to 15.56', String(tier.topAt(19.98)));
    check(tier.topAt(19.98) < tier.topAt(0.02), 'west-high: rake direction falls east (the mirrored-rake regression)');
  }
}

// ── 2. REGRESSION (ultra finding 2): the attached lean-to plane ──────────────
// Daniel's design shape: 36×36 shed W10/E20 (slope +0.2778), 2 storeys of
// 10, plate2 x17.5 w18.5 full-depth with stepBelow 'roof-top', west overhang
// 2.5, east 6. Ring = x 0..17.5; highSide east; X0 = −2.5, X1 = 17.85;
// lowA = min(20−0.5, shedEave(0,·)=10 + 0.25) = 10.25; highA = 20.
// Hand values: roofAt(0.02) = 10.25 + (2.52/20.35)·9.75 = 11.457;
//              roofAt(17.4) = 10.25 + (19.9/20.35)·9.75 = 19.784.
{
  const spec = baseSpec(
    { widthFt: 36, depthFt: 36, wallHeightFt: 10, roofType: 'shed', westWallHeightFt: 10, eastWallHeightFt: 20, southWallHeightFt: 10, northWallHeightFt: 10, storeys: 2, storeyHeights: { 1: 10, 2: 10 }, overhangs: { west: 2.5, east: 6, north: 3.5, south: 7 } },
    [{ id: 'p2', category: 'floor', level: 2, x: 17.5, y: 0, w: 18.5, d: 36, stepBelow: 'roof-top' }]
  );
  const law = buildFaceLaw(spec, 'south');
  check(near(law.roofAt(0.02), 11.457, 0.08), 'lean-to: plane near the west eave = 11.46', String(law.roofAt(0.02)));
  check(near(law.roofAt(17.4), 19.784, 0.08), 'lean-to: plane at the plate edge = 19.78', String(law.roofAt(17.4)));
  check(law.roofAt(25) == null, 'lean-to: no plane under the storey itself');
}

// ── 3. REGRESSION (ultra finding 7): the legacy FULL-footprint stack ─────────
// 2 storeys covering the whole footprint on a W10/E20 shed: every top rides
// the raked profile plus the storey lift — never a flat line.
{
  const spec = baseSpec(
    { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofType: 'shed', westWallHeightFt: 10, eastWallHeightFt: 20, southWallHeightFt: 10, northWallHeightFt: 10, storeys: 2, storeyHeights: { 1: 10, 2: 10 } }
  );
  const law = buildFaceLaw(spec, 'south');
  check(near(law.wallTopAt(0.02), 20.006, 0.1), 'legacy stack: west end = shed 10 + lift 10', String(law.wallTopAt(0.02)));
  check(near(law.wallTopAt(35.98), 29.994, 0.1), 'legacy stack: east end = shed 20 + lift 10', String(law.wallTopAt(35.98)));
  check(law.wallTopAt(35.98) - law.wallTopAt(0.02) > 9, 'legacy stack: the face rakes (never flat)');
}

// ── 4. The ground cap under a standing storey (set-back design) ──────────────
{
  const spec = baseSpec(
    { widthFt: 36, depthFt: 36, wallHeightFt: 10, roofType: 'shed', westWallHeightFt: 10, eastWallHeightFt: 20, southWallHeightFt: 10, northWallHeightFt: 10, storeys: 2, storeyHeights: { 1: 10, 2: 10 } },
    [{ id: 'p2', category: 'floor', level: 2, x: 17.5, y: 0, w: 18.5, d: 36 }]
  );
  const law = buildFaceLaw(spec, 'south');
  check(near(law.groundTopAt(5), 11.389, 0.08), 'ground: raked on the open ring', String(law.groundTopAt(5)));
  check(near(law.groundTopAt(20), 10, 0.05), 'ground: capped at the storey floor under the plate', String(law.groundTopAt(20)));
}

// ── 5. THE SUNSPACE WALL LAW (derived, one list for plan AND 3D) ─────────────
{
  const room = { id: 'gh', name: 'Greenhouse', type: 'plant', level: 1, x: 0, y: 24.5, w: 35, d: 10 };
  const shell = { widthFt: 36, depthFt: 36, wallHeightFt: 10, storeys: 1 };
  const walls = sunspacePartitions(baseSpec(shell, [], [room]));
  check(walls.length === 1, 'sunspace: exactly one wall (the interior north edge)', `got ${walls.length}`);
  if (walls.length === 1) {
    check(near(walls[0].y, 24.5, 0.01) && near(walls[0].w, 35, 0.01) && walls[0].construction === 'cob', 'sunspace: cob wall along the room edge');
    check(walls[0].doorWFt === 3, 'sunspace: the wall carries a doorway');
    check(walls[0].id === 'gh' && walls[0].synthetic === true, 'sunspace: tapping selects the room; marked derived');
  }
  // a person's own partition along that edge wins
  const own = sunspacePartitions(baseSpec(shell, [{ id: 'pt', category: 'partition', x: 0, y: 24.2, w: 35, d: 0.5 }], [room]));
  check(own.length === 0, 'sunspace: a hand-placed partition stands the derived wall down');
  // a room poking out grows the annex instead — no derived wall
  const poked = sunspacePartitions(baseSpec(shell, [], [{ ...room, y: 28 }]));
  check(poked.length === 0, 'sunspace: a poking room defers to the glazed annex');
}

// ── 6. REGRESSION (ultra finding 3): the lean-to pitch check's run ───────────
// Plate flush WEST (x=0) with a 16 ft EAST step must measure the east run —
// the first cut divided by the west inset (0.5) and flagged everything.
{
  const spec = seedSpec ? structuredClone(seedSpec) : null;
  if (spec) {
    spec.shell = { ...spec.shell, widthFt: 36, depthFt: 28, roofType: 'shed', westWallHeightFt: 16, eastWallHeightFt: 8, southWallHeightFt: 10, northWallHeightFt: 10, storeys: 2, storeyHeights: { 1: 10, 2: 10 } };
    spec.elements = [...(spec.elements || []), { id: 'p2', category: 'floor', level: 2, x: 0, y: 0, w: 20, d: 28, stepBelow: 'roof-top' }];
    const flags = detectIssues(spec).map((i) => i.title).join(' | ');
    check(!/steeper than 12:12/.test(flags), 'pitch check: a 16 ft east step at ~0.75 pitch is NOT flagged', flags.slice(0, 120));
  } else {
    check(false, 'seedSpec available for the pitch-check regression');
  }
}

console.log(`face-law battery: ${pass} passed, ${fail} failed`);
if (problems.length) { problems.forEach((p) => console.log('  FAIL:', p)); process.exit(1); }
