// FROM-SCRATCH BUILDABILITY AUDIT
//
// The app is the product; the house is the acceptance test. The bar is NOT
// "the app can display Daniel's design" — that design was seeded and patched
// into shape over months. The bar is: **could someone starting from an empty
// screen build it, using only the UI?**
//
// This walks a real saved design and asks, of every construct actually present
// in it, two questions:
//
//   1. Is there a backend OP that can create or change this thing?
//   2. Does any UI file EMIT that op — or is it reachable only by asking the
//      AI in chat (which is not "building it yourself")?
//
// A construct that fails (1) can only exist because it was authored outside
// the app. A construct that fails (2) exists but is unreachable by hand.
// Both are from-scratch gaps and both print below.
//
//   node tools/from_scratch_audit.mjs                       # audits every saved project
//   node tools/from_scratch_audit.mjs .data/projects/reimagine/project-state.json
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const bimCore = read('backend/bim-core.mjs');
const plannerEnum = read('backend/planner.mjs');
// Every UI surface a person can actually click.
const uiFiles = ['src/main.jsx', 'src/reimagine/App.jsx', 'src/planView.jsx', 'src/threeScene.jsx',
  'src/reimagine/elevationView.jsx', 'src/reimagine/stackView.jsx', 'src/reimagine/interiorWallView.jsx',
  'src/reimagine/siteTable.jsx', 'src/reimagine/shell.jsx'];
const ui = uiFiles.filter((f) => fs.existsSync(path.join(ROOT, f))).map(read).join('\n');

// ---- 1. every op the backend understands ----------------------------------
const opTypes = [...new Set([
  ...bimCore.matchAll(/operation\.type === '([a-z_]+)'/g),
  ...bimCore.matchAll(/op\.type === '([a-z_]+)'/g)
].map((m) => m[1]))].sort();

const emittedInUi = (op) => new RegExp(`type:\\s*'${op}'|"type"\\s*:\\s*"${op}"|'${op}'`).test(ui);
const inPlannerEnum = (op) => plannerEnum.includes(`'${op}'`);

// ---- 2. what a real design is actually MADE of ----------------------------
// Each probe: does this design contain the construct, and which op makes it?
const PROBES = [
  { id: 'rooms', label: 'Rooms', ops: ['add_room'], has: (s) => (s.rooms || []).length > 0 },
  { id: 'room-level', label: 'Rooms on an upper floor', ops: ['add_room'], has: (s) => (s.rooms || []).some((r) => Number(r.level || 1) > 1) },
  { id: 'openings', label: 'Windows & doors', ops: ['add_opening'], has: (s) => (s.openings || []).length > 0 },
  { id: 'opening-types', label: 'The full opening vocabulary (french, slider, clerestory…)', ops: ['add_opening'], has: (s) => new Set((s.openings || []).map((o) => o.type)).size > 2 },
  { id: 'opening-sill', label: 'Per-opening sill height / head height', ops: ['update_object'], field: 'sillFt', has: (s) => (s.openings || []).some((o) => o.sillFt != null || o.heightFt != null) },
  { id: 'roof-openings', label: 'Skylights / roof openings', ops: ['add_opening'], has: (s) => (s.openings || []).some((o) => o.wall === 'roof') },
  { id: 'storeys', label: 'More than one storey', ops: ['set_shell'], has: (s) => Number(s.shell?.storeys || 1) > 1 },
  { id: 'storey-height', label: 'Per-storey heights', ops: ['set_storey_height'], has: (s) => Object.keys(s.shell?.storeyHeights || {}).length > 0 },
  { id: 'upper-plate', label: 'An upper storey smaller than the ground (set-back)', ops: ['edit_level', 'resize_object', 'move_object'], has: (s) => (s.elements || []).some((e) => e.category === 'floor' && Number(e.level || 1) > 1) },
  { id: 'custom-footprint', label: 'A non-rectangular footprint (L/T/U/custom)', ops: ['set_footprint', 'move_wall_edge'], has: (s) => Array.isArray(s.shell?.footprint) && s.shell.footprint.length > 4 },
  { id: 'per-floor-outline', label: 'A DIFFERENT outline per floor (not just a smaller rectangle)', ops: [], has: (s) => (s.elements || []).some((e) => e.category === 'floor' && Array.isArray(e.footprint)) },
  { id: 'wall-side', label: 'Per-wall construction / height / cladding', ops: ['set_wall_side'], has: (s) => Object.keys(s.walls || {}).length > 0 },
  { id: 'wall-segments', label: 'A wall split into segments with their own build', ops: ['resize_wall_segment', 'split_wall_edge'], has: (s) => Object.values(s.walls || {}).some((w) => w && w.segments) },
  { id: 'partitions', label: 'Interior walls with doorways', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'partition') },
  { id: 'stairs', label: 'Stairs (shape, facing, split)', ops: ['set_stair'], has: (s) => (s.elements || []).some((e) => e.category === 'stair' || /stair/i.test(e.name || '')) },
  { id: 'decks', label: 'Decks & patios', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'deck') },
  { id: 'outbuildings', label: 'Outbuildings', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'outbuilding') },
  { id: 'foundation-runs', label: 'Foundation runs / pads placed by hand', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'foundation') },
  { id: 'furnishings', label: 'Fixtures, built-ins, appliances, furniture', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'furnishing') },
  { id: 'frame-per-storey', label: 'A different frame per storey', ops: ['set_frame'], has: (s) => Object.keys(s.frame?.storeyTypes || {}).length > 0 },
  { id: 'frame-members', label: 'Hand-placed / hand-removed frame members', ops: ['set_frame'], has: (s) => (s.frame?.removedMembers || []).length > 0 || (s.elements || []).some((e) => e.category === 'framemember') },
  { id: 'roof-profile', label: 'Roof shape, pitch, and fall direction', ops: ['set_roof_profile'], has: (s) => Boolean(s.shell?.roofType) },
  { id: 'roof-planes', label: 'Extra roof planes (dormers, lean-tos over an outdoor room)', ops: ['add_roof_plane', 'add_element'], has: (s) => (s.roofPlanes || []).length > 0 || (s.elements || []).some((e) => e.roofType) },
  { id: 'sunspace', label: 'A greenhouse / sunspace (glazed south band)', ops: ['set_wall_side'], field: 'sunGlazing', has: (s) => (s.rooms || []).some((r) => r.type === 'plant') },
  { id: 'shade', label: 'Shade you build or plant — awnings, a trellis, a tree', ops: ['add_element'], has: (s) => (s.elements || []).some((e) => e.category === 'shade') },
  { id: 'flooring', label: 'Floor finish + subfloor', ops: ['set_flooring'], has: (s) => Boolean(s.flooring) },
  { id: 'sourcing', label: 'Where each material comes from', ops: ['set_sourcing'], has: (s) => Boolean(s.sourcing) },
  { id: 'utilities', label: 'Heat / water / waste / power', ops: ['set_utility'], has: (s) => Boolean(s.utilities) },
  { id: 'basement', label: 'A basement', ops: ['set_shell'], has: (s) => Number(s.shell?.basementHeightFt || 0) > 0 },
  { id: 'site', label: 'Site — orientation, slope, services', ops: ['set_site'], has: (s) => Boolean(s.site) }
];

function auditSpec(spec, name) {
  const rows = PROBES.filter((p) => { try { return p.has(spec); } catch { return false; } })
    .map((p) => {
      const known = (p.ops || []).filter((o) => opTypes.includes(o));
      if (!known.length) return { ...p, verdict: 'NO-OP' };
      // a generic op (update_object) only counts if the UI passes THIS field
      const reachable = known.some((o) => emittedInUi(o))
        && (!p.field || new RegExp(`['"]${p.field}['"]`).test(ui));
      return { ...p, verdict: reachable ? 'ok' : 'NO-UI', via: known.join(' / ') };
    });
  const gaps = rows.filter((r) => r.verdict !== 'ok');
  console.log(`\n═══ ${name} — ${rows.length} constructs present, ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`);
  for (const g of gaps) {
    console.log(`  ${g.verdict === 'NO-OP' ? '✗ NO OP  ' : '△ NO UI  '} ${g.label}`);
    console.log(`             ${g.verdict === 'NO-OP'
      ? 'nothing in the app can create this — it exists only because it was authored outside the UI'
      : `op '${g.via}' exists but no screen builds this by hand — reachable only by asking the assistant`}`);
  }
  if (!gaps.length) console.log('  every construct in this design is buildable by hand.');
  return gaps;
}

// Ops the backend understands that NO screen can fire — the app can do more
// than it lets you do.
const PLANNER_CONTROL_OPS = ['no_change', 'request_clarification', 'trace_image_request', 'add_opening_from_reference'];
// An op with no button is only a GAP if no other op gives you the same
// capability — 'add_floor' has no button because the Floor bar builds a storey
// out of set_shell + add_element instead, and that is fine.
// add_roof_plane used to be listed here as a lie — it fell through to the same
// handler as set_roof_profile and added no plane at all. It has its own handler
// now and its own button in the Roof chapter, so it is a real op with a real
// screen and belongs in neither list.
const SUPERSEDED_OPS = { add_floor: 'set_shell storeys + add_element', add_level: 'set_shell storeys', add_loft: 'add_element', add_tower: 'add_element', edit_level: 'resize_object', set_reclaimed: 'set_sourcing', set_roof: 'set_roof_profile', set_wall_assembly: 'set_wall_side', set_wall_segment_assembly: 'resize_wall_segment', add_site_element: 'add_element', add_pad_extension: 'add_element' };
const orphanOps = opTypes.filter((op) => !emittedInUi(op) && !PLANNER_CONTROL_OPS.includes(op));

const args = process.argv.slice(2);
const files = args.length ? args : (() => {
  const dir = path.join(ROOT, '.data/projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((d) => path.join('.data/projects', d, 'project-state.json'))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
})();

console.log(`Backend understands ${opTypes.length} ops. ${orphanOps.length} of them no screen can fire.`);
let totalGaps = 0;
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f), 'utf8'));
  const spec = raw.spec || raw.design || raw;
  if (!spec?.shell) continue;
  totalGaps += auditSpec(spec, f).length;
}
if (orphanOps.length) {
  console.log('\n═══ Ops with no button anywhere (chat-only capability)');
  orphanOps.forEach((op) => console.log(`  ${SUPERSEDED_OPS[op] ? '·' : '△'} ${op}${SUPERSEDED_OPS[op] ? `   — fine, the UI does this with ${SUPERSEDED_OPS[op]}` : (inPlannerEnum(op) ? '   ← no button AND nothing supersedes it' : '   ← no button, and NOT in the planner enum: dead code')}`));
}
console.log(`\n${totalGaps} construct-level gap(s) across the audited designs.`);
