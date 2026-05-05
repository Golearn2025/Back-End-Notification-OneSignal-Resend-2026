import { describe, expect, it } from 'vitest';
import {
  buildDriverJobAcceptedPushMessage,
  buildDriverPushMessage,
  formatPayout
} from '../../src/modules/notifications/driver-push.formatter.js';

describe('driver-push.formatter', () => {
  it('formats GBP payout with pound symbol', () => {
    expect(formatPayout(11835, 'GBP')).toBe('£118.35');
  });

  it('builds compact title and non-duplicated message sections', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-000569',
      bookingType: 'oneway',
      pickupAddress: 'Ruislip HA4, UK',
      dropoffAddress: 'Hayes UB4 0SL, UK',
      scheduledAt: '2026-04-24T03:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'bmw-7-series',
      payoutDisplay: '£118.35'
    });

    expect(result.title).toContain('New job');
    expect(result.title).toContain('£118.35');
    expect(result.message).toContain('Pickup:');
    expect(result.message).toContain('Drop-off:');
    expect(result.message).toContain('When:');
    expect(result.message).toContain('Trip: One way');
    expect(result.message).toContain('Vehicle: Luxury / Bmw 7 Series');
    expect(result.message).toContain('Reference: CB-000569');
    expect(result.message).not.toContain('RATE:');
  });

  it('buildDriverJobAcceptedPushMessage uses Job confirmed title and same body as new job', () => {
    const accepted = buildDriverJobAcceptedPushMessage({
      bookingReference: 'CB-1',
      bookingType: 'oneway',
      pickupAddress: 'A',
      dropoffAddress: 'B',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'exec',
      vehicleModelId: null,
      payoutDisplay: '£10.00'
    });
    const available = buildDriverPushMessage({
      bookingReference: 'CB-1',
      bookingType: 'oneway',
      pickupAddress: 'A',
      dropoffAddress: 'B',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'exec',
      vehicleModelId: null,
      payoutDisplay: '£10.00'
    });
    expect(accepted.title).toMatch(/^Job confirmed/);
    expect(accepted.title).toContain('CB-1');
    expect(accepted.title).toContain('£10.00');
    expect(accepted.message).toBe(available.message);
  });
});
