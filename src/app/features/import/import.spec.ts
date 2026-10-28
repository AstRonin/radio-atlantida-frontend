import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import { applyServerErrors } from '../../shared/forms/server-errors';
import { ImportFolderSelectComponent } from '../../shared/pickers/import-folder-select.component';
import ImportPageComponent from './import-page.component';

type Folders = ApiSchema<'ImportFolders'>;
type Files = ApiSchema<'ImportFiles'>;

const folders = (overrides: Partial<Folders> = {}): Folders => ({
  root: { audio_files: 5, new_files: 5 },
  folders: [
    { path: 'jingles', audio_files: 2, new_files: 2 },
    { path: 'music', audio_files: 3, new_files: 3 },
    { path: 'music/rock', audio_files: 1, new_files: 0 },
  ],
  more: false,
  ...overrides,
});

const files = (overrides: Partial<Files> = {}): Files => ({
  folder: 'jingles',
  items: [
    {
      path: 'jingles/id1.mp3',
      size: 5_242_880,
      modified_at: '2026-10-15T08:00:00Z',
      status: 'new',
    },
    {
      path: 'jingles/id2.mp3',
      size: 900,
      modified_at: '2026-10-15T08:01:00Z',
      status: 'in_library',
      track_id: 17,
    },
    {
      path: 'jingles/id3.flac',
      size: 900,
      modified_at: '2026-10-15T08:02:00Z',
      status: 'original',
      track_id: 18,
    },
    {
      path: 'jingles/notes.txt',
      size: 10,
      modified_at: '2026-10-15T08:03:00Z',
      status: 'not_audio',
    },
  ],
  more: false,
  ...overrides,
});

interface ImportView {
  form: FormGroup<{
    folder: FormControl<string | null>;
    type_id: FormControl<number | null>;
    playlist_ids: FormControl<number[] | null>;
    artist_id: FormControl<number | null>;
  }>;
  analysing: () => boolean;
  analysisPercent: () => number | null;
}

const filesUrl = (request: { url: string }) => request.url === '/api/import/files';

describe('import', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  describe('ImportFolderSelectComponent', () => {
    function render(more = false) {
      const control = new FormControl<string | null>(null);
      const fixture = TestBed.createComponent(ImportFolderSelectComponent);
      fixture.componentRef.setInput('control', control);
      fixture.componentRef.setInput('folders', folders().folders);
      fixture.componentRef.setInput('root', folders().root);
      fixture.componentRef.setInput('more', more);
      return { fixture, control };
    }

    afterEach(() => {
      flushHelp(TestBed.inject(HttpTestingController));
    });

    async function options(fixture: ComponentFixture<unknown>): Promise<string[]> {
      await fixture.whenStable();
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLElement>('.mat-mdc-select-trigger')
        ?.click();
      await fixture.whenStable();
      return [...document.querySelectorAll('mat-option')].map(
        (option) => option.textContent?.trim() ?? '',
      );
    }

    it('offers the whole media folder first, then each folder in the given order', async () => {
      const { fixture } = render();
      expect(await options(fixture)).toEqual([
        'import.folder.rootOption',
        'import.folder.option',
        'import.folder.option',
        'import.folder.option',
      ]);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'import.folder.moreFolders',
      );
    });

    it('says when not every folder is listed', async () => {
      const { fixture } = render(true);
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'import.folder.moreFolders',
      );
    });

    it('shows a server error on the folder under the control', async () => {
      const { fixture, control } = render();
      const form = new FormGroup({ folder: control });
      await fixture.whenStable();
      applyServerErrors(form, [{ field: 'folder', code: 'invalid', message: 'no such folder' }]);
      await fixture.whenStable();
      const error = (fixture.nativeElement as HTMLElement).querySelector('mat-error');
      // No translations are loaded in tests, so the code's text falls back to the server message.
      expect(error?.textContent).toContain('no such folder');
    });
  });

  describe('ImportPageComponent', () => {
    let http: HttpTestingController;
    let server: FakeSocketServer;

    beforeEach(() => {
      server = new FakeSocketServer();
      TestBed.configureTestingModule({ providers: [server.provider] });
      http = TestBed.inject(HttpTestingController);
      TestBed.inject(RealtimeService).connect();
      server.latest.open();
    });

    afterEach(() => {
      flushHelp(http);
      http.verify();
    });

    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) => element.textContent?.trim() === label,
      );

    async function open(list: Folders = folders()): Promise<ComponentFixture<unknown>> {
      const fixture = TestBed.createComponent(ImportPageComponent);
      await settlePage();
      http.expectOne('/api/import/folders').flush(list);
      http.expectOne('/api/playlist-types').flush({
        items: [{ id: 1, code: 'jingle', name: 'Jingle' }],
      });
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne('/api/artists').flush({ items: [{ id: 9, name: 'DJ Ann' }] });
      await settlePage();
      return fixture;
    }

    const view = (fixture: ComponentFixture<unknown>) => fixture.componentInstance as ImportView;

    async function choose(
      fixture: ComponentFixture<unknown>,
      folder: string,
      list: Files = files(),
    ): Promise<void> {
      view(fixture).form.controls.folder.setValue(folder);
      await settlePage();
      const request = http.expectOne(filesUrl);
      expect(request.request.params.get('folder')).toBe(folder || null);
      request.flush(list);
      await settlePage();
    }

    function completed(id: number, summary: string): void {
      server.latest.send({
        type: 'import.completed',
        time: '2026-10-15T08:05:00Z',
        operation_id: id,
        data: { kind: 'import', summary },
      });
    }

    it('asks for a folder first and loads no files', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      view(fixture).form.controls.type_id.setValue(1);
      await settlePage();
      http.expectNone(filesUrl);
      expect(page.textContent).toContain('import.folder.choose');
      expect(button(page, 'import.form.start')?.disabled).toBe(true);
    });

    it('lists the files of the chosen folder with their status', async () => {
      const fixture = await open();
      await choose(fixture, 'jingles', files({ more: true }));
      const page = fixture.nativeElement as HTMLElement;
      const rows = page.querySelectorAll('tr.mat-mdc-row');
      expect(rows).toHaveLength(4);
      expect(rows[0].textContent).toContain('jingles/id1.mp3');
      expect(rows[0].textContent).toContain('5 MB');
      expect(rows[0].textContent).toContain('import.folder.statuses.new');
      expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/library/17');
      expect(rows[1].textContent).toContain('import.folder.statuses.in_library');
      expect(rows[2].querySelector('a')?.getAttribute('href')).toBe('/library/18');
      expect(rows[2].textContent).toContain('import.folder.statuses.original');
      expect(rows[3].querySelector('a')).toBeNull();
      expect(rows[3].textContent).toContain('import.folder.statuses.not_audio');
      expect(page.textContent).toContain('import.folder.counts');
      expect(page.textContent).toContain('import.folder.moreFiles');
    });

    it('loads the whole media folder without a query, and a new choice cancels the old one', async () => {
      const fixture = await open();
      view(fixture).form.controls.folder.setValue('music');
      await settlePage();
      const first = http.expectOne(filesUrl);
      view(fixture).form.controls.folder.setValue('');
      await settlePage();
      expect(first.cancelled).toBe(true);
      const root = http.expectOne(filesUrl);
      expect(root.request.params.keys()).toEqual([]);
      root.flush(files({ folder: '' }));
    });

    it('imports a folder with type, playlists, and artist, and reloads after the import', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'jingles');
      view(fixture).form.patchValue({ type_id: 1, playlist_ids: [4, 5], artist_id: 9 });
      await settlePage();

      button(page, 'import.form.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/import' });
      expect(start.request.body).toEqual({
        folder: 'jingles',
        type_id: 1,
        playlist_ids: [4, 5],
        artist_id: 9,
      });
      start.flush({ operation_id: 31 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'import.form.start')?.disabled).toBe(true);

      server.latest.send({
        type: 'import.progress',
        time: '2026-10-15T08:04:00Z',
        operation_id: 31,
        data: { kind: 'import', done: 1, total: 2, message: '1 of 2 files' },
      });
      await settlePage();
      expect(page.textContent).toContain('1 of 2 files');

      completed(31, 'folder jingles: 2 imported');
      await settlePage();
      const done = folders({
        folders: folders().folders.map((folder) =>
          folder.path === 'jingles' ? { ...folder, new_files: 0 } : folder,
        ),
      });
      http.expectOne('/api/import/folders').flush(done);
      http.expectOne(filesUrl).flush(files({ items: files().items.slice(1) }));
      await settlePage();
      expect(page.textContent).toContain('folder jingles: 2 imported');
      const link = page.querySelector<HTMLAnchorElement>('a[href*="quality=issues"]');
      expect(link?.getAttribute('href')).toBe('/library?quality=issues');
      const review = page.querySelector<HTMLAnchorElement>('a[href*="reviewed=false"]');
      expect(review?.getAttribute('href')).toBe('/library?reviewed=false');
      expect(view(fixture).form.controls.folder.value).toBe('jingles');
      expect(button(page, 'import.form.start')?.disabled).toBe(true);
    });

    it('shows the analysis of the running import as a bar', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'jingles');
      view(fixture).form.patchValue({ type_id: 1, playlist_ids: [4] });
      await settlePage();

      button(page, 'import.form.start')?.click();
      http.expectOne({ method: 'POST', url: '/api/import' }).flush(
        { operation_id: 33 },
        { status: 202, statusText: 'Accepted' },
      );
      await settlePage();
      expect(view(fixture).analysing()).toBe(false);

      const analysed = (operation_id: number, done: number, total: number) =>
        server.latest.send({
          type: 'track.analysed',
          time: '2026-10-15T08:04:30Z',
          data: { track_id: done, quality_issues: [], operation_id, done, total },
        });
      analysed(33, 1, 3);
      await settlePage();
      expect(view(fixture).analysing()).toBe(true);

      analysed(33, 2, 3);
      await settlePage();
      expect(view(fixture).analysisPercent()).toBe(67);
      expect(page.querySelector('.analysis-status')?.textContent).toContain('operations.progress');

      // An analysis of another operation (an analyse run, say) is not this import's.
      analysed(34, 3, 3);
      await settlePage();
      expect(view(fixture).analysisPercent()).toBe(67);

      completed(33, 'folder jingles: 3 imported; analysis: analysed 3');
      await settlePage();
      http.expectOne('/api/import/folders').flush(folders());
      http.expectOne(filesUrl).flush(files());
      await settlePage();
      // The import is over: the analysis bar is gone, the summary stays.
      expect(view(fixture).analysing()).toBe(false);
      expect(page.querySelector('.analysis-status')).toBeNull();
      expect(page.textContent).toContain('folder jingles: 3 imported; analysis: analysed 3');
    });

    it('applies the analysis that arrived before the start response named the import', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'jingles');
      view(fixture).form.patchValue({ type_id: 1 });
      await settlePage();

      button(page, 'import.form.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/import' });
      // The backend analyses the first tracks before the start response reaches the page.
      const analysed = (done: number) =>
        server.latest.send({
          type: 'track.analysed',
          time: '2026-10-15T08:04:30Z',
          data: { track_id: done, quality_issues: [], operation_id: 35, done, total: 3 },
        });
      analysed(1);
      analysed(2);
      await settlePage();
      expect(view(fixture).analysing()).toBe(false);

      start.flush({ operation_id: 35 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(view(fixture).analysing()).toBe(true);
      expect(view(fixture).analysisPercent()).toBe(67);
      expect(page.querySelector('.analysis-status')?.textContent).toContain('operations.progress');
    });

    it('sends no folder for the whole media folder and no artist when none is chosen', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, '', files({ folder: '' }));
      view(fixture).form.patchValue({ type_id: 1 });
      await settlePage();

      button(page, 'import.form.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/import' });
      expect(start.request.body).toEqual({ type_id: 1, playlist_ids: [] });
      start.flush({ operation_id: 32 }, { status: 202, statusText: 'Accepted' });
    });

    it('shows a long folder in pages, starting again at the first page for another folder', async () => {
      const many = (count: number): Files =>
        files({
          items: Array.from({ length: count }, (_, index) => ({
            path: `music/song-${String(index + 1).padStart(3, '0')}.mp3`,
            size: 1000,
            modified_at: '2026-10-15T08:00:00Z',
            status: 'new' as const,
          })),
        });
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      const rows = () => [...page.querySelectorAll('tr.mat-mdc-row')];
      const next = () =>
        page.querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')?.click();

      await choose(fixture, 'music', many(25));
      expect(rows()).toHaveLength(10);
      expect(rows()[0].textContent).toContain('song-001');
      expect(page.querySelector('mat-paginator')).not.toBeNull();

      next();
      await settlePage();
      expect(rows()[0].textContent).toContain('song-011');

      next();
      await settlePage();
      expect(rows()).toHaveLength(5);

      // A reload with fewer files moves back to the last page that still has files.
      button(page, 'import.refresh')?.click();
      await settlePage();
      http.expectOne('/api/import/folders').flush(folders());
      http.expectOne(filesUrl).flush(many(15));
      await settlePage();
      expect(rows()[0].textContent).toContain('song-011');

      await choose(fixture, 'jingles', many(15));
      expect(rows()[0].textContent).toContain('song-001');

      await choose(fixture, 'music/rock', many(10));
      expect(page.querySelector('mat-paginator')).toBeNull();
    });

    it('keeps Import off for a folder without new files', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'music/rock', files({ folder: 'music/rock', items: [] }));
      view(fixture).form.patchValue({ type_id: 1 });
      await settlePage();
      expect(page.textContent).toContain('import.folder.empty');
      expect(button(page, 'import.form.start')?.disabled).toBe(true);

      await choose(fixture, 'music');
      expect(button(page, 'import.form.start')?.disabled).toBe(false);
    });

    it('reloads when an import started elsewhere ends, and clears a folder that is gone', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'jingles');

      completed(40, 'folder music: 3 imported');
      await settlePage();
      http.expectOne('/api/import/folders').flush(folders({ folders: folders().folders.slice(1) }));
      http.expectOne(filesUrl).flush(files());
      await settlePage();
      expect(view(fixture).form.controls.folder.value).toBeNull();
      expect(page.textContent).toContain('import.folder.gone');
      expect(page.textContent).toContain('import.folder.choose');
    });

    it('keeps a folder past the listing limit', async () => {
      const fixture = await open();
      await choose(fixture, 'jingles');

      button(fixture.nativeElement as HTMLElement, 'import.refresh')?.click();
      await settlePage();
      http
        .expectOne('/api/import/folders')
        .flush(folders({ folders: folders().folders.slice(1), more: true }));
      http.expectOne(filesUrl).flush(files());
      await settlePage();
      expect(view(fixture).form.controls.folder.value).toBe('jingles');
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'import.folder.gone',
      );
    });

    it('shows a refusal while another media operation runs, and field errors on the controls', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      await choose(fixture, 'jingles');
      view(fixture).form.patchValue({ type_id: 1, artist_id: 9 });
      await settlePage();

      button(page, 'import.form.start')?.click();
      http.expectOne({ method: 'POST', url: '/api/import' }).flush(
        {
          status: 409,
          code: 'media_operation_running',
          title: 'Conflict',
          detail: 'An analysis is running.',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settlePage();
      expect(page.querySelector('.form-error')?.textContent).toContain('An analysis is running.');
      expect(button(page, 'import.form.start')?.disabled).toBe(false);

      button(page, 'import.form.start')?.click();
      http.expectOne({ method: 'POST', url: '/api/import' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [
            { field: 'folder', code: 'invalid', message: 'no such folder in the media folder' },
            { field: 'artist_id', code: 'unknown_id', message: 'No such artist.' },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      const form = view(fixture).form;
      expect(form.controls.folder.hasError('server')).toBe(true);
      expect(form.controls.artist_id.hasError('server')).toBe(true);
    });

    it('cancels the open requests when the page is left', async () => {
      const fixture = await open();
      view(fixture).form.controls.folder.setValue('music');
      await settlePage();
      const request = http.expectOne(filesUrl);
      fixture.destroy();
      expect(request.cancelled).toBe(true);
    });

    it('analyses every track never analysed', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      button(page, 'import.analyse.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/analyse' });
      expect(start.request.body).toEqual({});
      start.flush({ operation_id: 32 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'import.analyse.start')?.disabled).toBe(true);

      server.latest.send({
        type: 'analyse.completed',
        time: '2026-10-15T08:05:00Z',
        operation_id: 32,
        data: { kind: 'analyse', summary: '12 analysed' },
      });
      await settlePage();
      expect(page.textContent).toContain('12 analysed');
      expect(button(page, 'import.analyse.start')?.disabled).toBe(false);
    });
  });
});
