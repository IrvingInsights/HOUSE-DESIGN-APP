// Receipts battery — every receipt must sum EXACTLY to its cost line.
//
// deriveDesign emits receipts (derived.receipts) built inline from the same
// variables as the costs. This test holds that promise: for each reference
// design, every system's receipt lines must sum to cost.<system> and the
// sweat lines must sum to -sweat. If a formula changes without its receipt
// (or vice versa), this fails and names the line.

import {
  seedSpec, getWallSections, deriveDesign, convertSpecApproach, resolveDeck, resolveDeckStairs
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
  // padOutsideOnSlab = a carport pad OUTSIDE the house, on a SLAB foundation —
  // it must stay SEPARATE (not absorbed as the house slab).
  const padOutsideOnSlab = structuredClone(seedSpec);
  padOutsideOnSlab.utilities = { ...(padOutsideOnSlab.utilities || {}), foundationType: 'slab' };
  padOutsideOnSlab.elements = [{ id: 'pad3', name: 'Carport pad', category: 'foundation', construction: 'slabpad', x: 40, y: 2, w: 20, d: 12, h: 0.35, level: 1 }];
  // a shed roof with full drainage: gutters all around + a cistern
  const drained = structuredClone(seedSpec);
  drained.shell = { ...drained.shell, roofType: 'shed', southWallHeightFt: 12, northWallHeightFt: 8, gutters: 'all', discharge: 'cistern' };
  // decks with every option in play, on a stem-wall house (raised floor →
  // auto steps): a wood deck against the south wall, a covered cable-railed
  // deck snapped to its east edge (wraparound — the shared edge prices no
  // railing), and a stone patio at grade away from the house.
  const decked = structuredClone(seedSpec);
  decked.utilities = { ...(decked.utilities || {}), foundationType: 'stemwall' };
  decked.elements = [
    { id: 'dk1', name: 'Deck', category: 'deck', x: 8, y: 28.5, w: 12, d: 8, h: 0.35, level: 1 },
    { id: 'dk2', name: 'Covered deck', category: 'deck', x: 20.2, y: 28.5, w: 10, d: 8, h: 0.35, level: 1, deckRail: 'cable', deckRoof: 'shed' },
    { id: 'pt1', name: 'Patio', category: 'deck', x: -18, y: 2, w: 12, d: 10, h: 0.25, level: 1, deckSurface: 'stone' }
  ];
  return {
    seed: structuredClone(seedSpec),
    standard: convertSpecApproach(structuredClone(seedSpec), 'standard'),
    strawBale,
    loaded,
    padSlab,
    padExtra,
    padOutsideOnSlab,
    drained,
    decked
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
  // The fix: a carport pad OUTSIDE the house on a SLAB foundation stays a
  // SEPARATE slab — the house slab is still just the floor (1008), and the
  // 240 sf pad is priced on top, not absorbed.
  const dOut = deriveDesign(f.padOutsideOnSlab, getWallSections(f.padOutsideOnSlab));
  ok(Math.abs(dOut.cost.foundation - (1008 * 15 + 128 * 6 + 240 * 15)) < 0.5,
    `padOutsideOnSlab: slab house (1008 sf) + separate 240 sf carport slab (got ${Math.round(dOut.cost.foundation)})`);
  ok(dOut.receipts.systems.foundation.some((l) => /outside spaces/i.test(l.label)),
    'padOutsideOnSlab: a separate "Slab for outside spaces" receipt line exists');
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

// Deck options — the receipts itemize what the 3D scene draws, from the same
// resolveDeck answer. Wraparound = the shared edge (and the house edge)
// prices NO railing; a stem-wall house lifts the deck floor → auto steps;
// a stone patio sits at grade with no railing and no steps.
{
  const f = fixtures();
  const spec = f.decked;
  const d = deriveDesign(spec, getWallSections(spec));
  const out = d.receipts.systems.outdoors;
  const find = (re) => out.find((l) => re.test(l.label));
  ok(Boolean(find(/^Deck — wood boards/)), 'decked: a wood-boards deck line exists');
  const wood = find(/^Deck — wood boards/);
  ok(Math.abs(wood.qty - (96 + 80)) < 0.5, `decked: both raised decks price as one 176 sf wood line (got ${wood?.qty})`);
  ok(Boolean(find(/^Patio — stone/)), 'decked: the stone patio prices as a patio line');
  ok(Math.abs(find(/^Patio — stone/).qty - 120) < 0.5, 'decked: patio = 120 sf at grade');
  ok(Boolean(find(/^Deck roof — shed/)), 'decked: the covered deck prices its shed roof');
  ok(Math.abs(find(/^Deck roof — shed/).qty - 80) < 0.5, 'decked: 80 sf covered');
  ok(Boolean(find(/^Deck steps/)), 'decked: stem-wall house → the raised decks price steps down');
  ok(find(/^Deck steps/).qty === 2, 'decked: two raised decks, two stairs (the patio needs none)');
  // railing: dk1 keeps south (12) + west (8) = 20 lf of wood — its north edge
  // faces the house and its east edge faces dk2 (the wraparound join)
  const woodRail = find(/^Deck railing — wood/);
  ok(Boolean(woodRail) && Math.abs(woodRail.qty - 20) < 1.2, `decked: wood railing only on the open edges, ~20 lf (got ${woodRail?.qty})`);
  // dk2 keeps south (10) + east (8) = 18 lf of cable
  const cableRail = find(/^Deck railing — steel/);
  ok(Boolean(cableRail) && Math.abs(cableRail.qty - 18) < 1.2, `decked: cable railing ~18 lf on the covered deck (got ${cableRail?.qty})`);
  // resolveDeck invariants the scene relies on
  const rPatio = resolveDeck(spec, spec.elements[2]);
  ok(rPatio.placement === 'grade' && rPatio.railKey === 'none' && !rPatio.needsSteps, 'decked: stone forces at-grade — no railing, no steps');
  const rDeck = resolveDeck(spec, spec.elements[0]);
  ok(rDeck.topFt > 1.5 && rDeck.needsSteps, 'decked: stem wall lifts the deck floor past 1.5 ft → steps');
  ok((rDeck.openSides.north || []).length === 0, 'decked: the house-facing edge stays open for the doorway (no rail segments)');
  ok((rDeck.openSides.east || []).length === 0, 'decked: the edge shared with the neighboring deck is a join, not a railing');
  // and with the neighbor gone, that east edge rails again (the join is LIVE)
  const alone = structuredClone(spec);
  alone.elements = alone.elements.filter((e) => e.id !== 'dk2');
  const rAlone = resolveDeck(alone, alone.elements[0]);
  ok((rAlone.openSides.east || []).length === 1, 'decked: remove the neighbor and the shared edge grows its railing back');
}

// Deck STAIRS everywhere — resolveDeckStairs is the one answer for the
// renderer, the receipts, and the deck card. 'auto' keeps the old rule
// (pinned above: two auto stairs on the decked fixture); a NAMED edge runs
// deck→deck between levels, priced by the climb; 'none' clears it; an edge
// leaning on the house reports blocked instead of inventing a run.
{
  const f = fixtures();
  const spec = structuredClone(f.decked);
  spec.shell = { ...spec.shell, storeys: 2 };
  spec.elements.push(
    { id: 'landing', name: 'Landing deck', category: 'deck', x: 6, y: 35, w: 14, d: 8, h: 0.35, level: 1 },
    { id: 'bal', name: 'Balcony', category: 'deck', x: 8, y: 28.5, w: 10, d: 6, h: 0.35, level: 2, deckStairs: 'south' }
  );
  const st = resolveDeckStairs(spec, spec.elements.find((e) => e.id === 'bal'));
  ok(Boolean(st) && !st.blocked && st.target === 'deck' && st.side === 'south' && !st.up,
    `stairs: balcony's south steps land on the deck below (got ${JSON.stringify(st && { t: st.target, s: st.side })})`);
  ok(Boolean(st) && st.rise > 6 && st.treads >= 10, `stairs: a storey of climb, real treads (rise ${st && st.rise.toFixed(1)}, ${st && st.treads} treads)`);
  const d = deriveDesign(spec, getWallSections(spec));
  const line = d.receipts.systems.outdoors.find((l) => /^Deck steps/.test(l.label));
  ok(Boolean(line) && line.qty === 4, `stairs: 4 runs price (3 auto + the balcony's) (got ${line?.qty})`);
  ok(Boolean(line) && line.amount > 4 * 260, `stairs: the tall balcony run prices MORE than a flat $260 (line $${line?.amount && Math.round(line.amount)})`);
  // 'none' clears the run; a house-facing edge is blocked, not invented
  const balNone = structuredClone(spec);
  balNone.elements.find((e) => e.id === 'bal').deckStairs = 'none';
  ok(resolveDeckStairs(balNone, balNone.elements.find((e) => e.id === 'bal')) === null, 'stairs: none = no run');
  const balNorth = structuredClone(spec);
  balNorth.elements.find((e) => e.id === 'bal').deckStairs = 'north';
  const stN = resolveDeckStairs(balNorth, balNorth.elements.find((e) => e.id === 'bal'));
  ok(Boolean(stN) && stN.blocked === true, 'stairs: the house-facing edge reports blocked (no open stretch)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
