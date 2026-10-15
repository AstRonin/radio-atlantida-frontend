import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import LogsPageComponent from './logs-page.component';

type LogFile = ApiSchema<'LogFile'>;
type LogEntry = ApiSchema<'LogEntry'>;

const today: LogFile = { name: 'app-2026-10-15.log', date: '2026-10-15', size_bytes: 5_242_880 };
const yesterday: LogFile = { name: 'app-2026-10-14.log', date: '2026-10-14', size_bytes: 2048 };

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

interface LogsView {
  form: FormGroup<{
    file: FormControl<string | null>;
    level: FormControl<string | null>;
    component: FormControl<string | null>;
  }>;
}

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

  function expectFiles(items: LogFile[]): void {
    http.expectOne('/api/logs/files').flush({ items });
  }

  function expectEntries(
    name: string,
    params: Record<string, string | null>,
    items: LogEntry[],
    total = items.length,
  ): void {
    const expected: Record<string, string | null> = {
      limit: '100',
      offset: '0',
      level: null,
      component: null,
      ...params,
    };
    http
      .expectOne(
        (req) =>
          req.url === `/api/logs/files/${name}` &&
          Object.entries(expected).every(([key, value]) => req.params.get(key) === value),
      )
      .flush({ items, total });
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

  const rows = (fixture: ComponentFixture<unknown>) =>
    (fixture.nativeElement as HTMLElement).querySelectorAll('.entries tbody tr');

  it('reads the newest file and shows its entries in station time', async () => {
    const fixture = await open();
    expectFiles([today, yesterday]);
    await settlePage();
    expectEntries(today.name, {}, [lost, failed]);
    await settlePage();

    const page = fixture.nativeElement as HTMLElement;
    expect(rows(fixture)).toHaveLength(2);
    const first = rows(fixture)[0];
    // 10:05 UTC is 14:05 in Asia/Yerevan.
    expect(first.textContent).toContain('2:05:00 PM');
    expect(first.querySelector('.badge.warn')?.textContent).toContain('WARN');
    expect(first.textContent).toContain('dial tcp: connection refused');
    expect(first.textContent).toContain('attempt: 3');
    expect(first.textContent).toContain('mount: /live');
    expect(rows(fixture)[1].textContent).toContain('logs.requestId');
    expect(page.textContent).toContain('logs.shown');
    expect(page.textContent).toContain('logs.note');
  });

  it('says when there are no files and reads nothing', async () => {
    const fixture = await open();
    expectFiles([]);
    await settlePage();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('logs.noFiles');
    expect(rows(fixture)).toHaveLength(0);
  });

  it('sends the level and component filters and reads the first page again', async () => {
    const fixture = await open();
    expectFiles([today, yesterday]);
    await settlePage();
    expectEntries(today.name, {}, [lost, failed]);
    await settlePage();

    const form = (fixture.componentInstance as unknown as LogsView).form;
    form.patchValue({ level: 'WARN', component: 'icecast', file: yesterday.name });
    await settlePage();
    expectEntries(yesterday.name, { level: 'WARN', component: 'icecast' }, [lost]);
    await settlePage();

    expect(rows(fixture)).toHaveLength(1);
  });

  it('loads older entries by offset until the total is read', async () => {
    const fixture = await open();
    expectFiles([today]);
    await settlePage();
    const firstPage = Array.from({ length: 100 }, () => lost);
    expectEntries(today.name, {}, firstPage, 101);
    await settlePage();

    const page = fixture.nativeElement as HTMLElement;
    button(page, 'common.loadMore')?.click();
    expectEntries(today.name, { offset: '100' }, [failed], 101);
    await settlePage();

    expect(rows(fixture)).toHaveLength(101);
    expect(button(page, 'common.loadMore')).toBeUndefined();
  });

  it('reads the list and the entries again on refresh', async () => {
    const fixture = await open();
    expectFiles([today]);
    await settlePage();
    expectEntries(today.name, {}, [failed]);
    await settlePage();

    button(fixture.nativeElement as HTMLElement, 'logs.refresh')?.click();
    expectEntries(today.name, {}, [lost, failed]);
    await settlePage();
    expectFiles([today]);
    await settlePage();

    expect(rows(fixture)).toHaveLength(2);
  });

  it('shows a removed file as an error and reads the list again', async () => {
    const fixture = await open();
    expectFiles([today, yesterday]);
    await settlePage();
    expectEntries(today.name, {}, [lost]);
    await settlePage();

    (fixture.componentInstance as unknown as LogsView).form.patchValue({ file: yesterday.name });
    await settlePage();
    http
      .expectOne(`/api/logs/files/${yesterday.name}?limit=100&offset=0`)
      .flush(
        { type: 'about:blank', title: 'Not Found', status: 404, code: 'log_file_not_found' },
        { status: 404, statusText: 'Not Found' },
      );
    await settlePage();
    expect((fixture.nativeElement as HTMLElement).querySelector('.load-error')).not.toBeNull();

    expectFiles([today]);
    await settlePage();
    expectEntries(today.name, {}, [lost]);
    await settlePage();
    expect((fixture.componentInstance as unknown as LogsView).form.controls.file.value).toBe(
      today.name,
    );
  });

  it('opens the file, filters, and request from the query parameters', async () => {
    const fixture = await open({
      file: yesterday.name,
      level: 'ERROR',
      component: 'api',
      request: 'r-7',
    });
    expectFiles([today, yesterday]);
    await settlePage();
    expectEntries(yesterday.name, { level: 'ERROR', component: 'api' }, [failed]);
    await settlePage();

    const row = rows(fixture)[0];
    expect(row.classList).toContain('requested');
    expect(row.textContent).toContain('logs.requested');
  });

  it('ignores query parameters it does not know', async () => {
    const fixture = await open({ file: 'app-2026-09-01.log', level: 'loud', component: 'x' });
    expectFiles([today]);
    await settlePage();
    expectEntries(today.name, {}, [lost]);
    await settlePage();

    expect(rows(fixture)).toHaveLength(1);
  });
});
