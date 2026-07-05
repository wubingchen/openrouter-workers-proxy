import type { MiddlewareHandler } from 'hono';
import { randomId } from '../utils/common';

export const requestContextMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('x-request-id') || randomId('req');
  c.set('requestId', requestId);
  await next();
  c.header('x-request-id', requestId);
};
