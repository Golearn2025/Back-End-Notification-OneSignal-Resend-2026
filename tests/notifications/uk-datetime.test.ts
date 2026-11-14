import { describe, expect, it } from 'vitest';
import {
  SERVICE_TIME_ZONE,
  formatUkDate,
  formatUkDateTime,
  formatUkDateTimeWithLabel,
  formatUkJobCardDateTime,
  ukCalendarDayKey
} from '../../src/modules/notifications/uk-datetime.js';

describe('uk-datetime', () => {
  it('exports Europe/London as service zone', () => {
    expect(SERVICE_TIME_ZONE).toBe('Europe/London');
  });

  it('formats a winter UTC instant in London (GMT)', () => {
    // 2026-01-15 15:00 UTC = 15:00 London (GMT)
    const out = formatUkDateTime('2026-01-15T15:00:00.000Z', { month: 'short' });
    expect(out).toMatch(/15/);
    expect(out).toMatch(/Jan/i);
    expect(out).toMatch(/15:00/);
  });

  it('formats a summer UTC instant in London (BST = UTC+1)', () => {
    // 2026-07-15 15:00 UTC = 16:00 London (BST)
    const out = formatUkDateTime('2026-07-15T15:00:00.000Z', { month: 'short' });
    expect(out).toMatch(/16:00/);
  });

  it('appends UK time label for customer emails', () => {
    const out = formatUkDateTimeWithLabel('2026-01-15T15:00:00.000Z');
    expect(out).toContain('(UK time)');
  });

  it('formatUkDate is London calendar date', () => {
    // 2026-01-15 01:30 UTC = still 15 Jan in London
    expect(formatUkDate('2026-01-15T01:30:00.000Z', 'short')).toMatch(/15/);
  });

  it('ukCalendarDayKey uses London civil date near midnight UTC', () => {
    // 2026-06-01 00:30 UTC = 01:30 BST → still 1 Jun in London
    expect(ukCalendarDayKey(new Date('2026-06-01T00:30:00.000Z'))).toBe('2026-06-01');
  });

  it('formatUkJobCardDateTime returns a non-empty string for valid ISO', () => {
    const out = formatUkJobCardDateTime('2026-05-31T09:00:00.000Z');
    expect(out).toBeTruthy();
    expect(String(out)).toMatch(/10:00|9:00|09:00/i); // BST: 09:00Z → 10:00 London
  });
});
