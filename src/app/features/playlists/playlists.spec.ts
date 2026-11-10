import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Location } from '@angular/common';
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
import en from '../../../assets/i18n/en.json';
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

const EMERGENCY_KEY = 'playout.emergency_playlist_id';
const SETTING_URL = `/api/settings/${EMERGENCY_KEY}`;

/** The reply to `GET /api/settings` with this emergency playlist; null means none is set. */
const settingsWith = (value: number | null) => ({
  items: [{ key: EMERGENCY_KEY, group: 'playout', value, apply: 'immediate' }],
});
const savedSetting = (value: number | null) => ({
  key: EMERGENCY_KEY,
  group: 'playout',
  value,
  apply: 'immediate',
});
const serverError = {
  status: 500,
  code: 'internal',
  title: 'Internal Server Error',
};
const failWith500 = (request: TestRequest) =>
  request.flush(serverError, { status: 500, statusText: 'Internal Server Error' });

interface EditView {
  form: FormGroup<{
    name: FormControl<string | null>;
    type_id: FormControl<number | null>;
    clock_rule: FormControl<string | null>;
    clock_count: FormControl<number | null>;
    rule_ids: FormControl<number[] | null>;
    track_ids: FormControl<number[] | null>;
    emergency: FormControl<boolean>;
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
      http.expectOne('/api/settings').flush(settingsWith(null));
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

    async function openList(reply: (request: TestRequest) => void): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(PlaylistsPageComponent);
      await settlePage();
      http.expectOne('/api/playlist-types').flush({ items: [] });
      reply(http.expectOne('/api/settings'));
      http
        .expectOne((req) => req.url === '/api/playlists')
        .flush({ items: [playlist(), playlist({ id: 6, name: 'Jingles' })] });
      await settlePage();
      return fixture.nativeElement as HTMLElement;
    }

    const badgedRows = (page: HTMLElement) =>
      [...page.querySelectorAll('.emergency')].map(
        (badge) => badge.closest('tr')?.querySelector('a')?.textContent,
      );

    it('marks only the current emergency playlist', async () => {
      const page = await openList((request) => request.flush(settingsWith(6)));
      expect(badgedRows(page)).toEqual(['Jingles']);
    });

    it('shows no badge when no emergency playlist is set', async () => {
      const page = await openList((request) => request.flush(settingsWith(null)));
      expect(badgedRows(page)).toEqual([]);
    });

    it('works without the badge when the setting cannot be read', async () => {
      const page = await openList(failWith500);
      expect(badgedRows(page)).toEqual([]);
      expect(page.textContent).toContain('Jingles');
      expect(page.querySelector('.load-error')).toBeNull();
    });

    it('shows the emergency reason of a refused delete, with the delete button enabled', async () => {
      const page = await openList((request) => request.flush(settingsWith(4)));
      const remove = button(page, 'common.delete');
      expect(remove?.disabled).toBe(false);
      remove?.click();
      await settlePage();
      button(overlay, 'common.delete')?.click();
      http.expectOne({ method: 'DELETE', url: '/api/playlists/4' }).flush(
        {
          status: 409,
          code: 'playlist_in_use',
          title: 'Conflict',
          used_by: [{ kind: 'emergency_playlist', id: 4, name: 'Morning music' }],
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settlePage();
      expect(overlay.textContent).toContain('Morning music');
    });
  });

  it('has the emergency texts in the translations', () => {
    expect(en.dialogs.usedBy.kinds.emergency_playlist).toContain('Use as emergency playlist');
    expect(Object.keys(en.playlists.emergency).sort()).toEqual([
      'badge',
      'clearFailed',
      'clears',
      'label',
      'noPlayable',
      'readFailed',
      'replaces',
      'replacesUnnamed',
      'setFailed',
    ]);
  });

  describe('PlaylistEditComponent', () => {
    interface OpenOptions {
      emergency?: number | null;
      /** Replies to the read of the setting instead of `emergency`. */
      settings?: (request: TestRequest) => void;
      members?: Track[];
      playlists?: Playlist[];
    }

    async function open(
      options: OpenOptions = {},
    ): Promise<{ view: EditView; ref: ComponentRef<PlaylistEditComponent> }> {
      const fixture = TestBed.createComponent(PlaylistEditComponent);
      fixture.componentRef.setInput('id', '4');
      await settlePage();
      const reply =
        options.settings ??
        ((request: TestRequest) => request.flush(settingsWith(options.emergency ?? null)));
      reply(http.expectOne('/api/settings'));
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
        .flush({ items: options.members ?? [track(1), track(2)], next_cursor: 'p2' });
      http
        .expectOne((req) => req.url === '/api/tracks' && req.params.get('cursor') === 'p2')
        .flush({ items: options.members ? [] : [track(3)] });
      await settlePage();
      for (const request of http.match(
        (req) => req.url !== '/api/tracks' || !req.params.has('playlist_id'),
      )) {
        request.flush({
          items: request.request.url === '/api/playlists' ? (options.playlists ?? []) : [],
        });
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

    describe('emergency playlist box', () => {
      const text = (ref: ComponentRef<PlaylistEditComponent>) =>
        (ref.location.nativeElement as HTMLElement).textContent ?? '';
      const tick = async (view: EditView, value: boolean) => {
        view.form.controls.emergency.setValue(value);
        view.form.controls.emergency.markAsDirty();
        await settlePage();
      };
      const stubNavigation = () =>
        vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      async function openNew(
        reply: (request: TestRequest) => void = (r) => r.flush(settingsWith(null)),
      ) {
        const fixture = TestBed.createComponent(PlaylistEditComponent);
        await settlePage();
        reply(http.expectOne('/api/settings'));
        await settlePage();
        for (const request of http.match((req) => req.url !== '/api/tracks')) {
          request.flush({ items: [] });
        }
        for (const request of http.match((req) => req.url === '/api/tracks')) {
          request.flush({ items: [] });
        }
        await settlePage();
        const view = fixture.componentInstance as unknown as EditView;
        view.form.controls.name.setValue('Backup');
        view.form.controls.name.markAsDirty();
        view.form.controls.type_id.setValue(1);
        view.form.controls.type_id.markAsDirty();
        await settlePage();
        return { view, ref: fixture.componentRef };
      }

      it('opens ticked only for the current emergency playlist', async () => {
        const current = await open({ emergency: 4 });
        expect(current.view.form.controls.emergency.value).toBe(true);
        expect(current.view.form.controls.emergency.enabled).toBe(true);
        expect(current.ref.instance.hasUnsavedChanges()).toBe(false);
      });

      it('opens unticked for another playlist', async () => {
        const other = await open({ emergency: 9 });
        expect(other.view.form.controls.emergency.value).toBe(false);
      });

      it('opens unticked for a new playlist', async () => {
        const { view } = await openNew();
        expect(view.form.controls.emergency.value).toBe(false);
        expect(view.form.controls.emergency.enabled).toBe(true);
      });

      it('counts a changed box as an unsaved change', async () => {
        const { view, ref } = await open();
        await tick(view, true);
        expect(ref.instance.hasUnsavedChanges()).toBe(true);
      });

      it('creates the playlist first, then writes the setting with the returned ID', async () => {
        const navigate = stubNavigation();
        const { view } = await openNew();
        await tick(view, true);
        view.save();

        http.expectNone({ method: 'PUT', url: SETTING_URL });
        http.expectOne({ method: 'POST', url: '/api/playlists' }).flush(playlist({ id: 12 }));
        const put = http.expectOne({ method: 'PUT', url: SETTING_URL });
        expect(put.request.body).toEqual({ value: 12 });
        put.flush(savedSetting(12));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('does not write the setting when the box did not change', async () => {
        const navigate = stubNavigation();
        const { view } = await open({ emergency: 4 });
        view.form.controls.name.setValue('Morning pop');
        view.form.controls.name.markAsDirty();
        view.save();

        http
          .expectOne({ method: 'PUT', url: '/api/playlists/4' })
          .flush(playlist({ name: 'Morning pop', play_rule_ids: [9] }));
        await settlePage();
        http.expectNone({ method: 'PUT', url: SETTING_URL });
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('names the playlist it replaces and writes this one', async () => {
        const navigate = stubNavigation();
        const { view, ref } = await open({
          emergency: 9,
          playlists: [playlist({ id: 9, name: 'Backup' })],
        });
        await tick(view, true);
        expect(text(ref)).toContain('playlists.emergency.replaces');
        expect(text(ref)).not.toContain('playlists.emergency.replacesUnnamed');
        view.save();

        const put = http.expectOne({ method: 'PUT', url: SETTING_URL });
        expect(put.request.body).toEqual({ value: 4 });
        put.flush(savedSetting(4));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('warns when the current one is unticked and writes None', async () => {
        const navigate = stubNavigation();
        const { view, ref } = await open({ emergency: 4 });
        await tick(view, false);
        expect(text(ref)).toContain('playlists.emergency.clears');
        view.save();

        const put = http.expectOne({ method: 'PUT', url: SETTING_URL });
        expect(put.request.body).toEqual({ value: null });
        put.flush(savedSetting(null));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('does not write the setting when the playlist save fails', async () => {
        const { view } = await open();
        await tick(view, true);
        view.form.controls.name.setValue('Morning pop');
        view.form.controls.name.markAsDirty();
        view.save();

        failWith500(http.expectOne({ method: 'PUT', url: '/api/playlists/4' }));
        await settlePage();
        http.expectNone({ method: 'PUT', url: SETTING_URL });
      });

      it('keeps a new playlist saved and on its edit page when the write fails', async () => {
        const navigate = stubNavigation();
        const replaceState = vi.spyOn(TestBed.inject(Location), 'replaceState');
        const { view, ref } = await openNew();
        await tick(view, true);
        view.save();

        http.expectOne({ method: 'POST', url: '/api/playlists' }).flush(playlist({ id: 12 }));
        failWith500(http.expectOne({ method: 'PUT', url: SETTING_URL }));
        await settlePage();

        expect(navigate).not.toHaveBeenCalled();
        expect(replaceState).toHaveBeenCalledWith('/playlists/12');
        expect(text(ref)).toContain('playlists.emergency.setFailed');
        expect(ref.instance.hasUnsavedChanges()).toBe(true);

        // Saving again retries the setting and does not create the playlist a second time.
        view.save();
        http.expectNone({ method: 'POST', url: '/api/playlists' });
        http.expectOne({ method: 'PUT', url: SETTING_URL }).flush(savedSetting(12));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('disables the box when the setting cannot be read, and saving still works', async () => {
        const navigate = stubNavigation();
        const { view, ref } = await open({ settings: failWith500 });
        expect(view.form.controls.emergency.disabled).toBe(true);
        expect(text(ref)).toContain('playlists.emergency.readFailed');

        view.form.controls.name.setValue('Morning pop');
        view.form.controls.name.markAsDirty();
        view.save();
        http
          .expectOne({ method: 'PUT', url: '/api/playlists/4' })
          .flush(playlist({ name: 'Morning pop', play_rule_ids: [9] }));
        await settlePage();
        http.expectNone({ method: 'PUT', url: SETTING_URL });
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('warns on an empty track list and still saves', async () => {
        const navigate = stubNavigation();
        const { view, ref } = await open({ members: [] });
        await tick(view, true);
        expect(text(ref)).toContain('playlists.emergency.noPlayable');
        view.save();
        http.expectOne({ method: 'PUT', url: SETTING_URL }).flush(savedSetting(4));
        await settlePage();
        expect(navigate).toHaveBeenCalledWith('/playlists');
      });

      it('does not warn when a track has a known duration', async () => {
        const timed = await open({ members: [{ ...track(1), duration_ms: 1000 }] });
        await tick(timed.view, true);
        expect(text(timed.ref)).not.toContain('playlists.emergency.noPlayable');
      });

      it('warns when the tracks have no known duration', async () => {
        const untimed = await open({ members: [track(1)] });
        await tick(untimed.view, true);
        expect(text(untimed.ref)).toContain('playlists.emergency.noPlayable');
      });
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
