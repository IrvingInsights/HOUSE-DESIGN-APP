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
  return {
    seed: structuredClone(seedSpec),
    standard: convertSpecApproach(structuredClone(seedSpec), 'standard'),
    strawBale,
    loaded
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
