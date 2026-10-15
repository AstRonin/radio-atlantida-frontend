import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiSchema } from '../api/api-types';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { MissedItemsService } from './missed-items.service';

const missed = (id: number): ApiSchema<'PlayHistoryEntry'> => ({
  id,
  status: 'missed',
  source: 'auto',
  track_id: 7,
  title: 'News',
  planned_start_utc: '2026-10-15T10:00:00Z',
  planned_out_ms: 180_000,
  resolution: 'open',
  outage: { id: 3, component: 'icecast' },
});

describe('MissedItemsService', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let service: MissedItemsService;
  let changes: number;

  const expectRead = (items: ApiSchema<'PlayHistoryEntry'>[] | null) =>
    http.expectOne((req) => req.url === '/api/missed-items').flush({ items });

  const completed = (kind: 'missed_items' | 'playout_reconcile' | 'reschedule' | 'track_plan') =>
    server.latest.send({
      type: `${kind}.completed` as const,
      time: '2026-10-15T11:00:00Z',
      operation_id: 9,
      data: { kind, summary: 'done' },
    });

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), server.provider],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(MissedItemsService);
    changes = 0;
    service.changes$.subscribe(() => changes++);
    TestBed.inject(RealtimeService).connect();
  });

  afterEach(() => http.verify());

  it('reads the open count when the connection opens', () => {
    expect(service.open()).toBeNull();
    server.latest.open();

    const request = http.expectOne((req) => req.url === '/api/missed-items');
    expect(request.request.params.get('resolution')).toBe('open');
    request.flush({ items: [missed(1), missed(2)] });

    expect(service.open()).toBe(2);
    expect(changes).toBe(1);
  });

  it('reads again when items are marked or resolved, and on refresh', () => {
    server.latest.open();
    expectRead(null);
    expect(service.open()).toBe(0);

    completed('missed_items');
    expectRead([missed(1)]);
    completed('playout_reconcile');
    expectRead([missed(1), missed(2)]);
    completed('reschedule');
    expectRead([missed(2)]);
    expect(service.open()).toBe(1);

    service.refresh();
    expectRead([]);
    expect(service.open()).toBe(0);
    expect(changes).toBe(5);
  });

  it('ignores other operations and keeps the count when a read fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.latest.open();
    expectRead([missed(1)]);

    completed('track_plan');
    http.expectNone((req) => req.url === '/api/missed-items');

    service.refresh();
    http
      .expectOne((req) => req.url === '/api/missed-items')
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(service.open()).toBe(1);
  });
});
