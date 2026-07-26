// thermal_test.mjs — the summer half of the year, held to physics.
//
// THE POINT: the app spent its whole life thinking about keeping heat IN. It
// knew the house needed 17 kBTU/hr on the coldest night, knew a Temp-Cast was
// chosen, and never compared the two. It reported a single whole-house shading
// percentage computed from the noon sun and the top eave — which credited the
// roof with shading east and west windows it cannot reach, and credited the
// ground floor of a two-storey house with shade twenty feet over its head.
//
// These checks pin the physics, not the numbers: the RELATIONSHIPS that must
// hold for any house, so a future tweak to a coefficient can't quietly invert
// the meaning of the model.
//
// Run: node tools/thermal_test.mjs
import {
  seedSpec, getWallSections, deriveDesign, SHADE_DEVICES, SOLAR_ON_GLASS, HEAT_OUTPUT
} from '../src/engine.js';

let pass = 0; let fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass += 1; console.log(`  ok  ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
const derive = (spec) => deriveDesign(spec, getWallSections(spec));
const base = () => structuredClone(seedSpec);
// A window of a given size on a given wall and floor.
const win = (wall, positionFt, level = 1, type = 'window', widthFt = 6) => ({ wall, positionFt, level, type, widthFt, sillFt: 3 });

// --- 1. glass knows which way it faces ---------------------------------------
{
  const s = base();
  s.openings = [win('east', 4), win('east', 12), win('west', 4)];
  const t = derive(s).thermal;
  ok(t.glassByFace.east > t.glassByFace.west, 'two east windows count as more east glass than one west one');
  ok(t.glassByFace.north === 0, 'a wall with no windows has no glass on it');
  ok(Math.abs(t.eastWestGlass - (t.glassByFace.east + t.glassByFace.west)) < 0.01, 'east+west is the sum of its sides');
}

// --- 2. THE BUG THIS BATTERY EXISTS FOR: an overhang cannot shade east glass --
// The sun is ~20° up when it strikes an east or west wall. No roof reaches it.
{
  const s = base();
  s.shell.overhangFt = 8; // absurdly deep, to make the point
  s.openings = [win('south', 6), win('east', 6)];
  const t = derive(s).thermal;
  ok(t.shadeSummer.south > 0.5, 'a deep overhang shades the south glass in summer', `got ${t.shadeSummer.south.toFixed(2)}`);
  ok(t.shadeSummer.east < 0.2, 'the same overhang does NOT shade the east glass — that sun comes in level', `got ${t.shadeSummer.east.toFixed(2)}`);
}

// --- 3. a roof eave shades the TOP storey, not the ground floor ---------------
{
  const s = base();
  s.shell.storeys = 2;
  s.shell.overhangFt = 4;
  s.openings = [win('south', 6, 1), win('south', 6, 2)];
  const t = derive(s).thermal;
  ok(t.shadeGround !== null, 'a two-storey house reports its ground floor separately');
  ok(t.shadeSummer.south > t.shadeGround.south, 'the eave shades upstairs more than downstairs — it is twenty feet over the ground-floor glass');
  const one = (() => { const x = base(); x.shell.storeys = 1; x.shell.overhangFt = 4; x.openings = [win('south', 6, 1)]; return derive(x).thermal; })();
  ok(one.shadeGround === null, 'a single-storey house has no separate ground floor to report');
}

// --- 4. shade devices do what they say ---------------------------------------
{
  const withDev = (kind) => {
    const s = base();
    s.shell.overhangFt = 0;
    s.openings = [win('west', 6)];
    s.elements = [{ id: 'sh1', name: 'Shade', category: 'shade', kind, side: 'west', x: -5, y: 8, w: 5, d: 12, h: 10, level: 1 }];
    return derive(s).thermal;
  };
  const bare = (() => { const s = base(); s.shell.overhangFt = 0; s.openings = [win('west', 6)]; return derive(s).thermal; })();
  const trellis = withDev('trellis');
  ok(trellis.shadeSummer.west > bare.shadeSummer.west, 'a trellis on the west wall shades west glass the overhang could not');
  ok(trellis.summerGainBtu < bare.summerGainBtu, 'and that shows up as less heat coming in');
  // The seasonal spread is the whole point of a leafy one.
  const fixed = withDev('awning');
  const retract = withDev('awning_retract');
  ok(retract.winterGainBtu > fixed.winterGainBtu, 'a retractable awning keeps the winter sun a fixed one blocks');
  ok(Math.abs(retract.summerGainBtu - fixed.summerGainBtu) < 1, 'and in summer the two are the same');
  ok(SHADE_DEVICES.deciduous.summer > SHADE_DEVICES.deciduous.winter, 'a deciduous tree shades more in leaf than out of it');
  ok(SHADE_DEVICES.awning.winter > SHADE_DEVICES.awning_retract.winter, 'a fixed awning costs you winter sun; a retractable one does not');
}

// --- 5. the table itself must not lie ----------------------------------------
{
  ok(SOLAR_ON_GLASS.winter.south > SOLAR_ON_GLASS.winter.east * 2, 'in winter a south wall collects far more than an east one');
  ok(SOLAR_ON_GLASS.summer.west > SOLAR_ON_GLASS.summer.south, 'in summer that reverses — the west wall is the hot one');
  ok(SOLAR_ON_GLASS.summer.roof > SOLAR_ON_GLASS.summer.south * 3, 'and a skylight takes the worst of it');
}

// --- 6. mass, and the swing it prevents --------------------------------------
{
  const noMass = base();
  noMass.utilities = { ...noMass.utilities, heatSource: 'minisplit', foundationType: 'rubble' };
  noMass.openings = [win('south', 4), win('south', 12), win('south', 20)];
  const massy = structuredClone(noMass);
  massy.utilities.heatSource = 'masonry';
  massy.utilities.foundationType = 'slab';
  const a = derive(noMass).thermal; const b = derive(massy).thermal;
  ok(b.thermalMassBtuF > a.thermalMassBtuF, 'a slab and a masonry heater are mass; a mini-split on a rubble trench is not');
  ok(b.winterSwingF < a.winterSwingF, 'more mass, less swing on a sunny winter day');
  ok(b.massParts.some((p) => /slab/i.test(p.label)), 'the mass says where it comes from');
  // Bale walls insulate; they are not mass. Same glass, better R, still swings.
  ok(a.winterSwingF > 0, 'sun with nowhere to go moves the temperature');
}

// --- 7. the comparison nobody was making -------------------------------------
{
  const s = base();
  s.utilities = { ...s.utilities, heatSource: 'minisplit' };
  const small = derive(s);
  ok(small.thermal.heatCoverage !== null, 'the heat source is compared against the load at all');
  const expected = HEAT_OUTPUT.minisplit.outputKbtu / small.heatLoadKbtu;
  ok(Math.abs(small.thermal.heatCoverage - expected) < 0.001, 'coverage is output over load, not a vibe');
  const big = structuredClone(s); big.utilities.heatSource = 'wood_stove';
  ok(derive(big).thermal.heatCoverage > small.thermal.heatCoverage, 'a bigger heat source covers more of the same house');
}

// --- 8. ventilation: a way in and a way out ----------------------------------
{
  const oneSide = base();
  oneSide.openings = [win('south', 4), win('south', 12), win('south', 20)];
  const bothSides = structuredClone(oneSide);
  bothSides.openings = [win('south', 4), win('south', 12), win('north', 8), win('north', 16)];
  ok(!derive(oneSide).thermal.crossVents, 'windows all on one wall cannot cross-ventilate');
  ok(derive(bothSides).thermal.crossVents, 'windows on opposite walls can');
  const fixedGlass = structuredClone(bothSides);
  fixedGlass.openings = fixedGlass.openings.map((o) => ({ ...o, type: 'picture' }));
  ok(derive(fixedGlass).thermal.operableGlass === 0, 'a picture window is a hole you cannot open — it counts for gain, never for venting');
  ok(!derive(fixedGlass).thermal.crossVents, 'and a house of picture windows cannot flush itself');
  const fanned = structuredClone(fixedGlass);
  fanned.utilities = { ...fanned.utilities, wholeHouseFan: true };
  ok(derive(fanned).thermal.nightFlushOk, 'a whole-house fan does the job the windows cannot');
}

// --- 9. it must survive a bare spec ------------------------------------------
{
  const empty = base();
  empty.openings = []; empty.elements = [];
  const t = derive(empty).thermal;
  ok(Number.isFinite(t.summerGainBtu) && t.summerGainBtu >= 0, 'a house with no windows gains no sun and does not produce nonsense');
  ok(Number.isFinite(t.thermalMassBtuF), 'mass is a real number even with nothing in the house');
  ok(t.operableGlass === 0 && !t.crossVents, 'and it cannot ventilate, which is the honest answer');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail === 0) console.log('The summer half of the year is held to physics, not to a snapshot.');
process.exit(fail ? 1 : 0);
