import { describe, expect, it } from 'vitest';
import {
  buildDriverJobAcceptedPushMessage,
  buildDriverPushMessage,
  formatDriverPayoutWholePence,
  formatPenceLikeJobCard,
  formatPayout
} from '../../src/modules/notifications/driver-push.formatter.js';

describe('driver-push.formatter', () => {
  it('formats GBP payout with pound symbol', () => {
    expect(formatPayout(11835, 'GBP')).toBe('£118.35');
  });

  it('formats driver payout like JobCard toFixed(0)', () => {
    expect(formatPenceLikeJobCard(10900)).toBe('109');
    expect(formatDriverPayoutWholePence(10900, 'GBP')).toBe('£109');
    expect(formatDriverPayoutWholePence(66900, 'GBP')).toBe('£669');
    expect(formatDriverPayoutWholePence(37200, 'GBP')).toBe('£372');
  });

  it('builds one-way push like JobCard (ref at end, pax, bags)', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-000677',
      bookingType: 'oneway',
      pickupAddress: 'HP11 • High Wycombe',
      dropoffAddress: 'LU5 • Dunstable',
      scheduledAt: '2026-05-31T09:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'mercedes-s-class',
      payoutDisplay: '£109',
      distanceMiles: 44,
      durationMin: 47,
      stopsCount: 0,
      passengerCount: 2,
      bagCount: 3,
      urgency: 'Pre-Book'
    });

    expect(result.title).toContain('£109');
    expect(result.message).toMatch(/^One way · Pre-Book/);
    expect(result.message).toContain('🟢 HP11 • High Wycombe');
    expect(result.message).toContain('44 mi · 47 min · 0 stops');
    expect(result.message).toContain('2 passengers · 3 bags');
    expect(result.message).toContain('Luxury · Mercedes S Class');
    expect(result.message.trimEnd().endsWith('CB-000677')).toBe(true);
    expect(result.message).not.toContain('CB-000677 ·');
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
      stopsCount: 1,
      urgency: 'Pre-Book'
    });

    expect(result.title).toContain('£372');
    expect(result.message).toContain('£312 + £60 extras');
    expect(result.message).toContain('54.98 mi · 117 min · 1 stop');
    expect(result.message.trimEnd().endsWith('CB-000674')).toBe(true);
  });

  it('buildDriverJobAcceptedPushMessage uses Job confirmed title', () => {
    const accepted = buildDriverJobAcceptedPushMessage({
      bookingReference: 'CB-1',
      bookingType: 'oneway',
      pickupAddress: 'A',
      dropoffAddress: 'B',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'exec',
      vehicleModelId: null,
      payoutDisplay: '£10',
      urgency: 'ASAP'
    });
    expect(accepted.title).toMatch(/^Job confirmed/);
    expect(accepted.message.trimEnd().endsWith('CB-1')).toBe(true);
  });

  it('hourly: no miles line, shows hours booked', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-HOURLY-1',
      bookingType: 'hourly',
      pickupAddress: 'LHR Terminal 2',
      dropoffAddress: '',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'executive',
      vehicleModelId: 'mercedes-e-class',
      payoutDisplay: '£220',
      hoursRequested: 4,
      urgency: 'Pre-Book'
    });

    expect(result.message).toContain('Hourly · Pre-Book');
    expect(result.message).toContain('4 hours booked');
    expect(result.message).not.toContain(' mi ·');
    expect(result.message.trimEnd().endsWith('CB-HOURLY-1')).toBe(true);
  });

  it('fleet summary line', () => {
    const result = buildDriverPushMessage({
      bookingReference: 'CB-FLEET-1',
      bookingType: 'fleet',
      pickupAddress: 'Gatwick',
      dropoffAddress: 'Chelsea',
      scheduledAt: '2026-05-05T12:00:00Z',
      vehicleCategoryId: 'luxury',
      vehicleModelId: 'mercedes-s-class',
      payoutDisplay: '£500',
      legNumber: 1,
      fleetTotalLegs: 20,
      urgency: 'Pre-Book'
    });

    expect(result.message).toContain('Fleet · 20 vehicles');
    expect(result.message.trimEnd().endsWith('CB-FLEET-1')).toBe(true);
  });
});
