import { OverlayContainer } from '@angular/cdk/overlay';
import { Location } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Observable, map } from 'rxjs';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationState, OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { SettingsService } from '../../core/settings/settings.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import ClockEditComponent from './clock-edit.component';
import { Clock, ClockForm, ClockSaveResult, Playlist, fillShares } from './clock-form';
import ClocksPageComponent from './clocks-page.component';

const playlist = (
  id: number,
  name: string,
  clockRule: Playlist['clock_rule'],
  clockCount?: number,
): Playlist => ({
  id,
  name,
  clock_rule: clockRule,
  ...(clockCount !== undefined ? { clock_count: clockCount } : {}),
  track_count: 40,
  play_rule_ids: [],
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
});

const MUSIC = playlist(3, 'Music', 'fill');
const JINGLES = playlist(4, 'Jingles', 'spread', 2);
const GOLD = playlist(5, 'Gold', 'fill');
const PLAYLISTS = [MUSIC, JINGLES, GOLD];

const clock = (overrides: Partial<Clock> = {}): Clock => ({
  id: 7,
  name: 'Music hour',
  updated_at: '2026-10-15T08:00:00Z',
  playlists: [
    { playlist_id: 3, position: 0, effective_rule: 'fill' },
    { playlist_id: 4, position: 1, effective_rule: 'spread', effective_count: 2 },
  ],
  inserts: [
    { id: 21, offset_ms: 1_800_000, tolerance_ms: 60_000, playlist_id: 4 },
    { id: 20, offset_ms: 1_780_000, tolerance_ms: 60_000, track_id: 9 },
  ],
  ...overrides,
});

const saveResult = (
  saved = clock(),
  overrides: Partial<ClockSaveResult> = {},
): ClockSaveResult => ({
  clock: saved,
  sample: {
    hour_start_utc: '2026-10-15T10:00:00Z',
    items: [
      {
        offset_ms: 0,
        length_ms: 372_000,
        track_id: 1,
        title: 'Long song',
        artist: 'Band',
        source: 'fill',
        playlist_id: 3,
        truncated: false,
      },
      {
        offset_ms: 1_780_000,
        length_ms: 20_000,
        track_id: 9,
        title: 'Pre-news jingle',
        source: 'insert',
        insert_index: 0,
        truncated: false,
      },
    ],
  },
  warnings: [],
  build_operation_id: 40,
  ...overrides,
});

interface EditView {
  form: ClockForm;
  addPlaylist: FormControl<number | null>;
  save(): void;
  addInsert(): void;
  removePlaylist(index: number): void;
}

describe('clocks', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;
  let runOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const build: OperationState = {
      id: 40,
      kind: 'clock_build',
      status: 'completed',
      updatedAt: '2026-10-15T08:00:05Z',
    };
    runOperation = vi.fn((start: Observable<{ operation_id: number }>) =>
      start.pipe(map(() => build)),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideFakeAudio(new FakeAudio()),
        {
          provide: OperationsService,
          useValue: { operations: signal([build]).asReadonly(), runOperation },
        },
        {
          provide: SettingsService,
          useValue: {
            get: (key: string) =>
              key === 'rotation.default_fixed_tolerance_ms' ? { key, value: 30_000 } : undefined,
          },
        },
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
      ['/api/playlists', '/api/tracks', '/api/playlist-types'].includes(req.url),
    )) {
      if (!request.cancelled) {
        request.flush({ items: request.request.url === '/api/playlists' ? PLAYLISTS : [] });
      }
    }
    // The track picker reads the chosen tracks to show their titles.
    for (const request of http.match((item) => /^\/api\/tracks\/\d+$/.test(item.url))) {
      if (!request.cancelled) {
        request.flush(null, { status: 404, statusText: 'Not Found' });
      }
    }
  }

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    );

  describe('ClocksPageComponent', () => {
    it('lists clocks with their playlists and inserts, and names the slots that block a delete', async () => {
      const fixture = TestBed.createComponent(ClocksPageComponent);
      await settlePage();
      http.expectOne('/api/clocks').flush({
        items: [
          {
            id: 7,
            name: 'Music hour',
            playlist_count: 2,
            insert_count: 3,
            updated_at: '2026-10-15T08:00:00Z',
          },
        ],
      });
      await settlePage();

      const page = fixture.nativeElement as HTMLElement;
      const cells = [...page.querySelectorAll('td')].map((cell) => cell.textContent?.trim());
      expect(cells).toContain('2');
      expect(cells).toContain('3');
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
    // The editor reads the playlists for their own rules; the add select reads them too.
    function flushPlaylists(): void {
      for (const request of http.match('/api/playlists')) {
        request.flush({ items: PLAYLISTS });
      }
    }

    async function create(): Promise<{ view: EditView; ref: ComponentRef<ClockEditComponent> }> {
      const fixture = TestBed.createComponent(ClockEditComponent);
      await settlePage();
      flushPlaylists();
      await settlePage();
      return { view: fixture.componentInstance as unknown as EditView, ref: fixture.componentRef };
    }

    async function open(stored = clock()): Promise<{
      view: EditView;
      ref: ComponentRef<ClockEditComponent>;
    }> {
      const fixture = TestBed.createComponent(ClockEditComponent);
      fixture.componentRef.setInput('id', String(stored.id));
      await settlePage();
      http.expectOne(`/api/clocks/${stored.id}`).flush(stored);
      flushPlaylists();
      await settlePage();
      return { view: fixture.componentInstance as unknown as EditView, ref: fixture.componentRef };
    }

    it('needs a fill playlist, then sends the playlists and inserts and shows the sample', async () => {
      const { view, ref } = await create();
      const replaceState = vi.spyOn(TestBed.inject(Location), 'replaceState');
      const form = view.form;
      const page = ref.location.nativeElement as HTMLElement;
      form.controls.name.setValue('Music hour');

      view.addPlaylist.setValue(JINGLES.id);
      await settlePage();
      expect(form.controls.playlists.hasError('fillPlaylistRequired')).toBe(true);
      expect(page.textContent).toContain('clocks.playlists.fillRequired');
      expect(form.invalid).toBe(true);

      view.addPlaylist.setValue(MUSIC.id);
      // The same playlist is not added twice.
      view.addPlaylist.setValue(MUSIC.id);
      await settlePage();
      expect(form.controls.playlists.length).toBe(2);
      expect(view.addPlaylist.value).toBeNull();

      view.addInsert();
      await settlePage();
      const insert = form.controls.inserts.at(0);
      // A new insert proposes the tolerance of the setting.
      expect(insert.controls.tolerance_ms.value).toBe(30_000);
      const offset = page.querySelector('app-offset-input input') as HTMLInputElement;
      offset.value = '29:40';
      offset.dispatchEvent(new Event('input'));
      insert.controls.track_id.setValue([9]);
      await settlePage();
      expect(form.valid).toBe(true);
      view.save();

      const post = http.expectOne({ method: 'POST', url: '/api/clocks' });
      // No override and no share: the playlists keep their own rules.
      expect(post.request.body).toEqual({
        name: 'Music hour',
        playlists: [{ playlist_id: 4 }, { playlist_id: 3 }],
        inserts: [{ offset_ms: 1_780_000, tolerance_ms: 30_000, track_id: 9 }],
      });
      post.flush(
        saveResult(clock(), {
          warnings: [
            {
              code: 'fill_no_interval_rule',
              message: 'no interval',
              playlist_index: 0,
            },
          ],
        }),
      );
      await settlePage();

      expect(replaceState).toHaveBeenCalledWith('/clocks/7');
      expect(runOperation).toHaveBeenCalledOnce();
      expect(page.textContent).toContain('operationStatus.completed');
      const sample = page.querySelector('app-clock-sample') as HTMLElement;
      expect(sample.textContent).toContain('Long song');
      expect(sample.textContent).toContain('29:40');
      expect(sample.querySelector('.item.insert')?.textContent).toContain('Pre-news jingle');
      // Tests load no translations, so the backend's message is shown.
      expect(page.querySelector('.result .warnings')?.textContent).toContain('no interval');
      // The warning names a playlist row, so the row shows it too.
      expect(page.querySelectorAll('app-clock-playlist-row')[0].textContent).toContain(
        'no interval',
      );
      expect(form.dirty).toBe(false);
    });

    it('loads the clock with its own rules and sends an override and shares', async () => {
      const { view } = await open();
      const rows = view.form.controls.playlists;
      // The inserts are shown in time order.
      expect(view.form.controls.inserts.controls.map((item) => item.value.offset_ms)).toEqual([
        1_780_000, 1_800_000,
      ]);
      expect(view.form.controls.inserts.at(1).controls.source.value).toBe('playlist');

      const jingles = rows.at(1);
      jingles.controls.override.setValue(true);
      // An override starts from the playlist's own rule.
      expect(jingles.controls.clock_rule.value).toBe('spread');
      expect(jingles.controls.clock_count.value).toBe(2);
      jingles.controls.clock_count.setValue(4);

      view.addPlaylist.setValue(GOLD.id);
      rows.at(0).controls.fill_weight.setValue(30);
      expect(rows.hasError('fillWeightsPartial')).toBe(true);
      rows.at(2).controls.fill_weight.setValue(70);
      expect(rows.valid).toBe(true);
      expect(fillShares(rows.controls)).toEqual([30, null, 70]);
      await settlePage();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/clocks/7' });
      expect(put.request.body).toEqual({
        name: 'Music hour',
        playlists: [
          { playlist_id: 3, fill_weight: 30 },
          { playlist_id: 4, clock_rule: 'spread', clock_count: 4 },
          { playlist_id: 5, fill_weight: 70 },
        ],
        inserts: [
          { offset_ms: 1_780_000, tolerance_ms: 60_000, track_id: 9 },
          { offset_ms: 1_800_000, tolerance_ms: 60_000, playlist_id: 4 },
        ],
      });
      put.flush(saveResult());
      await settlePage();
    });

    it('turns a share off when an override makes the row a rule row', async () => {
      const { view } = await open();
      const music = view.form.controls.playlists.at(0);
      music.controls.fill_weight.setValue(50);
      music.controls.override.setValue(true);
      music.controls.clock_rule.setValue('start');

      expect(music.controls.fill_weight.disabled).toBe(true);
      expect(music.controls.clock_count.disabled).toBe(true);
      // Music no longer fills, and Jingles never did.
      expect(view.form.controls.playlists.hasError('fillPlaylistRequired')).toBe(true);

      music.controls.override.setValue(false);
      expect(music.controls.clock_rule.disabled).toBe(true);
      expect(music.controls.fill_weight.enabled).toBe(true);
      expect(view.form.controls.playlists.valid).toBe(true);
    });

    it('needs the source of an insert and sends only the chosen one', async () => {
      const { view } = await open();
      const insert = view.form.controls.inserts.at(0);
      insert.controls.source.setValue('playlist');
      expect(insert.hasError('insertSource')).toBe(true);
      insert.controls.playlist_id.setValue(4);
      expect(insert.valid).toBe(true);
      await settlePage();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/clocks/7' });
      expect(put.request.body.inserts[0]).toEqual({
        offset_ms: 1_780_000,
        tolerance_ms: 60_000,
        playlist_id: 4,
      });
      put.flush(saveResult());
      await settlePage();
    });

    it('puts an insert field error on that insert', async () => {
      const { view } = await open();
      view.form.markAsDirty();
      view.save();

      http.expectOne({ method: 'PUT', url: '/api/clocks/7' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [
            {
              field: 'inserts[1].offset_ms',
              code: 'insert_offset_taken',
              message: 'two inserts at 30:00',
            },
            {
              field: 'playlists',
              code: 'fill_playlist_required',
              message: 'no fill playlist',
            },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      const inserts = view.form.controls.inserts;
      expect(inserts.at(1).controls.offset_ms.hasError('server')).toBe(true);
      expect(inserts.at(0).controls.offset_ms.hasError('server')).toBe(false);
      expect(view.form.controls.playlists.hasError('server')).toBe(true);
    });

    it('keeps unsaved changes until a save', async () => {
      const { view, ref } = await open();
      expect(ref.instance.hasUnsavedChanges()).toBe(false);
      view.removePlaylist(1);
      expect(ref.instance.hasUnsavedChanges()).toBe(true);
    });
  });
});
