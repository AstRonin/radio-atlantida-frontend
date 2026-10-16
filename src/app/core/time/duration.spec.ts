import { PlannedLengthPipe } from './duration.pipe';
import { plannedLengthMs } from './duration';

describe('plannedLengthMs', () => {
  it('is the length between the in and out points', () => {
    expect(plannedLengthMs(20_000, 200_000)).toBe(180_000);
    expect(plannedLengthMs(0, 200_000)).toBe(200_000);
    expect(plannedLengthMs(undefined, 200_000)).toBe(200_000);
  });

  it('is unknown without an out point and never negative', () => {
    expect(plannedLengthMs(5_000, undefined)).toBeUndefined();
    expect(plannedLengthMs(9_000, 5_000)).toBe(0);
  });

  it('is shown by the pipe, a dash when unknown', () => {
    const pipe = new PlannedLengthPipe();
    expect(pipe.transform(200_000, 20_000)).toBe('3:00');
    expect(pipe.transform(undefined, 0)).toBe('—');
  });
});
