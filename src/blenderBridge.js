// --- Blender / Natural Building GC Dashboard bridge -------------------------
// Translates this app's spec (shell/rooms/openings/elements) into the
// Dashboard state schema and pushes it to the Blender add-on server
// (http://localhost:8000), which procedurally rebuilds the model and can
// write a validated IFC4 file. The Dashboard, Blender scene, and IFC exports
// all stay in sync with what is designed here.
//
// Coordinate note: this app uses house-local coords (0..width east, 0..depth
// north, origin at SW corner). The Dashboard uses site coords centered on the
// house (x east, y north). Translate by centering.

const BLENDER_URL = 'http://localhost:8000';

export function specToDashboardState(spec) {
  const shell = spec.shell || {};
  const widthFt = Number(shell.widthFt) || 36;   // plan X (east-west) -> Dashboard "length"
  const depthFt = Number(shell.depthFt) || 28;   // plan Y (north-south) -> Dashboard "width"
  const hN = Number(shell.northWallHeightFt || shell.wallHeightFt) || 10;
  const hS = Number(shell.southWallHeightFt || shell.wallHeightFt) || 10;

  const roofMap = { gable: 'gable', shed: 'shed', flat: 'living', living: 'living', hip: 'hip', gambrel: 'gambrel' };
  const roofType = roofMap[String(shell.roofType || 'gable').toLowerCase()] || 'gable';

  const cx = widthFt / 2;
  const cy = depthFt / 2;

  // Openings: Dashboard cuts custom openings into north/east/west walls.
  // (Its south wall is the passive-solar greenhouse assembly.)
  const customOpenings = (spec.openings || [])
    .filter((o) => ['north', 'east', 'west'].includes(o.wall))
    .map((o, i) => ({
      id: Date.now() + i,
      wall: o.wall,
      type: o.type === 'door' ? 'door' : 'window',
      w: Number(o.widthFt) || 3,
      h: o.type === 'door' ? 7 : 4,
      sill: o.type === 'door' ? 0 : 3,
      // Dashboard offset = distance along the wall from its west/south end.
      offset: o.wall === 'north' ? (Number(o.x) || 0) : (Number(o.y) || 0),
    }));

  // Rooms: Dashboard partition rooms are name + footprint.
  const rooms = (spec.rooms || []).map((r) => ({
    id: r.id || r.name,
    name: r.name,
    w: Number(r.w) || 8,
    l: Number(r.d) || 8,
  }));

  // Site elements: center-relative placement, mirroring this app's plan.
  const naturalElements = (spec.elements || []).map((el, i) => ({
    id: el.id || Date.now() + i,
    name: el.name,
    kind: el.kind || 'structure',
    w: Number(el.w) || 10,
    d: Number(el.d) || 8,
    x: (Number(el.x) || 0) + (Number(el.w) || 10) / 2 - cx,
    y: cy - ((Number(el.y) || 0) + (Number(el.d) || 8) / 2),
  }));

  return {
    length: widthFt,
    width: depthFt,
    heightNorth: hN,
    heightSouth: hS,
    roofType,
    showRafters: true,
    hasGreenhouse: false, // this app's specs are conventional envelopes by default
    customOpenings,
    rooms,
    naturalElements,
  };
}

export async function pushToBlender(spec) {
  const state = specToDashboardState(spec);
  const res = await fetch(`${BLENDER_URL}/api/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`Blender backend replied ${res.status}`);
  return res.json();
}

export async function exportIfcViaBlender(spec) {
  // Push first so the exported IFC matches the current design, give the
  // Blender main-thread queue a moment to rebuild, then export.
  await pushToBlender(spec);
  await new Promise((r) => setTimeout(r, 4000));
  const res = await fetch(`${BLENDER_URL}/api/export-ifc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return res.json();
}

export async function blenderStatus() {
  try {
    const res = await fetch(`${BLENDER_URL}/api/ai-status`);
    return res.ok;
  } catch {
    return false;
  }
}
