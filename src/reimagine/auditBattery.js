// The LIVE SEAM AUDIT BATTERY — canned designs the 3D seam audit must pass.
// Run it from the browser console on the reimagine app:
//
//   await window.__nbSeamAuditBattery()
//
// It renders each design in the real 3D view, runs window.__nbSeamAudit on the
// real meshes, restores whatever you were working on, and returns one row per
// design: { name, problems } — every `problems` list must be empty.
//
// The point of this file is the LEGACY shapes: designs saved under older
// storey-stacking rules (before update 101 the ground storey height was the
// LOWEST wall; per-side wall heights carried the shed shape; floor plates
// stored z values from that model). Update 103's fixes — posts/plates bear on
// the eave line at their own span position, porch-tier posts ring the enclosed
// core, the standing-law vertex cap covers the frame, and floor-plate z heals
// at every load door — must keep ALL of these tight, forever.

// Daniel's real saved design (revision 435, condensed): 36×28 shed 17'→10',
// three storeys, SET-BACK plates, legacy upperStoreyHeightFt + storeyHeights,
// storey-3 plate z stored under the OLD stacking (10' ground + 8' upper = 18).
const LEGACY_SETBACK_SHED = {
  projectName: 'battery: legacy set-back shed (rev-435 shape)',
  revision: 1,
  shell: {
    widthFt: 36, depthFt: 28, wallHeightFt: 17, roofPitch: 0.194, roofType: 'shed',
    southWallHeightFt: 17, northWallHeightFt: 10, padExtensionFt: 64,
    overhangs: { south: 7, west: 2.5, east: 6, north: 3.5 },
    storeys: 3, upperStoreyHeightFt: 8, storeyHeights: { 2: 10, 3: 10 }
  },
  walls: { north: { assembly: 'straw-bale', heightFt: 17 }, south: { assembly: 'straw-bale' }, east: { assembly: 'straw-bale' }, west: { assembly: 'straw-bale' } },
  site: { latitudeDeg: 43, climate: 'mixed humid', north: 'top', wind: 'west', solar: 'south' },
  elements: [
    { id: 'storey-2-extent', name: 'Storey 2 extent', category: 'floor', level: 2, x: 23, y: 0, z: 17, w: 13, d: 28, h: 0.4 },
    { id: 'storey-3-extent', name: 'Storey 3 extent', category: 'floor', level: 3, x: 17, y: 6, z: 18, w: 18, d: 18, h: 0.4 }
  ],
  rooms: [
    { id: 'great', name: 'Great Room', x: 0, y: 12.5, w: 17.5, d: 12, type: 'living', level: 1 },
    { id: 'bedroom-2', name: 'Bedroom 2', x: 23, y: 0.5, w: 12, d: 12, type: 'sleeping', level: 2 },
    { id: 'office', name: 'Office', x: 17, y: 6, w: 18, d: 18, type: 'work', level: 3 }
  ],
  openings: [
    { type: 'door', wall: 'south', x: 17.7, widthFt: 3, label: 'Main Entry' },
    { type: 'window', wall: 'north', x: 17.7, widthFt: 5, label: 'Bedroom Egress' },
    { type: 'window', wall: 'west', y: 13, widthFt: 6, label: 'Great Room View' }
  ],
  systems: { structure: '', envelope: '', water: '', energy: '' },
  notes: '', levels: [],
  utilities: { foundationType: 'rubble', stemwallHeightFt: 1.5 },
  frame: { type: 'timber', storeyTypes: {} }
};

// The live failing shape from update 102's audit report: 96-ft-wide 3-storey
// shed carried through the update 100–102 schema changes, whose storey-2 ring
// is an OPEN PORCH deck. Before update 103 its tier posts stood at the open
// deck's edge and rose ~4 ft over the roof plan (there is no roof there).
const LEGACY_PORCH_TIER_96 = {
  projectName: 'battery: legacy 96-ft porch tier',
  revision: 1,
  shell: {
    widthFt: 96, depthFt: 28, wallHeightFt: 10, roofPitch: 0.32, roofType: 'shed',
    southWallHeightFt: 10, northWallHeightFt: 16, storeys: '3', padExtensionFt: 40
  },
  walls: {},
  site: { climate: 'mixed humid', north: 'top', wind: 'west', solar: 'south' },
  utilities: { foundationType: 'rubble' },
  elements: [
    { id: 'fl2', name: 'Storey 2 extent', category: 'floor', level: 2, x: 8, y: 4, w: 40, d: 20, z: 10, h: 0.4, topTreatment: 'porch' },
    { id: 'fl3', name: 'Storey 3 extent', category: 'floor', level: 3, x: 16, y: 8, w: 20, d: 12, z: 20, h: 0.4 }
  ],
  rooms: [], openings: [],
  systems: { structure: '', envelope: '', water: '', energy: '' },
  notes: '', levels: [],
  frame: { type: 'post-beam' }
};

// A fresh full-footprint 3-storey shed — the plain shape whose ground plate
// beams rode over the sloping roof plane at the high wall before update 103
// (posts bear on the EAVE at their own span position now).
const FRESH_TALL_SHED = {
  projectName: 'battery: fresh 17/10 shed, 3 storeys',
  revision: 1,
  shell: {
    widthFt: 36, depthFt: 28, wallHeightFt: 17, roofType: 'shed',
    southWallHeightFt: 17, northWallHeightFt: 10, storeys: 3
  },
  walls: {},
  site: { climate: 'mixed humid', north: 'top' },
  utilities: { foundationType: 'slab' },
  elements: [],
  rooms: [{ id: 'great', name: 'Great Room', x: 0, y: 0, w: 20, d: 20, type: 'living', level: 1 }],
  openings: [],
  systems: { structure: '', envelope: '', water: '', energy: '' },
  notes: '', levels: [],
  frame: { type: 'timber', storeyTypes: {} }
};

// A wide gable with a stale per-side height left over from an earlier shed
// life — the per-side fields must shape nothing but the roofline.
const LEGACY_SIDES_GABLE_96 = {
  projectName: 'battery: 96-ft gable with legacy side heights',
  revision: 1,
  shell: {
    widthFt: 96, depthFt: 28, wallHeightFt: 10, roofPitch: 0.32, roofType: 'gable',
    southWallHeightFt: 6, northWallHeightFt: 10, eastWallHeightFt: 10, westWallHeightFt: 10, storeys: 3
  },
  walls: {},
  site: { climate: 'mixed humid', north: 'top' },
  utilities: { foundationType: 'slab' },
  elements: [
    { id: 'storey-2-extent', name: 'Floor 2', category: 'floor', level: 2, x: 0, y: 0, w: 96, d: 28, h: 0.4, z: 10 },
    { id: 'storey-3-extent', name: 'Floor 3', category: 'floor', level: 3, x: 0, y: 0, w: 96, d: 28, h: 0.4, z: 20 }
  ],
  rooms: [{ id: 'great', name: 'Great Room', x: 0, y: 0, w: 20, d: 20, type: 'living', level: 1 }],
  openings: [
    { type: 'window', wall: 'south', x: 4, widthFt: 3, label: 'S1', level: 1 },
    { type: 'window', wall: 'north', x: 8, widthFt: 3, label: 'N1', level: 2 },
    { type: 'door', wall: 'east', y: 4, widthFt: 3, label: 'E1', level: 1 }
  ],
  systems: { structure: '', envelope: '', water: '', energy: '' },
  notes: '', levels: [],
  frame: { type: 'timber', storeyTypes: {} }
};

// The rev-435 shape WITH the ☀ greenhouse: south 2-ft kneewall + slanted sun
// glazing on a 17/10 stepped shed. Two real bugs live here: the ☀ preset once
// synced the kneewall into the shell (flipping the roof and zeroing the glass
// gap — "where did my greenhouse go?"), and the band once rose full-length to
// one eave height, floating dark fins through the low west wing roof. The
// audit must stay 0 AND the glazing must actually render (expect below) —
// an invisible greenhouse is a failure even when nothing pierces.
const GREENHOUSE_SETBACK_SHED = {
  ...structuredClone(LEGACY_SETBACK_SHED),
  projectName: 'battery: rev-435 + south greenhouse',
  walls: {
    north: { assembly: 'straw-bale' },
    south: { assembly: 'straw-bale', heightFt: 2, sunGlazing: true, sunGlazingTiltDeg: 30 },
    east: { assembly: 'straw-bale' },
    west: { assembly: 'straw-bale' }
  }
};

// The rev-435 shape with PER-STOREY roof choices (update 109): the ring over
// storey 2 wears its own GABLE ridge, the tower cap is a SHED falling west
// with its own overhang. Every piece must stay under the one-roof law —
// walls, frame, and glazing all judged against the overridden plan.
const PER_STOREY_ROOFS = (() => {
  const d = structuredClone(LEGACY_SETBACK_SHED);
  d.projectName = 'battery: rev-435 + per-storey roofs';
  d.elements = d.elements.map((el) => {
    if (el.id === 'storey-2-extent') return { ...el, roofShape: 'gable', roofPitch: 0.25 };
    if (el.id === 'storey-3-extent') return { ...el, roofShape: 'shed', roofFall: 'west', roofOverhangFt: 3 };
    return el;
  });
  return d;
})();

// Daniel's rev-681 shape: windows on a glazed kneewall, oversized openings,
// clerestories on a level whose plate doesn't reach them (his screenshot's
// floating-window stack). The band law must pull every one of these into a
// real wall — the audit's 'opening-floating' check holds them there forever.
const KNEEWALL_OPENINGS = (() => {
  const d = structuredClone(LEGACY_SETBACK_SHED);
  d.projectName = 'battery: glazed kneewall + oversized openings';
  d.walls = {
    north: { assembly: 'straw-bale' },
    south: { assembly: 'straw-bale', heightFt: 2, sunGlazing: true, sunGlazingTiltDeg: 30 },
    east: { assembly: 'straw-bale' },
    west: { assembly: 'straw-bale' }
  };
  d.openings = [
    // on the glazed kneewall — live in the glass band, sill above the knee
    { type: 'picture', wall: 'south', x: 1, widthFt: 6, label: 'Kneewall picture', level: 1 },
    { type: 'french', wall: 'south', x: 9, widthFt: 7, label: 'Kneewall french', level: 1 },
    // level-2 clerestory OUTSIDE the storey-2 plate (plate x14-27 on rev-435
    // shape... x2 is past it) — must DROP to the ground wall, never float
    { type: 'clerestory', wall: 'south', x: 2.5, widthFt: 6, label: 'Orphan clerestory', level: 2, sillFt: 3.5 },
    // a sill dragged absurdly high on a normal wall — pulled down to fit
    { type: 'window', wall: 'north', x: 6, widthFt: 5, label: 'Sky-high sill', level: 1, sillFt: 14 },
    // an eyebrow window (hood + brackets ride the clamp too)
    { type: 'window', wall: 'east', y: 6, widthFt: 5, label: 'Shaded window', level: 1, shadeFt: 2 },
    // a legit clerestory under the tower's own wall band — untouched
    { type: 'clerestory', wall: 'south', x: 20, widthFt: 5, label: 'True clerestory', level: 2, sillFt: 3 }
  ];
  return d;
})();

// Every battery design. The seed and the bundled starters join at run time
// (they live in their own modules); each entry here is a shape the audit has
// actually caught a real bug on, or the fresh control for one. `expect`
// lists mesh tags that MUST be present in the rendered scene — absence is a
// failure (that's how a silently-culled greenhouse gets caught).
export const AUDIT_BATTERY_SPECS = [
  { name: 'legacy set-back shed (rev-435 shape)', spec: LEGACY_SETBACK_SHED },
  { name: 'legacy 96-ft porch tier', spec: LEGACY_PORCH_TIER_96 },
  { name: 'fresh 17/10 shed, 3 storeys', spec: FRESH_TALL_SHED },
  { name: '96-ft gable with legacy side heights', spec: LEGACY_SIDES_GABLE_96 },
  { name: 'rev-435 + south greenhouse', spec: GREENHOUSE_SETBACK_SHED, expect: ['sunGlazingBand'] },
  { name: 'rev-435 + per-storey roofs', spec: PER_STOREY_ROOFS },
  { name: 'glazed kneewall + oversized openings', spec: KNEEWALL_OPENINGS, expect: ['sunGlazingBand'] }
];
