import { describe, expect, it } from 'vitest';
import { buildBookingLines } from '../../src/modules/notifications/notification-test.routes.js';

function baseContext() {
  return {
    organization_id: '9a5caade-4791-4860-93b5-12b1c4fa9830',
    booking_id: '11111111-1111-1111-1111-111111111111',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_first_name: 'Test',
    customer_email: 'test@example.com',
    booking_reference: 'CB-000001',
    booking_type: 'oneway',
    passenger_count: 2,
    bag_count: 1,
    hours_requested: null,
    days_requested: null,
    first_scheduled_at: '2026-04-27T18:30:00.000Z',
    return_scheduled_at: null,
    legs_json: [],
    fleet_vehicle_count: null,
    fleet_category_summary: null,
    amount_pence: 12345,
    amount_formatted: 'GBP 123.45',
    currency: 'GBP',
    payment_date: '2026-04-27T18:30:00.000Z',
    invoice_number: 'INV-001',
    receipt_url: 'https://example.com',
    payment_method_raw_or_metadata: 'full',
    vehicle_category_id: 'luxury',
    vehicle_model_id: 'bmw-7-series',
    trip_configuration_raw: null
  };
}

describe('buildBookingLines', () => {
  it('handles oneway', () => {
    const context = {
      ...baseContext(),
      booking_type: 'oneway',
      legs_json: [
        {
          leg_number: 1,
          pickup_address: 'Heathrow',
          dropoff_address: 'The Ritz',
          scheduled_at: '2026-04-27T18:30:00.000Z'
        }
      ]
    };
    const lines = buildBookingLines(context);
    expect(lines[0]).toEqual({ label: 'Booking Type', value: 'One Way' });
    expect(lines[3]?.value).toContain('Heathrow -> The Ritz');
  });

  it('handles return', () => {
    const context = {
      ...baseContext(),
      booking_type: 'return',
      return_scheduled_at: '2026-04-30T14:00:00.000Z',
      legs_json: [
        {
          leg_number: 1,
          pickup_address: 'Heathrow',
          dropoff_address: 'The Ritz',
          scheduled_at: '2026-04-27T18:30:00.000Z'
        },
        {
          leg_number: 2,
          pickup_address: 'The Ritz',
          dropoff_address: 'Heathrow',
          scheduled_at: '2026-04-30T14:00:00.000Z'
        }
      ]
    };
    const lines = buildBookingLines(context);
    expect(lines[0]).toEqual({ label: 'Booking Type', value: 'Return' });
    expect(lines[4]?.value).toContain('The Ritz -> Heathrow');
  });

  it('handles fleet', () => {
    const context = {
      ...baseContext(),
      booking_type: 'fleet',
      fleet_vehicle_count: 6,
      fleet_category_summary: 'executive x2, luxury x2, mpv x1, suv x1',
      trip_configuration_raw: {
        baseServiceType: 'hourly'
      }
    };
    const lines = buildBookingLines(context);
    expect(lines[0]).toEqual({ label: 'Booking Type', value: 'Fleet' });
    expect(lines[4]?.value).toBe('executive x2, luxury x2, mpv x1, suv x1');
    expect(lines[5]?.value).toBe('hourly');
  });
});
