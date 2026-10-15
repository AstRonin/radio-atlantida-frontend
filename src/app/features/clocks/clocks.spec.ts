import { OverlayContainer } from '@angular/cdk/overlay';
import { Location } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import ClockEditComponent from './clock-edit.component';
import { Clock, ClockForm, ClockSaveResult } from './clock-form';
import ClocksPageComponent from './clocks-page.component';

type ClockSegment = ApiSchema<'ClockSegment'>;

const segment = (overrides: Partial<ClockSegment> = {}): ClockSegment => ({
  index: 0,
  start_ms: 0,
  end_ms: 3_600_000,
  content_ms: 3_600_000,
  shortfall_ms: 0,
  overflow_ms: 0,
  element_indexes: [0],
  holder_index: 0,
  filler_mode: 'none',
  ...overrides,
});

const clock = (overrides: Partial<Clock> = {}): Clock => ({
  id: 7,
  name: 'News hour',
  status: 'complete',
  updated_at: '2026-10-15T08:00:00Z',
  elements: [
    {
      id: 11,
      placement: 'fixed',
      fixed_minute: 0,
      fixed_tolerance_ms: 60_000,
      nominal_duration_ms: 300_000,
      duration_tolerance_ms: 30_000,
      filler_mode: 'none',
      playlist_ids: [3],
    },
    {
      id: 12,
      placement: 'flow',
      fixed_tolerance_ms: 60_000,
      nominal_duration_ms: 210_000,
      duration_tolerance_ms: 30_000,
      filler_mode: 'none',
      playlist_ids: [4],
    },
  ],
  layout: { shortfall_ms: 0, segments: [segment()] },
  ...overrides,
});

const saveResult = (overrides: Partial<ClockSaveResult['check']> = {}, saved = clock()) => ({
  clock: saved,
  check: {
    shortfall_ms: 0,
    requires_filler_choice: false,
    short_segments: [],
    warnings: [],
    replaced_elements: [],
    ...overrides,
  },
  build_operation_id: 40,
});

interface EditView {
  form: ClockForm;
  save(): void;
  addElement(): void;
  move(index: number, by: -1 | 1): void;
}

describe('clocks', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;
  let waitFor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    waitFor = vi.fn((id: number) => of({ id, kind: 'clock_build', status: 'completed' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideFakeAudio(new FakeAudio()),
        { provide: OperationsService, useValue: { waitFor } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    flushCatalog();
    http.verify();
  });

  // The pickers read their lists when they appear; the tests do not need any entries.
  function flushCatalog(): void {
    for (const request of http.match((req) =>
      ['/api/playlists', '/api/artists', '/api/tracks'].includes(req.url),
    )) {
      if (!request.cancelled) {
        request.flush({ items: [] });
      }
    }
  }

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  describe('ClocksPageComponent', () => {
    it('lists clocks with their status and names the slots that block a delete', async () => {
      const fixture = TestBed.createComponent(ClocksPageComponent);
      await settlePage();
      http.expectOne('/api/clocks').flush({
        items: [
          {
            id: 7,
            name: 'News hour',
            status: 'incomplete',
            element_count: 14,
            updated_at: '2026-10-15T08:00:00Z',
          },
        ],
      });
      await settlePage();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.querySelector('.badge.warn')?.textContent).toContain('clocks.status.incomplete');
      button(page, 'common.delete')?.click();
      await settlePage();
      button(overlay, 'common.delete')?.click();
      http.expectOne({ method: 'DELETE', url: '/api/clocks/7' }).flush(
        {
          status: 409,
          code: 'clock_in_use',
          title: 'Conflict',
          used_by: [{ kind: 'grid_slot', id: 3, name: 'Monday 10:00' }],
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settlePage();
      expect(overlay.textContent).toContain('Monday 10:00');
    });
  });

  describe('ClockEditComponent', () => {
    async function create(): Promise<{ view: EditView; ref: ComponentRef<ClockEditComponent> }> {
      const fixture = TestBed.createComponent(ClockEditComponent);
      await settlePage();
      return {
        view: fixture.componentInstance as unknown as EditView,
        ref: fixture.componentRef,
      };
    }

    async function open(stored = clock()): Promise<{
      view: EditView;
      ref: ComponentRef<ClockEditComponent>;
    }> {
      const fixture = TestBed.createComponent(ClockEditComponent);
      fixture.componentRef.setInput('id', String(stored.id));
      await settlePage();
      http.expectOne(`/api/clocks/${stored.id}`).flush(stored);
      await settlePage();
      return {
        view: fixture.componentInstance as unknown as EditView,
        ref: fixture.componentRef,
      };
    }

    function flushPool(items: ApiSchema<'FillerPoolEntry'>[] = []): void {
      http.expectOne('/api/clocks/7/filler-pool').flush({ items });
    }

    it('sends the template, then asks for the filler of the short segment', async () => {
      const { view, ref } = await create();
      const replaceState = vi.spyOn(TestBed.inject(Location), 'replaceState');
      const form = view.form;
      form.controls.name.setValue('News hour');
      view.addElement();
      view.addElement();
      await settlePage();
      const [news, music] = form.controls.elements.controls;
      news.controls.placement.setValue('fixed');
      news.controls.fixed_minute.setValue(0);
      news.controls.nominal_duration_ms.setValue(300_000);
      news.controls.playlist_ids.setValue([3]);
      music.controls.duration_tolerance_ms.setValue(30_000);
      music.controls.playlist_ids.setValue([4, 9]);
      view.save();

      const post = http.expectOne({ method: 'POST', url: '/api/clocks' });
      // Empty tolerances are left out, so the backend applies its default settings.
      expect(post.request.body).toEqual({
        name: 'News hour',
        default_filler_mode: null,
        elements: [
          {
            placement: 'fixed',
            fixed_minute: 0,
            nominal_duration_ms: 300_000,
            playlist_ids: [3],
            filler_mode: 'none',
          },
          {
            placement: 'flow',
            nominal_duration_ms: 210_000,
            duration_tolerance_ms: 30_000,
            playlist_ids: [4, 9],
            filler_mode: 'none',
          },
        ],
      });
      const short = segment({ start_ms: 300_000, shortfall_ms: 40_000, element_indexes: [1] });
      post.flush(
        saveResult(
          { shortfall_ms: 40_000, requires_filler_choice: true, short_segments: [0] },
          clock({ status: 'incomplete', layout: { shortfall_ms: 40_000, segments: [short] } }),
        ),
      );
      await settlePage();
      expect(replaceState).toHaveBeenCalledWith('/clocks/7');
      flushPool();

      const dialog = TestBed.inject(MatDialog).openDialogs[0];
      expect(dialog).toBeDefined();
      const dialogForm = (
        dialog.componentInstance as unknown as {
          form: {
            controls: { segments: { at(i: number): { controls: { filler_mode: FormControl } } } };
          };
        }
      ).form;
      dialogForm.controls.segments.at(0).controls.filler_mode.setValue('random');
      await settlePage();
      button(overlay, 'filler.dialog.save')?.click();

      const filler = http.expectOne({ method: 'POST', url: '/api/clocks/7/save-with-filler' });
      expect(filler.request.body).toEqual({ segments: [{ segment: 0, filler_mode: 'random' }] });
      filler.flush(saveResult({}, clock({ status: 'complete' })));
      await settlePage();

      const page = ref.location.nativeElement as HTMLElement;
      expect(page.textContent).toContain('clocks.status.complete');
      expect(waitFor).toHaveBeenCalledWith(40);
      expect(page.textContent).toContain('clocks.build.completed');
    });

    it('puts an element field error on that element', async () => {
      const { view } = await open();
      flushPool();
      view.form.controls.elements.at(1).controls.nominal_duration_ms.setValue(3_500_000);
      view.form.markAsDirty();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/clocks/7' });
      expect(put.request.body.elements.map((element: { id: number }) => element.id)).toEqual([
        11, 12,
      ]);
      put.flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [
            {
              field: 'elements[0].fixed_minute',
              code: 'does_not_fit',
              message: 'the material before it does not fit',
            },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      expect(view.form.controls.elements.at(0).controls.fixed_minute.hasError('server')).toBe(true);
      expect(view.form.controls.elements.at(1).controls.fixed_minute.hasError('server')).toBe(
        false,
      );
    });

    it('shows replaced fixed elements and the warnings of the dry check', async () => {
      const { view, ref } = await open();
      flushPool();
      view.move(1, -1);
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/clocks/7' });
      expect(put.request.body.elements.map((element: { id: number }) => element.id)).toEqual([
        12, 11,
      ]);
      put.flush(
        saveResult({
          replaced_elements: [{ ...clock().elements[0], id: 5, fixed_minute: 30 }],
          warnings: [
            {
              code: 'element_no_fitting_track',
              element_index: 1,
              message: 'no track fits element 2',
            },
          ],
        }),
      );
      await settlePage();

      const page = ref.location.nativeElement as HTMLElement;
      expect(page.textContent).toContain('clocks.check.replaced');
      expect(page.querySelectorAll('app-clock-element')[1].textContent).toContain(
        'no track fits element 2',
      );
      expect(view.form.dirty).toBe(false);
    });

    it('edits the unused tracks of the filler pool and keeps the used ones as history', async () => {
      const { ref } = await open();
      flushPool([
        { track_id: 1, title: 'Used song', position: 1, used_at: '2026-10-14T10:00:00Z' },
        { track_id: 2, title: 'Waiting song', position: 2 },
      ]);
      await settlePage();

      const page = ref.location.nativeElement as HTMLElement;
      expect(page.querySelector('app-clock-filler-pool')?.textContent).toContain('Used song');
      const pool = ref.instance['pool']() as unknown as { unused: FormControl<number[] | null> };
      expect(pool.unused.value).toEqual([2]);
      pool.unused.setValue([2, 5]);
      pool.unused.markAsDirty();
      expect(ref.instance.hasUnsavedChanges()).toBe(true);
      await settlePage();
      button(page, 'clocks.pool.save')?.click();

      const put = http.expectOne({ method: 'PUT', url: '/api/clocks/7/filler-pool' });
      expect(put.request.body).toEqual({ track_ids: [2, 5] });
      put.flush({ items: [{ track_id: 2, title: 'Waiting song', position: 2 }] });
      await settlePage();
      expect(ref.instance.hasUnsavedChanges()).toBe(false);
      // The picker reads the chosen tracks to show their titles.
      for (const request of http.match((req) => /^\/api\/tracks\/\d+$/.test(req.url))) {
        request.flush(null, { status: 404, statusText: 'Not Found' });
      }
    });
  });
});
