import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { Observable, map } from 'rxjs';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationState, OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import PlaylistEditComponent, { MEMBER_PAGE_SIZE } from './playlist-edit.component';
import PlaylistsPageComponent from './playlists-page.component';

type Playlist = ApiSchema<'Playlist'>;
type Track = ApiSchema<'Track'>;

const playlist = (overrides: Partial<Playlist> = {}): Playlist => ({
  id: 4,
  name: 'Morning music',
  type: { id: 1, code: 'music', name: 'Music' },
  clock_rule: 'fill',
  track_count: 3,
  play_rule_ids: [],
  created_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

const track = (id: number): Track => ({
  id,
  title: `Song ${id}`,
  file_path: `music/${id}.mp3`,
  fixes: [],
  play_rule_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  playlist_ids: [4],
  quality_issues: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  in_use: null,
});

interface EditView {
  form: FormGroup<{
    name: FormControl<string | null>;
    type_id: FormControl<number | null>;
    clock_rule: FormControl<string | null>;
    clock_count: FormControl<number | null>;
    rule_ids: FormControl<number[] | null>;
    track_ids: FormControl<number[] | null>;
  }>;
  save(): void;
}

describe('playlists', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;
  let runOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const build: OperationState = {
      id: 60,
      kind: 'clock_build',
      status: 'running',
      updatedAt: '2026-10-15T08:00:00Z',
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
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes(label),
    );

  describe('PlaylistsPageComponent', () => {
    it('filters by type and names the clocks that block a delete', async () => {
      const fixture = TestBed.createComponent(PlaylistsPageComponent);
      await settlePage();
      http.expectOne('/api/playlist-types').flush({ items: [] });
      http
        .expectOne((req) => req.url === '/api/playlists' && !req.params.has('type_id'))
        .flush({ items: [playlist()] });
      await settlePage();

      const component = fixture.componentInstance as unknown as {
        typeFilter: FormControl<number | null>;
      };
      component.typeFilter.setValue(2);
      await settlePage();
      http
        .expectOne((req) => req.url === '/api/playlists' && req.params.get('type_id') === '2')
        .flush({
          items: [playlist({ id: 6, name: 'Jingles', clock_rule: 'spread', clock_count: 2 })],
        });
      await settlePage();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.textContent).toContain('Jingles');
      // The placement rule is a badge; without loaded translations the key is shown.
      expect(page.textContent).toContain('forms.clockRule.spreadCount');
      button(page, 'common.delete')?.click();
      await settlePage();
      button(overlay, 'common.delete')?.click();
      http.expectOne({ method: 'DELETE', url: '/api/playlists/6' }).flush(
        {
          status: 409,
          code: 'playlist_in_use',
          title: 'Conflict',
          used_by: [{ kind: 'clock', id: 2, name: 'Morning clock' }],
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settlePage();
      expect(overlay.textContent).toContain('Morning clock');
    });
  });

  describe('PlaylistEditComponent', () => {
    async function open(): Promise<{ view: EditView; ref: ComponentRef<PlaylistEditComponent> }> {
      const fixture = TestBed.createComponent(PlaylistEditComponent);
      fixture.componentRef.setInput('id', '4');
      await settlePage();
      http.expectOne('/api/playlists/4').flush(playlist({ play_rule_ids: [9] }));
      // The members come in pages; every page is read before the form is filled.
      http
        .expectOne(
          (req) =>
            req.url === '/api/tracks' &&
            req.params.get('playlist_id') === '4' &&
            req.params.get('limit') === String(MEMBER_PAGE_SIZE) &&
            !req.params.has('cursor'),
        )
        .flush({ items: [track(1), track(2)], next_cursor: 'p2' });
      http
        .expectOne((req) => req.url === '/api/tracks' && req.params.get('cursor') === 'p2')
        .flush({ items: [track(3)] });
      await settlePage();
      for (const request of http.match(
        (req) => req.url !== '/api/tracks' || !req.params.has('playlist_id'),
      )) {
        request.flush({ items: [] });
      }
      await settlePage();
      return {
        view: fixture.componentInstance as unknown as EditView,
        ref: fixture.componentRef,
      };
    }

    it('shows every member and saves the membership as a set when it changed', async () => {
      const { view, ref } = await open();
      expect(view.form.controls.track_ids.value).toEqual([1, 2, 3]);
      const members = (ref.location.nativeElement as HTMLElement).querySelector(
        'app-playlist-tracks',
      );
      expect(members?.textContent).toContain('Song 3');

      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      view.form.controls.track_ids.setValue([3, 1]);
      view.form.controls.track_ids.markAsDirty();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/playlists/4/tracks' });
      expect(put.request.body).toEqual({ track_ids: [3, 1] });
      put.flush(playlist({ track_count: 2 }));
      await settlePage();
      expect(navigate).toHaveBeenCalledWith('/playlists');
    });

    it('narrows the library search with the track filters', async () => {
      const { ref } = await open();
      const root = ref.location.nativeElement as HTMLElement;
      // The members have their own filters first; the library search comes second.
      const filters = root.querySelectorAll('app-playlist-tracks app-track-filters').item(1);
      expect(filters?.querySelector('input[type="search"]')).not.toBeNull();

      filters?.querySelector<HTMLButtonElement>('.filters-toggle')?.click();
      await settlePage();
      for (const request of http.match((req) => req.url !== '/api/tracks')) {
        request.flush({ items: [] });
      }
      await settlePage();
      filters?.querySelector<HTMLElement>('.check input')?.click();
      await settlePage();

      const search = http.expectOne(
        (req) =>
          req.url === '/api/tracks' &&
          !req.params.has('playlist_id') &&
          req.params.get('in_playlist') === 'false',
      );
      search.flush({ items: [track(8)] });
      await settlePage();
      expect(root.querySelector('app-playlist-tracks')?.textContent).toContain('Song 8');
    });

    it('sends only the parts that changed', async () => {
      const { view } = await open();
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      view.form.controls.name.setValue('Morning pop');
      view.form.controls.name.markAsDirty();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/playlists/4' });
      expect(put.request.body).toEqual({ name: 'Morning pop', type_id: 1, clock_rule: 'fill' });
      put.flush(playlist({ name: 'Morning pop', play_rule_ids: [9] }));
      await settlePage();
      http.expectNone('/api/playlists/4/play-rules');
      http.expectNone('/api/playlists/4/tracks');
    });

    it('saves the placement rule and stays to follow the rebuild of its clocks', async () => {
      const { view, ref } = await open();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const { clock_rule, clock_count } = view.form.controls;
      expect(clock_count.disabled).toBe(true);

      clock_rule.setValue('spread');
      clock_rule.markAsDirty();
      // The count is required for spread only.
      expect(clock_count.enabled).toBe(true);
      expect(view.form.invalid).toBe(true);
      clock_count.setValue(2);
      clock_count.markAsDirty();
      await settlePage();
      expect(
        (ref.location.nativeElement as HTMLElement).querySelector('app-clock-rule-input'),
      ).not.toBeNull();
      view.save();

      const put = http.expectOne({ method: 'PUT', url: '/api/playlists/4' });
      expect(put.request.body).toEqual({
        name: 'Morning music',
        type_id: 1,
        clock_rule: 'spread',
        clock_count: 2,
      });
      put.flush({
        ...playlist({ clock_rule: 'spread', clock_count: 2, play_rule_ids: [9] }),
        build_operation_id: 60,
      });
      await settlePage();

      expect(navigate).not.toHaveBeenCalled();
      expect(runOperation).toHaveBeenCalledOnce();
      expect(ref.location.nativeElement.textContent).toContain('playlists.clockRule.rebuilding');
      expect(ref.instance.hasUnsavedChanges()).toBe(false);
    });

    it('puts a refused count on its field', async () => {
      const { view } = await open();
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      view.form.controls.clock_rule.setValue('spread');
      view.form.controls.clock_rule.markAsDirty();
      view.form.controls.clock_count.setValue(3);
      await settlePage();
      view.save();

      http.expectOne({ method: 'PUT', url: '/api/playlists/4' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [
            { field: 'clock_count', code: 'clock_count_required', message: 'count required' },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      expect(view.form.controls.clock_count.hasError('server')).toBe(true);
    });

    it('asks before leaving with unsaved changes', async () => {
      const { view, ref } = await open();
      expect(ref.instance.hasUnsavedChanges()).toBe(false);
      view.form.controls.name.setValue('Changed');
      view.form.controls.name.markAsDirty();
      expect(ref.instance.hasUnsavedChanges()).toBe(true);
    });
  });
});
