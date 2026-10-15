import { Injectable, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';

export const DEFAULT_TIME_ZONE = 'Asia/Yerevan';

export type TimeFormat = 'datetime' | 'datetime-seconds' | 'date' | 'time' | 'time-seconds';

const FORMATS: Readonly<Record<TimeFormat, Intl.DateTimeFormatOptions>> = {
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  'datetime-seconds': { dateStyle: 'medium', timeStyle: 'medium' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
  'time-seconds': { timeStyle: 'medium' },
};

// The backend sends instants as ISO 8601 UTC (design §10.2); Go may add up to nine fraction digits.
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** Converts an API timestamp to a `Date`. Throws for anything that is not a UTC instant. */
export function parseApiTime(value: string): Date {
  const date = UTC_INSTANT.test(value) ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Not an ISO 8601 UTC time: "${value}".`);
  }
  return date;
}

export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats instants in the station timezone, never in the browser's zone (design §10.2). The zone
 * starts at the default; SettingsService sets it from `station.timezone` once settings are loaded.
 */
@Injectable({ providedIn: 'root' })
export class StationTimeService {
  private readonly i18n = inject(I18nService);
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();
  private readonly currentZone = signal(DEFAULT_TIME_ZONE);

  readonly zone = this.currentZone.asReadonly();

  /** Sets the IANA zone. An unknown name is refused, so a bad setting cannot break every view. */
  setZone(name: string): boolean {
    if (!isValidTimeZone(name)) {
      return false;
    }
    this.currentZone.set(name);
    return true;
  }

  /** Formats an API timestamp or a `Date` in the station zone and the active language. */
  format(value: string | Date, format: TimeFormat = 'datetime'): string {
    const date = typeof value === 'string' ? parseApiTime(value) : value;
    return this.formatter(this.i18n.locale(), this.zone(), format).format(date);
  }

  private formatter(locale: string, timeZone: string, format: TimeFormat): Intl.DateTimeFormat {
    const key = `${locale}|${timeZone}|${format}`;
    let formatter = this.formatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...FORMATS[format], timeZone });
      this.formatters.set(key, formatter);
    }
    return formatter;
  }
}
