import { Injectable, effect, inject } from '@angular/core';
import { DateAdapter, MatDateFormats } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { I18nService } from '../../core/i18n/i18n.service';
import { addDays, isLocalDate, stationToday } from '../../core/time/local-date';
import { StationTimeService } from '../../core/time/station-time.service';

/** What `invalid()` returns: a string, so it passes `isDateInstance`, that is never a date. */
const INVALID = 'invalid';
// 2024-01-07 was a Sunday, so day N of the week (0 = Sunday) is January 7 + N.
const SUNDAY_UTC = Date.UTC(2024, 0, 7);
const DAY_MS = 86_400_000;

type DisplayFormat = 'iso' | Intl.DateTimeFormatOptions;

/**
 * The field shows and reads `YYYY-MM-DD`, the form the API uses, so typed dates are never read in
 * a locale's order; the calendar's labels are in the active language.
 */
export const STATION_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'iso' },
  display: {
    dateInput: 'iso',
    monthYearLabel: { year: 'numeric', month: 'short' },
    dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' },
    monthYearA11yLabel: { year: 'numeric', month: 'long' },
  },
};

/**
 * A `MatDatepicker` adapter whose dates are station dates as `YYYY-MM-DD` strings (design §10.2),
 * the value the forms and the API use. The `NativeDateAdapter` would hold a `Date` in the browser's
 * zone, which can shift the day; here a date has no zone at all, and "today" is the station's.
 */
@Injectable()
export class StationDateAdapter extends DateAdapter<string, string> {
  private readonly stationTime = inject(StationTimeService);

  constructor() {
    super();
    const i18n = inject(I18nService);
    effect(() => this.setLocale(i18n.locale()));
  }

  getYear(date: string): number {
    return Number(date.slice(0, 4));
  }

  getMonth(date: string): number {
    return Number(date.slice(5, 7)) - 1;
  }

  getDate(date: string): number {
    return Number(date.slice(8, 10));
  }

  getDayOfWeek(date: string): number {
    return asUtc(date).getUTCDay();
  }

  getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    const format = this.formatter({ month: style });
    return Array.from({ length: 12 }, (_, month) => format.format(Date.UTC(2024, month, 1)));
  }

  getDateNames(): string[] {
    const format = this.formatter({ day: 'numeric' });
    return Array.from({ length: 31 }, (_, day) => format.format(Date.UTC(2024, 0, day + 1)));
  }

  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    const format = this.formatter({ weekday: style });
    return Array.from({ length: 7 }, (_, day) => format.format(SUNDAY_UTC + day * DAY_MS));
  }

  getYearName(date: string): string {
    return this.formatter({ year: 'numeric' }).format(asUtc(date));
  }

  /** Monday, as the grid counts weekdays. */
  getFirstDayOfWeek(): number {
    return 1;
  }

  getNumDaysInMonth(date: string): number {
    return daysInMonth(this.getYear(date), this.getMonth(date));
  }

  clone(date: string): string {
    return date;
  }

  createDate(year: number, month: number, date: number): string {
    if (month < 0 || month > 11 || date < 1 || date > daysInMonth(year, month)) {
      throw new Error(`Invalid date: year ${year}, month ${month}, day ${date}.`);
    }
    return toLocalDate(year, month, date);
  }

  today(): string {
    return stationToday(this.stationTime.zone());
  }

  parse(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }
    const text = value.trim();
    return isLocalDate(text) ? text : INVALID;
  }

  format(date: string, displayFormat: DisplayFormat): string {
    if (!this.isValid(date)) {
      throw new Error('StationDateAdapter: cannot format an invalid date.');
    }
    return displayFormat === 'iso' ? date : this.formatter(displayFormat).format(asUtc(date));
  }

  addCalendarYears(date: string, years: number): string {
    return this.addCalendarMonths(date, years * 12);
  }

  /** Keeps the day where it can and moves it back to the month's last day, as Material expects. */
  addCalendarMonths(date: string, months: number): string {
    const total = this.getYear(date) * 12 + this.getMonth(date) + months;
    const year = Math.floor(total / 12);
    const month = total - year * 12;
    return toLocalDate(year, month, Math.min(this.getDate(date), daysInMonth(year, month)));
  }

  addCalendarDays(date: string, days: number): string {
    return addDays(date, days);
  }

  toIso8601(date: string): string {
    return date;
  }

  isDateInstance(obj: unknown): boolean {
    return typeof obj === 'string';
  }

  isValid(date: string): boolean {
    return isLocalDate(date);
  }

  invalid(): string {
    return INVALID;
  }

  /** The labels are formatted in UTC, where a station date is a plain calendar day. */
  private formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(this.locale, { ...options, timeZone: 'UTC' });
  }
}

/** The datepicker's button and calendar labels from the translations, in the active language. */
@Injectable()
export class TranslatedDatepickerIntl extends MatDatepickerIntl {
  private readonly i18n = inject(I18nService);

  constructor() {
    super();
    effect(() => {
      const t = (key: string) => this.i18n.translate(`forms.datepicker.${key}`);
      this.calendarLabel = t('calendar');
      this.openCalendarLabel = t('open');
      this.closeCalendarLabel = t('close');
      this.prevMonthLabel = t('prevMonth');
      this.nextMonthLabel = t('nextMonth');
      this.prevYearLabel = t('prevYear');
      this.nextYearLabel = t('nextYear');
      this.prevMultiYearLabel = t('prevYears');
      this.nextMultiYearLabel = t('nextYears');
      this.switchToMonthViewLabel = t('chooseDate');
      this.switchToMultiYearViewLabel = t('chooseMonthAndYear');
      this.changes.next();
    });
  }

  override formatYearRangeLabel(start: string, end: string): string {
    return this.i18n.translate('forms.datepicker.yearRange', { start, end });
  }
}

function asUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function toLocalDate(year: number, month: number, date: number): string {
  const pad = (value: number, length: number) => String(value).padStart(length, '0');
  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(date, 2)}`;
}
