import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiSchema } from '../api/api-types';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import type { RealtimeEventOf } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import { FillerRemindersService } from './filler-reminders.service';
import { PLAN_WARNING_HOURS_KEPT, PlanWarningsService } from './plan-warnings.service';

const HOUR = '2026-10-15T10:00:00Z';

const warning = (
  time: string,
  hour = HOUR,
  code: ApiSchema<'TrackPlanWarning'>['code'] = 'gap_unfilled',
): RealtimeEventOf<'track_plan.warning'> => ({
  type: 'track_plan.warning',
  time,
  data: {
    hour_start_utc: hour,
    clock_id: 2,
    clock_name: 'Morning',
    warnings: [{ code, message: code, segment_index: 0 }],
  },
});

const reminder = (id: number): ApiSchema<'FillerRequest'> => ({
  id,
  clock_id: 2,
  clock_name: 'Morning',
  hour_start_utc: HOUR,
  reason: 'short_clock',
  mode: 'none',
  status: 'pending',
  created_at: '2026-10-15T06:00:00Z',
  deadline_at: '2026-10-15T08:00:00Z',
});

describe('rotation services', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), server.provider],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('PlanWarningsService', () => {
    let service: PlanWarningsService;

    beforeEach(() => {
      service = TestBed.inject(PlanWarningsService);
      TestBed.inject(RealtimeService).connect();
      server.latest.open();
    });

    it('keeps the warnings of the latest build of an hour', () => {
      server.latest.send(warning('2026-10-15T07:00:01Z', HOUR, 'gap_unfilled'));
      server.latest.send(warning('2026-10-15T07:05:01Z', HOUR, 'pool_empty'));
      // An event that arrives late from an older build does not replace the newer one.
      server.latest.send(warning('2026-10-15T07:02:01Z', HOUR, 'filler_waiting'));

      const codes = service.forHour(HOUR, '2026-10-15T07:05:00Z').map((item) => item.code);
      expect(codes).toEqual(['pool_empty']);
    });

    it('hides warnings of a build older than the hour', () => {
      server.latest.send(warning('2026-10-15T07:00:01Z'));

      expect(service.forHour(HOUR, '2026-10-15T07:00:00.5Z')).toHaveLength(1);
      // The hour was rebuilt later without warnings: no event, but a newer built_at.
      expect(service.forHour(HOUR, '2026-10-15T07:05:00Z')).toEqual([]);
      expect(service.forHour('2026-10-15T11:00:00Z', '2026-10-15T07:00:00Z')).toEqual([]);
    });

    it('matches hours however the instant is written', () => {
      server.latest.send(warning('2026-10-15T07:00:01Z', '2026-10-15T10:00:00.000Z'));

      expect(service.forHour('2026-10-15T10:00:00Z', '2026-10-15T07:00:00Z')).toHaveLength(1);
    });

    it('drops the earliest hours beyond the limit', () => {
      const start = Date.parse(HOUR);
      for (let index = 0; index <= PLAN_WARNING_HOURS_KEPT; index++) {
        const hour = new Date(start + index * 3_600_000).toISOString();
        server.latest.send(warning('2026-10-15T07:00:01Z', hour));
      }

      expect(service.forHour(HOUR, '2026-10-15T07:00:00Z')).toEqual([]);
      expect(service.forHour('2026-10-15T11:00:00Z', '2026-10-15T07:00:00Z')).toHaveLength(1);
    });
  });

  describe('FillerRemindersService', () => {
    let service: FillerRemindersService;
    let changes: number;

    const expectRead = (items: ApiSchema<'FillerRequest'>[]) =>
      http
        .expectOne((req) => req.url === '/api/filler-requests')
        .flush({ items }, { status: 200, statusText: 'OK' });

    beforeEach(() => {
      service = TestBed.inject(FillerRemindersService);
      changes = 0;
      service.changes$.subscribe(() => changes++);
      TestBed.inject(RealtimeService).connect();
    });

    it('reads the pending count when the connection opens', () => {
      expect(service.pending()).toBeNull();
      server.latest.open();

      const request = http.expectOne((req) => req.url === '/api/filler-requests');
      expect(request.request.params.get('status')).toBe('pending');
      request.flush({ items: [reminder(1), reminder(2)] });

      expect(service.pending()).toBe(2);
      expect(changes).toBe(1);
    });

    it('reads again on events that open or close reminders, and on refresh', () => {
      server.latest.open();
      expectRead([]);

      server.latest.send({
        type: 'filler_request.created',
        time: '2026-10-15T07:00:00Z',
        data: {
          id: 1,
          clock_id: 2,
          clock_name: 'Morning',
          hour_start_utc: HOUR,
          reason: 'short_clock',
          deadline_at: '2026-10-15T08:00:00Z',
        },
      });
      expectRead([reminder(1)]);
      expect(service.pending()).toBe(1);

      server.latest.send({
        type: 'track_plan.completed',
        time: '2026-10-15T08:00:05Z',
        operation_id: 7,
        data: { kind: 'track_plan', summary: 'synced' },
      });
      expectRead([]);
      expect(service.pending()).toBe(0);

      service.refresh();
      expectRead([]);
      expect(changes).toBe(4);
    });

    it('ignores unrelated events and keeps the count when a read fails', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      server.latest.open();
      expectRead([reminder(1)]);

      server.latest.send({
        type: 'error.alert',
        time: '2026-10-15T07:00:00Z',
        data: { message: 'x', component: 'api' },
      });
      http.expectNone((req) => req.url === '/api/filler-requests');

      service.refresh();
      http
        .expectOne((req) => req.url === '/api/filler-requests')
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.pending()).toBe(1);
    });
  });
});
