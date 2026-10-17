import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Observable, map } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationState, OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import TrackPlanPageComponent from './track-plan-page.component';

type TrackPlanHour = ApiSchema<'TrackPlanHour'>;

// Today is 2026-10-15 in Yerevan (UTC+4): the default range is the 15th and the 16th.
const FROM = '2026-10-14T20:00:00.000Z';
const TO = '2026-10-16T20:00:00.000Z';

const hour = (overrides: Partial<TrackPlanHour> = {}): TrackPlanHour => ({
  hour_start_utc: '2026-10-15T06:00:00Z',
  clock: { id: 2, name: 'Weekday morning' },
  seed: 1,
  built_at: '2026-10-15T01:00:00Z',
  items: [
    {
      id: 11,
      track_id: 7,
      title: 'Morning Song',
      artist_name: 'Ani',
      duration_ms: 200_000,
      planned_start_utc: '2026-10-15T06:00:00Z',
      // Cut from 0:20 by its cue: 3:00 on air, not the out point 3:20.
      planned_in_ms: 20_000,
      planned_out_ms: 200_000,
      truncated: false,
      source: 'fill',
      status: 'planned',
    },
    {
      id: 12,
      track_id: 8,
      title: 'Long Outro',
      duration_ms: 300_000,
      planned_start_utc: '2026-10-15T06:57:00Z',
      planned_in_ms: 0,
      planned_out_ms: 180_000,
      truncated: true,
      source: 'general',
      status: 'planned',
    },
  ],
  inserts: [],
  ...overrides,
});

interface PlanView {
  form: FormGroup<{ from: FormControl<string | null>; to: FormControl<string | null> }>;
}

describe('TrackPlanPageComponent', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;
  let runOperation: ReturnType<typeof vi.fn>;
  let overlay: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
    server = new FakeSocketServer();
    const operations = signal<OperationState[]>([]);
    runOperation = vi.fn((start: Observable<{ operation_id: number }>) =>
      start.pipe(
        map(({ operation_id }) => {
          const state: OperationState = {
            id: operation_id,
            kind: 'clock_build',
            status: 'completed',
            updatedAt: '2026-10-15T01:00:05Z',
          };
          operations.set([state]);
          return state;
        }),
      ),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        provideFakeAudio(new FakeAudio()),
        { provide: OperationsService, useValue: { runOperation, operations } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.useRealTimers();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  function expectPlan(from: string, to: string, items: TrackPlanHour[] = []): void {
    http
      .expectOne(
        (req) =>
          req.url === '/api/track-plan' &&
          req.params.get('from') === from &&
          req.params.get('to') === to,
      )
      .flush({ items });
  }

  async function open(items: TrackPlanHour[] = [hour()]): Promise<ComponentFixture<unknown>> {
    const fixture = TestBed.createComponent(TrackPlanPageComponent);
    await settlePage();
    expectPlan(FROM, TO, items);
    await settlePage();
    return fixture;
  }

  it('reads today and tomorrow of the station and shows the items', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Weekday morning');
    expect(page.textContent).toContain('Morning Song');
    expect(page.textContent).toContain('trackPlan.sources.general');
    expect(page.textContent).toContain('trackPlan.truncated');
    expect(page.querySelectorAll('app-play-button')).toHaveLength(2);
    const firstRow = page.querySelector('tbody tr')?.textContent ?? '';
    expect(firstRow).toContain('3:00');
    expect(firstRow).not.toContain('3:20');
  });

  it('shows the warnings of the current build only', async () => {
    const fixture = await open([
      hour(),
      hour({ hour_start_utc: '2026-10-15T07:00:00Z', built_at: '2026-10-15T01:10:00Z' }),
    ]);
    const page = fixture.nativeElement as HTMLElement;
    const send = (hourStart: string) =>
      server.latest.send({
        type: 'track_plan.warning',
        time: '2026-10-15T01:00:01Z',
        data: {
          hour_start_utc: hourStart,
          clock_id: 2,
          clock_name: 'Weekday morning',
          warnings: [{ code: 'insert_skipped', message: 'refused', track_id: 8 }],
        },
      });
    send('2026-10-15T06:00:00Z');
    // The 07:00 hour was built after this event, so its warning belongs to an older build.
    send('2026-10-15T07:00:00Z');
    await settlePage();

    expect(page.querySelectorAll('.warnings li')).toHaveLength(1);
    // Without loaded translations the backend's message is shown.
    expect(page.querySelector('.warnings')?.textContent).toContain('refused');
  });

  it('refuses a range longer than 7 days', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as PlanView;
    const page = fixture.nativeElement as HTMLElement;

    view.form.controls.to.setValue('2026-10-22');
    await settlePage();
    expect(view.form.controls.to.hasError('dateRange')).toBe(true);
    expect(button(page, 'trackPlan.rebuild.action')?.disabled).toBe(true);

    view.form.controls.to.setValue('2026-10-21');
    await settlePage();
    expectPlan(FROM, '2026-10-21T20:00:00.000Z');
  });

  it('rebuilds the range and reloads when a build completes', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    button(page, 'trackPlan.rebuild.action')?.click();
    const rebuild = http.expectOne({ method: 'POST', url: '/api/track-plan/rebuild' });
    expect(rebuild.request.body).toEqual({ from: FROM, to: TO });
    rebuild.flush({ operation_id: 41 });
    await settlePage();
    expect(runOperation).toHaveBeenCalledOnce();
    expect(page.textContent).toContain('clocks.build.completed');

    server.latest.send({
      type: 'clock_build.completed',
      time: '2026-10-15T01:00:05Z',
      operation_id: 41,
      data: { kind: 'clock_build', summary: 'rebuilt' },
    });
    await settlePage();
    expectPlan(FROM, TO);
  });

  describe('one-time inserts', () => {
    const NEWS_TYPE = {
      id: 3,
      code: 'news',
      name: 'News',
      is_system: true,
      playlist_count: 1,
      track_count: 4,
      created_at: '2026-10-01T00:00:00Z',
    };

    // The picker reads the chosen track to show its title.
    function flushChosenTracks(): void {
      for (const request of http.match((req) => /^\/api\/tracks\/\d+$/.test(req.url))) {
        if (!request.cancelled) {
          request.flush(null, { status: 404, statusText: 'Not Found' });
        }
      }
    }

    async function openDialog(page: HTMLElement): Promise<void> {
      button(page, 'trackPlan.inserts.add')?.click();
      await settlePage();
      http.expectOne('/api/playlist-types').flush({ items: [NEWS_TYPE] });
      await settlePage();
    }

    // The picker reads tracks of the news type first, then whatever the test types.
    function flushTracks(): void {
      for (const request of http.match((req) => req.url === '/api/tracks')) {
        if (!request.cancelled) {
          request.flush({ items: [], total: 0 });
        }
      }
    }

    it('adds an insert at a time with seconds and follows the rebuild of the hour', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await openDialog(page);
      const tracks = http.match((req) => req.url === '/api/tracks');
      expect(tracks.some((req) => req.request.params.get('type_id') === '3')).toBe(true);
      flushTracks();

      const dialog = TestBed.inject(MatDialog).openDialogs[0];
      const form = (
        dialog.componentInstance as unknown as {
          form: FormGroup<{
            offset_ms: FormControl<number | null>;
            tolerance_ms: FormControl<number | null>;
            track_id: FormControl<number[] | null>;
          }>;
        }
      ).form;
      // Without the setting the tolerance is one minute.
      expect(form.controls.tolerance_ms.value).toBe(60_000);
      const offset = overlay.querySelector('app-offset-input input') as HTMLInputElement;
      offset.value = '30:00';
      offset.dispatchEvent(new Event('input'));
      form.controls.track_id.setValue([7]);
      await settlePage();
      button(overlay, 'trackPlan.inserts.add')?.click();

      const post = http.expectOne({ method: 'POST', url: '/api/track-plan/inserts' });
      expect(post.request.body).toEqual({
        hour_start_utc: '2026-10-15T06:00:00Z',
        offset_ms: 1_800_000,
        tolerance_ms: 60_000,
        track_id: 7,
      });
      post.flush({ operation_id: 50 });
      await settlePage();
      flushTracks();
      flushChosenTracks();

      expect(runOperation).toHaveBeenCalledOnce();
      expect(page.textContent).toContain('operationStatus.completed');
      server.latest.send({
        type: 'hour_insert.completed',
        time: '2026-10-15T01:00:06Z',
        operation_id: 50,
        data: { kind: 'hour_insert', summary: 'placed' },
      });
      await settlePage();
      expectPlan(FROM, TO);
    });

    it('shows a refused time on its field', async () => {
      const fixture = await open();
      await openDialog(fixture.nativeElement as HTMLElement);
      flushTracks();
      const dialog = TestBed.inject(MatDialog).openDialogs[0];
      const form = (
        dialog.componentInstance as unknown as {
          form: FormGroup<{
            offset_ms: FormControl<number | null>;
            track_id: FormControl<number[] | null>;
          }>;
        }
      ).form;
      form.controls.offset_ms.setValue(1_800_000);
      form.controls.track_id.setValue([7]);
      await settlePage();
      button(overlay, 'trackPlan.inserts.add')?.click();

      http.expectOne({ method: 'POST', url: '/api/track-plan/inserts' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [{ field: 'offset_ms', code: 'invalid', message: 'inside a template insert' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      flushTracks();
      flushChosenTracks();
      expect(form.controls.offset_ms.hasError('server')).toBe(true);
      expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
      expect(runOperation).not.toHaveBeenCalled();
    });

    it('marks inserts and removes a one-time insert after confirmation', async () => {
      const fixture = await open([
        hour({
          inserts: [
            { id: 5, placement: 'fixed', offset_ms: 1_800_000, tolerance_ms: 60_000, track_id: 7 },
          ],
        }),
      ]);
      const page = fixture.nativeElement as HTMLElement;
      const inserts = page.querySelector('.inserts') as HTMLElement;
      expect(inserts.textContent).toContain('30:00');
      expect(inserts.textContent).toContain('Morning Song');

      button(inserts, 'common.remove')?.click();
      await settlePage();
      expect(overlay.textContent).toContain('trackPlan.inserts.removeTitle');
      button(overlay, 'common.remove')?.click();
      http
        .expectOne({ method: 'DELETE', url: '/api/track-plan/inserts/5' })
        .flush({ operation_id: 51 });
      await settlePage();
      expect(runOperation).toHaveBeenCalledOnce();
    });

    it('offers no insert actions for an hour that has started', async () => {
      const fixture = await open([
        hour({
          hour_start_utc: '2026-10-15T00:00:00Z',
          inserts: [
            { id: 5, placement: 'fixed', offset_ms: 1_800_000, tolerance_ms: 60_000, track_id: 7 },
          ],
        }),
      ]);
      const page = fixture.nativeElement as HTMLElement;
      expect(button(page, 'trackPlan.inserts.add')).toBeUndefined();
      expect(button(page, 'common.remove')).toBeUndefined();
    });
  });
});
