import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from '../modules/health/health.routes.js';
import { registerNotificationTestRoutes } from '../modules/notifications/notification-test.routes.js';
import { internalAuthPlugin } from '../modules/security/internal-auth.plugin.js';

export async function registerRoutes(app: FastifyInstance) {
  await registerHealthRoutes(app);

  // Prepare internal namespace: all future /internal routes require internal auth.
  await app.register(async (internalApp) => {
    await internalAuthPlugin(internalApp, {});
    await registerNotificationTestRoutes(internalApp);
  }, { prefix: '/internal' });
}
