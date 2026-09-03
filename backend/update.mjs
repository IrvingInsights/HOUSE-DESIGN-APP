// Self-update: the app checks GitHub for newer work and applies it on one
// tap — nobody should have to close a window and double-click start.bat to
// get a fix.
//
// A build once sat 8 real updates behind with zero warning — not because
// nothing was wrong, but because "couldn't verify" and "confirmed current"
// both collapsed to the same silent `{behind: 0}`, which the UI then didn't
// show at all either way. Both bugs are fixed now: this always reports
// WHICH of the two happened (`checked: true/false`, with a `reason` when
// false), and the UI (below, in App.jsx) renders that status permanently
// next to the version stamp — never only when something's already wrong.
import { execFile } from 'node:child_process';

const git = (args) => new Promise((resolve) => {
  execFile('git', args, { timeout: 30000 }, (err, stdout, stderr) => {
    resolve({ err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
  });
});

// `@{u}` (the upstream-tracking ref) only resolves if this clone's `main` was
// ever set up to track `origin/main` — a manual clone/checkout easily skips
// that step. `origin/main` by name needs no tracking config at all, so it
// can't go blind the same way.
export async function checkForUpdate() {
  const fetched = await git(['fetch', '--quiet', 'origin', 'main']);
  if (fetched.err) {
    const reason = /enoent|not recognized|not found/i.test(fetched.err.message || '') ? 'no-git' : 'offline';
    return { checked: false, behind: 0, reason };
  }
  const count = await git(['rev-list', '--count', 'HEAD..origin/main']);
  if (count.err) return { checked: false, behind: 0, reason: 'no-history' };
  const behind = Number(count.stdout) || 0;
  if (!behind) return { checked: true, behind: 0 };
  // The newest commit is very often a GitHub merge commit — "Merge pull
  // request #19 from irvinginsights/claude/some-branch-name" — which is
  // exactly what showed in the update banner instead of anything a person
  // would want to read (Daniel, Aug 2). Every real change in this repo is
  // titled "update N: ...", so prefer the newest one of those within the
  // behind range; only a merge subject exists at all as the fallback.
  const titled = await git(['log', '--format=%s', 'HEAD..origin/main']);
  const latestTitled = titled.stdout.split('\n').find((line) => /^update \d+:/.test(line));
  const latest = latestTitled || (await git(['log', '-1', '--format=%s', 'origin/main'])).stdout || '';
  return { checked: true, behind, latest };
}

export async function applyUpdate() {
  const before = (await git(['rev-parse', 'HEAD'])).stdout;
  // A folder parked on a side branch is not "current" just because that
  // branch has nothing new: the work lives on main. Move there first when it
  // is safe (nothing unsaved); otherwise say so in one sentence and stop.
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
  if (branch && branch !== 'main') {
    const dirty = (await git(['status', '--porcelain'])).stdout;
    if (dirty) return { ok: false, error: `This folder is on the side branch "${branch}" and has unsaved changes. Run push-to-github.bat to save them, then update again.` };
    const moved = await git(['checkout', 'main']);
    if (moved.err) return { ok: false, error: moved.stderr || 'could not switch to the main line' };
  }
  let pulled = await git(['pull', '--ff-only', 'origin', 'main']);
  if (pulled.err && /would be overwritten|commit your changes|move or remove them/i.test(`${pulled.stderr}\n${pulled.stdout}`)) {
    // A stray local file edit must never brick the one-tap update. Stash it
    // (kept, never deleted — recoverable with `git stash pop`) and retry.
    const stashed = await git(['stash', 'push', '--include-untracked', '-m', 'auto-stash before self-update']);
    if (!stashed.err) pulled = await git(['pull', '--ff-only', 'origin', 'main']);
  }
  if (pulled.err) return { ok: false, error: pulled.stderr || pulled.stdout || 'update failed' };
  const after = (await git(['rev-parse', 'HEAD'])).stdout;
  if (!before || before === after) return { ok: true, changed: false, restarting: false };
  const diff = await git(['diff', '--name-only', `${before}..${after}`]);
  const files = diff.stdout.split('\n').filter(Boolean);
  // Frontend files are served fresh from disk on the next reload; only the
  // engine itself (backend/, server.mjs, deps) is cached in the running Node
  // process. For those, exit — the start.bat loop restarts us on new code.
  const needsRestart = files.some((f) => f.startsWith('backend/') || f === 'server.mjs' || f === 'package.json');
  if (needsRestart) setTimeout(() => process.exit(0), 800);
  return { ok: true, changed: true, restarting: needsRestart, files: files.length };
}
