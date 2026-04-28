import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../../config/env.js';

export async function assertInternalAuth(request: FastifyRequest, reply: FastifyReply) {
  const env = getEnv();
  const provided = request.headers['x-internal-api-secret'];

  if (provided !== env.INTERNAL_API_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized internal request' });
  }

  return null;
}

export const internalAuthPlugin: FastifyPluginAsync = async (app) => {
  // This plugin should be mounted only for internal route groups.
  app.addHook('onRequest', async (request, reply) => {
    const denied = await assertInternalAuth(request, reply);
    if (denied) {
      return denied;
    }
  });
};
