import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { PORT } from './backend/config.mjs';
import { isApiOptions, sendJson } from './backend/http.mjs';
import { handleApiRoute } from './backend/routes.mjs';

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: { port: PORT + 20000 }
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
    const handled = await handleApiRoute(req, res, pathname);
    if (!handled) sendJson(res, 404, { error: 'Not found' });
    return;
  }
  vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Natural Building Design Dashboard running at http://127.0.0.1:${PORT}/`);
});
