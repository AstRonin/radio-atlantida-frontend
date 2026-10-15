import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../i18n/i18n.service';
import type { HelpContent } from './help-content';
import { HelpService } from './help.service';

const help = (title: string): HelpContent => ({
  title,
  summary: 'What the page is.',
  entities: [{ term: 'Clock', text: 'A 60-minute template.' }],
  usage: 'How to use it.',
  steps: ['Step one.'],
  mistakes: ['A mistake.'],
  example: { title: 'Example', text: 'A worked example.' },
  operations: { delete: 'Blocked while in use.' },
  fields: { name: { label: 'Name', text: 'The clock name.' } },
});

describe('HelpService', () => {
  let service: HelpService;
  let http: HttpTestingController;
  let i18n: I18nService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HelpService);
    http = TestBed.inject(HttpTestingController);
    i18n = TestBed.inject(I18nService);
  });

  afterEach(() => http.verify());

  it('loads the help of the active language once', async () => {
    const first = firstValueFrom(service.content('help.clocks'));
    TestBed.tick();
    http.expectOne('assets/help/en/clocks.json').flush(help('Clocks'));
    expect((await first)?.title).toBe('Clocks');

    const again = await firstValueFrom(service.content('help.clocks'));
    expect(again?.title).toBe('Clocks');
    http.expectNone('assets/help/en/clocks.json');
  });

  it('falls back to English when the language has no file', async () => {
    i18n.languages.set([
      { code: 'en', name: 'English' },
      { code: 'hy', name: 'Հայերեն' },
    ]);
    i18n.language.set('hy');

    const content = firstValueFrom(service.content('help.grid'));
    TestBed.tick();
    http.expectOne('assets/help/hy/grid.json').flush('', { status: 404, statusText: 'Not Found' });
    http.expectOne('assets/help/en/grid.json').flush(help('Grid'));

    expect((await content)?.title).toBe('Grid');
  });

  it('gives null for an incomplete file, and tries again next time', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const content = firstValueFrom(service.content('help.logs'));
    TestBed.tick();
    http.expectOne('assets/help/en/logs.json').flush({ title: 'Logs' });
    expect(await content).toBeNull();
    expect(consoleError).toHaveBeenCalled();

    const retry = firstValueFrom(service.content('help.logs'));
    TestBed.tick();
    http.expectOne('assets/help/en/logs.json').flush(help('Logs'));
    expect((await retry)?.title).toBe('Logs');
  });

  it('opens and closes the help panel for a page', () => {
    service.open('help.settings');
    TestBed.tick();
    expect(service.panelPage()).toBe('help.settings');
    http.expectOne('assets/help/en/settings.json').flush(help('Settings'));
    expect(service.panelContent()?.title).toBe('Settings');

    service.close();
    TestBed.tick();
    expect(service.panelPage()).toBeNull();
    expect(service.panelContent()).toBeUndefined();
  });
});
