import http from 'node:http';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { PORT } from './backend/config.mjs';
import { isApiOptions, sendJson } from './backend/http.mjs';
import { handleApiRoute } from './backend/routes.mjs';

// Durable trace regardless of how stdout/stderr were redirected — the one
// place to look when the app misbehaves (.data/server-errors.log).
function logServerError(label, error) {
  try {
    fs.mkdirSync('.data', { recursive: true });
    fs.appendFileSync('.data/server-errors.log', `${new Date().toISOString()} ${label} ${error?.stack || error}\n`);
  } catch { /* logging must never break serving */ }
}

// The server is someone's live design session. A stray exception outside a
// route (a timer, an unawaited promise, a spawn callback) exits the Node
// process by default — the engine then dies SILENTLY while the browser tab
// stays open, and every edit fails with "Failed to fetch". Log and keep
// serving instead.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (server kept alive):', error);
  logServerError('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server kept alive):', reason);
  logServerError('unhandledRejection', reason);
});

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: { port: PORT + 20000 },
    // The app is reviewed/shared through forwarded HTTPS URLs (GitHub
    // Codespaces ports, tunnels). Vite 6.0.9+ host-checks dev requests and
    // would answer "Blocked request. This host is not allowed." — the server
    // already binds 127.0.0.1, so forwarding is an explicit, deliberate act.
    allowedHosts: true
  },
  appType: 'spa'
});

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname;
  if (isApiOptions(req, pathname)) {
    sendJson(res, 204, {});
    return;
  }
  if (pathname.startsWith('/api/')) {
    // A route error must NEVER take the whole server down — the app is
    // someone's live design session. Answer 500 and keep serving.
    try {
      const handled = await handleApiRoute(req, res, pathname);
      if (!handled) sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error(`API ${pathname} failed:`, error);
      logServerError(pathname, error);
      if (!res.headersSent) sendJson(res, 500, { error: String(error?.message || error) });
      else try { res.end(); } catch { /* connection already gone */ }
    }
    return;
  }
  vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Natural Building Design Dashboard running at http://127.0.0.1:${PORT}/`);
});
