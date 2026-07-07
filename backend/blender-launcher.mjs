// One-click Blender: if the add-on server (port 8000) isn't running, spawn a
// headless Blender with tools/blender_headless_server.py and wait for it to
// come up. Used by POST /api/blender/ensure so the app's "Sync to Blender" /
// "Export IFC" buttons work with nothing pre-launched.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLENDER_STATUS_URL = 'http://localhost:8000/api/ai-status';
const HARNESS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'blender_headless_server.py');

const BLENDER_CANDIDATES = [
  process.env.BLENDER_EXE,
  'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe'
].filter(Boolean);

async function probe(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BLENDER_STATUS_URL, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let launching = null;

export async function ensureBlenderRunning() {
  if (await probe()) return { running: true, started: false };

  // Only one launch at a time; concurrent ensure calls share it.
  launching ||= (async () => {
    const exe = BLENDER_CANDIDATES.find((candidate) => existsSync(candidate));
    if (!exe) {
      return { running: false, started: false, error: 'Blender not found. Set BLENDER_EXE or install Blender under Program Files.' };
    }
    const child = spawn(exe, ['--background', '--python', HARNESS_PATH, '--', '60'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Blender takes a while to boot + register add-ons; poll up to 45 s.
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (await probe()) return { running: true, started: true };
    }
    return { running: false, started: true, error: 'Blender was launched but its server did not come up within 45 s.' };
  })();

  try {
    return await launching;
  } finally {
    launching = null;
  }
}
