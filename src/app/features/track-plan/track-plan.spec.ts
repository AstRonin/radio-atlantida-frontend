import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Observable, map } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationsService } from '../../core/operations/operations.service';
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
      source: 'clock',
      status: 'planned',
      element_id: 3,
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
      source: 'filler_random',
      status: 'planned',
    },
  ],
  ...overrides,
});

interface PlanView {
  form: FormGroup<{ from: FormControl<string | null>; to: FormControl<string | null> }>;
}

describe('TrackPlanPageComponent', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;
  let runOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
    server = new FakeSocketServer();
    runOperation = vi.fn((start: Observable<{ operation_id: number }>) =>
      start.pipe(
        map(({ operation_id }) => ({ id: operation_id, kind: 'clock_build', status: 'completed' })),
      ),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        { provide: OperationsService, useValue: { runOperation } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  });

  afterEach(() => {
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
    expect(page.textContent).toContain('trackPlan.sources.filler_random');
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
          warnings: [{ code: 'pool_track_refused', message: 'refused', track_id: 8 }],
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
});
