// Build the FL0 House v5 starter design — Daniel's drawing set (A-000..A-402)
// expressed through the app's own ops, so the result is engine-valid. Writes
// src/reimagine/starters.js for the My designs shelf.
import { applyBimOperations } from '../backend/bim-core.mjs';
import { seedSpec } from '../src/engine.js';
import { writeFileSync } from 'node:fs';

let spec = structuredClone(seedSpec);
const apply = (operations) => {
  const r = applyBimOperations(spec, { operations });
  if (r.warnings?.length) console.log('  warn:', r.warnings.join(' | '));
  spec = r.spec || r;
};

// ---- shell: 24 x 28, shed roof high-south 17 / low-north 10 (A-201/A-301)
apply([
  { type: 'set_shell', field: 'widthFt', value: '24' },
  { type: 'set_shell', field: 'depthFt', value: '28' },
  { type: 'set_shell', field: 'wallHeightFt', value: '10' },
  { type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: 17, northWallHeightFt: 10 }
]);
// overhangs: keep the generous solar eave south, gutter north (A-104)
apply([{ type: 'set_overhang', wall: 'south', value: 2.5 }, { type: 'set_overhang', wall: 'north', value: 1.5 }]);
// FPSF slab + timber frame + straw bale walls (A-102, elevations, notes)
apply([
  { type: 'set_utility', field: 'foundationType', value: 'slab' },
  { type: 'set_frame', value: 'timber' }
]);

// ---- ground rooms per A-101 (24 x 28; y=0 is NORTH)
spec.rooms = [];
const addRoom = (id, name, type, x, y, w, d) => { spec.rooms.push({ id, name, type, x, y, w, d, level: 1 }); };
addRoom('mud', 'Mud / Laundry', 'service', 0, 0, 6, 8);
addRoom('bath', 'Bath', 'wet', 6, 0, 6, 8);
addRoom('bed1', 'Bedroom 1', 'sleeping', 12, 0, 12, 10);
addRoom('hall', 'Hall / Storage', 'storage', 0, 8, 12, 4);
addRoom('bed2', 'Bedroom 2', 'sleeping', 0, 12, 9, 9);
addRoom('passage', 'Open Passage', 'living', 9, 12, 5, 9);
addRoom('pantry', 'Pantry / Storage', 'storage', 14, 10, 10, 8);
addRoom('kitchen', 'Kitchen', 'service', 14, 18, 10, 10);
addRoom('great', 'Great Room', 'living', 0, 21, 14, 7);
// tower studio (level 2) over the east kitchen/pantry bay
apply([{ type: 'set_shell', field: 'storeys', value: '2' }]);
spec.rooms.push({ id: 'tower-studio', name: 'Tower Studio', type: 'living', x: 14, y: 10, w: 10, d: 8, level: 2 });
// its extent plate = the tower footprint; tower storey ~9.8 ft to hit 19.8/21
spec.elements = (spec.elements || []).filter((e) => e.category !== 'floor');
spec.elements.push({ id: 'storey-2-extent', name: 'Tower extent', category: 'floor', level: 2, x: 14, y: 10, w: 10, d: 8, h: 0.4, z: 10 });
// The app measures a tower storey from the sloping main roof at the tower's
// spot (~12.5-14.5 ft there), not from the flat tower floor — 7 ft lands the
// tower roof at ~19.5-21.5, matching the drawn EL 19'-9" / 21'-0".
apply([{ type: 'set_storey_height', level: 2, value: 7 }]);

// greenhouse band along the south, OUTSIDE the envelope (A-101/A-301)
spec.rooms.push({ id: 'greenhouse', name: 'Greenhouse (isolated sunspace)', type: 'plant', x: 0, y: 28, w: 18, d: 8, level: 1 });

// stairs rise from the open passage (A-101 stair/tower)
apply([{ type: 'add_element', name: 'Stairs', category: 'structure', x: 10, y: 12.5, w: 3.5, d: 8, h: 8, level: 1 }]);
// compact stove/mass at the kitchen-great-room hinge
apply([{ type: 'add_element', name: 'Compact stove / mass', category: 'thermal', x: 12.5, y: 19, w: 2, d: 2, h: 5, level: 1 }]);
// covered outdoor kitchen / work edge east (pad; its roof is future work)
apply([{ type: 'add_element', name: 'Covered outdoor kitchen (pad)', category: 'foundation', construction: 'slabpad', x: 24, y: 10, w: 8, d: 18, h: 0.6 }]);

// ---- openings (A-201): greenhouse-front french doors, punched north, egress west
spec.openings = [];
apply([
  { type: 'add_opening', wall: 'south', openingType: 'french', x: 4 },
  { type: 'add_opening', wall: 'south', openingType: 'french', x: 16 },
  { type: 'add_opening', wall: 'north', openingType: 'window', x: 4 },
  { type: 'add_opening', wall: 'north', openingType: 'window', x: 16 },
  { type: 'add_opening', wall: 'west', openingType: 'window', y: 15 },
  { type: 'add_opening', wall: 'east', openingType: 'door', y: 20 }
]);

apply([{ type: 'set_shell', field: 'projectName', value: 'FL0 House v5 — starter' }]);

// sanity: derived numbers exist, no NaN
const json = JSON.stringify(spec);
if (json.includes('NaN')) throw new Error('NaN in starter spec');
console.log('rooms:', spec.rooms.length, 'elements:', spec.elements.length, 'openings:', spec.openings.length);
console.log('shell:', spec.shell.widthFt, 'x', spec.shell.depthFt, 'shed', spec.shell.southWallHeightFt, '/', spec.shell.northWallHeightFt, 'storeys', spec.shell.storeys);

const file = `// Bundled starter designs — real houses expressed in the app's own spec,
// built by tools/build_fl0_starter.mjs from Daniel's FL0 v5 drawing set.
// Regenerate with: node tools/build_fl0_starter.mjs
export const STARTER_DESIGNS = [
  {
    id: 'starter-fl0-v5',
    name: 'FL0 House v5 — from the drawings',
    blurb: '24×28 straw bale, high-south shed 17′→10′, tower studio over the east bay, greenhouse band south',
    spec: ${JSON.stringify(spec)}
  }
];
`;
writeFileSync(new URL('../src/reimagine/starters.js', import.meta.url), file);
console.log('wrote src/reimagine/starters.js');
