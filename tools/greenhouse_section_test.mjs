// The greenhouse-section battery — locks the update-142 fixes:
//  (1) splitSouthEdgeAt works on the plain rectangle AND custom outlines
//      (L-shape, already-split) — the update-141 one-tap refused anything
//      non-rectangular, which killed every greenhouse button on real designs.
//  (2) Splitting is idempotent — tapping again inserts no duplicate points.
//  (3) Side-level sunGlazing:true brings its 2 ft kneewall even when the wall
//      carried its own height — without it the glass was a sliver at the top.
import { applyBimOperations, splitSouthEdgeAt, footprintEdges, resolveWallSide } from '../backend/bim-core.mjs';

let checks = 0;
const ok = (cond, label) => {
  checks += 1;
  if (!cond) { console.error(`FAIL: ${label}`); process.exit(1); }
};

const base = (extra = {}) => ({
  shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, ...extra },
  rooms: [], elements: [], openings: []
});

const applySplit = (spec, cut) => {
  const r = applyBimOperations(spec, { operations: [{ type: 'set_footprint', value: JSON.stringify(cut.poly) }] });
  ok(Boolean(r?.spec), 'set_footprint applies');
  return r.spec;
};
const glazedEdgeOf = (spec, x0, x1) => footprintEdges(spec).find((e) => e.facing === 'south'
  && Math.min(e.x0, e.x1) >= x0 - 0.3 && Math.max(e.x0, e.x1) <= x1 + 0.3);

// 1. Plain rectangle: split 12..24
{
  const spec = base();
  const cut = splitSouthEdgeAt(spec, 12, 24);
  ok(cut && cut.x0 === 12 && cut.x1 === 24, 'rect: cut clamps to 12..24');
  ok(cut.poly.length === 6, 'rect: poly gains the two split points');
  const s1 = applySplit(spec, cut);
  const edge = glazedEdgeOf(s1, 12, 24);
  ok(Boolean(edge), 'rect: a south edge spans exactly the cut');
  const s2 = applyBimOperations(s1, { operations: [
    { type: 'set_wall_side', wall: edge.key, field: 'sunGlazing', value: true },
    { type: 'set_wall_side', wall: edge.key, field: 'kneewallFt', value: 2 }
  ] }).spec;
  const r = resolveWallSide(s2, 'south', 1, edge.key);
  ok(r.sunGlazing === true, 'rect: the section resolves glazed');
  ok(!resolveWallSide(s2, 'south').sunGlazing, 'rect: the SIDE itself stays unglazed');
}

// 2. L-shape: two south stretches (24..36 @ y=18, 0..24 @ y=28); split 4..16 on the lower
{
  const spec = base({ footprint: [[0, 0], [36, 0], [36, 18], [24, 18], [24, 28], [0, 28]] });
  const cut = splitSouthEdgeAt(spec, 4, 16);
  ok(cut && cut.x0 === 4 && cut.x1 === 16, 'L: cut lands on the long lower stretch');
  ok(cut.poly.length === 8, 'L: poly gains two points');
  const s1 = applySplit(spec, cut);
  const edge = glazedEdgeOf(s1, 4, 16);
  ok(Boolean(edge) && edge.y0 === 28, 'L: the glazed stretch sits on y=28');
  // the OTHER south stretch (the notch edge at y=18) is untouched
  ok(footprintEdges(s1).some((e) => e.facing === 'south' && e.y0 === 18
    && Math.min(e.x0, e.x1) === 24 && Math.max(e.x0, e.x1) === 36), 'L: the notch south edge survives whole');
}

// 3. L-shape notch stretch: a cut on the inset south edge clamps to it
{
  const spec = base({ footprint: [[0, 0], [36, 0], [36, 18], [24, 18], [24, 28], [0, 28]] });
  const cut = splitSouthEdgeAt(spec, 26, 40);
  ok(cut && cut.x0 === 26 && cut.x1 === 36, 'L-notch: cut clamps into the 24..36 stretch');
  const s1 = applySplit(spec, cut);
  ok(Boolean(glazedEdgeOf(s1, 26, 36)), 'L-notch: the inset stretch got its section');
}

// 4. Idempotence: re-splitting the same span changes nothing
{
  const spec = base();
  const s1 = applySplit(spec, splitSouthEdgeAt(spec, 12, 24));
  const cut2 = splitSouthEdgeAt(s1, 12, 24);
  ok(cut2 && cut2.poly.length === footprintEdges(s1).length, 'idempotent: second cut inserts no new points');
}

// 5. No fit: a stretch over the void of the notch answers null; round answers null
{
  const spec = base({ footprint: [[0, 0], [36, 0], [36, 18], [24, 18], [24, 28], [0, 28]] });
  ok(splitSouthEdgeAt(spec, 24.5, 26.5) === null, 'no-fit: a 2 ft sliver answers null');
  ok(splitSouthEdgeAt(base({ footprint: 'round' }), 4, 16) === null, 'round: answers null');
}

// 6. Side glazing brings its kneewall (the sliver-of-glass bug)
{
  let s = base();
  s = applyBimOperations(s, { operations: [{ type: 'set_wall_side', wall: 'south', field: 'heightFt', value: 10 }] }).spec;
  s = applyBimOperations(s, { operations: [{ type: 'set_wall_side', wall: 'south', field: 'sunGlazing', value: true }] }).spec;
  const r = resolveWallSide(s, 'south');
  ok(r.sunGlazing === true, 'kneewall: side glazes');
  ok(Number(r.heightFt) === 2, `kneewall: full-height wall drops to the 2 ft kneewall (got ${r.heightFt})`);
  // turning it off stands the wall back up (existing law still holds)
  const off = applyBimOperations(s, { operations: [{ type: 'set_wall_side', wall: 'south', field: 'sunGlazing', value: false }] }).spec;
  ok(!resolveWallSide(off, 'south').sunGlazing && Number(resolveWallSide(off, 'south').heightFt) !== 2, 'kneewall: glazing off stands the wall back up');
  // a deliberate LOW kneewall set before glazing is kept
  let s2 = base();
  s2 = applyBimOperations(s2, { operations: [{ type: 'set_wall_side', wall: 'south', field: 'heightFt', value: 3 }] }).spec;
  s2 = applyBimOperations(s2, { operations: [{ type: 'set_wall_side', wall: 'south', field: 'sunGlazing', value: true }] }).spec;
  ok(Number(resolveWallSide(s2, 'south').heightFt) === 3, 'kneewall: a chosen 3 ft kneewall is kept');
}

console.log(`greenhouse_section_test: all ${checks} checks green`);

// 7. The greenhouse OPENING (update 146): added, moved, resized, removed like
//    any window — the moveable design that replaced fixed wall sections.
{
  let s = base();
  s = applyBimOperations(s, { operations: [{ type: 'add_opening', wall: 'south', openingType: 'greenhouse', widthFt: 12, positionFt: 10, level: 1, tiltDeg: 30 }] }).spec;
  const gh = (s.openings || []).find((o) => o.type === 'greenhouse');
  ok(Boolean(gh), 'gh-opening: stored');
  ok(gh.x === 10 && gh.widthFt === 12, 'gh-opening: explicit position and width stick');
  ok(Number(gh.tiltDeg) === 30, 'gh-opening: tilt stored');
  const idx = (s.openings || []).indexOf(gh);
  s = applyBimOperations(s, { operations: [{ type: 'update_object', targetId: `opening-${idx}`, field: 'widthFt', value: 16 }] }).spec;
  ok(Number(s.openings[idx].widthFt) === 16, 'gh-opening: resizes like any opening');
  s = applyBimOperations(s, { operations: [{ type: 'update_object', targetId: `opening-${idx}`, field: 'sillFt', value: 3 }] }).spec;
  ok(Number(s.openings[idx].sillFt) === 3, 'gh-opening: kneewall (sill) adjustable');
  s = applyBimOperations(s, { operations: [{ type: 'remove_object', targetId: `opening-${idx}` }] }).spec;
  ok(!(s.openings || []).some((o) => o.type === 'greenhouse'), 'gh-opening: removes like any opening');
}
console.log('greenhouse OPENING checks green');
