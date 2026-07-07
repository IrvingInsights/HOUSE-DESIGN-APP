import { aiPlan } from './planner.mjs';
import { readJson, sendJson } from './http.mjs';
import { DEFAULT_PROJECT_ID } from './config.mjs';
import { listProjects, loadProjectRevisions, loadProjectState, saveProjectState } from './project-store.mjs';
import { applyBimOperations } from './bim-core.mjs';
import { buildContextPacket, ensureProjectBrain, updateProjectBrainAfterOperation } from './project-brain-service.mjs';
import { respondFromStudioAgent } from './studio-agent-service.mjs';

export async function handleApiRoute(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/projects') {
    const projects = await listProjects();
    sendJson(res, 200, { projects, currentProjectId: projects[0]?.id || DEFAULT_PROJECT_ID });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/projects/current') {
    const state = await loadProjectState(DEFAULT_PROJECT_ID);
    const nextState = state?.spec
      ? { ...state, projectBrain: ensureProjectBrain(state.projectBrain, state.spec) }
      : state;
    sendJson(res, 200, {
      projectId: DEFAULT_PROJECT_ID,
      state: nextState,
      revisions: await loadProjectRevisions(DEFAULT_PROJECT_ID, 12)
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/projects/current/save') {
    const payload = await readJson(req);
    const normalized = payload?.spec ? { ...payload, projectBrain: ensureProjectBrain(payload.projectBrain, payload.spec) } : payload;
    const result = await saveProjectState(normalized, { projectId: DEFAULT_PROJECT_ID });
    sendJson(res, 200, {
      ok: true,
      projectId: result.projectId,
      summary: result.summary
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/design-plan') {
    try {
      const payload = await readJson(req);
      const plan = await aiPlan(payload);
      sendJson(res, 200, plan);
    } catch (error) {
      sendJson(res, 500, {
        source: 'planner-error',
        summary: 'Planning failed before any model change was made.',
        operations: [],
        warnings: [error?.message || String(error)],
        assumptions: [],
        questions: []
      });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/studio/respond') {
    try {
      const payload = await readJson(req);
      const result = await respondFromStudioAgent(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        source: 'studio-error',
        reply: '',
        warnings: [error?.message || String(error)]
      });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/bim/apply') {
    try {
      const payload = await readJson(req);
      const currentState = payload.state || {};
      const spec = payload.bim || payload.spec || currentState.spec;
      if (!spec?.shell || !Array.isArray(spec?.rooms)) {
        sendJson(res, 400, { error: 'Missing valid BIM spec.' });
        return true;
      }
      const projectBrain = ensureProjectBrain(payload.projectBrain || currentState.projectBrain, spec);
      const contextPacket = payload.contextPacket || buildContextPacket(spec, projectBrain, payload.selected, payload.prompt);
      const plan = payload.plan || await aiPlan({ ...payload, projectBrain, contextPacket });
      const report = applyBimOperations(spec, plan);
      const nextBrain = updateProjectBrainAfterOperation(projectBrain, report.spec, {
        prompt: payload.prompt || plan.summary || 'Backend BIM operation',
        source: report.source || plan.source || 'planner',
        beforeRevision: spec.revision,
        afterRevision: report.spec.revision,
        actions: report.actions || [],
        changedIds: report.changedIds || [],
        issues: report.issues || [],
        summary: report.summary
      });
      let nextState = {
        ...currentState,
        projectId: currentState.projectId || DEFAULT_PROJECT_ID,
        spec: report.spec,
        projectBrain: nextBrain,
        savedAt: currentState.savedAt || new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      };
      if (payload.persist !== false) {
        const saved = await saveProjectState(nextState, { projectId: nextState.projectId || DEFAULT_PROJECT_ID });
        nextState = saved.state;
      }
      sendJson(res, 200, {
        ok: true,
        plan,
        report,
        state: nextState
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error?.message || String(error)
      });
    }
    return true;
  }

  return false;
}
