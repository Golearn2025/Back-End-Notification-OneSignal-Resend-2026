import { getSupabaseAdmin } from '../../config/supabase.js';

type DbClient = any;

export type ResolveDriverPushIdentityInput = {
  organizationId: string;
  driverId: string;
};

export type ResolveDriverPushIdentityResult = {
  externalUserId: string;
  resolvedViaFallback: boolean;
  subscriptionId: string | null;
};

export class PushSubscriptionResolverService {
  constructor(private readonly db: DbClient = getSupabaseAdmin()) {}

  async resolveDriverPushIdentity(
    input: ResolveDriverPushIdentityInput
  ): Promise<ResolveDriverPushIdentityResult> {
    const { data: driver, error: driverError } = await this.db
      .from('drivers')
      .select('auth_user_id')
      .eq('id', input.driverId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();

    if (driverError) {
      throw new Error(`Failed to load driver auth_user_id: ${driverError.message}`);
    }

    const authUserId = driver?.auth_user_id as string | null | undefined;
    if (!authUserId) {
      throw new Error('Driver has no auth_user_id; cannot resolve OneSignal external_user_id');
    }

    const { data: subscription, error: subscriptionError } = await this.db
      .from('push_subscriptions')
      .select('id, external_user_id')
      .eq('organization_id', input.organizationId)
      .eq('recipient_type', 'driver')
      .eq('app_surface', 'driver_app')
      .eq('provider', 'onesignal')
      .eq('external_user_id', authUserId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error(`Failed to resolve push_subscriptions identity: ${subscriptionError.message}`);
    }

    if (subscription?.external_user_id) {
      return {
        externalUserId: subscription.external_user_id,
        resolvedViaFallback: false,
        subscriptionId: subscription.id ?? null
      };
    }

    return {
      externalUserId: authUserId,
      resolvedViaFallback: true,
      subscriptionId: null
    };
  }
}
