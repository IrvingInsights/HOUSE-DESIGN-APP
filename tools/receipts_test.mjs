// Receipts battery — every receipt must sum EXACTLY to its cost line.
//
// deriveDesign emits receipts (derived.receipts) built inline from the same
// variables as the costs. This test holds that promise: for each reference
// design, every system's receipt lines must sum to cost.<system> and the
// sweat lines must sum to -sweat. If a formula changes without its receipt
// (or vice versa), this fails and names the line.

import {
  seedSpec, getWallSections, deriveDesign, convertSpecApproach
} from '../src/engine.js';

const fixtures = () => {
  const strawBale = structuredClone(seedSpec);
  strawBale.walls = {
    north: { assembly: 'straw-bale' }, south: { assembly: 'straw-bale' },
    east: { assembly: 'straw-bale' }, west: { assembly: 'straw-bale' }
  };
  strawBale.systems = { ...strawBale.systems, frameGround: 'timber' };
  // a variant exercising reclaimed discounts + DIY sweat + offgrid power
  const loaded = structuredClone(strawBale);
  loaded.reclaimed = { frame: true, walls: true, flooring: true, windows: true, roof: true };
  loaded.utilities = { ...(loaded.utilities || {}), diyWalls: true, diyRoof: true, diyFoundation: true, powerMode: 'offgrid', foundationType: 'stemwall', tankGal: 1500 };
  // slab pads (a slab drawn as one shape, bigger than the house):
  // padSlab = the pad IS the slab (main foundation is 'slab') — priced once;
  // padExtra = the pad is EXTRA slab beside a rubble-trench house.
  const padSlab = structuredClone(seedSpec);
  padSlab.utilities = { ...(padSlab.utilities || {}), foundationType: 'slab' };
  padSlab.elements = [{ id: 'pad1', name: 'Slab shape', category: 'foundation', construction: 'slabpad', x: -2, y: -2, w: 40, d: 32, h: 0.35, level: 1 }];
  const padExtra = structuredClone(seedSpec);
  padExtra.utilities = { ...(padExtra.utilities || {}), foundationType: 'rubble' };
  padExtra.elements = [{ id: 'pad2', name: 'Carport slab', category: 'foundation', construction: 'slabpad', x: 40, y: 2, w: 20, d: 12, h: 0.35, level: 1 }];
  // a shed roof with full drainage: gutters all around + a cistern
  const drained = structuredClone(seedSpec);
  drained.shell = { ...drained.shell, roofType: 'shed', southWallHeightFt: 12, northWallHeightFt: 8, gutters: 'all', discharge: 'cistern' };
  return {
    seed: structuredClone(seedSpec),
    standard: convertSpecApproach(structuredClone(seedSpec), 'standard'),
    strawBale,
    loaded,
    padSlab,
    padExtra,
    drained
  };
};

let passed = 0; let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed += 1; console.log(`  ok  ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}`); }
};

for (const [name, spec] of Object.entries(fixtures())) {
  const d = deriveDesign(spec, getWallSections(spec));
  const { systems, sweat } = d.receipts;
  for (const [key, expected] of Object.entries(d.cost)) {
    const lines = systems[key];
    ok(Array.isArray(lines), `${name}.${key} has receipt lines`);
    if (!Array.isArray(lines)) continue;
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    const match = Math.abs(sum - expected) < 0.5;
    ok(match, `${name}.${key}: lines sum ${Math.round(sum)} = cost ${Math.round(expected)}`);
    for (const l of lines) {
      if (!Number.isFinite(l.amount)) ok(false, `${name}.${key}: line "${l.label}" amount is not a number`);
      if (l.qty != null && l.rate != null && Math.abs(l.qty * l.rate - l.amount) > 0.5) {
        ok(false, `${name}.${key}: line "${l.label}" shows ${l.qty} x ${l.rate} but amount is ${l.amount}`);
      }
    }
  }
  const sweatSum = sweat.reduce((s, l) => s + l.amount, 0);
  ok(Math.abs(sweatSum + d.sweat) < 0.5, `${name}: sweat lines sum ${Math.round(sweatSum)} = -sweat ${Math.round(-d.sweat)}`);
}

// The slab-pad no-double-count law, pinned with explicit numbers:
// seed house = 36×28 = 1008 sf floor, perimeter 128 ft (× $6 perimeter insulation).
{
  const f = fixtures();
  const dSlab = deriveDesign(f.padSlab, getWallSections(f.padSlab));
  ok(Math.abs(dSlab.cost.foundation - (1280 * 15 + 128 * 6)) < 0.5,
    `padSlab: the 1280 sf drawn shape IS the slab, priced once (got ${Math.round(dSlab.cost.foundation)})`);
  const dExtra = deriveDesign(f.padExtra, getWallSections(f.padExtra));
  ok(Math.abs(dExtra.cost.foundation - (1008 * 8 + 128 * 6 + 240 * 15)) < 0.5,
    `padExtra: rubble house + 240 sf extra slab (got ${Math.round(dExtra.cost.foundation)})`);
}

// Drainage lands in the roof line, itemized: gutters (perimeter × $8) +
// downspouts ($55 ea) + cistern ($3,800) all show and sum into cost.roof.
{
  const f = fixtures();
  const d = deriveDesign(f.drained, getWallSections(f.drained));
  const roofLines = d.receipts.systems.roof.map((l) => l.label);
  ok(roofLines.some((l) => l === 'Gutters'), 'drained: a Gutters receipt line exists');
  ok(roofLines.some((l) => l === 'Downspouts'), 'drained: a Downspouts receipt line exists');
  ok(roofLines.some((l) => /Cistern/.test(l)), 'drained: a cistern runoff line exists');
  const perim = 2 * (Number(f.drained.shell.widthFt) + Number(f.drained.shell.depthFt));
  const gutterLine = d.receipts.systems.roof.find((l) => l.label === 'Gutters');
  ok(Math.abs(gutterLine.amount - perim * 8) < 0.5, `drained: gutters = ${perim} ft × $8 (got ${Math.round(gutterLine.amount)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
