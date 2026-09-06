// HEAT-SOURCE CLEARANCE TO COMBUSTIBLES — the law a stove has to obey.
//
// Daniel, July 2026, working his own workshop out by hand: 68″ deep inside, a
// 22″ stove and a 16″ hearth — a standard 36″ rear clearance does not fit; a
// shielded 12″ does, with 18″ to walk past. "It fits if he buys the right
// stove, not any stove." And the room has polycarbonate walls, which deform
// well below the temperature a shield sees. The app checked none of it. This
// battery holds resolveHeatClearance — the one answer the flags and the
// heater's card both read — to that arithmetic, for any heater in any room.
//
// Run: node tools/heat_clearance_test.mjs
import { emptyLandSpec, resolveHeatClearance, detectIssues, heaterElements, HEAT_CLEARANCE_IN } from '../src/engine.js';
import { applyBimOperations } from '../backend/bim-core.mjs';

let checks = 0;
const fails = [];
const ok = (cond, label) => { checks += 1; if (!cond) fails.push(label); };

const stove = (over) => ({ id: 'st', name: 'Wood Stove', kind: 'heater', category: 'thermal', w: 3, d: 2.5, h: 4, level: 1, ...over });
const spec = (elements, heatSource = 'wood_stove', walls = {}) => {
  const s = emptyLandSpec();
  s.utilities = { ...(s.utilities || {}), heatSource };
  s.walls = { ...(s.walls || {}), ...walls };
  s.elements = elements;
  return s;
};
const heatFlags = (s) => detectIssues(s).filter((i) => i.system === 'heat' && /close|fit|shield/i.test(i.title));

// ── the workshop, to the inch ───────────────────────────────────────────────
// 19 × 5.7 ft inside (68″), polycarbonate walls, the stove against the north wall.
{
  const ws = { id: 'ws', name: 'Workshop', category: 'outbuilding', x: 60, y: 10, w: 19, d: 5.7, h: 9, construction: 'stick', wallCovering: 'polycarb', level: 1 };
  const s = spec([ws, stove({ x: 62, y: 10.2 })]);
  const hc = resolveHeatClearance(s, s.elements[1]);
  ok(hc && hc.enclosure.kind === 'structure' && hc.enclosure.name === 'Workshop', 'a stove inside a structure is checked against that structure');
  ok(hc.needIn === 36, 'an unshielded wood stove needs 36″');
  ok(hc.nearest && /north wall/.test(hc.nearest.name) && Math.round(hc.nearest.distIn) === 2, `the north wall is the offender at 2″ (got ${hc.nearest && hc.nearest.name} ${hc.nearest && hc.nearest.distIn.toFixed(1)})`);
  ok(hc.fitOpen === null, '36″ each side of a 30″ stove does not fit a 68″ room — no open spot exists');
  ok(hc.fitShielded !== null, '12″ each side does fit: 30 + 24 = 54 < 68');
  ok(hc.softens, 'polycarbonate is named as a wall that softens, not merely burns');
  const flags = heatFlags(s);
  ok(flags.length === 1 && flags[0].fixId === 'heater-shield', `the flag offers the shield remedy, not a move that cannot exist (got ${flags.map((f) => f.fixId).join(',') || 'none'})`);
  ok(flags.length === 1 && /right stove, not any stove/.test(flags[0].fix), 'and says so in Daniel\'s own words');
  ok(flags.length === 1 && /polycarbonate/.test(flags[0].fix), 'and names the polycarbonate problem');
  // The one-tap remedy: shield it and move it. Applied through the real op
  // path, the flag must then clear itself.
  const fixed = applyBimOperations(s, { operations: [
    { type: 'update_object', targetId: 'st', field: 'heatShield', value: 'yes' },
    { type: 'move_object', targetId: 'st', x: flags[0].fixX, y: flags[0].fixY }
  ] }).spec;
  const hc2 = resolveHeatClearance(fixed, fixed.elements.find((e) => e.id === 'st'));
  ok(hc2.shielded && hc2.needIn === 12, 'heatShield=yes brings the requirement to 12″');
  ok(hc2.nearest === null, `shielded and moved, nothing is too close (nearest ${hc2.walls[0] && hc2.walls[0].distIn.toFixed(1)}″)`);
  ok(heatFlags(fixed).length === 0, 'and the flag clears itself');
  ok(hc2.walls.every((w) => w.distIn >= 11.5), 'every wall is at least 12″ away after the move');
}

// ── a room deep enough: the plain move remedy ──────────────────────────────
{
  const shop = { id: 'ws', name: 'Studio', category: 'outbuilding', x: 60, y: 10, w: 14, d: 12, h: 9, construction: 'timber', wallCovering: 'plywood', level: 1 };
  const s = spec([shop, stove({ x: 60.5, y: 11 })]);
  const flags = heatFlags(s);
  ok(flags.length === 1 && flags[0].fixId === 'heater-clearance', `a room with a clear spot offers the move (got ${flags.map((f) => f.fixId).join(',') || 'none'})`);
  ok(flags.length === 1 && /plywood/.test(flags[0].fix), 'the wall is named by its skin (plywood)');
  const moved = applyBimOperations(s, { operations: [{ type: 'move_object', targetId: 'st', x: flags[0].fixX, y: flags[0].fixY }] }).spec;
  ok(heatFlags(moved).length === 0, 'moving it to the offered spot clears the flag');
  const hc = resolveHeatClearance(moved, moved.elements.find((e) => e.id === 'st'));
  ok(hc.walls.every((w) => w.distIn >= 35.5), `the offered spot is 36″ from every wall (nearest ${hc.walls[0].distIn.toFixed(1)}″)`);
}

// ── an open side is no wall ────────────────────────────────────────────────
{
  const shed = { id: 'ws', name: 'Woodshed', category: 'outbuilding', x: 60, y: 10, w: 10, d: 8, h: 8, construction: 'shed', openSouth: 'yes', level: 1 };
  const s = spec([shed, stove({ x: 63.5, y: 15.4 })]);   // hard against the (open) south side, 3 ft+ from the rest
  const hc = resolveHeatClearance(s, s.elements[1]);
  ok(!hc.walls.some((w) => w.side === 'south'), 'an open side is not a wall to keep clear of');
  ok(hc.nearest === null, `nothing else is too close (nearest ${hc.walls[0] && hc.walls[0].distIn.toFixed(1)}″ ${hc.walls[0] && hc.walls[0].side})`);
}

// ── a shared edge is no wall either ────────────────────────────────────────
{
  const a = { id: 'a', name: 'Bay', category: 'outbuilding', x: 60, y: 10, w: 12, d: 10, h: 9, construction: 'stick', level: 1 };
  const b = { id: 'b', name: 'Room', category: 'outbuilding', x: 72, y: 10, w: 8, d: 10, h: 9, construction: 'stick', level: 1 };
  const s = spec([a, b, stove({ x: 68.5, y: 13.5 })]);   // in the bay, hard against the edge it shares with the room
  const hc = resolveHeatClearance(s, s.elements[2]);
  ok(!hc.walls.some((w) => w.side === 'east'), 'the edge two joined structures share is not a wall');
  ok(hc.nearest === null, 'so a stove against it is not flagged');
  b.standsAlone = 'yes';
  const hc2 = resolveHeatClearance(s, s.elements[2]);
  ok(hc2.walls.some((w) => w.side === 'east') && hc2.nearest && hc2.nearest.side === 'east', 'declare them separate buildings and the wall — and the flag — come back');
}

// ── inside the house ───────────────────────────────────────────────────────
{
  // The default land is a framed shell: every wall burns.
  const s = spec([stove({ x: 0.5, y: 12 })]);
  const hc = resolveHeatClearance(s, s.elements[0]);
  ok(hc && hc.enclosure.kind === 'house', 'a stove inside the shell is checked against the house');
  ok(hc.nearest && hc.nearest.side === 'west', `the west wall is the offender (got ${hc.nearest && hc.nearest.side})`);
  ok(heatFlags(s).length === 1 && heatFlags(s)[0].fixId === 'heater-clearance', 'a house is big enough: the move is offered');
  // Cob does not burn: the same stove against a cob west wall is fine.
  const cob = spec([stove({ x: 0.5, y: 12 })], 'wood_stove', { west: { assembly: 'cob' } });
  const hcc = resolveHeatClearance(cob, cob.elements[0]);
  ok(hcc.walls.find((w) => w.side === 'west') && !hcc.walls.find((w) => w.side === 'west').combustible, 'a cob wall is not combustible');
  ok(hcc.nearest === null, 'so a stove may stand against it');
  // An interior framed wall counts too.
  const part = spec([stove({ x: 12, y: 12 }), { id: 'p', name: 'Kitchen / Hall wall', category: 'partition', x: 12, y: 15, w: 10, d: 0.4, level: 1, construction: 'framed' }]);
  const hcp = resolveHeatClearance(part, part.elements[0]);
  ok(hcp.nearest && hcp.nearest.side === 'interior', `an interior framed wall 6″ off is flagged (got ${hcp.nearest && hcp.nearest.side})`);
}

// ── the heat source decides the rule ───────────────────────────────────────
{
  const s = spec([stove({ x: 0.5, y: 12, name: 'Masonry Heater', w: 4, d: 4 })], 'masonry');
  const hc = resolveHeatClearance(s, s.elements[0]);
  ok(hc.rule.open === 36 && hc.rule.shielded === 4, 'a masonry heater: 36″, or 4″ built to ASTM E1602');
  const mini = spec([stove({ x: 0.5, y: 12, name: 'Mini-Split Unit' })], 'minisplit');
  ok(resolveHeatClearance(mini, mini.elements[0]) === null, 'a mini-split has nothing to keep clear of');
  ok(HEAT_CLEARANCE_IN.minisplit === null, 'and the table says so');
  // A heater standing in the open (outside every building) is nobody's problem.
  const open = spec([stove({ x: 200, y: 200 })]);
  ok(resolveHeatClearance(open, open.elements[0]) === null, 'a heater in the open is not checked');
  ok(heaterElements(spec([stove({}), { id: 'x', name: 'Water Tank', category: 'water', x: 1, y: 1, w: 4, d: 4 }])).length === 1, 'only heaters are heaters');
}

console.log(`heat clearance: ${checks} checks`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('  ✓ a stove keeps its distance from what burns, a shield halves it, and the workshop fits only with the right stove.');
