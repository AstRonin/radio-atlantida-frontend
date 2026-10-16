import { Injectable, Provider, effect, inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * The paginator's texts from the translations, renewed when the language or its file changes.
 * Provide it with `providePaginatorIntl()` on the component that shows a paginator.
 */
@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
  private readonly i18n = inject(I18nService);

  constructor() {
    super();
    // `translate` reads the active translations, so this runs again when they change.
    effect(() => {
      this.itemsPerPageLabel = this.i18n.translate('paginator.itemsPerPage');
      this.nextPageLabel = this.i18n.translate('paginator.next');
      this.previousPageLabel = this.i18n.translate('paginator.previous');
      this.firstPageLabel = this.i18n.translate('paginator.first');
      this.lastPageLabel = this.i18n.translate('paginator.last');
      this.changes.next();
    });
  }

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) {
      return this.i18n.translate('paginator.rangeEmpty');
    }
    const from = page * pageSize + 1;
    const to = Math.min(length, (page + 1) * pageSize);
    return this.i18n.translate('paginator.range', { from, to, length });
  };
}

export function providePaginatorIntl(): Provider {
  return { provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl };
}
