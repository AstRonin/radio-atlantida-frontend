import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18nService, flatten } from './i18n.service';

describe('I18nService', () => {
  let service: I18nService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(I18nService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function init(stored?: string): Promise<void> {
    if (stored) {
      localStorage.setItem('radio-atlantida.language', stored);
    }
    const done = service.init();
    http.expectOne('assets/i18n/languages.json').flush([
      { code: 'en', name: 'English' },
      { code: 'hy', name: 'Հայերեն' },
    ]);
    await Promise.resolve();
    http.expectOne('assets/i18n/en.json').flush({
      shell: { title: 'Radio', greeting: 'Hello, {name}' },
      only: { en: 'English only' },
    });
    if (stored === 'hy') {
      await Promise.resolve();
      await Promise.resolve();
      http.expectOne('assets/i18n/hy.json').flush({ shell: { title: 'Ռադիո' } });
    }
    await done;
  }

  it('flattens nested keys into dotted paths', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } } })).toEqual({ 'a.b': 'x', 'a.c.d': 'y' });
  });

  it('translates with parameters', async () => {
    await init();
    expect(service.translate('shell.title')).toBe('Radio');
    expect(service.translate('shell.greeting', { name: 'Anna' })).toBe('Hello, Anna');
  });

  it('restores the remembered language and falls back to English for a missing key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await init('hy');
    expect(service.language()).toBe('hy');
    expect(service.translate('shell.title')).toBe('Ռադիո');
    expect(service.translate('only.en')).toBe('English only');
    expect(service.translate('no.such.key')).toBe('no.such.key');
  });

  it('ignores an unknown remembered language', async () => {
    await init('xx');
    expect(service.language()).toBe('en');
  });
});
