// PLAN FLOOR TEST — what the 2D plan shows, and what you can grab, on each floor.
//
// The law being pinned here, in Daniel's words: "need to be able to move/resize
// decks same as rooms on 2D plan."  A room on another floor has always drawn as
// a faint ghost; an ELEMENT on another floor simply vanished.  So a deck built
// on the second storey was invisible from the ground floor — and invisible
// means unmovable, because there was nothing there to grab.
//
// Three things must hold, for ANY house, not just this one:
//   1. On its own floor, a deck draws live: draggable body, resize corners.
//   2. On another floor, a deck draws as a ghost — same as a room does.
//   3. That ghost is tappable: it takes the plan to the floor the thing is on.
//
// Nothing here names a specific house. The fixture is built from scratch.

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
// esbuild ships inside vite; it is how we turn the plan's JSX into something
// node can render. If it cannot load (a node_modules copied between a PC and a
// Mac, say), say so plainly and stand down rather than reporting a false break.
let build;
try { ({ build } = await import('esbuild')); } catch (err) {
  console.log('plan_floor_test: skipped — could not load the bundler (esbuild). '
    + 'Run "npm install" in this folder and try again. Nothing is broken.');
  process.exit(0);
}

const ROOT = new URL('..', import.meta.url).pathname;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- the fixture
// A plain two-storey box with one room and one deck on each floor. No stairs,
// no outbuildings, nothing house-specific.
const spec = {
  projectName: 'Plan floor fixture',
  shell: { widthFt: 30, depthFt: 20, storeys: 2, wallHeightFt: 9, roofType: 'gable' },
  walls: {},
  site: {},
  systems: {},
  utilities: {},
  openings: [],
  rooms: [
    { id: 'room-g', name: 'Ground room', type: 'living', level: 1, x: 2, y: 2, w: 12, d: 10 },
    { id: 'room-u', name: 'Upper room', type: 'bedroom', level: 2, x: 4, y: 3, w: 10, d: 9 },
  ],
  elements: [
    { id: 'deck-g', name: 'Ground deck', category: 'deck', level: 1, z: 0, x: 2, y: 21, w: 10, d: 8, h: 0.35 },
    { id: 'deck-u', name: 'Upper deck', category: 'deck', level: 2, z: 10, x: 16, y: 21, w: 10, d: 8, h: 0.35 },
  ],
};

// ------------------------------------------------------------- render harness
// PlanView is JSX, so bundle it once with esbuild and render to static markup.
const dir = mkdtempSync(join(ROOT, '.planfloor-'));
const entry = join(dir, 'entry.jsx');
writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanView } from ${JSON.stringify(join(ROOT, 'src/planView.jsx'))};
export function render(spec, activeFloor, opts = {}) {
  const picked = [];
  const floors = [];
  const markup = renderToStaticMarkup(
    React.createElement(PlanView, {
      spec,
      selectedRoom: opts.selected || null,
      onSelect: (id) => picked.push(id),
      onMove: () => {},
      onResize: () => {},
      onResizeShell: () => {},
      onMoveEdge: () => {},
      onMoveOpening: () => {},
      activeFloor,
      onSelectFloor: opts.noFloorJump ? null : ((f) => floors.push(f)),
    })
  );
  return { markup, picked, floors };
}
`);
const out = join(dir, 'bundle.mjs');
await build({
  entryPoints: [entry], bundle: true, outfile: out, format: 'esm', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/server', 'lucide-react', 'three'],
  jsx: 'automatic', logLevel: 'silent', absWorkingDir: ROOT,
});
const { render } = await import(out);
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

// Pull every <rect> out of the markup with its attributes.
const rects = (markup) => [...markup.matchAll(/<rect\b[^>]*\/?>/g)].map((m) => {
  const tag = m[0];
  const at = {};
  for (const a of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) at[a[1]] = a[2];
  return at;
});
// A ghost is the faint dashed rect used for anything on another floor.
const isGhost = (r) => r['stroke-dasharray'] === '0.5 0.5' && r['fill-opacity'] === '0.1';
const boxOf = (el) => ({ x: String(el.x), y: String(el.y), w: String(el.w), h: String(el.d) });
const matches = (r, b) => r.x === b.x && r.y === b.y && r.width === b.w && r.height === b.h;
const findRect = (rs, el, want) => rs.find((r) => matches(r, boxOf(el)) && (want === 'ghost' ? isGhost(r) : !isGhost(r)));

const gDeck = spec.elements[0];
const uDeck = spec.elements[1];
const gRoom = spec.rooms[0];
const uRoom = spec.rooms[1];

// ------------------------------------------------------------------- floor 1
{
  const { markup } = render(spec, 1);
  const rs = rects(markup);
  ok('floor 1: the ground deck draws live', !!findRect(rs, gDeck, 'live'));
  ok('floor 1: the upper deck draws as a ghost', !!findRect(rs, uDeck, 'ghost'),
    'an element on another floor used to vanish entirely');
  ok('floor 1: the ground room draws live', !!findRect(rs, gRoom, 'live'));
  ok('floor 1: the upper room draws as a ghost', !!findRect(rs, uRoom, 'ghost'));
  ok('floor 1: the upper deck is not ALSO drawn live', !findRect(rs, uDeck, 'live'));
}

// ------------------------------------------------------------------- floor 2
{
  const { markup } = render(spec, 2);
  const rs = rects(markup);
  ok('floor 2: the upper deck draws live', !!findRect(rs, uDeck, 'live'),
    'a deck on its own floor must be grabbable');
  ok('floor 2: the ground deck draws as a ghost', !!findRect(rs, gDeck, 'ghost'));
  ok('floor 2: the upper room draws live', !!findRect(rs, uRoom, 'live'));
  ok('floor 2: the ground room draws as a ghost', !!findRect(rs, gRoom, 'ghost'));
}

// ------------------------------------------- a deck is as grabbable as a room
// Same floor, same treatment: a body you can drag and corners you can pull.
{
  const roomSel = render(spec, 2, { selected: 'room-u' });
  const deckSel = render(spec, 2, { selected: 'deck-u' });
  const handles = (markup) => (markup.match(/cursor:(nw|ne|sw|se)-resize/g) || []).length;
  ok('a selected room offers four resize corners', handles(roomSel.markup) >= 4,
    `saw ${handles(roomSel.markup)}`);
  ok('a selected deck offers four resize corners too', handles(deckSel.markup) >= 4,
    `saw ${handles(deckSel.markup)} — a deck must resize like a room`);
  const grabs = (markup) => (markup.match(/cursor:grab/g) || []).length;
  ok('the plan offers grab cursors on both', grabs(roomSel.markup) > 0 && grabs(deckSel.markup) > 0);
}

// ------------------------------------------------- the ghost is a way through
{
  const { markup } = render(spec, 1);
  const rs = rects(markup);
  const ghost = findRect(rs, uDeck, 'ghost');
  ok('the ghost says which floor it is on', /Upper deck/.test(markup) && /floor/i.test(markup),
    'tapping a ghost should be an obvious offer, not a guess');
  ok('the ghost is not painted over the live floor', ghost && ghost['fill-opacity'] === '0.1');
  const pinned = render(spec, 1, { noFloorJump: true });
  const pinnedGhost = findRect(rects(pinned.markup), uDeck, 'ghost');
  ok('with no floor to jump to, the ghost stays out of the way',
    pinnedGhost && pinnedGhost['pointer-events'] === 'none',
    'a ghost that cannot take you anywhere must not swallow taps');
}

// -------------------------------------------------- a one-storey house is calm
// The whole mechanism must disappear on a house with a single floor.
{
  const flat = JSON.parse(JSON.stringify(spec));
  flat.shell.storeys = 1;
  flat.rooms = flat.rooms.filter((r) => r.level === 1);
  flat.elements = flat.elements.filter((e) => e.level === 1);
  const { markup } = render(flat, 1);
  const ghosts = rects(markup).filter(isGhost);
  ok('one storey: nothing ghosts', ghosts.length === 0, `saw ${ghosts.length} ghost rects`);
}

// ------------------------------------------------------------------ verdict
console.log(`plan_floor_test: ${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
