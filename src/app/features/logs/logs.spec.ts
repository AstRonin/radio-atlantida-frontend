import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import {
  RUNTIME_CONFIG_PATH,
  RuntimeConfigService,
} from '../../core/config/runtime-config.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LogsPageComponent from './logs-page.component';

type LogEntry = ApiSchema<'LogEntry'>;

/** The page's form, which the template reads as `form`. */
interface LogsView {
  form: FormGroup;
}

const HOUR = 3_600_000;

const lost: LogEntry = {
  time: '2026-10-15T10:05:00Z',
  level: 'WARN',
  message: 'icecast connection lost',
  component: 'icecast',
  error: 'dial tcp: connection refused',
  attrs: { attempt: 3, mount: '/live' },
};

const failed: LogEntry = {
  time: '2026-10-15T10:00:00Z',
  level: 'ERROR',
  message: 'handler failed',
  component: 'api',
  request_id: 'r-7',
};

const fieldsAreInvalid = {
  type: 'about:blank',
  title: 'Some fields are not valid',
  status: 422,
  code: 'validation_failed',
};

describe('LogsPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  /** The one read of the entries whose parameters match; a missing parameter is null. */
  function expectRead(expected: Record<string, string | null>): TestRequest {
    return http.expectOne(
      (req) =>
        req.url === '/api/logs' &&
        Object.entries(expected).every(([key, value]) => req.params.get(key) === value),
    );
  }

  function flushEntries(request: TestRequest, items: LogEntry[], extra = {}): void {
    request.flush({ items, ...extra });
  }

  async function open(
    inputs: Record<string, string> = {},
  ): Promise<ComponentFixture<LogsPageComponent>> {
    const fixture = TestBed.createComponent(LogsPageComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await settlePage();
    return fixture;
  }

  const formOf = (fixture: ComponentFixture<LogsPageComponent>) =>
    (fixture.componentInstance as unknown as LogsView).form;

  const rows = (fixture: ComponentFixture<unknown>) =>
    (fixture.nativeElement as HTMLElement).querySelectorAll('.entries tbody tr');

  const text = (fixture: ComponentFixture<unknown>) =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('reads the last 6 hours by default and shows the entries in station time', async () => {
    const fixture = await open();
    const request = expectRead({ limit: '100', level: null, component: null, cursor: null });
    const from = Date.parse(request.request.params.get('from') ?? '');
    const to = Date.parse(request.request.params.get('to') ?? '');
    expect(to - from).toBe(6 * HOUR);
    flushEntries(request, [lost, failed], { total: 2 });
    await settlePage();

    expect(rows(fixture)).toHaveLength(2);
    const first = rows(fixture)[0];
    // 10:05 UTC is 14:05 in Asia/Yerevan.
    expect(first.textContent).toContain('2:05:00 PM');
    expect(first.querySelector('.badge.warn')?.textContent).toContain('WARN');
    expect(first.textContent).toContain('dial tcp: connection refused');
    expect(first.textContent).toContain('attempt: 3');
    expect(first.textContent).toContain('mount: /live');
    expect(rows(fixture)[1].textContent).toContain('logs.requestId');
    expect(text(fixture)).toContain('logs.shown');
    expect(text(fixture)).toContain('logs.note');
  });

  it('says when no entries match', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [], { total: 0 });
    await settlePage();

    expect(text(fixture)).toContain('logs.empty');
    // The only row is the empty-state row.
    expect(rows(fixture)).toHaveLength(1);
  });

  it('reads a preset range, ending now', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [lost]);
    await settlePage();

    formOf(fixture).controls['range'].setValue('24h');
    const request = expectRead({ limit: '100' });
    const from = Date.parse(request.request.params.get('from') ?? '');
    const to = Date.parse(request.request.params.get('to') ?? '');
    expect(to - from).toBe(24 * HOUR);
    flushEntries(request, [lost]);
    await settlePage();
  });

  it('sends the level, component, and text, and applies the text on Refresh', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [lost, failed]);
    await settlePage();

    formOf(fixture).controls['level'].setValue('WARN');
    flushEntries(expectRead({ level: 'WARN', component: null }), [lost]);
    await settlePage();

    formOf(fixture).controls['search'].setValue('timeout');
    expect(http.match((req) => req.url === '/api/logs')).toHaveLength(0);

    button(fixture.nativeElement as HTMLElement, 'logs.refresh')?.click();
    flushEntries(expectRead({ level: 'WARN', search: 'timeout' }), []);
    await settlePage();

    expect(text(fixture)).toContain('logs.empty');
  });

  it('checks the request ID before sending it', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [failed]);
    await settlePage();

    const requestId = formOf(fixture).controls['request_id'];
    requestId.setValue('a b');
    button(fixture.nativeElement as HTMLElement, 'logs.refresh')?.click();
    expect(http.match((req) => req.url === '/api/logs')).toHaveLength(0);
    expect(requestId.invalid).toBe(true);

    requestId.setValue('r-7');
    button(fixture.nativeElement as HTMLElement, 'logs.refresh')?.click();
    flushEntries(expectRead({ request_id: 'r-7' }), [failed]);
    await settlePage();
    expect(rows(fixture)[0].classList).toContain('requested');
  });

  it('loads the next page by its cursor and appends the rows', async () => {
    const fixture = await open();
    const firstPage = Array.from({ length: 100 }, () => lost);
    flushEntries(expectRead({ limit: '100' }), firstPage, { next_cursor: 'c1' });
    await settlePage();

    const page = fixture.nativeElement as HTMLElement;
    expect(text(fixture)).toContain('logs.shownOnly');
    button(page, 'common.loadMore')?.click();
    flushEntries(expectRead({ cursor: 'c1' }), [failed]);
    await settlePage();

    expect(rows(fixture)).toHaveLength(101);
    expect(button(page, 'common.loadMore')).toBeUndefined();
  });

  it('shows the total when the page has one', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [lost, failed], { next_cursor: 'c1', total: 250 });
    await settlePage();

    expect(text(fixture)).toContain('logs.shown');
    expect(button(fixture.nativeElement as HTMLElement, 'common.loadMore')).toBeDefined();
  });

  it('reads the first page again when a filter changes, not the next one', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [lost], { next_cursor: 'c1' });
    await settlePage();

    formOf(fixture).controls['level'].setValue('ERROR');
    flushEntries(expectRead({ level: 'ERROR', cursor: null }), [failed]);
    await settlePage();

    expect(rows(fixture)).toHaveLength(1);
  });

  it('keeps the loaded rows when Loki does not answer, and reads again on retry', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [lost, failed]);
    await settlePage();

    formOf(fixture).controls['level'].setValue('WARN');
    expectRead({ level: 'WARN' }).flush(
      {
        type: 'about:blank',
        title: 'Logs are not available',
        status: 503,
        code: 'logs_unavailable',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settlePage();

    expect(text(fixture)).toContain('Logs are not available');
    expect(rows(fixture)).toHaveLength(2);

    button(fixture.nativeElement as HTMLElement, 'common.retry')?.click();
    flushEntries(expectRead({ level: 'WARN' }), [lost]);
    await settlePage();
    expect(rows(fixture)).toHaveLength(1);
  });

  it('puts a field error of the query on the control of the same name', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [failed]);
    await settlePage();

    formOf(fixture).controls['search'].setValue('abc');
    button(fixture.nativeElement as HTMLElement, 'logs.refresh')?.click();
    expectRead({ search: 'abc' }).flush(
      {
        ...fieldsAreInvalid,
        errors: [
          { field: 'query.search', code: 'invalid', message: 'bad text' },
          { field: 'query.cursor', code: 'invalid', message: 'bad cursor' },
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(formOf(fixture).controls['search'].hasError('server')).toBe(true);
    // The cursor has no control, so the page shows the problem with the form.
    expect(text(fixture)).toContain('Some fields are not valid');
    expect(rows(fixture)).toHaveLength(1);
  });

  it('shows a range that is too long on the range choice', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), [failed]);
    await settlePage();

    formOf(fixture).controls['range'].setValue('7d');
    expectRead({ limit: '100' }).flush(
      {
        type: 'about:blank',
        title: 'The time range is too long',
        status: 422,
        code: 'range_too_long',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(text(fixture)).toContain('The time range is too long');
    expect(rows(fixture)).toHaveLength(1);
  });

  it('opens the span, component, and request of an error popup link', async () => {
    const linked: LogEntry = { ...failed, component: 'icecast' };
    const fixture = await open({
      from: '2026-10-15T07:45:00Z',
      to: '2026-10-15T08:15:00Z',
      component: 'icecast',
      request: 'r-7',
    });
    flushEntries(
      expectRead({
        from: '2026-10-15T07:45:00Z',
        to: '2026-10-15T08:15:00Z',
        component: 'icecast',
        request_id: 'r-7',
        level: null,
      }),
      [linked],
    );
    await settlePage();

    expect(formOf(fixture).controls['range'].value).toBe('window');
    expect(rows(fixture)[0].classList).toContain('requested');
  });

  it('restores the filters and the range from the URL', async () => {
    const fixture = await open({
      range: '24h',
      level: 'WARN',
      search: 'timeout',
      request: 'r-7',
    });
    flushEntries(expectRead({ level: 'WARN', search: 'timeout', request_id: 'r-7' }), [failed]);
    await settlePage();

    expect(formOf(fixture).controls['range'].value).toBe('24h');
    expect(formOf(fixture).controls['level'].value).toBe('WARN');
  });

  it('writes the filters to the URL when they are applied', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), []);
    await settlePage();

    formOf(fixture).controls['level'].setValue('WARN');
    flushEntries(expectRead({ level: 'WARN' }), []);
    await settlePage();

    const url = TestBed.inject(Router).url;
    expect(url).toContain('range=6h');
    expect(url).toContain('level=WARN');
  });

  const grafanaLink = (fixture: ComponentFixture<unknown>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')].find(
      (link) => link.textContent?.includes('logs.openGrafana'),
    );

  it('links to the Logs dashboard of Grafana when monitoring is on', async () => {
    const config = TestBed.inject(RuntimeConfigService);
    config.load();
    http.expectOne(RUNTIME_CONFIG_PATH).flush({ grafana_url: 'http://127.0.0.1:3000' });
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), []);
    await settlePage();

    const link = grafanaLink(fixture);
    expect(link?.getAttribute('href')).toBe('http://127.0.0.1:3000/d/radio-logs');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });

  it('shows no Grafana link when monitoring is off', async () => {
    const fixture = await open();
    flushEntries(expectRead({ limit: '100' }), []);
    await settlePage();

    expect(grafanaLink(fixture)).toBeUndefined();
  });
});
