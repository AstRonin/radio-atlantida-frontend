import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, TranslationParams } from './i18n.service';

/**
 * `{{ 'shell.title' | translate }}`. Impure so that a language switch re-renders the text;
 * the lookup is a map read, so re-evaluation is cheap.
 */
@Pipe({ name: 'translate', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, params?: TranslationParams): string {
    return this.i18n.translate(key, params);
  }
}
