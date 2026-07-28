// DECK STAIRS — the laws a way down has to obey.
//
// Everything here came out of one afternoon of Daniel finding them by eye on
// his own house. The point of the battery is that nobody has to find them by
// eye twice. It runs against the real resolver, not a copy: resolveDeckStairs
// is the single answer the renderer, the receipts and the deck card all read,
// so if it is wrong here it is wrong in all three.
//
// Run: node tools/deck_stair_test.mjs
import { resolveDeck, resolveDeckStairs, deckGroupOf, STAIR_LIMITS } from '../src/engine.js';

let checks = 0;
const fails = [];
const ok = (cond, label) => { checks += 1; if (!cond) fails.push(label); };

const HOUSE = { widthFt: 28, depthFt: 32, wallHeightFt: 12, roofPitch: 0.25, storeys: 2, storeyHeights: { 2: 8 } };
const base = (elements, openings = []) => ({
  shell: { ...HOUSE }, utilities: { foundationType: 'rubble', stemwallHeightFt: 1.5 },
  elements, openings, rooms: [], walls: {}, site: {}
});
const upperDeck = (over) => ({ id: 'dk', name: 'Deck', category: 'deck', x: 28, y: 0, w: 6, d: 39, h: 0.35, level: 2, ...over });

// ── a raised walking surface needs a way down, at any level ────────────────
{
  const spec = base([upperDeck({})]);
  const dk = resolveDeck(spec, spec.elements[0]);
  ok(dk.topFt > 10, `an upper deck stands high (got ${dk.topFt.toFixed(1)})`);
  ok(dk.needsSteps, 'a raised deck needs steps whatever storey it is on');
  const st = resolveDeckStairs(spec, spec.elements[0], dk);
  ok(Boolean(st) && !st.blocked, 'and it gets a way down without being asked');
}

// ── the treads obey code, and a fold does not change how many there are ────
{
  const spec = base([upperDeck({})]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const straight = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east' }, dk);
  const riserIn = (straight.rise / straight.treads) * 12;
  ok(riserIn <= STAIR_LIMITS.maxRiserIn + 0.01, `risers within code (${riserIn.toFixed(2)}" vs ${STAIR_LIMITS.maxRiserIn}")`);
  ok(straight.gapW >= STAIR_LIMITS.minWidthFt, `at least ${STAIR_LIMITS.minWidthFt} ft wide (got ${straight.gapW})`);
  const folded = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairTurn: 'north' }, dk);
  ok(Boolean(folded) && !folded.blocked && folded.turn === 'north', 'a turn resolves');
  ok(folded.n1 + folded.n2 === folded.treads, `a fold keeps every tread (${folded.n1}+${folded.n2} of ${folded.treads})`);
  ok(Math.abs(folded.rise - straight.rise) < 0.001, 'and the same climb');
  ok(folded.reach < straight.treads * 0.9 - 1, `and gives ground back (${folded.reach.toFixed(1)} ft vs ${(straight.treads * 0.9).toFixed(1)} straight)`);
  // the legs are perpendicular: one runs along the deck's out-axis, the other across
  ok(folded.outAxis === 'x', 'off an east side the first leg runs east–west');
  ok(folded.acrossTo !== folded.acrossFrom, 'and the second leg actually travels');
}

// ── a stair may not run through a building, folded or straight ─────────────
{
  const shed = { id: 'shed', name: 'Shed', category: 'outbuilding', x: 40, y: 0, w: 14, d: 39, h: 9, level: 1 };
  const spec = base([upperDeck({}), shed]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const straight = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east' }, dk);
  ok(straight.blocked && straight.obstruction === 'Shed', `a straight run into a shed is refused (${straight.obstruction || 'NOT refused'})`);
  const folded = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairTurn: 'north' }, dk);
  ok(folded.blocked, 'and folding does not sneak it past — the first leg still crosses');
}

// ── a fold is checked on BOTH legs, not just the first ─────────────────────
{
  // clear straight out, but a shed sits where the second leg would land
  const shed = { id: 'shed', name: 'Shed', category: 'outbuilding', x: 34, y: 12, w: 20, d: 27, h: 9, level: 1 };
  const spec = base([upperDeck({}), shed]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const north = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 8, deckStairTurn: 'north' }, dk);
  ok(Boolean(north) && !north.blocked, 'turning away from the shed is fine');
  const south = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 8, deckStairTurn: 'south' }, dk);
  ok(south.blocked && south.obstruction === 'Shed', `turning INTO it is refused (${south.obstruction || 'NOT refused'}) — the second leg is checked too`);
}

// ── a door keeps its ground, the house's and a shed's alike ────────────────
{
  const spec = base([upperDeck({})], [{ type: 'slider', wall: 'east', y: 14, widthFt: 6, level: 1 }]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const across = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'along', deckStairs: 'east', deckStairFall: 'south' }, dk);
  ok(Boolean(across) && (across.blocked || across.botAt <= 14 || across.topAt >= 20),
    'an under-deck flight will not lie across a ground-floor slider');
  const shedDoor = { id: 'ws', name: 'Workshop', category: 'outbuilding', x: 34, y: 30, w: 16, d: 9, h: 9, level: 1, doorNorthFt: 3 };
  const spec2 = base([upperDeck({}), shedDoor]);
  const dk2 = resolveDeck(spec2, spec2.elements[0]);
  const atDoor = resolveDeckStairs(spec2, { ...spec2.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 28 }, dk2);
  ok(atDoor.blocked && /door/i.test(atDoor.obstruction || ''), `a shed's own door keeps its ground (${atDoor.obstruction || 'NOT refused'})`);
}

// ── one walking surface, one way down ─────────────────────────────────────
{
  const a = upperDeck({ id: 'a', name: 'Deck A' });
  const b = { id: 'b', name: 'Deck B', category: 'deck', x: 0, y: 32, w: 28, d: 7, h: 0.35, level: 2 };
  const spec = base([a, b]);
  const group = deckGroupOf(spec, a);
  ok(group.length === 2, `decks that meet are one surface (got ${group.length})`);
  const runs = spec.elements.filter((e) => e.category === 'deck')
    .map((e) => resolveDeckStairs(spec, e, resolveDeck(spec, e)))
    .filter((r) => r && !r.blocked);
  ok(runs.length === 1, `and the surface gets exactly one automatic stair (got ${runs.length})`);
}

// ── choosing a position names the stretch, and never invents one ───────────
{
  const spec = base([upperDeck({})]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const at = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 30 }, dk);
  ok(Boolean(at) && !at.blocked, 'a position resolves');
  ok(Math.abs(at.mid - 30) < 2.1, `and the flight sits where it was put (mid ${at.mid.toFixed(1)} for a mark of 30)`);
  const off = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 500 }, dk);
  ok(!off || off.blocked || off.placedOff, 'a mark off the end says so rather than pretending');
}

console.log(`deck stairs: ${checks} checks`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('  ✓ every way down obeys code, respects doors and buildings, and folds without losing a tread.');
