import { TimeOfDayAdapter } from './time-of-day-adapter';

describe('TimeOfDayAdapter', () => {
  const adapter = new TimeOfDayAdapter();

  it('parses typed times to HH:MM', () => {
    expect(adapter.parseTime('06:30')).toBe('06:30');
    expect(adapter.parseTime(' 7:05 ')).toBe('07:05');
    expect(adapter.parseTime('23:59:30')).toBe('23:59');
    expect(adapter.parseTime('')).toBeNull();
    expect(adapter.isValid(adapter.parseTime('24:00') ?? '')).toBe(false);
    expect(adapter.isValid(adapter.parseTime('noon') ?? '')).toBe(false);
  });

  it('builds and compares times', () => {
    expect(adapter.setTime('12:00', 9, 5)).toBe('09:05');
    expect(adapter.compareTime('09:05', '10:00')).toBeLessThan(0);
    expect(adapter.sameTime('09:05', '09:05')).toBe(true);
  });

  it('stops at the end of the day when adding', () => {
    expect(adapter.addSeconds('23:30', 15 * 60)).toBe('23:45');
    expect(adapter.isValid(adapter.addSeconds('23:45', 15 * 60))).toBe(false);
  });
});
