import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** A size in bytes, in the largest unit below 1,024 of it: `5242880 | fileSize` → "5 MB". */
export function formatFileSize(bytes: number, locale: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}

/** Impure because the language is a signal that changes without the input changing. */
@Pipe({ name: 'fileSize', pure: false })
export class FileSizePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(bytes: number): string {
    return formatFileSize(bytes, this.i18n.locale());
  }
}
