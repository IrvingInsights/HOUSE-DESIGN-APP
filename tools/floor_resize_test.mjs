// Verifies the reimagine per-floor resize survives normalizeRooms: resizing an
// upper storey's extent plate SMALLER than its rooms must stick (the rooms get
// pulled in to fit), instead of snapping back out to cover them.
import { applyBimOperations } from '../backend/bim-core.mjs';

function freshSpec() {
  return {
    projectName: 'FloorResize', revision: 1,
    shell: { widthFt: 36, depthFt: 28, wallHeightFt: 10, southWallHeightFt: 10, northWallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, storeys: 1 },
    systems: { envelope: 'straw bale walls with lime plaster', structure: 'timber', water: 'well', energy: 'off-grid solar' },
    rooms: [{ id: 'great-room', name: 'Great Room', x: 2, y: 2, w: 16, d: 14, h: 0.22, level: 1, type: 'living' }],
    elements: [], openings: [], levels: [], walls: {}, notes: ''
  };
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok ', msg); } else { fail++; console.log('  FAIL', msg); } };
const plateOf = (spec, level) => (spec.elements || []).find((e) => e.category === 'floor' && Number(e.level || 1) === level);
const apply = (spec, ops) => applyBimOperations(spec, { operations: ops }).spec;

// Build a 2-storey design with a full-footprint level-2 plate + a room on it.
let spec = freshSpec();
spec = apply(spec, [{ type: 'set_shell', field: 'storeys', value: '2' }]);
spec = apply(spec, [{ type: 'add_element', name: 'Storey 2 extent', category: 'floor', x: 0, y: 0, z: 10, w: spec.shell.widthFt, d: spec.shell.depthFt, h: 0.4, level: 2 }]);
spec = apply(spec, [{ type: 'add_room', name: 'Loft', category: 'sleeping', w: 18, d: 16, x: 1, y: 1, level: 2 }]);
const plate0 = plateOf(spec, 2);
ok(plate0 && plate0.w >= 30, `starting plate is full-ish (${plate0?.w}x${plate0?.d})`);

// --- WITHOUT the room-clamp: resize plate to 14x12 → normalizeRooms snaps it back to cover the 18x16 room.
const naive = apply(spec, [{ type: 'resize_object', targetId: plateOf(spec, 2).id, name: 'Storey 2 extent', w: 14, d: 12, h: 0.4 }]);
const naivePlate = plateOf(naive, 2);
ok(naivePlate.w > 14.5 || naivePlate.d > 12.5, `naive resize snaps back to cover the room (got ${naivePlate.w}x${naivePlate.d}) — proves the bug is real`);

// --- WITH the room-clamp (what resizeFloor emits): resize plate AND pull the room in to fit → sticks at 14x12.
const W = 14, D = 12, px = 0, py = 0;
const room = (spec.rooms || []).find((r) => Number(r.level || 1) === 2);
const nw = Math.min(room.w, W), nd = Math.min(room.d, D);
const nx = Math.max(px, Math.min(room.x, px + W - nw));
const ny = Math.max(py, Math.min(room.y, py + D - nd));
const fixed = apply(spec, [
  { type: 'resize_object', targetId: plateOf(spec, 2).id, name: 'Storey 2 extent', w: W, d: D, h: 0.4 },
  { type: 'resize_object', targetId: room.id, name: room.name, w: nw, d: nd, h: 0.22 },
  { type: 'move_object', targetId: room.id, name: room.name, x: nx, y: ny }
]);
const fixedPlate = plateOf(fixed, 2);
ok(Math.abs(fixedPlate.w - W) < 0.6 && Math.abs(fixedPlate.d - D) < 0.6, `clamped resize STICKS at ${W}x${D} (got ${fixedPlate.w}x${fixedPlate.d})`);
const fixedRoom = (fixed.rooms || []).find((r) => Number(r.level || 1) === 2);
ok(fixedRoom.x + fixedRoom.w <= W + 0.1 && fixedRoom.y + fixedRoom.d <= D + 0.1, `room now fits inside the smaller floor (${fixedRoom.w}x${fixedRoom.d} at ${fixedRoom.x},${fixedRoom.y})`);

// --- upper storey height via set_shell upperStoreyHeightFt.
const tall = apply(spec, [{ type: 'set_shell', field: 'upperStoreyHeightFt', value: '9' }]);
ok(Number(tall.shell.upperStoreyHeightFt) === 9, `upper storey height set to 9 (got ${tall.shell.upperStoreyHeightFt})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
