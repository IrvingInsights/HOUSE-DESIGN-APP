import { roofProfile, storeyHeightFt, storeyElevationFt } from '../../backend/bim-core.mjs';
import { upperPlateRect, floorCount } from '../engine.js';

// FACE LAW — the wall-top and roof-line math of one FACE of the house, in
// plan-true feet, shared by every 2D face view (the Wall view, the Storeys
// side faces). It is a hand-synced mirror of the 3D scene's own laws
// (threeScene: shedEaveAt, tierWallTop, pushSideBoxes' cap, the attached
// lean-to of stepBelow 'roof-top') — whoever edits a height law THERE edits
// it HERE, so what the 2D faces draw is what the 3D builds. Before this
// module, the 2D faces drew every storey as a flat box: raked tier tops and
// attached roof planes existed only in 3D and the views disagreed.
//
// Faces: 'south'/'north' measure t along plan x; 'east'/'west' along plan y.
// (Mirroring for view direction — flipX — stays the caller's business.)

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function buildFaceLaw(spec, face) {
  const shell = spec.shell || {};
  const width = Number(shell.widthFt) || 24;
  const depth = Number(shell.depthFt) || 24;
  const horiz = face === 'north' || face === 'south';
  const run = Math.max(4, horiz ? width : depth);
  const prof = roofProfile(shell);
  const shed = prof.roofType === 'shed';
  const shedEW = shed && prof.axis === 'ew';
  const slope = shed && prof.runFt > 0 ? prof.riseFt / prof.runFt : 0;

  // a point ON this face's wall line, from the run position t
  const linePoint = (t) => (face === 'south' ? [t, depth]
    : face === 'north' ? [t, 0]
    : face === 'east' ? [width, t]
    : [0, t]);

  // the raw shed eave (the ground roofline) at a plan point — same numbers
  // as the scene's shedEaveAt; a non-shed roof stands level at the high wall
  const shedEaveAt = (px, pz) => {
    if (!shed) return prof.highWallHeightFt;
    const f = shedEW ? px / Math.max(0.01, width) : pz / Math.max(0.01, depth);
    const h0 = shedEW ? prof.westWallHeightFt : prof.northWallHeightFt;
    const h1 = shedEW ? prof.eastWallHeightFt : prof.southWallHeightFt;
    return h0 + (h1 - h0) * clampN(f, 0, 1);
  };

  const floors = floorCount(spec);
  const plates = [];
  for (let lv = 2; lv <= floors; lv += 1) {
    if (storeyHeightFt(shell, lv) <= 0) continue;
    plates.push({
      lv,
      p: upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth },
      el: (spec.elements || []).find((e) => e.category === 'floor' && Number(e.level || 1) === lv)
    });
  }
  const floorOf = (lv) => storeyElevationFt(shell, lv);
  const topOf = (lv) => floorOf(lv) + storeyHeightFt(shell, lv);
  const anySetback = plates.some(({ p }) => p.w * p.d < width * depth - 1);

  // a tier's own wall top at a plan point (mirror of tierWallTop): flat at
  // its storey top, plus the shed rise restarting at the plate's low edge
  const tierTopAt = (lv, px, pz) => {
    const base = topOf(lv);
    if (!shed || !anySetback) return base;
    const entry = plates.find((x) => x.lv === lv);
    if (!entry) return base;
    const s = Number(entry.el?.roofPitch) > 0 ? Number(entry.el.roofPitch) : slope;
    const along = shedEW
      ? clampN(px - entry.p.x, 0, Math.max(0, entry.p.w))
      : clampN(pz - entry.p.y, 0, Math.max(0, entry.p.d));
    return base + s * along;
  };

  // the GROUND wall top at a perimeter point: the raw roofline, capped at
  // the floor of any storey standing over that spot (pushSideBoxes' law)
  const groundTopAt = (px, pz) => {
    let cap = Infinity;
    plates.forEach(({ lv, p }) => {
      // containment tolerance TIGHTER than the views' sampling inset
      // (0.02) — at 0.05 the sample just inside a plate edge read as
      // "covered" and the rake up to that edge drew flat
      if (px >= p.x - 0.01 && px <= p.x + p.w + 0.01 && pz >= p.y - 0.01 && pz <= p.y + p.d + 0.01) {
        cap = Math.min(cap, floorOf(lv));
      }
    });
    return Math.min(shedEaveAt(px, pz), cap);
  };

  // the ATTACHED LEAN-TO planes (stepBelow: 'roof-top'): the roof height at
  // a plan point in the ring such a storey roofs, or null where none reigns.
  // Mirrors the scene's wing branch: high edge at the storey's top on the
  // plate line, one plane down to the raw eave at the footprint edge.
  const wingAt = (px, pz) => {
    let best = null;
    for (const { lv, p, el } of plates) {
      if (el?.stepBelow !== 'roof-top') continue;
      const inFoot = px >= -0.01 && px <= width + 0.01 && pz >= -0.01 && pz <= depth + 0.01;
      const inPlate = px >= p.x - 0.01 && px <= p.x + p.w + 0.01 && pz >= p.y - 0.01 && pz <= p.y + p.d + 0.01;
      if (!inFoot || inPlate) continue;
      const high = topOf(lv);
      // which side of the plate this point lies on decides the plane's run
      let y = null;
      if (px < p.x) { const runW = Math.max(0.5, p.x); y = high - (high - shedEaveAt(0, pz)) * ((p.x - px) / runW); }
      else if (px > p.x + p.w) { const runW = Math.max(0.5, width - (p.x + p.w)); y = high - (high - shedEaveAt(width, pz)) * ((px - (p.x + p.w)) / runW); }
      else if (pz < p.y) { const runW = Math.max(0.5, p.y); y = high - (high - shedEaveAt(px, 0)) * ((p.y - pz) / runW); }
      else { const runW = Math.max(0.5, depth - (p.y + p.d)); y = high - (high - shedEaveAt(px, depth)) * ((pz - (p.y + p.d)) / runW); }
      if (y != null && (best == null || y > best)) best = y;
    }
    return best;
  };

  // storeys as FACE bands: their stretch along this run, whether their
  // extent touches this wall, and their true (possibly raked) top there
  const tiers = plates.map(({ lv, p }) => {
    const touches = face === 'north' ? p.y <= 0.05
      : face === 'south' ? p.y + p.d >= depth - 0.05
      : face === 'west' ? p.x <= 0.05
      : p.x + p.w >= width - 0.05;
    const s0 = clampN(horiz ? p.x : p.y, 0, run);
    const s1 = clampN(horiz ? p.x + p.w : p.y + p.d, 0, run);
    return {
      lv, touches, s0, s1,
      floorY: floorOf(lv),
      topAt: (t) => { const [px, pz] = linePoint(t); return tierTopAt(lv, px, pz); }
    };
  }).filter((b) => b.s1 - b.s0 > 0.1);

  return {
    run,
    horiz,
    linePoint,
    tiers,
    groundTopAt: (t) => { const [px, pz] = linePoint(t); return groundTopAt(px, pz); },
    // the combined WALL silhouette of the face (ground + touching tiers)
    wallTopAt: (t) => {
      const [px, pz] = linePoint(t);
      let top = groundTopAt(px, pz);
      tiers.forEach((b) => {
        if (b.touches && t > b.s0 - 0.01 && t < b.s1 + 0.01) top = Math.max(top, tierTopAt(b.lv, px, pz));
      });
      return top;
    },
    // the attached lean-to roof height crossing this face, or null
    roofAt: (t) => { const [px, pz] = linePoint(t); return wingAt(px, pz); }
  };
}
