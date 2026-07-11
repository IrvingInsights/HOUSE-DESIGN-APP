import { aiPlan } from './planner.mjs';
import { ensureBlenderRunning } from './blender-launcher.mjs';
import { annualRainInches, geoSearch } from './geo.mjs';
import { readJson, sendJson } from './http.mjs';
import { DEFAULT_PROJECT_ID } from './config.mjs';
import { listDesigns, listProjects, loadProjectRevisions, loadProjectState, restoreRevision, saveProjectState } from './project-store.mjs';
import { applyBimOperations } from './bim-core.mjs';
import { buildContextPacket, ensureProjectBrain, updateProjectBrainAfterOperation } from './project-brain-service.mjs';
import { respondFromStudioAgent } from './studio-agent-service.mjs';
import { getTraceJob, startTraceJob } from './trace-jobs.mjs';

// The one true apply path: plan (if needed) -> apply ops -> update the project
// brain -> persist. Both the synchronous POST /api/bim/apply route and the
// async trace-job path run THIS function, so saving and the response shape are
// identical no matter how the request arrived.
async function runBimApply(payload) {
  const currentState = payload.state || {};
  const spec = payload.bim || payload.spec || currentState.spec;
  if (!spec?.shell || !Array.isArray(spec?.rooms)) {
    const invalid = new Error('Missing valid BIM spec.');
    invalid.statusCode = 400;
    throw invalid;
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
  return { ok: true, plan, report, state: nextState };
}

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

  if (req.method === 'GET' && pathname === '/api/projects/current/designs') {
    sendJson(res, 200, { designs: await listDesigns(DEFAULT_PROJECT_ID) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/projects/current/restore') {
    try {
      const payload = await readJson(req);
      const result = await restoreRevision(payload?.file, DEFAULT_PROJECT_ID);
      sendJson(res, 200, { ok: true, projectId: result.projectId, state: result.state });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message || error) });
    }
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

  if (req.method === 'GET' && pathname === '/api/geo/search') {
    try {
      const query = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      if (query.trim().length < 2) {
        sendJson(res, 400, { results: [], error: 'Give me at least two characters to search.' });
        return true;
      }
      sendJson(res, 200, { results: await geoSearch(query) });
    } catch (error) {
      sendJson(res, 502, { results: [], error: error?.message || 'Geocoder unreachable.' });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/geo/rain') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const lat = Number(params.get('lat'));
      const lon = Number(params.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        sendJson(res, 400, { error: 'lat and lon are required.' });
        return true;
      }
      sendJson(res, 200, { rainInYr: await annualRainInches(lat, lon) });
    } catch (error) {
      sendJson(res, 502, { error: error?.message || 'Climate archive unreachable.' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/blender/ensure') {
    try {
      const result = await ensureBlenderRunning();
      sendJson(res, result.running ? 200 : 503, result);
    } catch (error) {
      sendJson(res, 500, { running: false, started: false, error: error?.message || String(error) });
    }
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
      if (payload?.async === true) {
        // Async mode: kick the job off and answer immediately with the jobId
        // so the browser never sits on a multi-minute request. jobMode gives
        // the planner's self-check loop a full budget — no fetch to outlive.
        const { jobId } = startTraceJob((note) => runBimApply({
          ...payload,
          async: false,
          jobMode: true,
          auditBudgetMs: Number(payload.auditBudgetMs) || 480000,
          onNote: note
        }));
        sendJson(res, 200, { ok: true, jobId });
        return true;
      }
      sendJson(res, 200, await runBimApply(payload));
    } catch (error) {
      if (error?.statusCode === 400) {
        sendJson(res, 400, { error: error.message });
      } else {
        sendJson(res, 500, {
          ok: false,
          error: error?.message || String(error)
        });
      }
    }
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/bim/job/')) {
    const jobId = decodeURIComponent(pathname.slice('/api/bim/job/'.length));
    const job = getTraceJob(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'No such job — the engine may have restarted since it was started.' });
      return true;
    }
    sendJson(res, 200, {
      status: job.status,
      notes: job.notes,
      startedAt: job.startedAt,
      ...(job.status === 'done' ? { result: job.result } : {}),
      ...(job.status === 'error' ? { error: job.error } : {})
    });
    return true;
  }

  return false;
}
