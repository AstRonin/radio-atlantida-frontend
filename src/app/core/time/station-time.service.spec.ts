import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StationTimePipe } from './station-time.pipe';
import { DEFAULT_TIME_ZONE, StationTimeService, parseApiTime } from './station-time.service';

// ICU separates AM/PM with a narrow no-break space; compare with plain spaces.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('station time', () => {
  let time: StationTimeService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    time = TestBed.inject(StationTimeService);
  });

  it('parses UTC timestamps, including Go nanoseconds', () => {
    expect(parseApiTime('2026-10-13T20:05:00Z').toISOString()).toBe('2026-10-13T20:05:00.000Z');
    expect(parseApiTime('2026-10-13T20:05:00.123456789Z').getTime()).toBe(
      Date.UTC(2026, 9, 13, 20, 5, 0, 123),
    );
  });

  it('refuses timestamps that are not UTC instants', () => {
    expect(() => parseApiTime('2026-10-13T20:05:00+04:00')).toThrow();
    expect(() => parseApiTime('2026-10-13 20:05:00')).toThrow();
    expect(() => parseApiTime('2026-13-45T99:00:00Z')).toThrow();
  });

  it('formats in the station zone, not the browser zone', () => {
    expect(time.zone()).toBe(DEFAULT_TIME_ZONE);
    // 20:05 UTC is 00:05 the next day in Yerevan (UTC+04:00).
    expect(plain(time.format('2026-10-13T20:05:00Z', 'datetime'))).toBe('Oct 14, 2026, 12:05 AM');

    expect(time.setZone('UTC')).toBe(true);
    expect(plain(time.format('2026-10-13T20:05:00Z', 'time'))).toBe('8:05 PM');
  });

  it('ignores an unknown zone', () => {
    expect(time.setZone('Mars/Olympus')).toBe(false);
    expect(time.zone()).toBe(DEFAULT_TIME_ZONE);
  });

  it('shows empty and malformed values without failing', () => {
    const pipe = TestBed.runInInjectionContext(() => new StationTimePipe());
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('yesterday')).toBe('yesterday');
    expect(pipe.transform('2026-10-13T20:05:00Z', 'date')).toBe('Oct 14, 2026');
  });
});
