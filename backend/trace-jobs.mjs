// In-memory store for long-running trace jobs. A browser gives up on a fetch
// after ~5 minutes of waiting for headers, but a full drawing takeoff with the
// self-check loop can legitimately take 6-8. So the apply route can run as a
// JOB instead: start it here, hand the client a jobId immediately, and let the
// client poll for progress notes and the finished result.
//
// Deliberately tiny: a Map, no persistence, no dependencies. Jobs die with the
// server process — the client treats a vanished job as "engine restarted, try
// again", which is exactly what happened.

const MAX_JOBS = 10;
const jobs = new Map(); // jobId -> { status, notes, result, error, startedAt }

let jobCounter = 0;

/**
 * Start a fire-and-forget job. `run` receives a `note(text)` callback it can
 * call at each stage; notes accumulate on the job for the client to poll.
 * Returns { jobId } synchronously — the work continues in the background.
 */
export function startTraceJob(run) {
  jobCounter += 1;
  const jobId = `trace-${Date.now().toString(36)}-${jobCounter.toString(36)}`;
  const job = { status: 'running', notes: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(jobId, job);
  pruneJobs();

  const note = (text) => {
    const line = String(text || '').trim();
    if (line) job.notes.push(line);
  };

  Promise.resolve()
    .then(() => run(note))
    .then((result) => {
      job.status = 'done';
      job.result = result;
    })
    .catch((error) => {
      job.status = 'error';
      job.error = error?.message || String(error);
    });

  return { jobId };
}

export function getTraceJob(jobId) {
  return jobs.get(jobId) || null;
}

// Keep only the last ~MAX_JOBS jobs. Never evict a job that is still running —
// its poller would see a false "engine restarted"; finished ones go oldest
// first (Map preserves insertion order).
function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status !== 'running') jobs.delete(id);
  }
}
