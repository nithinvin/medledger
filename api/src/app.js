// Express application. Dependencies are injected so tests can supply a fake
// Fabric service (docs/design/application.md).
import express from 'express';
import { toHttpError } from './errors.js';
import { logger } from './logger.js';
import { loginHandler, requireAuth } from './middleware/auth.js';
import { auditRoutes } from './routes/audit.js';
import { fulfillmentRoutes } from './routes/fulfillments.js';
import { prescriptionRoutes } from './routes/prescriptions.js';

export function createApp({ fabric, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.use((req, res, next) => {
    res.on('finish', () => {
      logger.info('request', { method: req.method, path: req.path, status: res.statusCode, user: req.user?.username });
    });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/login', loginHandler(jwtSecret));

  const api = express.Router();
  api.use(requireAuth(jwtSecret));
  api.use(prescriptionRoutes(fabric));
  api.use(fulfillmentRoutes(fabric));
  api.use(auditRoutes(fabric));
  app.use('/api', api);

  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'no such endpoint' }));

  // Express 5 forwards async errors here.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'malformed JSON body' });
    }
    const { status, body } = toHttpError(err);
    if (status >= 500) {
      logger.error('request failed', { method: req.method, path: req.path, error: err.message });
    }
    res.status(status).json(body);
  });

  return app;
}
