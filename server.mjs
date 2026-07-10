import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { PORT } from './backend/config.mjs';
import { isApiOptions, sendJson } from './backend/http.mjs';
import { handleApiRoute } from './backend/routes.mjs';

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
      // Durable trace regardless of how stdout/stderr were redirected — the
      // one place to look when the app says "failed with HTTP 500".
      try {
        const fs = await import('node:fs');
        fs.mkdirSync('.data', { recursive: true });
        fs.appendFileSync('.data/server-errors.log', `${new Date().toISOString()} ${pathname} ${error?.stack || error}\n`);
      } catch { /* logging must never break serving */ }
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
