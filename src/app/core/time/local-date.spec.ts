import { addDays, isLocalDate, stationToday, weekdayOf } from './local-date';

describe('local dates', () => {
  it('takes today in the station zone, not the browser zone', () => {
    // 21:30 UTC is already the next day in Yerevan (UTC+4).
    const now = new Date('2026-10-15T21:30:00Z');
    expect(stationToday('Asia/Yerevan', now)).toBe('2026-10-16');
    expect(stationToday('UTC', now)).toBe('2026-10-15');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts weekdays from Monday', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-18')).toBe(7);
  });

  it('refuses anything that is not a calendar date', () => {
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-10-15T00:00:00Z')).toBe(false);
    expect(() => addDays('15.10.2026', 1)).toThrow();
  });
});
