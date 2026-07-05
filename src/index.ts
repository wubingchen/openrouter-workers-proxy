import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requestContextMiddleware } from './middleware/request-context';
import adminRoutes from './routes/admin';
import proxyRoutes from './routes/proxy';
import { jsonError } from './utils/common';

const app = new Hono<{ Bindings: Env }>();

app.use('*', requestContextMiddleware);

app.get('/api/healthz', (c) => {
  return c.json({
    success: true,
    requestId: c.get('requestId'),
    service: 'openrouter-workers-proxy',
    timestamp: new Date().toISOString(),
  });
});

app.route('/api/admin', adminRoutes);
app.route('/', proxyRoutes);

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return jsonError(c, 404, '接口不存在');
  }

  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error('[worker-error]', error);
  return jsonError(c, 500, '服务内部错误');
});

export default app;
