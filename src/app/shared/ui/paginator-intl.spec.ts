import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { I18nService } from '../../core/i18n/i18n.service';
import { providePaginatorIntl } from './paginator-intl';

describe('TranslatedPaginatorIntl', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePaginatorIntl()],
    });
  });

  it('takes its labels and the range from the translations', () => {
    const translate = vi.spyOn(TestBed.inject(I18nService), 'translate');
    const intl = TestBed.inject(MatPaginatorIntl);
    TestBed.tick();
    expect(intl.nextPageLabel).toBe('paginator.next');
    expect(intl.itemsPerPageLabel).toBe('paginator.itemsPerPage');
    intl.getRangeLabel(1, 25, 60);
    expect(translate).toHaveBeenCalledWith('paginator.range', { from: 26, to: 50, length: 60 });
    expect(intl.getRangeLabel(0, 25, 0)).toBe('paginator.rangeEmpty');
  });
});
