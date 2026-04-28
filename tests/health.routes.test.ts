import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app/create-app.js';

describe('health route', () => {
  it('returns ok payload', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'backend-notifications'
    });

    await app.close();
  });
});
