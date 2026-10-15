import {
  addDays,
  daysBetween,
  isLocalDate,
  stationMidnightUtc,
  stationToday,
  weekdayOf,
} from './local-date';

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

  it('counts the days between two dates', () => {
    expect(daysBetween('2026-10-15', '2026-10-21')).toBe(6);
    expect(daysBetween('2026-10-15', '2026-10-14')).toBe(-1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('finds the UTC instant of a station midnight', () => {
    expect(stationMidnightUtc('2026-10-15', 'Asia/Yerevan')).toBe('2026-10-14T20:00:00.000Z');
    expect(stationMidnightUtc('2026-10-15', 'Asia/Kolkata')).toBe('2026-10-14T18:30:00.000Z');
    expect(stationMidnightUtc('2026-10-15', 'UTC')).toBe('2026-10-15T00:00:00.000Z');
  });

  it('uses the offset in force on the day of a DST change', () => {
    // Berlin moves from UTC+2 to UTC+1 at 03:00 on 2026-10-25; midnight is still summer time.
    expect(stationMidnightUtc('2026-10-25', 'Europe/Berlin')).toBe('2026-10-24T22:00:00.000Z');
    expect(stationMidnightUtc('2026-10-26', 'Europe/Berlin')).toBe('2026-10-25T23:00:00.000Z');
    // New York moves from UTC-5 to UTC-4 at 02:00 on 2026-03-08.
    expect(stationMidnightUtc('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00.000Z');
    expect(stationMidnightUtc('2026-03-09', 'America/New_York')).toBe('2026-03-09T04:00:00.000Z');
  });
});
