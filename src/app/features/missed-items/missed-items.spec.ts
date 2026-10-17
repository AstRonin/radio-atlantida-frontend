import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Observable, Subject, map } from 'rxjs';
import { MissedItemsService } from '../../core/alerts/missed-items.service';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import MissedItemsPageComponent from './missed-items-page.component';

type MissedItem = ApiSchema<'PlayHistoryEntry'>;
type TrackPlanHour = ApiSchema<'TrackPlanHour'>;

const NOW = '2026-10-15T01:00:00.000Z';
const TARGET_TO = '2026-10-22T01:00:00.000Z';
const TARGET = '2026-10-15T12:00:00Z';

const item = (overrides: Partial<MissedItem> = {}): MissedItem => ({
  id: 20,
  status: 'missed',
  source: 'auto',
  track_id: 8,
  title: 'Hourly News',
  planned_start_utc: '2026-10-15T00:10:00Z',
  planned_in_ms: 15_000,
  planned_out_ms: 195_000,
  clock: { id: 3, name: 'Night' },
  outage: { id: 4, component: 'icecast', reason: 'mount missing' },
  resolution: 'open',
  ...overrides,
});

const hour = (start: string): TrackPlanHour => ({
  hour_start_utc: start,
  clock: { id: 2, name: 'Midday' },
  seed: 1,
  built_at: '2026-10-15T00:00:00Z',
  items: [],
  inserts: [],
});

interface MissedView {
  form: FormGroup<{
    target_hour_start_utc: FormControl<string | null>;
    placement: FormControl<'start' | 'end' | 'fixed'>;
    offset_ms: FormControl<number | null>;
    tolerance_ms: FormControl<number | null>;
  }>;
  resolutionFilter: FormControl<string>;
}

describe('MissedItemsPageComponent', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;
  let overlay: HTMLElement;
  let changes: Subject<void>;
  let refresh: ReturnType<typeof vi.fn>;
  let outcome: 'completed' | 'failed';
  let runOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    server = new FakeSocketServer();
    changes = new Subject<void>();
    refresh = vi.fn();
    outcome = 'completed';
    runOperation = vi.fn((start: Observable<{ operation_id: number }>) =>
      start.pipe(
        map(({ operation_id }) => ({ id: operation_id, kind: 'reschedule', status: outcome })),
      ),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        provideFakeAudio(new FakeAudio()),
        { provide: MissedItemsService, useValue: { changes$: changes, refresh } },
        { provide: OperationsService, useValue: { runOperation } },
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
      (element) => element.textContent?.trim() === label,
    );

  function expectList(resolution: string, items: MissedItem[]): void {
    http
      .expectOne(
        (req) => req.url === '/api/missed-items' && req.params.get('resolution') === resolution,
      )
      .flush({ items });
  }

  async function open(items: MissedItem[] = [item()]): Promise<ComponentFixture<unknown>> {
    const fixture = TestBed.createComponent(MissedItemsPageComponent);
    await settlePage();
    expectList('open', items);
    await settlePage();
    return fixture;
  }

  /** Opens the reschedule form and answers the target hours from the plan. */
  async function startReschedule(fixture: ComponentFixture<unknown>): Promise<MissedView> {
    button(fixture.nativeElement as HTMLElement, 'missedItems.reschedule')?.click();
    await settlePage();
    http
      .expectOne(
        (req) =>
          req.url === '/api/track-plan' &&
          req.params.get('from') === NOW &&
          req.params.get('to') === TARGET_TO,
      )
      .flush({ items: [hour(TARGET), hour('2026-10-15T13:00:00Z')] });
    await settlePage();
    return fixture.componentInstance as MissedView;
  }

  it('lists open items with their outage and reloads on changes', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Hourly News');
    expect(page.textContent).toContain('mount missing');
    expect(page.textContent).toContain('3:00');
    expect(button(page, 'missedItems.dismiss')).toBeDefined();

    (fixture.componentInstance as MissedView).resolutionFilter.setValue('dismissed');
    await settlePage();
    expectList('dismissed', [
      item({ resolution: 'dismissed', resolved_at: '2026-10-15T00:30:00Z' }),
    ]);
    await settlePage();
    expect(button(page, 'missedItems.dismiss')).toBeUndefined();
    expect(page.textContent).toContain('missedItems.resolutions.dismissed');

    changes.next();
    await settlePage();
    expectList('dismissed', []);
  });

  it('dismisses an item after confirmation', async () => {
    const fixture = await open();

    button(fixture.nativeElement as HTMLElement, 'missedItems.dismiss')?.click();
    await settlePage();
    expect(overlay.textContent).toContain('missedItems.dismissDialog.title');
    button(overlay, 'missedItems.dismiss')?.click();
    http
      .expectOne({ method: 'POST', url: '/api/missed-items/20/dismiss' })
      .flush(item({ resolution: 'dismissed' }));
    await settlePage();

    expect(refresh).toHaveBeenCalledOnce();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('missedItems.dismissed');
  });

  it('reschedules to the start of a planned hour', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = await startReschedule(fixture);

    expect(button(page, 'missedItems.save')?.disabled).toBe(true);
    expect(page.querySelector('app-number-input')).toBeNull();
    view.form.controls.target_hour_start_utc.setValue(TARGET);
    await settlePage();
    button(page, 'missedItems.save')?.click();

    const request = http.expectOne({ method: 'POST', url: '/api/missed-items/20/reschedule' });
    expect(request.request.body).toEqual({ target_hour_start_utc: TARGET, placement: 'start' });
    request.flush({ operation_id: 31 });
    await settlePage();

    expect(runOperation).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(page.textContent).toContain('missedItems.rescheduled');
    expect(page.querySelector('form')).toBeNull();
  });

  it('sends the fixed time with seconds and keeps the form open when the operation fails', async () => {
    outcome = 'failed';
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = await startReschedule(fixture);

    view.form.controls.target_hour_start_utc.setValue(TARGET);
    view.form.controls.placement.setValue('fixed');
    await settlePage();
    expect(page.querySelector('app-offset-input')).not.toBeNull();
    expect(page.querySelector('app-seconds-input')).not.toBeNull();
    // The time is required for a fixed placement, in whole seconds.
    expect(button(page, 'missedItems.save')?.disabled).toBe(true);
    const offset = page.querySelector('app-offset-input input') as HTMLInputElement;
    offset.value = '29:40';
    offset.dispatchEvent(new Event('input'));
    expect(view.form.controls.offset_ms.value).toBe(1_780_000);
    await settlePage();
    button(page, 'missedItems.save')?.click();

    const request = http.expectOne({ method: 'POST', url: '/api/missed-items/20/reschedule' });
    expect(request.request.body).toEqual({
      target_hour_start_utc: TARGET,
      placement: 'fixed',
      offset_ms: 1_780_000,
    });
    request.flush({ operation_id: 32 });
    await settlePage();

    expect(refresh).not.toHaveBeenCalled();
    expect(page.querySelector('form')).not.toBeNull();
    expect(page.textContent).toContain('missedItems.status.failed');
  });

  it('puts a refused field on its control', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = await startReschedule(fixture);

    view.form.controls.target_hour_start_utc.setValue(TARGET);
    await settlePage();
    button(page, 'missedItems.save')?.click();
    http.expectOne({ method: 'POST', url: '/api/missed-items/20/reschedule' }).flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Unprocessable Entity',
        errors: [{ field: 'target_hour_start_utc', code: 'range', message: 'past the horizon' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(view.form.controls.target_hour_start_utc.hasError('server')).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when the item was resolved meanwhile', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = await startReschedule(fixture);

    view.form.controls.target_hour_start_utc.setValue(TARGET);
    await settlePage();
    button(page, 'missedItems.save')?.click();
    http.expectOne({ method: 'POST', url: '/api/missed-items/20/reschedule' }).flush(
      {
        status: 409,
        code: 'missed_item_resolved',
        title: 'Conflict',
        detail: 'already resolved',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settlePage();

    expect(page.querySelector('.form-error')?.textContent).toContain('already resolved');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
