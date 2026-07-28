// DECK STAIRS — the laws a way down has to obey.
//
// Everything here came out of one afternoon of Daniel finding them by eye on
// his own house. The point of the battery is that nobody has to find them by
// eye twice. It runs against the real resolver, not a copy: resolveDeckStairs
// is the single answer the renderer, the receipts and the deck card all read,
// so if it is wrong here it is wrong in all three.
//
// Run: node tools/deck_stair_test.mjs
import { resolveDeck, resolveDeckStairs, deckGroupOf, STAIR_LIMITS, structureDoorStart } from '../src/engine.js';

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
  // CHANGED (update 213): these asked for `blocked`. A refused choice now
  // MOVES the flight rather than deleting it, so the durable assertion is the
  // one that always mattered — whatever gets drawn does not cross the shed,
  // and the shed is named as the reason.
  const refused = (r) => Boolean(r) && (r.blocked || r.movedFrom);
  const because = (r) => (r && ((r.movedFrom && r.movedFrom.why) || r.obstruction)) || '';
  const straight = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east' }, dk);
  ok(refused(straight) && because(straight) === 'Shed', `a straight run into a shed is refused (${because(straight) || 'NOT refused'})`);
  const folded = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairTurn: 'north' }, dk);
  ok(refused(folded) && because(folded) === 'Shed', 'and folding does not sneak it past — the first leg still crosses');
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
  const southWhy = (south && ((south.movedFrom && south.movedFrom.why) || south.obstruction)) || '';
  ok(Boolean(south) && (south.blocked || south.movedFrom) && southWhy === 'Shed',
    `turning INTO it is refused (${southWhy || 'NOT refused'}) — the second leg is checked too`);
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
  ok(Boolean(atDoor) && /door/i.test((atDoor.movedFrom && atDoor.movedFrom.why) || atDoor.obstruction || ''),
    `a shed's own door keeps its ground (${(atDoor.movedFrom && atDoor.movedFrom.why) || atDoor.obstruction || 'NOT refused'})`);
  // ...and refusing it must not leave the deck with nothing
  ok(Boolean(atDoor) && !atDoor.blocked && Boolean(atDoor.movedFrom),
    'a refused position moves the flight rather than deleting it');
  ok(Boolean(atDoor) && Math.abs(atDoor.mid - 28) > 2,
    'and it lands somewhere else, not silently back where it was refused');
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

// ── the switchback: the compact way down ──────────────────────────────────
{
  const spec = base([upperDeck({})]);
  const dk = resolveDeck(spec, spec.elements[0]);
  const straight = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east' }, dk);
  const u = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'u', deckStairs: 'east', deckStairFall: 'north' }, dk);
  ok(Boolean(u) && !u.blocked && u.shape === 'u', 'a switchback resolves on a deck wide enough for two flights');
  ok(u.n1 + u.n2 === u.treads, `it keeps every tread (${u.n1}+${u.n2} of ${u.treads})`);
  ok(Math.abs(u.rise - straight.rise) < 0.001, 'and the same climb');
  ok(u.need < straight.treads * 0.9 * 0.8, `and needs far less length (${u.need.toFixed(1)} ft vs ${(straight.treads * 0.9).toFixed(1)} straight)`);
  ok(u.legW >= STAIR_LIMITS.minWidthFt, `both flights are wide enough (${u.legW} ft)`);
  ok(u.lane1Hi <= u.lane2Lo + 0.001, 'the two flights are side by side, not on top of each other');
  // you arrive back near where you set off — that is what a switchback is for
  ok(Math.abs(u.botAt - u.topAt) < Math.abs(u.turnAt - u.topAt), 'and the foot comes back toward the top');
  // a deck too narrow for two flights declines rather than drawing a ladder
  const narrow = { ...upperDeck({}), w: 5 };
  const dkN = resolveDeck(base([narrow]), narrow);
  const tooThin = resolveDeckStairs(base([narrow]), { ...narrow, deckStairShape: 'u', deckStairs: 'east', deckStairFall: 'north' }, dkN);
  ok(Boolean(tooThin) && tooThin.blocked && tooThin.narrow, 'a deck too narrow for two flights refuses, rather than drawing one nobody can climb');
}

// ── a room is enclosed space, and a stair may not pass through it ──────────
{
  const sunspace = { id: 'gh', name: 'Greenhouse', type: 'plant', x: 34, y: 10, w: 14, d: 20, level: 1 };
  const spec = { ...base([upperDeck({})]), rooms: [sunspace] };
  const dk = resolveDeck(spec, spec.elements[0]);
  const through = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 20 }, dk);
  const why = (through && ((through.movedFrom && through.movedFrom.why) || through.obstruction)) || '';
  ok(why === 'Greenhouse', `a run through a greenhouse is refused (${why || 'NOT refused'})`);
}

// ── a doorway sits where it is put, and its clear ground goes with it ─────
{
  const bay = { id: 'bay', name: 'Bay', category: 'outbuilding', x: 34, y: 10, w: 8, d: 20, h: 9, level: 1, doorEastFt: 3 };
  ok(Math.abs(structureDoorStart(bay, 'East', bay.y, bay.d, 3) - (10 + (20 - 3) / 2)) < 0.01,
    'unset, a doorway still centres on its face');
  ok(Math.abs(structureDoorStart({ ...bay, doorEastAt: 24 }, 'East', bay.y, bay.d, 3) - 24) < 0.01,
    'set, it sits exactly where it was put');
  ok(Math.abs(structureDoorStart({ ...bay, doorEastAt: 999 }, 'East', bay.y, bay.d, 3) - (30 - 3)) < 0.01,
    'and past the end it stops at the end rather than hanging off it');
  // the clear ground in front of it must follow the door, not the middle: the
  // same doorway, moved along its own wall, changes what a stair may cross
  const longBay = { id: 'bay2', name: 'Long bay', category: 'outbuilding', x: 40, y: 0, w: 40, d: 8, h: 9, level: 1, doorSouthFt: 3 };
  const runAt = (over) => {
    const spec = base([upperDeck({}), { ...longBay, ...over }]);
    const dk = resolveDeck(spec, spec.elements[0]);
    const r = resolveDeckStairs(spec, { ...spec.elements[0], deckStairShape: 'out', deckStairs: 'east', deckStairAt: 11 }, dk);
    return (r && ((r.movedFrom && r.movedFrom.why) || r.obstruction)) || '';
  };
  ok(!/door/i.test(runAt({})), 'centred, that bay\'s doorway is far away and the stair is left alone');
  ok(/door/i.test(runAt({ doorSouthAt: 40 })), 'moved to the near end of the same wall, it now keeps the stair off');
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
