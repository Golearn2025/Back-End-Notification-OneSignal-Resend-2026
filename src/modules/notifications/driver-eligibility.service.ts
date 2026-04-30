import { getSupabaseAdmin } from '../../config/supabase.js';
import { asNonEmptyString } from './notification-shared.js';

type DbClient = any;

export type EligibleDriver = {
  driverId: string;
  authUserId: string;
};

export class DriverEligibilityService {
  constructor(private readonly db: DbClient = getSupabaseAdmin()) {}

  async resolveEligibleDrivers(input: {
    organizationId: string;
    vehicleCategoryId: string | null;
    vehicleModelId: string | null;
  }): Promise<EligibleDriver[]> {
    let vehiclesQuery = this.db
      .from('vehicles')
      .select('driver_id')
      .eq('status', 'active')
      .is('deleted_at', null)
      .eq('organization_id', input.organizationId);

    if (input.vehicleModelId) {
      vehiclesQuery = vehiclesQuery.eq('model_id', input.vehicleModelId);
    } else if (input.vehicleCategoryId) {
      vehiclesQuery = vehiclesQuery.eq('category_id', input.vehicleCategoryId);
    }

    const { data: matchingVehicles, error: matchingVehiclesError } = await vehiclesQuery;
    if (matchingVehiclesError) {
      throw new Error(`Failed to load matching vehicles: ${matchingVehiclesError.message}`);
    }

    const driverIds = Array.from(
      new Set((matchingVehicles ?? []).map((vehicle: any) => asNonEmptyString(vehicle.driver_id)).filter(Boolean))
    ) as string[];

    if (driverIds.length === 0) {
      return [];
    }

    const { data: eligibleDrivers, error: eligibleDriversError } = await this.db
      .from('drivers')
      .select('id, auth_user_id')
      .eq('organization_id', input.organizationId)
      .is('deleted_at', null)
      .in('id', driverIds)
      .not('auth_user_id', 'is', null);

    if (eligibleDriversError) {
      throw new Error(`Failed to load eligible drivers: ${eligibleDriversError.message}`);
    }

    return (eligibleDrivers ?? []).map((driver: any) => ({
      driverId: String(driver.id),
      authUserId: String(driver.auth_user_id)
    }));
  }

  async resolveActiveExternalUserIds(input: {
    organizationId: string;
    authUserIds: string[];
  }): Promise<Set<string>> {
    if (input.authUserIds.length === 0) {
      return new Set<string>();
    }
    const { data: subscriptions, error: subscriptionsError } = await this.db
      .from('push_subscriptions')
      .select('external_user_id')
      .eq('organization_id', input.organizationId)
      .eq('recipient_type', 'driver')
      .eq('app_surface', 'driver_app')
      .eq('provider', 'onesignal')
      .eq('is_active', true)
      .in('auth_user_id', input.authUserIds);

    if (subscriptionsError) {
      throw new Error(`Failed to load push_subscriptions: ${subscriptionsError.message}`);
    }

    return new Set(
      (subscriptions ?? [])
        .map((subscription: any) => asNonEmptyString(subscription.external_user_id))
        .filter((value: string | null): value is string => value !== null)
    );
  }

  async getLatestLegFinancial(input: {
    bookingLegId: string;
  }): Promise<{ driverPayoutPence: number | null; currency: string | null }> {
    const { data, error } = await this.db
      .from('internal_leg_financials')
      .select('driver_payout_pence, currency')
      .eq('booking_leg_id', input.bookingLegId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load leg financials: ${error.message}`);
    }

    const row = (data ?? null) as { driver_payout_pence?: number | null; currency?: string | null } | null;
    return {
      driverPayoutPence: row?.driver_payout_pence ?? null,
      currency: row?.currency ?? null
    };
  }
}
