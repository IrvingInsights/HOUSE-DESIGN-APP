import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PROJECT_ID, PROJECTS_DIR } from './config.mjs';
import { slugify } from './utils.mjs';

function projectDir(projectId = DEFAULT_PROJECT_ID) {
  return path.join(PROJECTS_DIR, projectId);
}

function projectStatePath(projectId = DEFAULT_PROJECT_ID) {
  return path.join(projectDir(projectId), 'project-state.json');
}

function projectRevisionsDir(projectId = DEFAULT_PROJECT_ID) {
  return path.join(projectDir(projectId), 'revisions');
}

async function ensureProjectDirs(projectId = DEFAULT_PROJECT_ID) {
  await fs.mkdir(projectRevisionsDir(projectId), { recursive: true });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // A corrupt file (interrupted write) must NEVER take the server down —
    // set the damaged copy aside and fall back to null; every state is also
    // snapshotted in revisions/, so nothing real is lost.
    if (error instanceof SyntaxError) {
      try { await fs.copyFile(filePath, `${filePath}.corrupt-${Date.now()}.bak`); } catch { /* best effort */ }
      console.warn(`Corrupt JSON set aside: ${filePath} (${error.message})`);
      return null;
    }
    throw error;
  }
}

function summarizeProject(state, projectId = DEFAULT_PROJECT_ID) {
  const spec = state?.spec || {};
  return {
    id: projectId,
    projectName: spec.projectName || 'Untitled Natural Building Study',
    revision: Number(spec.revision || 1),
    savedAt: state?.savedAt || null,
    roomCount: Array.isArray(spec.rooms) ? spec.rooms.length : 0,
    elementCount: Array.isArray(spec.elements) ? spec.elements.length : 0,
    updatedAt: state?.updatedAt || state?.savedAt || null
  };
}

export async function listProjects() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readJsonIfExists(projectStatePath(entry.name));
    if (state) projects.push(summarizeProject(state, entry.name));
  }
  return projects.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export async function loadProjectState(projectId = DEFAULT_PROJECT_ID) {
  return readJsonIfExists(projectStatePath(projectId));
}

// Saves for one project run strictly one-after-another. Two concurrent saves
// (an apply persisting + the 250ms autosave) once shared the same temp path
// (.tmp-<pid>): the first rename stole the second's temp file, the second
// threw ENOENT, and rapid UI actions surfaced as random "didn't respond"
// failures. The chain also orders the read-modify-write, so no save works
// from a state another save is halfway through replacing.
const saveChains = new Map();
let saveSequence = 0;

export function saveProjectState(incomingState, options = {}) {
  const requestedId = options.projectId || incomingState?.projectId || DEFAULT_PROJECT_ID;
  const projectId = slugify(requestedId) || DEFAULT_PROJECT_ID;
  const previousLink = saveChains.get(projectId) || Promise.resolve();
  const run = previousLink.then(() => writeProjectState(incomingState, projectId));
  saveChains.set(projectId, run.catch(() => {}));
  return run;
}

async function writeProjectState(incomingState, projectId) {
  const now = new Date().toISOString();
  const previous = await loadProjectState(projectId);
  const nextState = {
    ...previous,
    ...incomingState,
    projectId,
    updatedAt: now
  };
  await ensureProjectDirs(projectId);
  // Atomic write: temp file + rename. A process killed mid-write (or two
  // servers racing) can then never leave a half-written live pointer —
  // exactly the corruption that once took the whole server down.
  // Windows quirk: rename over a file someone has open throws EPERM —
  // retry once, then fall back to a direct copy (not atomic, but the
  // corrupt-read set-aside above still protects the worst case).
  const statePath = projectStatePath(projectId);
  // Unique per write — a shared temp name is what let one save's rename
  // steal another's file. (Belt to the save-chain's braces.)
  saveSequence += 1;
  const tmpPath = `${statePath}.tmp-${process.pid}-${saveSequence}`;
  await fs.writeFile(tmpPath, JSON.stringify(nextState, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, statePath);
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EEXIST' || error?.code === 'EBUSY') {
      await new Promise((resolve) => setTimeout(resolve, 60));
      try {
        await fs.rename(tmpPath, statePath);
      } catch {
        await fs.copyFile(tmpPath, statePath);
        await fs.unlink(tmpPath).catch(() => {});
      }
    } else {
      throw error;
    }
  }

  const revision = Number(nextState?.spec?.revision || 1);
  const snapshotName = `${now.replace(/[:.]/g, '-')}-rev-${revision}.json`;
  await fs.writeFile(
    path.join(projectRevisionsDir(projectId), snapshotName),
    JSON.stringify(nextState, null, 2),
    'utf8'
  );

  return {
    projectId,
    state: nextState,
    summary: summarizeProject(nextState, projectId)
  };
}

// Every save snapshots into revisions/ with the design's name inside — so the
// snapshots ARE the design library. Group by projectName, newest first.
export async function listDesigns(projectId = DEFAULT_PROJECT_ID) {
  await ensureProjectDirs(projectId);
  const entries = await fs.readdir(projectRevisionsDir(projectId), { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const byName = new Map();
  for (const file of files) {
    const state = await readJsonIfExists(path.join(projectRevisionsDir(projectId), file));
    const spec = state?.spec;
    if (!spec?.shell) continue;
    const name = spec.projectName || 'Untitled';
    if (byName.has(name)) continue; // files are newest-first — first hit wins
    byName.set(name, {
      projectName: name,
      file,
      revision: Number(spec.revision || 1),
      savedAt: state?.savedAt || state?.updatedAt || null,
      roomCount: Array.isArray(spec.rooms) ? spec.rooms.length : 0,
      shell: `${spec.shell.widthFt}×${spec.shell.depthFt}`
    });
  }
  // The rename box autosaves per keystroke, so "T", "Tom", "Tom's Hous" all
  // left snapshots. Collapse partials: drop a name when a kept name extends it,
  // or sits within edit-distance 2 of it (typo stubs like "Housz\e").
  const editDistance = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  };
  // Keep the most-advanced name in each cluster (highest revision, then most
  // recent) — the real "Tom's House" outranks the "Tom's Housz\e" typo stub.
  const candidates = [...byName.values()].sort((a, b) =>
    (b.revision - a.revision) || (new Date(b.savedAt || 0) - new Date(a.savedAt || 0)) || (b.projectName.length - a.projectName.length));
  const kept = [];
  for (const design of candidates) {
    const shadowed = kept.some((other) =>
      other.projectName.startsWith(design.projectName)
      || design.projectName.startsWith(other.projectName)
      || editDistance(other.projectName, design.projectName) <= 2);
    if (!shadowed) kept.push(design);
  }
  return kept;
}

// Bring a snapshot back as the current design (a restore is itself saved, so
// nothing is ever overwritten — the timeline only grows).
export async function restoreRevision(file, projectId = DEFAULT_PROJECT_ID) {
  const safe = path.basename(String(file || ''));
  if (!safe.endsWith('.json')) throw new Error('Not a revision file.');
  const state = await readJsonIfExists(path.join(projectRevisionsDir(projectId), safe));
  if (!state?.spec?.shell) throw new Error('Revision not found or unreadable.');
  return saveProjectState(state, { projectId });
}

export async function loadProjectRevisions(projectId = DEFAULT_PROJECT_ID, limit = 20) {
  await ensureProjectDirs(projectId);
  const entries = await fs.readdir(projectRevisionsDir(projectId), { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);
  const revisions = [];
  for (const file of files) {
    const state = await readJsonIfExists(path.join(projectRevisionsDir(projectId), file));
    if (!state) continue;
    revisions.push({
      file,
      revision: Number(state?.spec?.revision || 1),
      savedAt: state?.savedAt || null,
      updatedAt: state?.updatedAt || null,
      projectName: state?.spec?.projectName || 'Untitled Natural Building Study'
    });
  }
  return revisions;
}
