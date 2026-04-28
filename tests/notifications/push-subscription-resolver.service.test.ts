import { describe, expect, it } from 'vitest';
import { PushSubscriptionResolverService } from '../../src/modules/notifications/push-subscription-resolver.service.js';

function createDbMock(input: {
  driverAuthUserId: string | null;
  pushSubscription: { id: string; external_user_id: string } | null;
}) {
  return {
    from(table: string) {
      const state: Record<string, unknown> = {};
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          state[column] = value;
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          if (table === 'drivers') {
            return {
              data: input.driverAuthUserId ? { auth_user_id: input.driverAuthUserId } : { auth_user_id: null },
              error: null
            };
          }

          if (table === 'push_subscriptions') {
            const matchesExternal = state.external_user_id === input.driverAuthUserId;
            return {
              data: matchesExternal ? input.pushSubscription : null,
              error: null
            };
          }

          return { data: null, error: null };
        }
      };
    }
  };
}

describe('PushSubscriptionResolverService', () => {
  it('folosește push_subscriptions dacă există row activ', async () => {
    const db = createDbMock({
      driverAuthUserId: 'ba1cafee-bb73-43f9-80df-57138e4793fc',
      pushSubscription: {
        id: 'psub-1',
        external_user_id: 'ba1cafee-bb73-43f9-80df-57138e4793fc'
      }
    });

    const resolver = new PushSubscriptionResolverService(db as never);
    const result = await resolver.resolveDriverPushIdentity({
      organizationId: '9a5caade-4791-4860-93b5-12b1c4fa9830',
      driverId: 'd6748565-2f0f-4743-a3ec-d06c7aefc130'
    });

    expect(result.externalUserId).toBe('ba1cafee-bb73-43f9-80df-57138e4793fc');
    expect(result.resolvedViaFallback).toBe(false);
    expect(result.subscriptionId).toBe('psub-1');
  });

  it('face fallback la drivers.auth_user_id când nu există push_subscriptions', async () => {
    const db = createDbMock({
      driverAuthUserId: 'ba1cafee-bb73-43f9-80df-57138e4793fc',
      pushSubscription: null
    });

    const resolver = new PushSubscriptionResolverService(db as never);
    const result = await resolver.resolveDriverPushIdentity({
      organizationId: '9a5caade-4791-4860-93b5-12b1c4fa9830',
      driverId: 'd6748565-2f0f-4743-a3ec-d06c7aefc130'
    });

    expect(result.externalUserId).toBe('ba1cafee-bb73-43f9-80df-57138e4793fc');
    expect(result.resolvedViaFallback).toBe(true);
    expect(result.subscriptionId).toBeNull();
  });
});
