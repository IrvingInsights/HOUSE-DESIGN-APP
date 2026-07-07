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

export async function saveProjectState(incomingState, options = {}) {
  const requestedId = options.projectId || incomingState?.projectId || DEFAULT_PROJECT_ID;
  const projectId = slugify(requestedId) || DEFAULT_PROJECT_ID;
  const now = new Date().toISOString();
  const previous = await loadProjectState(projectId);
  const nextState = {
    ...previous,
    ...incomingState,
    projectId,
    updatedAt: now
  };
  await ensureProjectDirs(projectId);
  await fs.writeFile(projectStatePath(projectId), JSON.stringify(nextState, null, 2), 'utf8');

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
