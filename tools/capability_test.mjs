// capability_test.mjs — the capability manifest checker.
//
// THE POINT: at least seven times (updates 20, 32, 47, 49, 57, 96/97, 114) a
// UI reorganization dropped or buried a working capability's visible entry
// point, and only Daniel's bug report caught it. The engine batteries can't
// see the UI surface. This battery can: tools/capabilities.json lists every
// user-facing capability and where its control must live; this script checks
// — statically, zero-dep, in milliseconds — that each one is still rendered
// in the DEFAULT (site) look.
//
// The contract:
//   site:"quick"  → the entry's data-cap marker must appear inside
//                   SiteQuickRow's `if (chapter === '<chapter>')` branch.
//   site:"more"   → the marker must appear inside the named classic
//                   component, AND that chapter's quick branch must carry a
//                   More signpost (a cap-more-<chapter> marker or an onMore
//                   control) so the user can find it.
//   Every data-cap in the code must be registered here (or be a cap-more-*
//   signpost) — new controls join the inventory the day they're born.
//
// WHAT IT CANNOT CATCH (the live layer's job — elementFromPoint in the
// browser pane): CSS hiding, occlusion by another panel, a marker inside a
// condition that's never true, runtime crashes.
//
// If SiteQuickRow is renamed or restructured this test FAILS LOUDLY on
// purpose: the reorg must update the checker (and re-prove the inventory)
// in the same change, not after Daniel finds the hole.
//
// Run: node tools/capability_test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, '..', 'src', 'reimagine', 'App.jsx');
const src = readFileSync(appPath, 'utf8');
const manifest = JSON.parse(readFileSync(join(here, 'capabilities.json'), 'utf8'));

let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL  ${label}`);
};

// --- slice a top-level `function Name(...) { ... }` out of App.jsx ---------
// House convention: top-level functions open with `function Name(` at column 0
// and close with `}` at column 0.
const sliceFunction = (name) => {
  const open = src.search(new RegExp(`^function ${name}\\(`, 'm'));
  if (open < 0) return null;
  // The close is `}` alone at column 0. A multi-line destructured parameter
  // list also puts `}` at column 0 — but followed by `) {`, so skip those.
  let close = src.indexOf('\n}', open);
  while (close >= 0 && src[close + 2] === ')') close = src.indexOf('\n}', close + 2);
  return close < 0 ? null : src.slice(open, close + 2);
};

// --- the default look's per-chapter surface: SiteQuickRow's branches -------
const quickRow = sliceFunction('SiteQuickRow');
if (!quickRow) {
  console.log('FAIL  SiteQuickRow not found in App.jsx — the default look\'s control surface moved.');
  console.log('      A reorg must carry this checker with it: update tools/capability_test.mjs to');
  console.log('      slice the new surface, and re-verify every entry in tools/capabilities.json.');
  process.exit(1);
}
const branchRe = /if \(chapter === '(\w+)'\)/g;
const marks = [];
for (let m; (m = branchRe.exec(quickRow));) marks.push({ chapter: m[1], at: m.index });
const branches = {};
marks.forEach((mk, i) => {
  branches[mk.chapter] = quickRow.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : quickRow.length);
});

const chaptersSrc = (() => {
  const open = src.indexOf('const CHAPTERS = [');
  const close = src.indexOf('];', open);
  return open >= 0 && close > open ? src.slice(open, close) : '';
})();

// --- the checks ------------------------------------------------------------
for (const cap of manifest.capabilities) {
  const tag = `[${cap.id}] ${cap.label}`;
  ok(chaptersSrc.includes(`id: '${cap.chapter}'`), `${tag} — chapter '${cap.chapter}' missing from CHAPTERS`);
  ok(src.includes(`data-cap="${cap.marker}"`), `${tag} — no control carries data-cap="${cap.marker}" anywhere`);
  const branch = branches[cap.chapter] || '';
  if (cap.site === 'quick') {
    ok(branch.includes(cap.marker),
      `${tag} — marker '${cap.marker}' is NOT in SiteQuickRow's '${cap.chapter}' branch: the default look lost this control (the update-114 bug class)`);
  } else if (cap.site === 'more') {
    const classic = cap.classic ? sliceFunction(cap.classic) : null;
    ok(Boolean(classic), `${tag} — classic component '${cap.classic}' not found`);
    ok(Boolean(classic && classic.includes(cap.marker)),
      `${tag} — marker '${cap.marker}' missing from ${cap.classic} (the More panel lost it)`);
    ok(branch.includes(`cap-more-${cap.chapter}`) || branch.includes('onMore'),
      `${tag} — the '${cap.chapter}' quick row has no More signpost, so this capability is invisible in the default look`);
  } else {
    ok(false, `${tag} — unknown site '${cap.site}' (use 'quick' or 'more')`);
  }
}

// --- inventory honesty, the reverse direction ------------------------------
// Every data-cap in the code must be registered (cap-more-* signposts exempt).
const registered = new Set(manifest.capabilities.map((c) => c.marker));
const capRe = /data-cap="([^"]+)"/g;
const seen = new Set();
for (let m; (m = capRe.exec(src));) seen.add(m[1]);
for (const marker of seen) {
  ok(registered.has(marker) || /^cap-more-[a-z]+$/.test(marker),
    `unregistered control data-cap="${marker}" — add it to tools/capabilities.json (every capability joins the inventory)`);
}

console.log(`\ncapability manifest: ${passed} checks passed, ${failed} failed (${manifest.capabilities.length} capabilities, ${seen.size} markers in code)`);
if (failed === 0) console.log('Every capability is reachable in the default look — a reorg cannot amputate silently.');
process.exit(failed ? 1 : 0);
