// Self-update: the app checks GitHub for newer work and applies it on one
// tap — nobody should have to close a window and double-click start.bat to
// get a fix. Everything fails SOFT: no git, no connection, no upstream —
// the check just says "nothing new" and the app keeps working.
import { execFile } from 'node:child_process';

const git = (args) => new Promise((resolve) => {
  execFile('git', args, { timeout: 30000 }, (err, stdout, stderr) => {
    resolve({ err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
  });
});

export async function checkForUpdate() {
  const fetched = await git(['fetch', '--quiet']);
  if (fetched.err) return { behind: 0 };
  const count = await git(['rev-list', '--count', 'HEAD..@{u}']);
  const behind = count.err ? 0 : Number(count.stdout) || 0;
  if (!behind) return { behind: 0 };
  const latest = await git(['log', '-1', '--format=%s', '@{u}']);
  return { behind, latest: latest.stdout || '' };
}

export async function applyUpdate() {
  const before = (await git(['rev-parse', 'HEAD'])).stdout;
  const pulled = await git(['pull', '--ff-only']);
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
