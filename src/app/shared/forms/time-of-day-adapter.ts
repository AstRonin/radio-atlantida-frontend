import { Injectable } from '@angular/core';
import { DateAdapter, MatDateFormats } from '@angular/material/core';

/** What `invalid()` returns: a string, so it passes `isDateInstance`, that is never a time. */
const INVALID = 'invalid';
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Typed times may leave out the leading zero of the hour or add seconds, which are dropped.
const TYPED_TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const MINUTES_PER_DAY = 24 * 60;

/** The field and the option list show `HH:MM`, 24-hour, the form the API uses. */
export const TIME_OF_DAY_FORMATS: MatDateFormats = {
  parse: { dateInput: null, timeInput: null },
  display: {
    dateInput: null,
    monthYearLabel: null,
    dateA11yLabel: null,
    monthYearA11yLabel: null,
    timeInput: null,
    timeOptionLabel: null,
  },
};

/**
 * A `MatTimepicker` adapter whose values are times of day as `HH:MM` strings (design §10.2), the
 * value the forms and the API use, with minute precision. A time has no date: every value is on
 * the same day, so the option list ends at 23:59 instead of running into the next day.
 */
@Injectable()
export class TimeOfDayAdapter extends DateAdapter<string, string> {
  override setTime(_target: string, hours: number, minutes: number): string {
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time: ${hours}:${minutes}.`);
    }
    return toTime(hours * 60 + minutes);
  }

  override getHours(time: string): number {
    return Number(time.slice(0, 2));
  }

  override getMinutes(time: string): number {
    return Number(time.slice(3, 5));
  }

  override getSeconds(): number {
    return 0;
  }

  override parseTime(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }
    const match = TYPED_TIME.exec(value.trim());
    const hours = Number(match?.[1]);
    const minutes = Number(match?.[2]);
    return match && hours < 24 && minutes < 60 ? toTime(hours * 60 + minutes) : INVALID;
  }

  /** Past 23:59 the result is invalid, which ends the option list. */
  override addSeconds(time: string, amount: number): string {
    const minutes = this.getHours(time) * 60 + this.getMinutes(time) + Math.floor(amount / 60);
    return minutes >= 0 && minutes < MINUTES_PER_DAY ? toTime(minutes) : INVALID;
  }

  format(time: string): string {
    if (!this.isValid(time)) {
      throw new Error('TimeOfDayAdapter: cannot format an invalid time.');
    }
    return time;
  }

  today(): string {
    return '00:00';
  }

  clone(time: string): string {
    return time;
  }

  isDateInstance(obj: unknown): boolean {
    return typeof obj === 'string';
  }

  isValid(time: string): boolean {
    return TIME_OF_DAY.test(time);
  }

  invalid(): string {
    return INVALID;
  }

  toIso8601(time: string): string {
    return time;
  }

  // The timepicker compares dates only to keep the options on one day; every time is on the same
  // one. The calendar parts of the adapter are never used.
  getYear(): number {
    return 2000;
  }

  getMonth(): number {
    return 0;
  }

  getDate(): number {
    return 1;
  }

  getDayOfWeek(): number {
    return 6;
  }

  getMonthNames(): string[] {
    return [];
  }

  getDateNames(): string[] {
    return [];
  }

  getDayOfWeekNames(): string[] {
    return [];
  }

  getYearName(): string {
    return '2000';
  }

  getFirstDayOfWeek(): number {
    return 1;
  }

  getNumDaysInMonth(): number {
    return 31;
  }

  createDate(): string {
    return '00:00';
  }

  parse(value: unknown): string | null {
    return this.parseTime(value);
  }

  addCalendarYears(time: string): string {
    return time;
  }

  addCalendarMonths(time: string): string {
    return time;
  }

  addCalendarDays(time: string): string {
    return time;
  }
}

function toTime(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
