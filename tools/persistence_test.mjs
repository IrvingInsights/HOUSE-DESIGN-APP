// Persistence battery — the engine-side design store keeps every save, per
// project, atomically, and recovers from corruption. Runs headless against
// backend/project-store.mjs directly (no server needed) on a throwaway
// project id, and cleans up after itself.
//
//   node tools/persistence_test.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  saveProjectState, loadProjectState, loadProjectRevisions, restoreRevision
} from '../backend/project-store.mjs';
import { PROJECTS_DIR } from '../backend/config.mjs';

let passed = 0; let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed += 1; console.log(`  ok  ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}`); }
};

const PID = `test-${Date.now().toString(36)}`;
const PID2 = `${PID}-b`;
const dirOf = (id) => path.join(PROJECTS_DIR, id);
const specOf = (rev, name = 'Test House') => ({
  projectName: name, revision: rev,
  shell: { widthFt: 30, depthFt: 24, wallHeightFt: 10, roofType: 'gable', roofPitch: 0.32, storeys: 1 },
  walls: {}, rooms: [{ id: 'r1', name: 'Room', x: 2, y: 2, w: 10, d: 10, h: 0.22, level: 1, type: 'living' }],
  elements: [], openings: [], systems: {}, levels: [], notes: ''
});

try {
  // save → load equality (spec round-trips, savedAt preserved as given)
  const at1 = Date.now();
  await saveProjectState({ spec: specOf(1), savedAt: at1 }, { projectId: PID });
  const s1 = await loadProjectState(PID);
  ok(JSON.stringify(s1.spec) === JSON.stringify(specOf(1)), 'save → load returns the identical spec');
  ok(Number(s1.savedAt) === at1, 'savedAt (epoch-ms) survives the round trip');

  // N saves → N revisions, newest first
  await saveProjectState({ spec: specOf(2), savedAt: Date.now() }, { projectId: PID });
  await saveProjectState({ spec: specOf(3), savedAt: Date.now() }, { projectId: PID });
  const revs = await loadProjectRevisions(PID, 20);
  ok(revs.length === 3, `every save keeps a revision (got ${revs.length}/3)`);
  ok(revs[0].revision === 3 && revs[revs.length - 1].revision === 1, 'revisions list newest first');

  // restore an old revision → state matches AND the timeline only grows
  const oldFile = revs.find((r) => r.revision === 1).file;
  const restored = await restoreRevision(oldFile, PID);
  ok(restored.state.spec.revision === 1, 'restore brings the old state back');
  const revsAfter = await loadProjectRevisions(PID, 20);
  ok(revsAfter.length === 4, 'restoring ADDS a revision — history never shrinks');

  // corruption: garbage in project-state.json → load survives, sets the bad
  // file aside, and a revision restore recovers
  await fs.writeFile(path.join(dirOf(PID), 'project-state.json'), '{ this is not json');
  const corrupt = await loadProjectState(PID);
  ok(corrupt === null || corrupt === undefined, 'corrupt state loads as empty, never throws');
  const baks = (await fs.readdir(dirOf(PID))).filter((f) => f.includes('.corrupt-'));
  ok(baks.length >= 1, 'the corrupt file is set aside, not destroyed');
  const rec = await restoreRevision(revsAfter[0].file, PID);
  ok(rec.state.spec.shell.widthFt === 30, 'a revision restore recovers from corruption');

  // concurrent saves serialize — the final state is the last payload
  await Promise.all(Array.from({ length: 10 }, (_, i) => saveProjectState({ spec: specOf(10 + i), savedAt: Date.now() + i }, { projectId: PID })));
  const afterRace = await loadProjectState(PID);
  ok(Number(afterRace.spec.revision) === 19, `10 concurrent saves serialize (final rev ${afterRace.spec.revision})`);

  // project ids never cross-contaminate
  await saveProjectState({ spec: specOf(100, 'Other House'), savedAt: Date.now() }, { projectId: PID2 });
  const a = await loadProjectState(PID);
  const b = await loadProjectState(PID2);
  ok(a.spec.projectName === 'Test House' && b.spec.projectName === 'Other House', 'two project ids keep two separate designs');
} finally {
  for (const id of [PID, PID2]) {
    try { await fs.rm(dirOf(id), { recursive: true, force: true }); } catch { /* fine */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
