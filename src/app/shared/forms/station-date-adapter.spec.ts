import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { StationTimeService } from '../../core/time/station-time.service';
import { STATION_DATE_FORMATS, StationDateAdapter } from './station-date-adapter';

describe('StationDateAdapter', () => {
  let adapter: StationDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), StationDateAdapter],
    });
    adapter = TestBed.inject(StationDateAdapter);
    TestBed.tick();
  });

  afterEach(() => vi.useRealTimers());

  it('reads the parts of a station date', () => {
    expect(adapter.getYear('2026-10-15')).toBe(2026);
    expect(adapter.getMonth('2026-10-15')).toBe(9);
    expect(adapter.getDate('2026-10-15')).toBe(15);
    expect(adapter.getDayOfWeek('2026-10-15')).toBe(4);
    expect(adapter.getNumDaysInMonth('2028-02-10')).toBe(29);
  });

  it('creates dates and refuses impossible ones', () => {
    expect(adapter.createDate(2026, 0, 5)).toBe('2026-01-05');
    expect(() => adapter.createDate(2026, 1, 30)).toThrow();
  });

  it('adds months, years, and days across month and year ends', () => {
    expect(adapter.addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(adapter.addCalendarMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(adapter.addCalendarYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(adapter.addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('parses only YYYY-MM-DD', () => {
    expect(adapter.parse('2026-10-15')).toBe('2026-10-15');
    expect(adapter.parse('')).toBeNull();
    expect(adapter.isValid(adapter.parse('2026-02-30') ?? '')).toBe(false);
    expect(adapter.isValid(adapter.parse('15.10.2026') ?? '')).toBe(false);
  });

  it('formats the field as YYYY-MM-DD and labels in the language, without a zone shift', () => {
    expect(adapter.format('2026-10-15', STATION_DATE_FORMATS.display.dateInput)).toBe('2026-10-15');
    expect(adapter.format('2026-10-01', STATION_DATE_FORMATS.display.monthYearA11yLabel)).toBe(
      'October 2026',
    );
    expect(adapter.getDayOfWeekNames('short')[0]).toBe('Sun');
  });

  it('takes today from the station zone, not the browser', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T21:30:00Z'));
    TestBed.inject(StationTimeService).setZone('Asia/Yerevan');
    expect(adapter.today()).toBe('2026-10-16');
  });
});
