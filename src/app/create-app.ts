import Fastify from 'fastify';
import { loggerOptions } from '../config/logger.js';
import { registerRoutes } from './routes.js';

export async function createApp() {
  const app = Fastify({ logger: loggerOptions });

  await registerRoutes(app);

  return app;
}
