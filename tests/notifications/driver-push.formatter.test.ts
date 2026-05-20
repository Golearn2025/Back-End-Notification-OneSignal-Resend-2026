import { describe, expect, it } from 'vitest';
import {
  buildDriverJobAcceptedPushMessage,
  buildDriverPushMessage,
  formatDriverPayoutWholePence,
  formatPayout
} from '../../src/modules/notifications/driver-push.formatter.js';

describe('driver-push.formatter', () => {
  it('formats GBP payout with pound symbol', () => {
    expect(formatPayout(11835, 'GBP')).toBe('£118.35');
  });

  it('formats driver payout rounded to whole pounds', () => {
    expect(formatDriverPayoutWholePence(66900, 'GBP')).toBe('£669');
    expect(formatDriverPayoutWholePence(37200, 'GBP')).toBe('£372');
  });

  it('builds compact title and job-card style message', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-000676',
      bookingType: 'oneway',
      pickupAddress: 'HP11 • High Wycombe',
      dropoffAddress: 'LU5 • Dunstable',
      scheduledAt: '2026-05-31T09:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'mercedes-s-class',
      payoutDisplay: '£669',
      distanceMiles: 170,
      durationMin: 209,
      stopsCount: 0
    });

    expect(result.title).toContain('New job');
    expect(result.title).toContain('£669');
    expect(result.message).toContain('CB-000676 · One way');
    expect(result.message).toContain('🟢 HP11 • High Wycombe');
    expect(result.message).toContain('🔴 LU5 • Dunstable');
    expect(result.message).toContain('170 mi · 209 min · 0 stops');
    expect(result.message).not.toContain('Pickup:');
    expect(result.message).not.toContain('Reference:');
  });

  it('shows payout breakdown when extras present', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-000674',
      bookingType: 'oneway',
      pickupAddress: 'W1S • London',
      dropoffAddress: 'STN · Stansted',
      scheduledAt: '2026-05-31T09:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'mercedes-s-class',
      payoutDisplay: '£372',
      payoutBreakdownLine: '£312 + £60 extras',
      distanceMiles: '54.98',
      durationMin: 117,
      stopsCount: 1
    });

    expect(result.title).toContain('£372');
    expect(result.message).toContain('£312 + £60 extras');
    expect(result.message).toContain('54.98 mi · 117 min · 1 stop');
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
      payoutDisplay: '£10'
    });
    const available = buildDriverPushMessage({
      bookingReference: 'CB-1',
      bookingType: 'oneway',
      pickupAddress: 'A',
      dropoffAddress: 'B',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'exec',
      vehicleModelId: null,
      payoutDisplay: '£10'
    });
    expect(accepted.title).toMatch(/^Job confirmed/);
    expect(accepted.title).toContain('CB-1');
    expect(accepted.title).toContain('£10');
    expect(accepted.message).toBe(available.message);
  });

  it('adds duration line for hourly bookings', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-HOURLY-1',
      bookingType: 'hourly',
      pickupAddress: 'LHR Terminal 2',
      dropoffAddress: '',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'executive',
      vehicleModelId: 'mercedes-e-class',
      payoutDisplay: '£220',
      hoursRequested: 4
    });

    expect(result.message).toContain('Duration: 4 hours');
    expect(result.message).toContain('CB-HOURLY-1 · Hourly');
  });

  it('adds fleet summary line when fleet total legs is known', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-FLEET-1',
      bookingType: 'fleet',
      pickupAddress: 'Gatwick',
      dropoffAddress: 'Chelsea',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'mercedes-s-class',
      payoutDisplay: null,
      legNumber: 1,
      fleetTotalLegs: 20
    });

    expect(result.message).toContain('Fleet dispatch: 20 vehicles');
    expect(result.message).toContain('CB-FLEET-1 · Fleet');
  });
});
