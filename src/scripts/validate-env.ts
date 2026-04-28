import { getEnv } from '../config/env.js';

const env = getEnv();

console.log('Environment is valid for Phase 1.', {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  workerEnabled: env.WORKER_ENABLED
});
