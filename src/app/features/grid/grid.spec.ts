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

const weekday = { id: 2, name: 'Weekday morning' };

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

  /** The grid request of one month, from its first to its last day. */
  function flushMonth(
    items: ApiSchema<'GridHour'>[] = [],
    from = '2026-10-01',
    to = '2026-10-31',
  ): void {
    http
      .expectOne(
        (req) =>
          req.url === '/api/grid' && req.params.get('from') === from && req.params.get('to') === to,
      )
      .flush({ items });
  }

  /** The "+" of a day cell: week block, hour row, and weekday column (0 = Monday). */
  function pickButton(
    page: HTMLElement,
    week: number,
    hour: number,
    column: number,
  ): HTMLButtonElement | null {
    const block = page.querySelectorAll('app-grid-week')[week];
    const row = block?.querySelectorAll('tbody tr')[hour];
    return (
      row?.querySelectorAll('td')[column]?.querySelector<HTMLButtonElement>('button.pick') ?? null
    );
  }

  function flushSlots(items: GridSlot[] = []): void {
    http
      .expectOne((req) => req.url === '/api/grid/slots' && req.params.get('from') === '2026-10-15')
      .flush({ items });
  }

  async function open(): Promise<ComponentFixture<GridPageComponent>> {
    const fixture = TestBed.createComponent(GridPageComponent);
    await settlePage();
    flushMonth([
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

  it('shows the month from today in the station zone, one block per week', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    // October 2026 runs over five Monday-to-Sunday weeks, from 28 September to 1 November.
    expect(page.querySelectorAll('app-grid-week')).toHaveLength(5);
    // The slot of Thursday 15 October at 10:00 is in the block of the week of 12 to 18 October.
    expect(page.querySelectorAll('app-grid-week')[2].textContent).toContain('Weekday morning');
  });

  it('moves the grid one month at a time and back to the current month', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;

    button(page, 'grid.month.next')?.click();
    await settlePage();
    flushMonth([], '2026-11-01', '2026-11-30');
    await settlePage();

    button(page, 'grid.month.previous')?.click();
    await settlePage();
    flushMonth([], '2026-10-01', '2026-10-31');
    await settlePage();

    button(page, 'grid.month.previous')?.click();
    await settlePage();
    flushMonth([], '2026-09-01', '2026-09-30');
    await settlePage();

    button(page, 'grid.month.current')?.click();
    await settlePage();
    flushMonth([], '2026-10-01', '2026-10-31');
    await settlePage();
  });

  it('dims the days outside the month and gives them no "+"', async () => {
    const fixture = await open();
    const page = fixture.nativeElement as HTMLElement;
    // The first block starts on Monday 28 September: its first three days are outside October.
    const firstRow = page.querySelector('app-grid-week')?.querySelector('tbody tr');
    const cells = [...(firstRow?.querySelectorAll('td') ?? [])];
    expect(cells[0].classList.contains('outside')).toBe(true);
    expect(cells[0].querySelector('button.pick')).toBeNull();
    // 1 October is in the month but before today (15 October), so it cannot be picked either.
    expect(cells[3].querySelector('button.pick')).toBeNull();
    // Thursday 15 October is today, the first day that can be picked.
    expect(pickButton(page, 2, 0, 3)).not.toBeNull();
  });

  it('assigns a clock to the picked hours and names the replaced slots', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as unknown as GridView;
    const page = fixture.nativeElement as HTMLElement;

    // Saturday 2026-10-17 at 11:00, then Sunday 2026-10-18 at 12:00; both in the week of 12 to 18.
    pickButton(page, 2, 11, 5)?.click();
    pickButton(page, 2, 12, 6)?.click();
    expect(view.form.controls.weekdays.value).toEqual([6, 7]);
    expect(view.form.controls.hours.value).toEqual([11, 12]);
    expect(view.form.controls.valid_from.value).toBe('2026-10-17');

    view.form.controls.clock_id.setValue(2);
    view.form.controls.valid_to.setValue('2026-10-31');
    await settlePage();
    button(page, 'grid.change.assign')?.click();

    const assign = http.expectOne({ method: 'POST', url: '/api/grid/assign' });
    expect(assign.request.body).toEqual({
      weekdays: [6, 7],
      hours: [11, 12],
      valid_from: '2026-10-17',
      valid_to: '2026-10-31',
      clock_id: 2,
    });
    assign.flush({
      created: [slot({ id: 20, weekday: 6, hour: 11 })],
      replaced: [{ slot: slot({ weekday: 6, hour: 11 }), change: 'trimmed', remaining: [] }],
      build_operation_id: 41,
    });
    await settlePage();
    flushMonth();
    flushSlots();
    await settlePage();

    expect(page.textContent).toContain('grid.result.change.trimmed');
    expect(waitFor).toHaveBeenCalledWith(41);
  });

  it('takes a weekday or an hour out of the change, and resets both', async () => {
    const fixture = await open();
    const view = fixture.componentInstance as unknown as GridView;
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('button.unpick')).toBeNull();

    // Saturday at 11:00 and Sunday at 12:00: weekdays 6 and 7, hours 11 and 12.
    pickButton(page, 2, 11, 5)?.click();
    pickButton(page, 2, 12, 6)?.click();
    await settlePage();
    // Within the block of the week of 12 to 18: one button per chosen day in the header, then
    // one per chosen hour down the rows. Every block shows them, so the first block is used.
    const unpicks = page
      .querySelectorAll<HTMLButtonElement>('app-grid-week')[2]
      .querySelectorAll<HTMLButtonElement>('button.unpick');
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
    view.form.patchValue({
      weekdays: [1],
      hours: [3],
      valid_from: '2026-10-20',
      valid_to: '2026-10-31',
    });
    await settlePage();

    button(fixture.nativeElement as HTMLElement, 'grid.change.clear')?.click();
    const clear = http.expectOne({ method: 'POST', url: '/api/grid/unassign' });
    expect(clear.request.body).toEqual({
      weekdays: [1],
      hours: [3],
      valid_from: '2026-10-20',
      valid_to: '2026-10-31',
    });
    clear.flush({ created: [], replaced: [] });
    await settlePage();
    flushMonth();
    flushSlots();
  });

  it('deletes a slot after confirmation and reloads', async () => {
    const fixture = await open();
    button(fixture.nativeElement as HTMLElement, 'common.delete')?.click();
    await settlePage();
    button(overlay, 'common.delete')?.click();
    http.expectOne({ method: 'DELETE', url: '/api/grid/slots/9' }).flush(null);
    await settlePage();
    flushMonth();
    flushSlots();
  });

  // 2026-10-15 is a Thursday (weekday 4); the cases below use station dates only.
  describe('weekdays against the date range', () => {
    async function setRange(
      weekdays: number[],
      valid_from: string,
      valid_to: string | null,
    ): Promise<ComponentFixture<GridPageComponent>> {
      const fixture = await open();
      const view = fixture.componentInstance as unknown as GridView;
      view.form.patchValue({ clock_id: 2, weekdays, hours: [3], valid_from, valid_to });
      await settlePage();
      return fixture;
    }

    const viewOf = (fixture: ComponentFixture<GridPageComponent>) =>
      fixture.componentInstance as unknown as GridView;

    it('refuses a one-day range on a weekday it does not contain', async () => {
      const fixture = await setRange([1], '2026-10-15', '2026-10-15');
      const view = viewOf(fixture);
      expect(view.form.controls.weekdays.hasError('weekdaysOutsideRange')).toBe(true);
      expect(view.form.valid).toBe(false);
      expect(button(fixture.nativeElement as HTMLElement, 'grid.change.assign')?.disabled).toBe(
        true,
      );
    });

    it('still allows clearing the hours when the range refuses an assignment', async () => {
      const fixture = await setRange([1], '2026-10-15', '2026-10-15');
      expect(button(fixture.nativeElement as HTMLElement, 'grid.change.clear')?.disabled).toBe(
        false,
      );
    });

    it('shows the server error when the backend refuses the range anyway', async () => {
      const fixture = await setRange([4], '2026-10-15', '2026-10-15');
      const page = fixture.nativeElement as HTMLElement;
      // The page's check passes, so the request goes out and the backend answers.
      button(page, 'grid.change.assign')?.click();
      http.expectOne({ method: 'POST', url: '/api/grid/assign' }).flush(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 422,
          code: 'validation_failed',
          detail: 'The request has invalid fields.',
          errors: [{ field: 'weekdays', code: 'invalid', message: 'no weekday falls in range' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      expect(viewOf(fixture).form.controls.weekdays.hasError('server')).toBe(true);
      expect(page.querySelector('app-weekdays-input .error')).not.toBeNull();
    });

    it('accepts a one-day range on the matching weekday', async () => {
      const view = viewOf(await setRange([4], '2026-10-15', '2026-10-15'));
      expect(view.form.controls.weekdays.hasError('weekdaysOutsideRange')).toBe(false);
      expect(view.form.valid).toBe(true);
    });

    it('accepts a week range', async () => {
      const view = viewOf(await setRange([1], '2026-10-15', '2026-10-21'));
      expect(view.form.controls.weekdays.hasError('weekdaysOutsideRange')).toBe(false);
      expect(view.form.valid).toBe(true);
    });

    it('requires an end date, since a range is at most one month', async () => {
      const view = viewOf(await setRange([1], '2026-10-15', null));
      expect(view.form.controls.valid_to.hasError('required')).toBe(true);
      expect(view.form.valid).toBe(false);
    });

    it('accepts a partial match: one chosen weekday falls in the range', async () => {
      const view = viewOf(await setRange([1, 4], '2026-10-15', '2026-10-15'));
      expect(view.form.controls.weekdays.hasError('weekdaysOutsideRange')).toBe(false);
      expect(view.form.valid).toBe(true);
    });
  });

  describe('date limits', () => {
    const viewOf = (fixture: ComponentFixture<GridPageComponent>) =>
      fixture.componentInstance as unknown as GridView & {
        windowEnd: () => string;
        validToMax: () => string | null;
        pickFrom: () => string;
        pickTo: () => string;
      };

    it('takes dates from today to six months ahead', async () => {
      const view = viewOf(await open());
      // 15 October 2026 plus 183 days.
      expect(view.windowEnd()).toBe('2027-04-16');
      expect(view.pickFrom()).toBe('2026-10-15');
      expect(view.pickTo()).toBe('2026-10-31');
    });

    it('refuses a start before today and after six months', async () => {
      const fixture = await open();
      const view = viewOf(fixture);
      view.form.controls.valid_from.setValue('2026-10-14');
      expect(view.form.controls.valid_from.hasError('matDatepickerMin')).toBe(true);

      view.form.controls.valid_from.setValue('2027-04-17');
      expect(view.form.controls.valid_from.hasError('matDatepickerMax')).toBe(true);

      view.form.controls.valid_from.setValue('2027-04-16');
      expect(view.form.controls.valid_from.valid).toBe(true);
    });

    it('allows a range of at most one month and no more', async () => {
      const fixture = await open();
      const view = viewOf(fixture);
      view.form.controls.valid_from.setValue('2026-10-15');
      view.form.controls.valid_to.setValue('2026-11-14');
      expect(view.form.controls.valid_to.hasError('dateRange')).toBe(false);

      view.form.controls.valid_to.setValue('2026-11-15');
      expect(view.form.controls.valid_to.hasError('dateRange')).toBe(true);
      expect(view.validToMax()).toBe('2026-11-14');
    });

    it('caps the end date at the window when the start is near its end', async () => {
      const fixture = await open();
      const view = viewOf(fixture);
      view.form.controls.valid_from.setValue('2027-04-01');
      expect(view.validToMax()).toBe('2027-04-16');
    });
  });
});
