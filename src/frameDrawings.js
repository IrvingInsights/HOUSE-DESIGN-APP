// --- Frame drawing set ------------------------------------------------------
// Generates timber-frame shop-drawing sheets (SVG) straight from the design
// spec — elevation views of the STRUCTURE (sills, posts, plate beams, braces,
// crossbeams, rafters) with dimension strings, leader callouts, and a title
// block, in the drafting style of a hand-lettered 11×17 frame drawing.
// Member sizes follow the Frame page choice (timber / post & beam / stick…);
// footprint-aware (an L-shape elevation shows each wall plane's own run) and
// roof-aware (a shed frame gets the raked plate + full sloped rafter, gable
// ends get the triangle, and views that cut the rafters show their ends at
// spacing — the classic "front elevation" look).
//
// One export: createFrameDrawingSetHtml(spec) → self-contained printable HTML
// (one page per sheet), used by the Export menu and the Frame page.

import {
  FRAME_TYPES, OPENING_TYPES, resolveFrameType, resolveWallSide, roofProfile,
  footprintPolygon, footprintEdges, hasCustomFootprint, polygonPerimeter, polygonArea
} from '../backend/bim-core.mjs';

const INK = '#1d2733';
const WOOD = '#f6f1e6';
const FAINT = '#8b94a0';

// Member schedules per frame type. Sizes are display strings; ftW is the
// drawn member width in feet; spacingFt = post/stud bay; rafterOCFt = rafter
// centers. Values echo common practice for each system — schematic, not
// stamped engineering.
const FRAME_MEMBERS = {
  timber: {
    label: 'Timber frame', post: '8×8″ Post', postW: 0.67, sill: '8×8″ Sills (build-up)', sillH: 0.67,
    plate: '8×8″ Plate Beam', plateH: 0.67, cross: '8×8″ Crossbeam', crossH: 0.67,
    brace: '4×6″ Braces — 36″ R/R', braceW: 0.35, rafter: '4×8″ Rafters', rafterH: 0.67, rafterW: 0.33,
    joist: '4×8″ Loft Joists', spacingFt: 10, rafterOCFt: 2, studs: false
  },
  'post-beam': {
    label: 'Post & beam', post: '6×6″ Post', postW: 0.5, sill: '6×8″ Sill', sillH: 0.55,
    plate: '6×8″ Plate Beam', plateH: 0.55, cross: '6×8″ Crossbeam', crossH: 0.55,
    brace: '4×4″ Braces — 36″ R/R', braceW: 0.33, rafter: '4×6″ Rafters', rafterH: 0.5, rafterW: 0.33,
    joist: '4×6″ Loft Joists', spacingFt: 8, rafterOCFt: 2, studs: false
  },
  pole: {
    label: 'Round-wood / pole frame', post: 'Ø8″ Pole Post', postW: 0.67, sill: '6×8″ Sill on piers', sillH: 0.55,
    plate: '6×10″ Plate', plateH: 0.6, cross: '6×8″ Crossbeam', crossH: 0.55,
    brace: '4×4″ Braces', braceW: 0.33, rafter: '4×6″ Rafters', rafterH: 0.5, rafterW: 0.33,
    joist: '4×6″ Loft Joists', spacingFt: 8, rafterOCFt: 2, studs: false
  },
  stick: {
    label: 'Light stick frame', post: '2×6 Studs @ 16″ o.c.', postW: 0.13, sill: '2×6 PT Sill', sillH: 0.13,
    plate: 'Double 2×6 Top Plate', plateH: 0.25, cross: '2×10 Rim / Ledger', crossH: 0.8,
    brace: 'Let-in / panel bracing', braceW: 0.12, rafter: '2×8 Rafters @ 16″ o.c.', rafterH: 0.63, rafterW: 0.13,
    joist: '2×10 Joists @ 16″ o.c.', spacingFt: 16 / 12, rafterOCFt: 16 / 12, studs: true
  },
  'double-stud': {
    label: 'Double-stud wall', post: '2×4 Studs @ 16″ o.c. (two rows)', postW: 0.11, sill: '2×4 PT Sills (two)', sillH: 0.13,
    plate: 'Double 2×4 Top Plates', plateH: 0.25, cross: '2×10 Rim / Ledger', crossH: 0.8,
    brace: 'Sheathing braced', braceW: 0.12, rafter: '2×10 Rafters @ 16″ o.c.', rafterH: 0.8, rafterW: 0.13,
    joist: '2×10 Joists @ 16″ o.c.', spacingFt: 16 / 12, rafterOCFt: 16 / 12, studs: true
  },
  'load-bearing': {
    label: 'Load-bearing walls', post: '', postW: 0, sill: '8×8″ Sill / grade beam', sillH: 0.67,
    plate: 'Bond beam (roof bearing)', plateH: 0.67, cross: 'Ledger (loft bearing)', crossH: 0.55,
    brace: '', braceW: 0, rafter: '4×8″ Rafters', rafterH: 0.67, rafterW: 0.33,
    joist: '4×8″ Loft Joists', spacingFt: 0, rafterOCFt: 2, studs: false
  }
};

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ftIn(feet) {
  const sign = feet < 0 ? '-' : '';
  const abs = Math.abs(feet);
  const ft = Math.floor(abs + 1e-6);
  const inches = Math.round((abs - ft) * 12);
  if (inches === 12) return `${sign}${ft + 1}′-0″`;
  return `${sign}${ft}′-${inches}″`;
}

function storeyBits(shell = {}) {
  const storeys = Math.min(3, Math.max(1, Number(shell.storeys || 1)));
  const baseWallFt = Number(shell.wallHeightFt || 10);
  return { storeys, baseWallFt, extraFt: (storeys - 1) * baseWallFt };
}

function overhangsOf(shell = {}) {
  const base = Math.max(0, Number(shell.overhangFt ?? 1.6));
  const per = shell.overhangs || {};
  const val = (side) => Math.max(0, Number(per[side] ?? base));
  return { north: val('north'), south: val('south'), east: val('east'), west: val('west') };
}

// The structural elevation data for one view (facing) — post positions per
// wall run, the top-of-plate line, and the rafter treatment.
function frameView(spec, facing) {
  const shell = spec.shell || {};
  const roof = roofProfile(shell);
  const { storeys, baseWallFt, extraFt } = storeyBits(shell);
  const members = FRAME_MEMBERS[resolveFrameType(spec, 1)] || FRAME_MEMBERS['load-bearing'];
  const o = overhangsOf(shell);
  const horizontalView = facing === 'north' || facing === 'south';
  const depth = Number(shell.depthFt) || 28;
  const width = Number(shell.widthFt) || 36;
  const edges = footprintEdges(spec).filter((edge) => edge.facing === facing);
  const alongOf = (x, y) => (horizontalView ? x : y);
  // Mirror so the drawing reads as seen from OUTSIDE that wall.
  const mirror = facing === 'north' || facing === 'west';
  const extent = horizontalView ? width : depth;
  const A = (a) => (mirror ? extent - a : a);

  // Eave height at a plan position (top of plate). Shed roofs rake north→south.
  const eaveAt = (y) => {
    if (roof.roofType === 'shed') {
      const t = depth > 0 ? Math.min(1, Math.max(0, y / depth)) : 0;
      return roof.northWallHeightFt + (roof.southWallHeightFt - roof.northWallHeightFt) * t + extraFt;
    }
    return roof.highWallHeightFt + extraFt;
  };

  const runs = edges.map((edge) => {
    const a0 = Math.min(A(alongOf(edge.x0, edge.y0)), A(alongOf(edge.x1, edge.y1)));
    const a1 = Math.max(A(alongOf(edge.x0, edge.y0)), A(alongOf(edge.x1, edge.y1)));
    // For E/W walls the eave can rake along the run; sample both ends.
    const yStart = horizontalView ? edge.y0 : Math.min(edge.y0, edge.y1);
    const yEnd = horizontalView ? edge.y0 : Math.max(edge.y0, edge.y1);
    const h0 = eaveAt(mirror && !horizontalView ? yEnd : yStart);
    const h1 = eaveAt(mirror && !horizontalView ? yStart : yEnd);
    // Post positions: both ends + intermediates at ≤ spacing (timber types);
    // stud walls draw studs at their o.c. instead.
    const posts = [];
    if (members.postW > 0) {
      const len = a1 - a0;
      const bays = members.studs ? Math.max(1, Math.round(len / members.spacingFt)) : Math.max(1, Math.ceil(len / members.spacingFt));
      for (let i = 0; i <= bays; i += 1) posts.push(a0 + (len * i) / bays);
    }
    return { a0, a1, h0, h1, posts, edge };
  }).sort((r, q) => r.a0 - q.a0);

  return { facing, horizontalView, mirror, extent, runs, roof, members, o, storeys, baseWallFt, extraFt, eaveAt, depth, width };
}

// One elevation sheet as SVG. Layout: drawing field left, callout labels on
// the right margin (leader lines), dimensions below/left, title block handled
// by the sheet wrapper.
function elevationSvg(spec, facing) {
  const v = frameView(spec, facing);
  const m = v.members;
  const shell = spec.shell || {};
  const pitchNow = Number(shell.roofPitch || 0.32);
  const gable = v.roof.roofType === 'gable';
  const shed = v.roof.roofType === 'shed';
  const gableRise = gable ? Math.max(0, v.depth * pitchNow - 0.25) : 0;

  // Extents in feet, including rafter overhangs where drawn.
  const oLead = v.horizontalView ? v.o[v.mirror ? 'east' : 'west'] : v.o[v.mirror ? 'south' : 'north'];
  const oTail = v.horizontalView ? v.o[v.mirror ? 'west' : 'east'] : v.o[v.mirror ? 'north' : 'south'];
  const maxEave = Math.max(...v.runs.map((r) => Math.max(r.h0, r.h1)), v.roof.highWallHeightFt + v.extraFt);
  const topFt = (v.horizontalView && gable ? v.roof.highWallHeightFt + v.extraFt + gableRise : maxEave) + m.rafterH + 1.2;

  // Scale: largest architect scale that fits the field (px @ 96/in).
  const fieldW = 1120, fieldH = 720;
  const scales = [48, 36, 24, 18, 12, 9, 6]; // 1/2″, 3/8″, 1/4″, 3/16″, 1/8″ … per foot
  const scaleNames = { 48: '1/2″ = 1′-0″', 36: '3/8″ = 1′-0″', 24: '1/4″ = 1′-0″', 18: '3/16″ = 1′-0″', 12: '1/8″ = 1′-0″', 9: '3/32″ = 1′-0″', 6: '1/16″ = 1′-0″' };
  const spanFt = v.extent + oLead + oTail + 6;
  const s = scales.find((k) => spanFt * k <= fieldW && (topFt + 6) * k <= fieldH) || 6;
  const ox = 120 + oLead * s;
  const groundPx = 800;
  const X = (a) => ox + a * s;
  const Y = (h) => groundPx - h * s;

  const parts = [];
  const leaders = [];
  const rect = (x, y, w, h, extra = '') => parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, w).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${WOOD}" stroke="${INK}" stroke-width="1.1" ${extra}/>`);
  const line = (x1, y1, x2, y2, extra = '') => parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" ${extra.includes('stroke-width') ? extra : `stroke-width="1" ${extra}`}/>`);
  const poly = (pts, extra = '') => parts.push(`<polygon points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="${WOOD}" stroke="${INK}" stroke-width="1.1" ${extra}/>`);
  const text = (x, y, t, size = 13, anchor = 'start', extra = '') => parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="${anchor}" fill="${INK}" ${extra}>${esc(t)}</text>`);
  const leader = (x, y, label) => leaders.push({ x, y, label });

  // Ground line
  line(X(-oLead) - 30, groundPx, X(v.extent + oTail) + 30, groundPx, 'stroke-width="1.6"');

  // Per-run frame
  let leaderDone = { sill: false, post: false, plate: false, brace: false, cross: false, opening: false };
  const crossbeams = v.storeys > 1;
  const crossH = v.baseWallFt;
  v.runs.forEach((run) => {
    const runLen = run.a1 - run.a0;
    const plateAt = (a) => run.h0 + (run.h1 - run.h0) * (runLen > 0 ? (a - run.a0) / runLen : 0);
    // Sill
    rect(X(run.a0), Y(m.sillH), runLen * s, m.sillH * s);
    if (!leaderDone.sill) { leader(X(run.a1) - 8, Y(m.sillH / 2), m.sill); leaderDone.sill = true; }
    // Plate (level or raked strip following the eave line)
    poly([
      [X(run.a0), Y(plateAt(run.a0))],
      [X(run.a1), Y(plateAt(run.a1))],
      [X(run.a1), Y(plateAt(run.a1) - m.plateH)],
      [X(run.a0), Y(plateAt(run.a0) - m.plateH)]
    ]);
    if (!leaderDone.plate) { leader(X(run.a1) - 6, Y(plateAt(run.a1) - m.plateH / 2), m.plate); leaderDone.plate = true; }
    // Posts / studs
    run.posts.forEach((a) => {
      const clampedA = Math.min(Math.max(a, run.a0 + m.postW / 2), run.a1 - m.postW / 2);
      rect(X(clampedA - m.postW / 2), Y(plateAt(clampedA) - m.plateH), m.postW * s, (plateAt(clampedA) - m.plateH - m.sillH) * s);
    });
    if (m.postW > 0 && !leaderDone.post && run.posts.length) {
      const a = run.posts[run.posts.length - 1];
      leader(X(a), Y((plateAt(a)) * 0.45), m.studs ? m.post : m.post);
      leaderDone.post = true;
    }
    // Braces at timber posts (not studs, not load-bearing): a 45° knee strip
    // from the post face up to the plate underside, 36" legs each way.
    if (m.braceW > 0 && !m.studs) {
      const braceStrip = (p1, p2) => {
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (m.braceW * s) / 2;
        const ny = (dx / len) * (m.braceW * s) / 2;
        poly([
          [p1[0] + nx, p1[1] + ny], [p2[0] + nx, p2[1] + ny],
          [p2[0] - nx, p2[1] - ny], [p1[0] - nx, p1[1] - ny]
        ], 'fill-opacity="0.95"');
      };
      const legs = 3;
      run.posts.forEach((a, i) => {
        const topY = plateAt(a) - m.plateH;
        if (i > 0) braceStrip([X(a - m.postW / 2), Y(topY - legs)], [X(a - legs), Y(topY)]);
        if (i < run.posts.length - 1) braceStrip([X(a + m.postW / 2), Y(topY - legs)], [X(a + legs), Y(topY)]);
      });
      if (!leaderDone.brace && run.posts.length > 1) {
        const a = run.posts[run.posts.length - 2];
        leader(X(a + 1.8), Y(plateAt(a) - m.plateH - 1.6), m.brace);
        leaderDone.brace = true;
      }
    }
    // Crossbeam / loft line
    if (crossbeams && crossH < plateAt(run.a0) - 1) {
      rect(X(run.a0), Y(crossH), runLen * s, m.crossH * s);
      line(X(run.a0), Y(crossH + m.crossH + 0.3), X(run.a1), Y(crossH + m.crossH + 0.3), `stroke-dasharray="6 4" stroke="${FAINT}"`);
      if (!leaderDone.cross) { leader(X(run.a1) - 10, Y(crossH + m.crossH / 2), `${m.cross} · ${m.joist} above`); leaderDone.cross = true; }
    }
  });

  // Wall-plane breaks for custom footprints: dashed verticals where a run ends
  if (v.runs.length > 1) {
    v.runs.forEach((run) => {
      [run.a0, run.a1].forEach((a) => {
        if (a > 0.1 && a < v.extent - 0.1) line(X(a), Y(0), X(a), Y(Math.max(run.h0, run.h1)), `stroke-dasharray="3 5" stroke="${FAINT}"`);
      });
    });
  }

  // Roof structure
  if (shed && !v.horizontalView) {
    // Full sloped rafter with plumb-cut ends and overhangs (the side view).
    const yLow = v.mirror ? v.depth : 0;   // plan position at the left of the drawing
    const hL = v.eaveAt(v.mirror ? v.depth : 0);
    const hR = v.eaveAt(v.mirror ? 0 : v.depth);
    const aL = -oLead, aR = v.extent + oTail;
    const slope = (hR - hL) / v.extent;
    const hAt = (a) => hL + slope * a;
    poly([
      [X(aL), Y(hAt(aL))], [X(aR), Y(hAt(aR))],
      [X(aR), Y(hAt(aR) + m.rafterH)], [X(aL), Y(hAt(aL) + m.rafterH)]
    ]);
    leader(X(aR) - 20, Y(hAt(aR - 1) + m.rafterH / 2), m.rafter);
    leader(X(aR), Y(hAt(aR) + m.rafterH), 'Plumb cut end(s)');
    // Overhang dims
    dimH(parts, X(aL), X(0), Y(hAt(aL) + m.rafterH) - 18, ftIn(oLead));
    dimH(parts, X(v.extent), X(aR), Y(hAt(aR) + m.rafterH) - 18, ftIn(oTail));
  } else if (gable && v.horizontalView) {
    // Gable end: triangle with the rafter pair.
    const eave = v.roof.highWallHeightFt + v.extraFt;
    const apexA = v.extent / 2;
    const apexH = eave + gableRise;
    poly([[X(-oLead), Y(eave)], [X(apexA), Y(apexH)], [X(apexA), Y(apexH + m.rafterH)], [X(-oLead), Y(eave + m.rafterH)]]);
    poly([[X(apexA), Y(apexH)], [X(v.extent + oTail), Y(eave)], [X(v.extent + oTail), Y(eave + m.rafterH)], [X(apexA), Y(apexH + m.rafterH)]]);
    leader(X(v.extent * 0.78), Y(eave + gableRise * 0.45 + m.rafterH), m.rafter);
    dimV(parts, X(v.extent + oTail) + 26, Y(eave), Y(apexH), ftIn(gableRise), 'left');
  } else {
    // Rafters seen end-on: ticks at o.c. above the plate (front-elevation look).
    const eaveL = v.runs.length ? v.runs[0].h0 : v.roof.highWallHeightFt + v.extraFt;
    const eaveR = v.runs.length ? v.runs[v.runs.length - 1].h1 : eaveL;
    const slope2 = (eaveR - eaveL) / Math.max(1, v.extent);
    const count = Math.floor((v.extent + oLead + oTail) / m.rafterOCFt);
    for (let i = 0; i <= count; i += 1) {
      const a = -oLead + i * m.rafterOCFt;
      const h = eaveL + slope2 * Math.min(Math.max(a, 0), v.extent);
      rect(X(a - m.rafterW / 2), Y(h + m.rafterH), m.rafterW * s, m.rafterH * s);
    }
    text(X(v.extent / 2), Y(eaveL + m.rafterH + 1.4), `${m.rafter} — ${ftIn(m.rafterOCFt)} o.c.`, 12, 'middle');
    if (shed) leader(X(v.extent) - 4, Y(eaveR + m.rafterH / 2), 'Rafters on raked plates — see side view');
  }

  // Openings on this facing (dashed, with labels) — "glass this bay" style.
  (spec.openings || []).filter((op) => op.wall === facing).forEach((op) => {
    const profile = OPENING_TYPES[op.type] || OPENING_TYPES.window;
    const alongRaw = Number(v.horizontalView ? op.x : op.y) || 0;
    const a0 = v.mirror ? v.extent - alongRaw - (Number(op.widthFt) || 3) : alongRaw;
    const w = Number(op.widthFt) || 3;
    parts.push(`<rect x="${X(a0).toFixed(1)}" y="${Y(profile.sill + profile.h).toFixed(1)}" width="${(w * s).toFixed(1)}" height="${(profile.h * s).toFixed(1)}" fill="none" stroke="${FAINT}" stroke-width="1" stroke-dasharray="5 4"/>`);
    text(X(a0 + w / 2), Y(profile.sill + profile.h / 2), profile.glazed ? 'Glass' : 'Door', 11, 'middle', `fill="${FAINT}"`);
  });

  // Dimensions: overall + bays (first run) + heights.
  dimH(parts, X(0), X(v.extent), groundPx + 46, ftIn(v.extent));
  if (v.runs.length && v.runs[0].posts.length > 1 && !m.studs) {
    const posts = v.runs[0].posts;
    for (let i = 0; i + 1 < posts.length; i += 1) {
      dimH(parts, X(posts[i]), X(posts[i + 1]), groundPx + 24, ftIn(posts[i + 1] - posts[i]));
    }
  }
  const hLeft = v.runs.length ? v.runs[0].h0 : v.roof.highWallHeightFt;
  dimV(parts, X(0) - 34, groundPx, Y(hLeft), ftIn(hLeft), 'right');
  if (crossbeams) dimV(parts, X(0) - 70, groundPx, Y(crossH), ftIn(crossH), 'right');
  const hRight = v.runs.length ? v.runs[v.runs.length - 1].h1 : hLeft;
  if (Math.abs(hRight - hLeft) > 0.05) dimV(parts, X(v.extent) + 34, groundPx, Y(hRight), ftIn(hRight), 'left');

  // Leader stack on the right margin (kept inside the sheet frame).
  const stackX = 1170;
  leaders.sort((a, b) => a.y - b.y).forEach((l, i) => {
    const ly = 130 + i * 42;
    parts.push(`<line x1="${l.x.toFixed(1)}" y1="${l.y.toFixed(1)}" x2="${stackX - 8}" y2="${ly}" stroke="${INK}" stroke-width="0.8"/>`);
    parts.push(`<circle cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="2.2" fill="${INK}"/>`);
    parts.push(`<text x="${stackX}" y="${ly + 4}" font-size="13" fill="${INK}" text-decoration="underline">${esc(l.label).slice(0, 46)}</text>`);
  });

  const custom = hasCustomFootprint(spec);
  const note = m.postW === 0
    ? `Load-bearing ${resolveWallSide(spec, facing).assembly.label} wall carries the roof — no separate frame on this line.`
    : `${m.label} · minor framing field fit as desired.`;
  text(120, 70, `${titleWord(facing)} Elevation — Frame`, 22, 'start', 'font-weight="700" text-decoration="underline"');
  text(120, 96, note, 12, 'start', `fill="${FAINT}"`);
  if (custom) text(120, 114, 'Custom footprint: each wall run framed separately (dashed breaks); the roof line here is simplified — the model shows the true segmented roof.', 11, 'start', `fill="${FAINT}"`);

  return { svg: `<svg viewBox="0 0 1584 900" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe Print','Comic Sans MS','Segoe UI',sans-serif">${parts.join('')}</svg>`, scaleName: scaleNames[s] || 'fit' };
}

function titleWord(facing) {
  return facing.charAt(0).toUpperCase() + facing.slice(1);
}

// Horizontal dimension string with extension ticks and centered text.
function dimH(parts, x1, x2, y, label) {
  if (x2 - x1 < 8) return;
  parts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" stroke-width="0.8"/>`);
  [x1, x2].forEach((x) => parts.push(`<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="${INK}" stroke-width="0.8"/>`));
  parts.push(`<line x1="${x1 - 4}" y1="${y + 4}" x2="${x1 + 4}" y2="${y - 4}" stroke="${INK}" stroke-width="0.9"/>`);
  parts.push(`<line x1="${x2 - 4}" y1="${y + 4}" x2="${x2 + 4}" y2="${y - 4}" stroke="${INK}" stroke-width="0.9"/>`);
  parts.push(`<text x="${(x1 + x2) / 2}" y="${y - 5}" font-size="13" text-anchor="middle" fill="${INK}">${esc(label)}</text>`);
}

// Vertical dimension string.
function dimV(parts, x, y1, y2, label, side = 'right') {
  const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
  if (bottom - top < 8) return;
  parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${INK}" stroke-width="0.8"/>`);
  [top, bottom].forEach((y) => parts.push(`<line x1="${x - 6}" y1="${y}" x2="${x + 6}" y2="${y}" stroke="${INK}" stroke-width="0.8"/>`));
  parts.push(`<line x1="${x - 4}" y1="${top + 4}" x2="${x + 4}" y2="${top - 4}" stroke="${INK}" stroke-width="0.9"/>`);
  parts.push(`<line x1="${x - 4}" y1="${bottom + 4}" x2="${x + 4}" y2="${bottom - 4}" stroke="${INK}" stroke-width="0.9"/>`);
  const tx = side === 'right' ? x - 9 : x + 9;
  const anchor = side === 'right' ? 'end' : 'start';
  parts.push(`<text x="${tx}" y="${(top + bottom) / 2 + 4}" font-size="13" text-anchor="${anchor}" fill="${INK}">${esc(label)}</text>`);
}

// Frame plan: footprint outline, post marks along every edge, bay dimensions.
function framePlanSvg(spec) {
  const poly = footprintPolygon(spec);
  const edges = footprintEdges(spec);
  const m = FRAME_MEMBERS[resolveFrameType(spec, 1)] || FRAME_MEMBERS['load-bearing'];
  const w = Number(spec.shell.widthFt) || 36;
  const d = Number(spec.shell.depthFt) || 28;
  const s = Math.min(1000 / (w + 14), 700 / (d + 14));
  const ox = 150, oy = 90;
  const X = (x) => ox + x * s;
  const Y = (y) => oy + y * s;
  const parts = [];
  parts.push(`<polygon points="${poly.map(([px, py]) => `${X(px).toFixed(1)},${Y(py).toFixed(1)}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.6"/>`);
  let postCount = 0;
  edges.forEach((edge) => {
    if (m.postW <= 0) return;
    const len = edge.lengthFt;
    const bays = m.studs ? 0 : Math.max(1, Math.ceil(len / m.spacingFt));
    if (m.studs) return; // stud layout too dense to plot — schedule notes o.c.
    for (let i = 0; i <= bays; i += 1) {
      const t = i / bays;
      const px = edge.x0 + (edge.x1 - edge.x0) * t;
      const py = edge.y0 + (edge.y1 - edge.y0) * t;
      const inX = px - edge.nx * (m.postW / 2);
      const inY = py - edge.ny * (m.postW / 2);
      parts.push(`<rect x="${(X(inX) - (m.postW * s) / 2).toFixed(1)}" y="${(Y(inY) - (m.postW * s) / 2).toFixed(1)}" width="${(m.postW * s).toFixed(1)}" height="${(m.postW * s).toFixed(1)}" fill="${WOOD}" stroke="${INK}" stroke-width="1.1"/>`);
      postCount += 1;
    }
  });
  dimH(parts, X(0), X(w), Y(d) + 46, ftIn(w));
  dimV(parts, X(0) - 36, Y(0), Y(d), ftIn(d), 'right');
  parts.push(`<text x="${X(w / 2)}" y="60" font-size="22" text-anchor="middle" fill="${INK}" font-weight="700" text-decoration="underline">Frame Plan</text>`);
  parts.push(`<text x="${X(w / 2)}" y="${Y(d) + 76}" font-size="12" text-anchor="middle" fill="${FAINT}">${esc(m.studs ? `${m.post} — stud layout by wall length` : m.postW > 0 ? `${postCount} posts (${m.post}), bays ≤ ${m.spacingFt}′ o.c. per wall run` : `Load-bearing walls — no post grid; roof bears on the bond beam`)}</text>`);
  parts.push(`<text x="${X(w) + 30}" y="${Y(2)}" font-size="14" fill="${INK}">▲ N</text>`);
  return `<svg viewBox="0 0 1584 900" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe Print','Comic Sans MS','Segoe UI',sans-serif">${parts.join('')}</svg>`;
}

// Approximate member takeoff for the schedule sheet — honest schematic counts.
function memberSchedule(spec) {
  const m = FRAME_MEMBERS[resolveFrameType(spec, 1)] || FRAME_MEMBERS['load-bearing'];
  const poly = footprintPolygon(spec);
  const edges = footprintEdges(spec);
  const roof = roofProfile(spec.shell || {});
  const { storeys, baseWallFt } = storeyBits(spec.shell);
  const o = overhangsOf(spec.shell);
  const perim = polygonPerimeter(poly);
  const w = Number(spec.shell.widthFt) || 36;
  const d = Number(spec.shell.depthFt) || 28;
  const rows = [];
  const posts = m.studs || m.postW <= 0 ? 0 : edges.reduce((sum, edge) => sum + Math.max(2, Math.ceil(edge.lengthFt / m.spacingFt) + 1), 0);
  rows.push([m.sill, `${Math.ceil(perim)} LF`, 'On foundation, lapped at corners']);
  if (m.postW > 0 && !m.studs) rows.push([m.post, `${posts} pcs`, `Bays ≤ ${m.spacingFt}′-0″; height to plate`]);
  if (m.studs) rows.push([m.post, `≈ ${Math.ceil(perim / m.spacingFt)} pcs`, 'Plus corners, jacks, and cripples']);
  rows.push([m.plate, `${Math.ceil(perim)} LF`, roof.roofType === 'shed' ? 'Raked N→S — confirm with actual slope' : 'Level at eave']);
  if (m.braceW > 0 && !m.studs) rows.push([m.brace, `≈ ${posts * 2} pcs`, 'Outer walls; omit at openings']);
  if (storeys > 1) {
    rows.push([m.cross, `${Math.ceil(perim)} LF`, `At loft line ${ftIn(baseWallFt)}`]);
    rows.push([m.joist, `≈ ${Math.ceil(w / 2) + 1} pcs`, `Span ≈ ${ftIn(Math.min(12, d))} between beams`]);
  }
  const run = roof.roofType === 'shed' ? Math.hypot(d + o.north + o.south, (roof.southWallHeightFt - roof.northWallHeightFt)) : (d / 2 + Math.max(o.east, o.west)) / Math.cos(Math.atan(Number(spec.shell.roofPitch || 0.32)));
  const rafterCount = Math.ceil((w + o.east + o.west) / (FRAME_MEMBERS[resolveFrameType(spec, 1)]?.rafterOCFt || 2)) + 1;
  rows.push([m.rafter, `≈ ${roof.roofType === 'gable' ? rafterCount * 2 : rafterCount} pcs`, `≈ ${ftIn(run)} long incl. overhangs; plumb cut ends`]);
  return rows;
}

export function createFrameDrawingSetHtml(spec) {
  const m = FRAME_MEMBERS[resolveFrameType(spec, 1)] || FRAME_MEMBERS['load-bearing'];
  const today = new Date().toLocaleDateString();
  const views = ['south', 'north', 'east', 'west'];
  const sheets = [];
  const custom = hasCustomFootprint(spec);

  const titleBlock = (sheetNo, title, scaleName) => `
    <aside class="tb">
      <div class="tb-firm">${esc(spec.projectName || 'Natural Building Study')}</div>
      <div class="tb-title">${esc(title)}</div>
      <dl>
        <dt>Sheet</dt><dd>${esc(sheetNo)}</dd>
        <dt>Scale on 11×17</dt><dd>${esc(scaleName)}</dd>
        <dt>Revision</dt><dd>${spec.revision}</dd>
        <dt>Date</dt><dd>${esc(today)}</dd>
        <dt>Draftsman</dt><dd>Natural Building Studio</dd>
        <dt>Frame</dt><dd>${esc(m.label)}</dd>
      </dl>
      <div class="tb-note">Schematic frame drawings generated from the live design model. Confirm sizes, joinery, and bracing with your engineer before cutting.</div>
    </aside>`;

  sheets.push(`<section class="sheet"><main>${framePlanSvg(spec)}</main>${titleBlock('F001', 'Frame Plan', 'fit')}</section>`);
  views.forEach((facing, i) => {
    const r = resolveWallSide(spec, facing);
    if (r.omitted) return;
    const { svg, scaleName } = elevationSvg(spec, facing);
    sheets.push(`<section class="sheet"><main>${svg}</main>${titleBlock(`F10${i + 1}`, `${titleWord(facing)} Elevation`, scaleName)}</section>`);
  });
  const scheduleRows = memberSchedule(spec)
    .map(([member, qty, note]) => `<tr><th>${esc(member)}</th><td>${esc(qty)}</td><td>${esc(note)}</td></tr>`).join('');
  sheets.push(`<section class="sheet"><main class="pad">
    <h2>Member Schedule (schematic takeoff)</h2>
    <table><thead><tr><th>Member</th><th>Qty / Length</th><th>Notes</th></tr></thead><tbody>${scheduleRows}</tbody></table>
    <p class="fine">${custom ? 'Custom footprint: quantities follow the real outline (each wall run framed separately). ' : ''}Counts are schematic-level for pricing and conversation — a cut list needs joinery decisions (scarfs, tenons, reductions) this model doesn't hold yet.</p>
  </main>${titleBlock('F201', 'Member Schedule', '—')}</section>`);

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(spec.projectName)} — Frame Drawings Rev ${spec.revision}</title>
<style>
  @page { size: 11in 17in landscape; margin: 0.3in; }
  body { margin: 0; background: #d9dde2; font-family: "Segoe UI", Arial, sans-serif; color: ${INK}; }
  .sheet { width: 15.9in; height: 10.2in; margin: 18px auto; background: #fff; border: 2px solid ${INK}; display: grid; grid-template-columns: 1fr 2.1in; page-break-after: always; }
  .sheet main { border-right: 2px solid ${INK}; overflow: hidden; }
  .sheet main svg { width: 100%; height: 100%; }
  .pad { padding: 0.4in; }
  .tb { display: grid; grid-template-rows: auto auto 1fr auto; font-size: 10px; }
  .tb-firm { background: ${INK}; color: #fff; font-weight: 800; letter-spacing: 0.06em; padding: 10px 8px; text-transform: uppercase; }
  .tb-title { padding: 10px 8px; font-size: 15px; font-weight: 700; border-bottom: 2px solid ${INK}; }
  .tb dl { margin: 0; }
  .tb dt { background: #eef1f4; padding: 3px 8px; text-transform: uppercase; font-size: 8px; color: #5a6675; }
  .tb dd { margin: 0; padding: 4px 8px 7px; font-weight: 700; border-bottom: 1px solid #c6ccd4; }
  .tb-note { padding: 8px; font-size: 8.5px; line-height: 1.35; border-top: 2px solid ${INK}; color: #475361; }
  h2 { margin: 0 0 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid ${INK}; padding: 7px 10px; text-align: left; }
  thead th { background: #eef1f4; text-transform: uppercase; font-size: 10px; }
  .fine { font-size: 11px; color: #5a6675; }
</style></head><body>${sheets.join('')}</body></html>`;
}
