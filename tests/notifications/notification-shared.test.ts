import { describe, expect, it } from 'vitest';
import { isDeliverySucceeded } from '../../src/modules/notifications/notification-shared.js';

describe('isDeliverySucceeded', () => {
  it('returns true for terminal success statuses', () => {
    expect(isDeliverySucceeded('provider_accepted')).toBe(true);
    expect(isDeliverySucceeded('delivered')).toBe(true);
    expect(isDeliverySucceeded('sent')).toBe(true);
  });

  it('returns false for retryable or pending statuses', () => {
    expect(isDeliverySucceeded('queued')).toBe(false);
    expect(isDeliverySucceeded('failed_retryable')).toBe(false);
    expect(isDeliverySucceeded('sending')).toBe(false);
  });
});
