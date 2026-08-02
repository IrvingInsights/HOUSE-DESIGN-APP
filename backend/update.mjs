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
  const latest = await git(['log', '-1', '--format=%s', 'origin/main']);
  return { checked: true, behind, latest: latest.stdout || '' };
}

export async function applyUpdate() {
  const before = (await git(['rev-parse', 'HEAD'])).stdout;
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
