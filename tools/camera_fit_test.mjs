// THE HOUSE IS ALWAYS IN FRONT OF THE CAMERA.
//
// The 3D view opens by working out how far back to stand from the house's own
// size. Twice now that sum has put the camera somewhere useless, and both
// times the symptom was the same to look at: a blank pane that reads as a
// broken app.
//
//   update 220 — a hardcoded position, fine for one shell, grazing the roof
//                deck from inches away on any other.
//   update 244 — a pane measured before the layout had given it a width. The
//                aspect came out as 0, the guard turned that into 0.01, and
//                dividing by the sine of an almost-zero field of view put the
//                camera EIGHT THOUSAND FEET out, past its own 2,000 ft far
//                plane. Every mesh was drawn behind the horizon: pure white.
//
// So the fit is held to three things, for any house and any pane:
//   1. the whole building fits in the frame,
//   2. the camera is never so far that the far plane hides it,
//   3. an unmeasured pane never sets the camera at all.
//
// Run: node tools/camera_fit_test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/threeScene.jsx', import.meta.url), 'utf8');

// The function under test is inside a .jsx module full of three.js imports, so
// it is lifted out by source and run on its own with a tiny Vector3 stand-in —
// the arithmetic is what matters, and this keeps the battery dependency-free.
const open = src.indexOf('function defaultCameraFraming(');
const close = src.indexOf('\n}', open) + 2;
if (open < 0) {
  console.log('FAIL  defaultCameraFraming not found — if it was renamed, carry this battery with it.');
  process.exit(1);
}
const body = src.slice(open, close);

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
}
const THREE = { Vector3: V3 };
const storeyInfo = (shell) => {
  const storeys = Math.max(1, Math.round(Number(shell.storeys) || 1));
  const base = Number(shell.wallHeightFt) || 10;
  return { storeys, baseWallFt: base, extraFt: (storeys - 1) * 9 };
};
const roofProfile = (shell) => ({ pitch: Number(shell.roofPitch) || 0.3, highWallHeightFt: Number(shell.wallHeightFt) || 10 });
// eslint-disable-next-line no-new-func
const defaultCameraFraming = new Function('THREE', 'storeyInfo', 'roofProfile',
  `${body}; return defaultCameraFraming;`)(THREE, storeyInfo, roofProfile);

const FAR_PLANE = 2000; // camera.far in threeScene.jsx
let pass = 0; let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

const HOUSES = [
  ['a small cabin', { widthFt: 18, depthFt: 20, wallHeightFt: 8, roofPitch: 0.3, storeys: 1 }],
  ['the sample house', { widthFt: 36, depthFt: 28, wallHeightFt: 10, roofPitch: 0.32, storeys: 1 }],
  ["Daniel's house", { widthFt: 28, depthFt: 32, wallHeightFt: 12, roofPitch: 0.094, storeys: 2 }],
  ['a three-storey tower', { widthFt: 24, depthFt: 24, wallHeightFt: 12, roofPitch: 0.4, storeys: 3 }],
  ['a long barn', { widthFt: 120, depthFt: 40, wallHeightFt: 16, roofPitch: 0.5, storeys: 1 }],
  ['the biggest the app allows', { widthFt: 120, depthFt: 120, wallHeightFt: 40, roofPitch: 1.2, storeys: 3 }]
];

// Every pane shape a chapter switch can hand it, including the ones that have
// not been measured yet.
const PANES = [
  ['a normal window', 16 / 9],
  ['a tall narrow pane', 0.55],
  ['an ultrawide pane', 3.2],
  ['a pane not measured yet (0)', 0],
  ['a pane mid-layout (0.01)', 0.01],
  ['a nonsense pane (NaN)', NaN]
];

console.log('the camera can always see the house:');
for (const [houseName, shell] of HOUSES) {
  for (const [paneName, aspect] of PANES) {
    const fit = defaultCameraFraming({ shell }, aspect, 45);
    const dist = fit.pos.distanceTo(fit.target);
    const label = `${houseName}, ${paneName}`;
    if (!Number.isFinite(dist)) { check(false, label, 'distance is not a number'); continue; }
    // 2 — inside the far plane, with room to spare for the far side of the house
    check(dist < FAR_PLANE * 0.75, `${label}: stands ${Math.round(dist)} ft back, inside the far plane`, `${Math.round(dist)} ft vs ${FAR_PLANE} ft far plane`);
    // 1 — far enough to hold the whole building
    const span = Math.max(shell.widthFt, shell.depthFt);
    check(dist > span * 0.6, `${label}: far enough back to hold all ${span} ft of it`, `${Math.round(dist)} ft`);
    // ...and not absurdly far for the size of the thing
    check(dist < Math.max(240, span * 12), `${label}: not absurdly far for its size`, `${Math.round(dist)} ft`);
    // the camera looks at the middle of the house, not the origin
    check(Math.abs(fit.target.x - shell.widthFt / 2) < 0.01 && Math.abs(fit.target.z - shell.depthFt / 2) < 0.01,
      `${label}: aimed at the middle of the house`);
  }
}

// 3 — the guard that actually broke: an unmeasured pane must give the SAME
// answer as an ordinary one, never a wilder one.
{
  const shell = { widthFt: 28, depthFt: 32, wallHeightFt: 12, roofPitch: 0.094, storeys: 2 };
  const measured = defaultCameraFraming({ shell }, 16 / 9, 45);
  for (const bad of [0, 0.01, NaN, -1, undefined]) {
    const unmeasured = defaultCameraFraming({ shell }, bad, 45);
    check(Math.abs(unmeasured.pos.distanceTo(unmeasured.target) - measured.pos.distanceTo(measured.target)) < 0.01,
      `an unmeasured pane (${String(bad)}) falls back to the ordinary distance`);
  }
}

// The fences on the wheel must exist at all — without them a scroll can put
// the house behind the far plane and nothing brings it back.
check(/controls\.maxDistance\s*=/.test(src), 'the view has a zoom-out limit');
check(/controls\.minDistance\s*=/.test(src), 'the view has a zoom-in limit');
check(/camera\.far\s*\*\s*0\.8/.test(src), 'a remembered camera too far to see the house is discarded');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
