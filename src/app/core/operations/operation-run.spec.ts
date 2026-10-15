import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { OperationRun, followOperation } from './operation-run';
import type { OperationState } from './operations.service';

describe('followOperation', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let run: OperationRun;

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), server.provider],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    run = runInInjectionContext(TestBed.inject(Injector), followOperation);
  });

  afterEach(() => http.verify());

  it('follows the started operation from its progress to its summary', () => {
    const start = new Subject<{ operation_id: number }>();
    const terminal: OperationState[] = [];
    expect(run.state()).toBeNull();

    run.run(start).subscribe((state) => terminal.push(state));
    expect(run.running()).toBe(true);

    start.next({ operation_id: 7 });
    start.complete();
    expect(run.state()?.status).toBe('accepted');

    server.latest.send({
      type: 'import.progress',
      time: '2026-10-15T08:00:02Z',
      operation_id: 7,
      data: { kind: 'import', done: 3, total: 10, message: '3 of 10 files' },
    });
    expect(run.state()?.progress).toEqual({ done: 3, total: 10, message: '3 of 10 files' });
    expect(run.running()).toBe(true);

    server.latest.send({
      type: 'import.completed',
      time: '2026-10-15T08:00:09Z',
      operation_id: 7,
      data: { kind: 'import', summary: '9 imported, 1 duplicate' },
    });
    expect(run.state()).toMatchObject({ status: 'completed', summary: '9 imported, 1 duplicate' });
    expect(run.running()).toBe(false);
    expect(terminal.map((state) => state.status)).toEqual(['completed']);
  });

  it('is not running after a refused start, and clear() hides the last one', () => {
    const start = new Subject<{ operation_id: number }>();
    const errors: unknown[] = [];
    run.run(start).subscribe({ error: (error: unknown) => errors.push(error) });
    start.error(new Error('media_operation_running'));

    expect(errors).toHaveLength(1);
    expect(run.running()).toBe(false);
    expect(run.state()).toBeNull();

    const next = new Subject<{ operation_id: number }>();
    run.run(next).subscribe();
    next.next({ operation_id: 8 });
    expect(run.state()?.id).toBe(8);
    run.clear();
    expect(run.state()).toBeNull();
    expect(run.running()).toBe(false);
  });
});
