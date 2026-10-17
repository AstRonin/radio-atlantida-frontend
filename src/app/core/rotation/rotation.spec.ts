import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiSchema } from '../api/api-types';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import type { RealtimeEventOf } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
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
    warnings: [{ code, message: code, insert_index: 0 }],
  },
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
      server.latest.send(warning('2026-10-15T07:05:01Z', HOUR, 'insert_skipped'));
      // An event that arrives late from an older build does not replace the newer one.
      server.latest.send(warning('2026-10-15T07:02:01Z', HOUR, 'rule_slot_skipped'));

      const codes = service.forHour(HOUR, '2026-10-15T07:05:00Z').map((item) => item.code);
      expect(codes).toEqual(['insert_skipped']);
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
});
