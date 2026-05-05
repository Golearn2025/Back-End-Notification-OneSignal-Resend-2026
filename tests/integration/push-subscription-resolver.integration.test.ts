import { beforeAll, describe, expect, it } from 'vitest';
import { PushSubscriptionResolverService } from '../../src/modules/notifications/push-subscription-resolver.service.js';
import {
  createServiceRoleClient,
  hasSupabaseCredentials,
  loadBackendEnvFromProcess
} from './integration-env.js';

describe.skipIf(!hasSupabaseCredentials())('PushSubscriptionResolverService (Supabase integration)', () => {
  let organizationId: string;
  let driverId: string;
  let client: ReturnType<typeof createServiceRoleClient>;

  beforeAll(async () => {
    loadBackendEnvFromProcess();
    client = createServiceRoleClient();
    const { data, error } = await client
      .from('drivers')
      .select('id, organization_id')
      .not('auth_user_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`drivers lookup failed: ${error.message}`);
    }
    if (!data?.id || !data.organization_id) {
      throw new Error('Need at least one driver with auth_user_id in the database for this integration test');
    }
    driverId = data.id as string;
    organizationId = data.organization_id as string;
  });

  it('resolves external_user_id from drivers / push_subscriptions', async () => {
    loadBackendEnvFromProcess();
    const resolver = new PushSubscriptionResolverService();
    const result = await resolver.resolveDriverPushIdentity({
      organizationId,
      driverId
    });
    expect(result.externalUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(typeof result.resolvedViaFallback).toBe('boolean');
  });
});
