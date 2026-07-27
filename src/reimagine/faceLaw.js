import { roofProfile, storeyHeightFt, storeyElevationFt, subtractRect } from '../../backend/bim-core.mjs';
import { upperPlateRect, floorCount, resolveOverhangs } from '../engine.js';

// mirrored from threeScene JOINTS.EAVE_BEARING (importing threeScene here
// would drag three.js into the Node battery) — keep in sync
const JOINTS = { EAVE_BEARING: 0.25 };

// FACE LAW — the wall-top and roof-line math of one FACE of the house, in
// plan-true feet, shared by every 2D face view (the Wall view, the Storeys
// side faces). It is a hand-synced mirror of the 3D scene's own laws
// (threeScene: shedEaveAt, tierWallTop, pushSideBoxes' cap, the legacy
// stacked model, the attached lean-to of stepBelow 'roof-top') — whoever
// edits a height law THERE edits it HERE, and tools/face_law_test.mjs pins
// this file to hand-verified 3D values so a drift fails a battery instead
// of reaching the user's eyes.
//
// Review findings fixed against the first cut (ultra review, Jul 19):
//  • the shed slope is SIGNED — (east−west)/width, (south−north)/depth — so
//    a WEST-high or NORTH-high shed rakes tier tops downward exactly as the
//    3D does (the first cut used |rise|/run and mirrored the rake);
//  • the attached lean-to plane is built per RING RECT between consecutive
//    tiers (not plate→footprint), over the overhang-extended run, with the
//    3D's own low-edge law: min(high − 0.5, outer eave + EAVE_BEARING),
//    where the outer eave samples the shed at the rect's outer-edge
//    midpoint — or the tier-below's topEave on a non-shed roof;
//  • a FULL-footprint stacked shed (no set-back storey) follows the legacy
//    stacked model: every top rides the raked shed profile plus the
//    cumulative storey lift (the first cut drew it flat).
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
  // SIGNED slope along the fall axis — the same number the 3D's
  // shedSlopePerFt carries (threeScene:441): negative when the high side
  // sits at the axis origin (west-high, north-high).
  const slope = !shed ? 0
    : shedEW
      ? (width > 0 ? (prof.eastWallHeightFt - prof.westWallHeightFt) / width : 0)
      : (depth > 0 ? (prof.southWallHeightFt - prof.northWallHeightFt) / depth : 0);

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
  // cumulative lift of the upper storeys THROUGH lv — the legacy stacked
  // model's storeyLift contribution (threeScene upThru / storeyInfo.extraFt)
  const liftThru = (lv) => Math.max(0, topOf(lv) - topOf(1));
  const anySetback = plates.some(({ p }) => p.w * p.d < width * depth - 1);

  // a tier's own wall top at a plan point (mirror of tierWallTop): flat at
  // its storey top plus the shed rise restarting at the plate's low edge —
  // set-back designs only. A FULL-footprint stack follows the legacy model:
  // the raked shed profile plus the cumulative storey lift.
  const tierTopAt = (lv, px, pz) => {
    if (!anySetback) return shedEaveAt(px, pz) + liftThru(lv);
    const base = topOf(lv);
    if (!shed) return base;
    const entry = plates.find((x) => x.lv === lv);
    if (!entry) return base;
    const s = Number(entry.el?.roofPitch) > 0 ? Number(entry.el.roofPitch) : slope;
    const along = shedEW
      ? clampN(px - entry.p.x, 0, Math.max(0, entry.p.w))
      : clampN(pz - entry.p.y, 0, Math.max(0, entry.p.d));
    return base + s * along;
  };

  // the GROUND wall top at a perimeter point: the raw roofline, capped at
  // the floor of any storey standing over that spot (pushSideBoxes' law) on
  // a set-back design; the raw roofline alone on the legacy full stack.
  const groundTopAt = (px, pz) => {
    if (!anySetback) return shedEaveAt(px, pz);
    let cap = Infinity;
    plates.forEach(({ lv, p }) => {
      // containment tolerance TIGHTER than the views' sampling inset (0.02)
      if (px >= p.x - 0.01 && px <= p.x + p.w + 0.01 && pz >= p.y - 0.01 && pz <= p.y + p.d + 0.01) {
        cap = Math.min(cap, floorOf(lv));
      }
    });
    return Math.min(shedEaveAt(px, pz), cap);
  };

  // ── THE ATTACHED LEAN-TO PLANES (stepBelow: 'roof-top') ──────────────────
  // Mirror of the 3D wing branch, ring by ring: tiers bottom→top (ground =
  // the footprint at the HIGH wall's eave; upper tiers at their engine
  // tops), each ring = subtract(below.rect, above.rect), and an attached
  // ring wears one plane from the ABOVE tier's top down to the ring's own
  // outer eave, across the overhang-extended run.
  const oAll = resolveOverhangs(shell);
  const tiers = [{ lv: 1, rect: { x: 0, y: 0, w: width, d: depth }, topEave: prof.highWallHeightFt }];
  plates.forEach(({ lv, p }) => tiers.push({ lv, rect: p, topEave: topOf(lv) }));
  const touchSideOf = (rect, above) => {
    const overlapX = rect.x < above.x + above.w && rect.x + rect.w > above.x;
    const overlapY = rect.y < above.y + above.d && rect.y + rect.d > above.y;
    return Math.abs(rect.y + rect.d - above.y) < 0.05 && overlapX ? 'south'
      : Math.abs(rect.y - (above.y + above.d)) < 0.05 && overlapX ? 'north'
      : Math.abs(rect.x + rect.w - above.x) < 0.05 && overlapY ? 'east'
      : Math.abs(rect.x - (above.x + above.w)) < 0.05 && overlapY ? 'west'
      : (Math.abs((rect.x + rect.w / 2) - (above.x + above.w / 2)) > Math.abs((rect.y + rect.d / 2) - (above.y + above.d / 2))
        ? ((rect.x + rect.w / 2) < (above.x + above.w / 2) ? 'east' : 'west')
        : ((rect.y + rect.d / 2) < (above.y + above.d / 2) ? 'south' : 'north'));
  };
  const wingPlanes = [];
  for (let i = tiers.length - 2; i >= 0; i -= 1) {
    const below = tiers[i];
    const above = tiers[i + 1];
    const aboveEl = plates.find((x) => x.lv === above.lv)?.el;
    if (aboveEl?.stepBelow !== 'roof-top') continue;
    if (below.rect.w * below.rect.d <= above.rect.w * above.rect.d + 1) continue;
    subtractRect(below.rect, above.rect).forEach((rect) => {
      const highSide = touchSideOf(rect, above.rect);
      // overhang per side: outward at the footprint edge → the real
      // overhang; toward the storey above → the 3D's courtesy 0.35;
      // interior neighbors → the hairline 0.05 (mirror of segOverhangs)
      const oSide = {};
      for (const side of ['north', 'south', 'east', 'west']) {
        const atEdge = side === 'north' ? rect.y <= 0.05
          : side === 'south' ? rect.y + rect.d >= depth - 0.05
          : side === 'west' ? rect.x <= 0.05
          : rect.x + rect.w >= width - 0.05;
        oSide[side] = atEdge ? oAll[side] : (side === highSide ? 0.35 : 0.05);
      }
      const X0 = rect.x - oSide.west; const X1 = rect.x + rect.w + oSide.east;
      const Z0 = rect.y - oSide.north; const Z1 = rect.y + rect.d + oSide.south;
      // outer-edge midpoint (the LOW side, opposite the storey it leans on)
      const [oxA, ozA] = highSide === 'east' ? [rect.x, rect.y + rect.d / 2]
        : highSide === 'west' ? [rect.x + rect.w, rect.y + rect.d / 2]
        : highSide === 'south' ? [rect.x + rect.w / 2, rect.y]
        : [rect.x + rect.w / 2, rect.y + rect.d];
      const highA = above.topEave;
      const lowA = Math.min(highA - 0.5,
        (shed ? shedEaveAt(oxA, ozA) : below.topEave) + JOINTS.EAVE_BEARING);
      wingPlanes.push({
        X0, X1, Z0, Z1,
        at: (px, pz) => (
          highSide === 'north' ? lowA + ((Z1 - pz) / Math.max(0.01, Z1 - Z0)) * (highA - lowA)
          : highSide === 'south' ? lowA + ((pz - Z0) / Math.max(0.01, Z1 - Z0)) * (highA - lowA)
          : highSide === 'west' ? lowA + ((X1 - px) / Math.max(0.01, X1 - X0)) * (highA - lowA)
          : lowA + ((px - X0) / Math.max(0.01, X1 - X0)) * (highA - lowA))
      });
    });
  }
  const wingAt = (px, pz) => {
    let best = null;
    wingPlanes.forEach((w) => {
      if (px < w.X0 - 0.01 || px > w.X1 + 0.01 || pz < w.Z0 - 0.01 || pz > w.Z1 + 0.01) return;
      const y = w.at(px, pz);
      if (best == null || y > best) best = y;
    });
    return best;
  };

  // storeys as FACE bands: their stretch along this run, whether their
  // extent touches this wall, and their true (possibly raked) top there
  const tierBands = plates.map(({ lv, p }) => {
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
    tiers: tierBands,
    groundTopAt: (t) => { const [px, pz] = linePoint(t); return groundTopAt(px, pz); },
    // the combined WALL silhouette of the face (ground + touching tiers)
    wallTopAt: (t) => {
      const [px, pz] = linePoint(t);
      let top = groundTopAt(px, pz);
      tierBands.forEach((b) => {
        if (b.touches && t > b.s0 - 0.01 && t < b.s1 + 0.01) top = Math.max(top, tierTopAt(b.lv, px, pz));
      });
      return top;
    },
    // the attached lean-to roof height crossing this face, or null
    roofAt: (t) => { const [px, pz] = linePoint(t); return wingAt(px, pz); }
  };
}
