import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationsService } from '../../core/operations/operations.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import GridPageComponent from './grid-page.component';

type GridSlot = ApiSchema<'GridSlot'>;

const weekday = { id: 2, name: 'Weekday morning', status: 'complete' as const };

const slot = (overrides: Partial<GridSlot> = {}): GridSlot => ({
  id: 9,
  weekday: 4,
  hour: 10,
  clock: weekday,
  valid_from: '2026-10-01',
  ...overrides,
});

interface GridView {
  form: FormGroup<{
    clock_id: FormControl<number | null>;
    weekdays: FormControl<number[] | null>;
    hours: FormControl<number[] | null>;
    valid_from: FormControl<string | null>;
    valid_to: FormControl<string | null>;
  }>;
}

describe('GridPageComponent', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;
  let waitFor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 2026-10-15 05:00 in Yerevan; only the date is faked, so timers keep working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
    waitFor = vi.fn((id: number) => of({ id, kind: 'clock_build', status: 'completed' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: OperationsService, useValue: { waitFor } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    for (const request of http.match('/api/clocks')) {
      request.flush({ items: [] });
    }
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  function flushWeek(items: ApiSchema<'GridHour'>[] = []): void {
    http
      .expectOne(
        (req) =>
          req.url === '/api/grid' &&
          req.params.get('from') === '2026-10-15' &&
          req.params.get('to') === '2026-10-21',
      )
      .flush({ items });
  }

  function flushSlots(items: GridSlot[] = []): void {
    http
      .expectOne((req) => req.url === '/api/grid/slots' && req.params.get('from') === '2026-10-15')
      .flush({ items });
  }

  async function open(): Promise<ComponentFixture<GridPageComponent>> {
    const fixture = TestBed.createComponent(GridPageComponent);
    await settlePage();
    flushWeek([
      {
        date: '2026-10-15',
        weekday: 4,
        hour: 10,
        start_utc: '2026-10-15T06:00:00Z',
        slot_id: 9,
        clock: weekday,
      },
    ]);
    flushSlots([slot()]);
    await settlePage();
    return fixture;
  }

  it('shows the week from today in the station zone', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('app-grid-week')?.textContent).toContain('Weekday morning');

    button(page, 'grid.week.next')?.click();
    await settlePage();
    http
      .expectOne(
        (req) =>
          req.url === '/api/grid' &&
          req.params.get('from') === '2026-10-22' &&
          req.params.get('to') === '2026-10-28',
      )
      .flush({ items: [] });
  });

  it('assigns a clock to the picked hours and names the replaced slots', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as unknown as GridView;
    const page = fixture.nativeElement as HTMLElement;

    // Saturday 2026-10-17 at 11:00, then Sunday at 12:00.
    const picks = [...page.querySelectorAll<HTMLButtonElement>('button.pick')];
    // Columns are the seven dates; rows the hours. Cell index = hour * 7 + day.
    picks[11 * 7 + 2].click();
    picks[12 * 7 + 3].click();
    expect(view.form.controls.weekdays.value).toEqual([6, 7]);
    expect(view.form.controls.hours.value).toEqual([11, 12]);
    expect(view.form.controls.valid_from.value).toBe('2026-10-17');

    view.form.controls.clock_id.setValue(2);
    await settlePage();
    button(page, 'grid.change.assign')?.click();

    const assign = http.expectOne({ method: 'POST', url: '/api/grid/assign' });
    expect(assign.request.body).toEqual({
      weekdays: [6, 7],
      hours: [11, 12],
      valid_from: '2026-10-17',
      valid_to: null,
      clock_id: 2,
    });
    assign.flush({
      created: [slot({ id: 20, weekday: 6, hour: 11 })],
      replaced: [{ slot: slot({ weekday: 6, hour: 11 }), change: 'trimmed', remaining: [] }],
      build_operation_id: 41,
    });
    await settlePage();
    flushWeek();
    flushSlots();
    await settlePage();

    expect(page.textContent).toContain('grid.result.change.trimmed');
    expect(waitFor).toHaveBeenCalledWith(41);
  });

  it('takes a weekday or an hour out of the change, and resets both', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as unknown as GridView;
    const page = fixture.nativeElement as HTMLElement;
    const picks = [...page.querySelectorAll<HTMLButtonElement>('button.pick')];
    expect(page.querySelector('button.unpick')).toBeNull();

    // Saturday at 11:00 and Sunday at 12:00: weekdays 6 and 7, hours 11 and 12.
    picks[11 * 7 + 2].click();
    picks[12 * 7 + 3].click();
    await settlePage();
    const unpicks = page.querySelectorAll<HTMLButtonElement>('button.unpick');
    // One button per chosen day in the header, then one per chosen hour down the rows.
    expect(unpicks).toHaveLength(4);

    unpicks[0].click();
    expect(view.form.controls.weekdays.value).toEqual([7]);
    unpicks[3].click();
    expect(view.form.controls.hours.value).toEqual([11]);

    await settlePage();
    button(page, 'grid.change.resetSelection')?.click();
    expect(view.form.controls.weekdays.value).toEqual([]);
    expect(view.form.controls.hours.value).toEqual([]);
    expect(view.form.controls.valid_from.value).toBe('2026-10-17');
  });

  it('clears hours without a clock', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as unknown as GridView;
    view.form.patchValue({ weekdays: [1], hours: [3], valid_from: '2026-10-20' });
    await settlePage();

    button(fixture.nativeElement as HTMLElement, 'grid.change.clear')?.click();
    const clear = http.expectOne({ method: 'POST', url: '/api/grid/unassign' });
    expect(clear.request.body).toEqual({
      weekdays: [1],
      hours: [3],
      valid_from: '2026-10-20',
      valid_to: null,
    });
    clear.flush({ created: [], replaced: [] });
    await settlePage();
    flushWeek();
    flushSlots();
  });

  it('deletes a slot after confirmation and reloads', async () => {
    const fixture = await open();
    button(fixture.nativeElement as HTMLElement, 'common.delete')?.click();
    await settlePage();
    button(overlay, 'common.delete')?.click();
    http.expectOne({ method: 'DELETE', url: '/api/grid/slots/9' }).flush(null);
    await settlePage();
    flushWeek();
    flushSlots();
  });
});
