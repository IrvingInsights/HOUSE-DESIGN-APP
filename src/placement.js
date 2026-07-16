// The LAW OF PLACEMENT — one pure module deciding what happens when a room,
// element, or floor plate is moved or resized to any target, for ANY design.
// The reimagine UI calls these planners and applies the ops they return;
// tools/placement_test.mjs batters the same planners with generated designs,
// so what the tests prove is exactly what the app does.
//
// The contract, in plain terms:
//   • A drop is HONORED at its coordinates — or the house GROWS so it can be
//     honored (east/south widen in place; west/north walk the wall out by
//     shifting the origin) — or a SHAPED outline lawfully trims/settles it
//     (round: center stays inside the curve; polygon: rooms sit inside the
//     real walls). Anything else is a bug.
//   • When the house grows west/north, every placed thing keeps its WORLD
//     position: the wall moves, nothing else appears to.
//   • Outdoor spaces and free elements roam without shell rules.
import { clamp } from '../backend/bim-core.mjs';

// Types whose spaces legitimately live outside the walls (mirror of
// bim-core's OUTDOOR_SPACE_TYPES — keep in sync).
export const OUTDOOR_TYPES = new Set(['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant', 'water', 'earthwork']);

export const SHELL_W_MAX = 96;
export const SHELL_D_MAX = 80;

// Grow the house toward the WEST/NORTH so a target past those walls ends up
// enclosed. The shell is origin-pinned, so the trick is: widen the shell AND
// shift every placed thing (rooms, elements — including foundation runs and
// pads — and openings) east/south by the growth; in world terms the west/
// north wall moves out and everything else stays where it was. Plain
// rectangles only — a stored polygon or round outline rescales under
// set_shell instead of extending, which would warp the plan.
export function westNorthGrowth(spec, targetX, targetY) {
  if (spec.shell.footprint) return null;
  const W = Number(spec.shell.widthFt) || 36;
  const D = Number(spec.shell.depthFt) || 28;
  let dx = targetX < -0.01 ? Math.ceil(-targetX) : 0;
  let dy = targetY < -0.01 ? Math.ceil(-targetY) : 0;
  dx = clamp(dx, 0, Math.max(0, SHELL_W_MAX - W));
  dy = clamp(dy, 0, Math.max(0, SHELL_D_MAX - D));
  if (!dx && !dy) return null;
  const ops = [];
  if (dx) ops.push({ type: 'set_shell', field: 'widthFt', value: String(W + dx) });
  if (dy) ops.push({ type: 'set_shell', field: 'depthFt', value: String(D + dy) });
  (spec.rooms || []).forEach((r) => ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: (Number(r.x) || 0) + dx, y: (Number(r.y) || 0) + dy }));
  (spec.elements || []).forEach((e) => ops.push({ type: 'move_object', targetId: e.id, name: e.name, x: (Number(e.x) || 0) + dx, y: (Number(e.y) || 0) + dy }));
  (spec.openings || []).forEach((op, i) => {
    if (op.wall === 'roof') {
      if (dx) ops.push({ type: 'update_object', targetId: `opening-${i}`, field: 'x', value: (Number(op.x) || 0) + dx });
      if (dy) ops.push({ type: 'update_object', targetId: `opening-${i}`, field: 'y', value: (Number(op.y) || 0) + dy });
    } else if ((op.wall === 'north' || op.wall === 'south') && dx) {
      ops.push({ type: 'update_object', targetId: `opening-${i}`, field: 'x', value: (Number(op.x) || 0) + dx });
    } else if ((op.wall === 'east' || op.wall === 'west') && dy) {
      ops.push({ type: 'update_object', targetId: `opening-${i}`, field: 'y', value: (Number(op.y) || 0) + dy });
    }
  });
  return { ops, dx, dy };
}

const findObj = (spec, id) => (spec.rooms || []).find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);

// Plan a MOVE of any object to (x, y). Returns { ops, fx, fy, grow } — fx/fy
// are the target in post-growth coordinates (what "honored" means), grow is
// the west/north growth taken (or null). Null when the id is unknown.
export function planObjectMove(spec, id, x, y) {
  const o = findObj(spec, id);
  if (!o) return null;
  // A storey's extent plate carries its rooms along by the same delta, so the
  // whole floor shifts as one (and the covers-rooms rule doesn't snap the
  // plate back to where the rooms were left behind).
  if (o.category === 'floor' && Number(o.level || 1) >= 2) {
    const dx = Number(x) - (Number(o.x) || 0);
    const dy = Number(y) - (Number(o.y) || 0);
    const ops = [{ type: 'move_object', targetId: id, name: o.name, x, y }];
    (spec.rooms || []).filter((r) => Number(r.level || 1) === Number(o.level || 1)).forEach((r) => {
      ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: (Number(r.x) || 0) + dx, y: (Number(r.y) || 0) + dy });
    });
    return { ops, fx: Number(x), fy: Number(y), grow: null };
  }
  const isRoom = (spec.rooms || []).some((r) => r.id === id);
  const indoor = isRoom && !OUTDOOR_TYPES.has(o.type);
  const grow = indoor ? westNorthGrowth(spec, Number(x), Number(y)) : null;
  const fx = Number(x) + (grow ? grow.dx : 0);
  const fy = Number(y) + (grow ? grow.dy : 0);
  const ops = [...(grow ? grow.ops : []), { type: 'move_object', targetId: id, name: o.name, x: fx, y: fy }];
  if (indoor) {
    const shellW = Number(spec.shell.widthFt) + (grow ? grow.dx : 0);
    const shellD = Number(spec.shell.depthFt) + (grow ? grow.dy : 0);
    const needW = Math.ceil(fx + (Number(o.w) || 0));
    const needD = Math.ceil(fy + (Number(o.d) || 0));
    if (needW > shellW) ops.unshift({ type: 'set_shell', field: 'widthFt', value: String(clamp(needW, 12, SHELL_W_MAX)) });
    if (needD > shellD) ops.unshift({ type: 'set_shell', field: 'depthFt', value: String(clamp(needD, 12, SHELL_D_MAX)) });
  }
  return { ops, fx, fy, grow };
}

// Plan a RESIZE (with reposition) of any object. Same contract as
// planObjectMove; rx/ry are the post-growth position of the resized rect.
export function planObjectResize(spec, id, x, y, w, d) {
  const o = findObj(spec, id);
  if (!o) return null;
  // Dragging an upper storey's extent plate smaller: pull its rooms in to fit
  // so the plate keeps the size dragged instead of snapping back out to cover
  // them (same rule as the numeric resizeFloor).
  if (o.category === 'floor' && Number(o.level || 1) >= 2) {
    const ops = [
      { type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.4 },
      { type: 'move_object', targetId: id, name: o.name, x, y }
    ];
    (spec.rooms || []).filter((r) => Number(r.level || 1) === Number(o.level || 1)).forEach((r) => {
      const nw = Math.min(Number(r.w), w);
      const nd = Math.min(Number(r.d), d);
      const nx = clamp(Number(r.x), x, x + w - nw);
      const ny = clamp(Number(r.y), y, y + d - nd);
      if (nw !== Number(r.w) || nd !== Number(r.d)) ops.push({ type: 'resize_object', targetId: r.id, name: r.name, w: nw, d: nd, h: Number(r.h) || 0.22 });
      if (nx !== Number(r.x) || ny !== Number(r.y)) ops.push({ type: 'move_object', targetId: r.id, name: r.name, x: nx, y: ny });
    });
    return { ops, rx: Number(x), ry: Number(y), grow: null };
  }
  // Resizing an INDOOR room past the walls grows the house to fit instead of
  // snapping the room back to the footprint — stretching a room enlarges the
  // building, the same as adding one does. West/north stretch walks the wall
  // out (shift-the-origin), east/south widen in place.
  const isRoom = (spec.rooms || []).some((r) => r.id === id);
  const indoor = isRoom && !OUTDOOR_TYPES.has(o.type);
  const grow = indoor ? westNorthGrowth(spec, Number(x), Number(y)) : null;
  const rx = Number(x) + (grow ? grow.dx : 0);
  const ry = Number(y) + (grow ? grow.dy : 0);
  const ops = [
    ...(grow ? grow.ops : []),
    { type: 'resize_object', targetId: id, name: o.name, w, d, h: Number(o.h) || 0.22 },
    { type: 'move_object', targetId: id, name: o.name, x: rx, y: ry }
  ];
  if (indoor) {
    const shellW = Number(spec.shell.widthFt) + (grow ? grow.dx : 0);
    const shellD = Number(spec.shell.depthFt) + (grow ? grow.dy : 0);
    const needW = Math.ceil(rx + Number(w));
    const needD = Math.ceil(ry + Number(d));
    if (needW > shellW) ops.unshift({ type: 'set_shell', field: 'widthFt', value: String(clamp(needW, 12, SHELL_W_MAX)) });
    if (needD > shellD) ops.unshift({ type: 'set_shell', field: 'depthFt', value: String(clamp(needD, 12, SHELL_D_MAX)) });
  }
  return { ops, rx, ry, grow };
}
