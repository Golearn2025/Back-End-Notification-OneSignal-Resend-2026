import { createApp } from './app/create-app.js';
import { getEnv } from './config/env.js';

async function bootstrap() {
  const env = getEnv();
  const app = await createApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

bootstrap().catch((error) => {
  console.error('Failed to start HTTP server', error);
  process.exit(1);
});
