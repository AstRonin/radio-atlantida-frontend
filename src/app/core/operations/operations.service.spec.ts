import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import type { RealtimeEventOf } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CATCH_UP_PAGE,
  OPERATION_FALLBACK_MS,
  OperationDto,
  OperationState,
  OperationsService,
} from './operations.service';

const completed = (id: number): RealtimeEventOf<'clock_build.completed'> => ({
  type: 'clock_build.completed',
  time: '2026-10-15T08:00:05Z',
  operation_id: id,
  data: { kind: 'clock_build', summary: '24 hours rebuilt' },
});

const failed = (id: number): RealtimeEventOf<'import.failed'> => ({
  type: 'import.failed',
  time: '2026-10-15T08:00:06Z',
  operation_id: id,
  data: { kind: 'import', component: 'media', error: 'ffprobe failed' },
});

const progress = (id: number): RealtimeEventOf<'import.progress'> => ({
  type: 'import.progress',
  time: '2026-10-15T08:00:02Z',
  operation_id: id,
  data: { kind: 'import', done: 12, total: 40, message: '12 of 40 files analysed' },
});

describe('OperationsService', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let operations: OperationsService;
  let realtime: RealtimeService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'));
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), server.provider],
    });
    http = TestBed.inject(HttpTestingController);
    operations = TestBed.inject(OperationsService);
    realtime = TestBed.inject(RealtimeService);
    realtime.connect();
    server.latest.open();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /** Starts an operation whose start request answers with `id`; collects its terminal state. */
  function run(id: number): OperationState[] {
    const start = new Subject<{ operation_id: number }>();
    const result: OperationState[] = [];
    operations.runOperation(start).subscribe((state) => result.push(state));
    start.next({ operation_id: id });
    return result;
  }

  it('emits the terminal event of an operation it started', () => {
    const result = run(5);
    expect(operations.get(5)?.status).toBe('accepted');
    expect(operations.activeCount()).toBe(1);

    server.latest.send(completed(4));
    expect(result).toEqual([]);

    server.latest.send(completed(5));
    expect(result).toEqual([
      expect.objectContaining({ id: 5, status: 'completed', summary: '24 hours rebuilt' }),
    ]);
    expect(operations.activeCount()).toBe(0);
  });

  it('reports a failure with its error and component', () => {
    const result = run(6);
    server.latest.send(progress(6));
    expect(operations.get(6)).toEqual(
      expect.objectContaining({
        status: 'running',
        kind: 'import',
        progress: { done: 12, total: 40, message: '12 of 40 files analysed' },
      }),
    );

    server.latest.send(failed(6));
    expect(result).toEqual([
      expect.objectContaining({ status: 'failed', error: 'ffprobe failed', component: 'media' }),
    ]);
  });

  it('handles a terminal event that arrives before the start response', () => {
    server.latest.send(completed(8));
    const result = run(8);
    expect(result).toEqual([expect.objectContaining({ id: 8, status: 'completed' })]);
  });

  it('keeps a terminal state when a late progress event arrives', () => {
    server.latest.send(completed(9));
    server.latest.send({ ...progress(9), type: 'clock_build.progress' });
    expect(operations.get(9)?.status).toBe('completed');
  });

  it('reads the stored outcome once when no event arrives in time', () => {
    const result = run(10);

    vi.advanceTimersByTime(OPERATION_FALLBACK_MS);
    const stored: OperationDto = {
      id: 10,
      kind: 'clock_build',
      status: 'completed',
      started_at: '2026-10-15T08:00:00Z',
      finished_at: '2026-10-15T08:00:03Z',
      result_summary: 'done',
    };
    http.expectOne('/api/operations/10').flush(stored);

    expect(result).toEqual([
      expect.objectContaining({ id: 10, status: 'completed', summary: 'done' }),
    ]);
  });

  it('keeps waiting for the event when the stored operation is still running', () => {
    const result = run(11);
    vi.advanceTimersByTime(OPERATION_FALLBACK_MS);
    http.expectOne('/api/operations/11').flush({
      id: 11,
      kind: 'clock_build',
      status: 'running',
      started_at: '2026-10-15T08:00:00Z',
    } satisfies OperationDto);
    expect(result).toEqual([]);

    server.latest.send(completed(11));
    expect(result).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('catches up on operations after a reconnect, page by page', () => {
    const terminal: number[] = [];
    operations.terminal$.subscribe((state) => terminal.push(state.id));
    const result = run(20);

    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
    server.latest.drop();
    vi.advanceTimersByTime(1_000);
    server.latest.open();

    // The window starts five minutes before the drop, to cover clock differences.
    const since = '2026-10-15T08:55:00.000Z';
    const first = http.expectOne(
      (req) =>
        req.url === '/api/operations' &&
        req.params.get('since') === since &&
        !req.params.has('after_id'),
    );
    expect(first.request.params.get('limit')).toBe(String(CATCH_UP_PAGE));
    const page: OperationDto[] = Array.from({ length: CATCH_UP_PAGE }, (_, index) => ({
      id: 100 + index,
      kind: 'track_plan',
      status: 'completed',
      started_at: '2026-10-15T08:56:00Z',
      finished_at: '2026-10-15T08:56:01Z',
    }));
    first.flush({ items: page });

    const second = http.expectOne(
      (req) =>
        req.url === '/api/operations' && req.params.get('after_id') === String(99 + CATCH_UP_PAGE),
    );
    second.flush({
      items: [
        {
          id: 20,
          kind: 'clock_build',
          status: 'failed',
          started_at: '2026-10-15T08:00:00Z',
          finished_at: '2026-10-15T08:58:00Z',
          error_message: 'no candidate',
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({ id: 20, status: 'failed', error: 'no candidate' }),
    ]);
    expect(terminal).toContain(20);
    expect(operations.get(20)?.updatedAt).toBe('2026-10-15T08:58:00Z');
  });

  it('does not catch up on the first connection', () => {
    http.expectNone('/api/operations');
  });
});
