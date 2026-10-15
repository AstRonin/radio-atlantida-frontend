import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FillerRemindersService } from '../../core/rotation/filler-reminders.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import FillerRemindersPageComponent from './filler-reminders-page.component';

type FillerRequest = ApiSchema<'FillerRequest'>;

const reminder = (overrides: Partial<FillerRequest> = {}): FillerRequest => ({
  id: 5,
  clock_id: 2,
  clock_name: 'Evening',
  hour_start_utc: '2026-10-15T16:00:00Z',
  reason: 'short_clock',
  mode: 'none',
  status: 'pending',
  created_at: '2026-10-15T00:00:00Z',
  deadline_at: '2026-10-15T14:00:00Z',
  ...overrides,
});

interface RemindersView {
  form: FormGroup<{ track_id: FormControl<number[] | null> }>;
  statusFilter: FormControl<string>;
}

describe('FillerRemindersPageComponent', () => {
  let http: HttpTestingController;
  let changes: Subject<void>;
  let refresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
    changes = new Subject<void>();
    refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: FillerRemindersService, useValue: { changes$: changes, refresh } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    flushHelp(http);
    // The track picker reads its first page of tracks; closing the form cancels the read.
    for (const request of http.match((req) => req.url.startsWith('/api/tracks'))) {
      if (!request.cancelled) {
        request.flush({ items: [] });
      }
    }
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  function expectList(status: string, items: FillerRequest[]): void {
    http
      .expectOne((req) => req.url === '/api/filler-requests' && req.params.get('status') === status)
      .flush({ items });
  }

  async function open(
    items: FillerRequest[] = [
      reminder(),
      reminder({ id: 6, reason: 'pool_empty', mode: 'pool', clock_id: 3 }),
    ],
  ): Promise<ComponentFixture<unknown>> {
    const fixture = TestBed.createComponent(FillerRemindersPageComponent);
    await settlePage();
    expectList('pending', items);
    await settlePage();
    return fixture;
  }

  it('lists pending reminders; a pool-empty one links to its clock', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Evening');
    expect(button(page, 'fillerReminders.answer')).toBeDefined();
    const refill = [...page.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === 'fillerReminders.refillPool',
    );
    expect(refill?.getAttribute('href')).toBe('/clocks/3');
  });

  it('reads the chosen status and reloads when reminders change', async () => {
    const fixture = await open();
    (fixture.componentInstance as RemindersView).statusFilter.setValue('all');
    await settlePage();
    expectList('all', [reminder({ status: 'answered', answer_track_id: 7 })]);
    await settlePage();
    expect(button(fixture.nativeElement as HTMLElement, 'fillerReminders.answer')).toBeUndefined();

    changes.next();
    await settlePage();
    expectList('all', []);
  });

  it('answers a reminder with a track and refreshes the count', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = fixture.componentInstance as RemindersView;

    button(page, 'fillerReminders.answer')?.click();
    await settlePage();
    expect(page.querySelector('app-track-picker')).not.toBeNull();
    expect(button(page, 'fillerReminders.save')?.disabled).toBe(true);

    view.form.controls.track_id.setValue([7]);
    await settlePage();
    button(page, 'fillerReminders.save')?.click();
    const answer = http.expectOne({ method: 'POST', url: '/api/filler-requests/5/answer' });
    expect(answer.request.body).toEqual({ track_id: 7 });
    answer.flush(reminder({ status: 'answered', answer_track_id: 7 }));
    await settlePage();

    expect(refresh).toHaveBeenCalledOnce();
    expect(page.textContent).toContain('fillerReminders.answered');
    expect(page.querySelector('app-track-picker')).toBeNull();
  });

  it('shows a refused track on the picker', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = fixture.componentInstance as RemindersView;

    button(page, 'fillerReminders.answer')?.click();
    await settlePage();
    view.form.controls.track_id.setValue([7]);
    await settlePage();
    button(page, 'fillerReminders.save')?.click();
    http.expectOne({ method: 'POST', url: '/api/filler-requests/5/answer' }).flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Unprocessable Entity',
        errors: [{ field: 'track_id', code: 'blocked', message: 'separation' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(view.form.controls.track_id.hasError('server')).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reloads when the reminder closed meanwhile', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    const view = fixture.componentInstance as RemindersView;

    button(page, 'fillerReminders.answer')?.click();
    await settlePage();
    view.form.controls.track_id.setValue([7]);
    await settlePage();
    button(page, 'fillerReminders.save')?.click();
    http
      .expectOne({ method: 'POST', url: '/api/filler-requests/5/answer' })
      .flush(
        { status: 409, code: 'hour_started', title: 'Conflict', detail: 'the hour has started' },
        { status: 409, statusText: 'Conflict' },
      );
    await settlePage();

    // Without loaded translations the backend's detail is shown.
    expect(page.querySelector('.form-error')?.textContent).toContain('the hour has started');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
