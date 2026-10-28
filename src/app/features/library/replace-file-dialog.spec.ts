import { OverlayContainer } from '@angular/cdk/overlay';
import { AbstractControl } from '@angular/forms';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import type { ApiSchema } from '../../core/api/api-types';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import { ReplaceFileDialogComponent } from './replace-file-dialog.component';
import TrackEditComponent from './track-edit.component';
import { Track, trackForm } from './track-form';

const track = (id: number, overrides: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artist: { id: 50, name: 'Artist' },
  duration_ms: 225_000,
  file_path: `music/${id}.mp3`,
  format: 'mp3',
  bitrate: 320_000,
  sample_rate: 44_100,
  quality_ok: true,
  fixes: [],
  play_rule_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  playlist_ids: [],
  quality_issues: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  in_use: null,
  ...overrides,
});

const FOLDERS: ApiSchema<'ImportFolders'> = {
  folders: [
    { path: 'music', audio_files: 4, new_files: 1 },
    { path: 'music/rock', audio_files: 2, new_files: 0 },
  ],
  root: { audio_files: 6, new_files: 1 },
  more: false,
};

const file = (
  path: string,
  status: ApiSchema<'ImportFile'>['status'],
  track_id?: number,
): ApiSchema<'ImportFile'> => ({
  path,
  size: 1024,
  modified_at: '2026-10-01T00:00:00Z',
  status,
  ...(track_id === undefined ? {} : { track_id }),
});

/** Track 3 is the one being edited, so its own file is shown as the current file. */
const FILES: ApiSchema<'ImportFiles'> = {
  folder: 'music',
  items: [
    file('music/new.wav', 'new'),
    file('music/3.mp3', 'in_library', 3),
    file('music/other.mp3', 'in_library', 9),
    file('music/original.mp3', 'original', 4),
    file('music/notes.txt', 'not_audio'),
  ],
  more: false,
};

/** The parts of the dialog the tests drive; the page itself is reached through the DOM. */
interface DialogView {
  form: { controls: { folder: AbstractControl; file_path: AbstractControl } };
}

describe('replace track file', () => {
  let http: HttpTestingController;
  let server: FakeSocketServer;
  let overlay: HTMLElement;

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        provideFakeAudio(new FakeAudio()),
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
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.trim() === label,
    );

  /** The radio of a file row, found by its path; its input is what the manager clicks. */
  const row = (path: string) =>
    [...overlay.querySelectorAll<HTMLElement>('mat-radio-button')].find((element) =>
      element.textContent?.includes(path),
    );
  const pick = (path: string) => row(path)?.querySelector<HTMLInputElement>('input')?.click();

  async function openEdit(stored: Track): Promise<ComponentFixture<TrackEditComponent>> {
    const fixture = TestBed.createComponent(TrackEditComponent);
    fixture.componentRef.setInput('id', String(stored.id));
    await settlePage();
    http.expectOne(`/api/tracks/${stored.id}`).flush(stored);
    await settlePage();
    http
      .match((req) => !req.url.startsWith('assets/'))
      .forEach((request) => request.flush({ items: [] }));
    await settlePage();
    return fixture;
  }

  /** Opens the dialog from the page's Replace file button; the folders load on open. */
  async function openDialog(
    fixture: ComponentFixture<TrackEditComponent>,
    folders: ApiSchema<'ImportFolders'> = FOLDERS,
  ): Promise<DialogView> {
    button(fixture.nativeElement as HTMLElement, 'library.replaceFile.button')?.click();
    await settlePage();
    http.expectOne('/api/import/folders').flush(folders);
    await settlePage();
    const ref = TestBed.inject(MatDialog)
      .openDialogs[0] as MatDialogRef<ReplaceFileDialogComponent>;
    return ref.componentInstance as unknown as DialogView;
  }

  /** Chooses a folder the way the folder select does: the value changes and the files load. */
  async function chooseFolder(
    view: DialogView,
    folder = 'music',
    list: ApiSchema<'ImportFiles'> = FILES,
  ): Promise<void> {
    view.form.controls.folder.setValue(folder);
    await settlePage();
    http
      .expectOne((req) => req.url === '/api/import/files' && req.params.get('folder') === folder)
      .flush(list);
    await settlePage();
  }

  /** Submits the dialog form, as pressing Save does. */
  function save(): void {
    overlay.querySelector('form')?.dispatchEvent(new Event('submit'));
  }

  it('disables Replace file while the form has changes', async () => {
    const fixture = await openEdit(track(3));
    const page = fixture.nativeElement as HTMLElement;
    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);

    const view = fixture.componentInstance as unknown as { form: ReturnType<typeof trackForm> };
    view.form.controls.title.setValue('Changed');
    view.form.markAsDirty();
    await settlePage();

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(true);
    expect(page.textContent).toContain('library.edit.reviewSaveFirst');
  });

  it('disables Replace file with a hint while the track is in a clock or the plan', async () => {
    const fixture = await openEdit(track(3, { in_use: true }));
    const page = fixture.nativeElement as HTMLElement;

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(true);
    expect(page.textContent).toContain('library.replaceFile.inUse');
  });

  it('enables Replace file when the track is not in use', async () => {
    const fixture = await openEdit(track(3, { in_use: false }));
    const page = fixture.nativeElement as HTMLElement;

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);
    expect(page.textContent).not.toContain('library.replaceFile.inUse');
  });

  it('enables Replace file when the use is unknown (null)', async () => {
    const fixture = await openEdit(track(3, { in_use: null }));
    const page = fixture.nativeElement as HTMLElement;

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);
    expect(page.textContent).not.toContain('library.replaceFile.inUse');
  });

  it('disables Replace file while another media operation runs', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    const fixture = await openEdit(track(3));
    const page = fixture.nativeElement as HTMLElement;
    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);

    button(page, 'library.media.analyse')?.click();
    http
      .expectOne({ method: 'POST', url: '/api/tracks/analyse' })
      .flush({ operation_id: 61 }, { status: 202, statusText: 'Accepted' });
    await settlePage();

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(true);
  });

  it('disables Replace file while a media operation started elsewhere runs', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    const fixture = await openEdit(track(3));
    const page = fixture.nativeElement as HTMLElement;
    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);

    server.latest.send({
      type: 'import.progress',
      time: '2026-10-15T08:05:00Z',
      operation_id: 70,
      data: { kind: 'import', done: 1, total: 4, message: 'music/new.wav' },
    });
    await settlePage();
    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(true);

    server.latest.send({
      type: 'import.completed',
      time: '2026-10-15T08:06:00Z',
      operation_id: 70,
      data: { kind: 'import', summary: '4 imported' },
    });
    await settlePage();
    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);
  });

  it('keeps Replace file enabled while a non-media operation runs', async () => {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
    const fixture = await openEdit(track(3));
    const page = fixture.nativeElement as HTMLElement;

    server.latest.send({
      type: 'clock_build.progress',
      time: '2026-10-15T08:05:00Z',
      operation_id: 71,
      data: { kind: 'clock_build', done: 3, total: 24, message: 'hour 3' },
    });
    await settlePage();

    expect(button(page, 'library.replaceFile.button')?.disabled).toBe(false);
  });

  it('loads the folders on open and no files until a folder is chosen', async () => {
    const fixture = await openEdit(track(3));
    await openDialog(fixture);

    expect(overlay.querySelector('app-import-folder-select')).not.toBeNull();
    expect(overlay.textContent).toContain('import.folder.choose');
    http.expectNone((req) => req.url === '/api/import/files');
  });

  it('says so when the media folder has no subfolders', async () => {
    const fixture = await openEdit(track(3));
    await openDialog(fixture, { folders: [], root: { audio_files: 0, new_files: 0 }, more: false });

    expect(overlay.textContent).toContain('library.replaceFile.noFolders');
  });

  it('shows a folder load error with a retry', async () => {
    const fixture = await openEdit(track(3));
    button(fixture.nativeElement as HTMLElement, 'library.replaceFile.button')?.click();
    await settlePage();
    http
      .expectOne('/api/import/folders')
      .flush(
        { status: 500, title: 'Internal Server Error', detail: 'The folders are unreadable.' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await settlePage();

    expect(overlay.querySelector('[role="alert"]')?.textContent).toContain('Internal Server Error');
    expect(button(overlay, 'common.retry')).toBeDefined();
  });

  it('loads the files of the chosen folder and shows the empty folder', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view, 'music', { folder: 'music', items: [], more: false });

    expect(overlay.textContent).toContain('library.replaceFile.emptyFolder');
  });

  it('sends the media root as no folder, as the import page does', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    view.form.controls.folder.setValue('');
    await settlePage();
    http
      .expectOne((req) => req.url === '/api/import/files' && !req.params.has('folder'))
      .flush({ folder: '', items: [], more: false });
    await settlePage();
  });

  it('selects only new files; the others are disabled and show their status', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view);

    const inputs = [...overlay.querySelectorAll<HTMLInputElement>('mat-radio-button input')];
    expect(inputs.map((input) => input.disabled)).toEqual([false, true, true, true, true]);
    expect(row('music/3.mp3')?.textContent).toContain('import.folder.statuses.in_library');
    expect(row('music/3.mp3')?.textContent).toContain('library.replaceFile.currentFile');
    expect(row('music/other.mp3')?.textContent).toContain('import.folder.statuses.in_library');
    expect(row('music/original.mp3')?.textContent).toContain('import.folder.statuses.original');
    expect(row('music/notes.txt')?.textContent).toContain('import.folder.statuses.not_audio');

    pick('music/3.mp3');
    expect(view.form.controls.file_path.value).toBeNull();
    pick('music/new.wav');
    expect(view.form.controls.file_path.value).toBe('music/new.wav');
  });

  it('says when the list is cut', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view, 'music', { ...FILES, more: true });

    expect(overlay.textContent).toContain('import.folder.moreFiles');
  });

  it('clears the chosen file when another folder is chosen', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view);
    pick('music/new.wav');

    view.form.controls.folder.setValue('music/rock');
    await settlePage();
    http
      .expectOne(
        (req) => req.url === '/api/import/files' && req.params.get('folder') === 'music/rock',
      )
      .flush({ folder: 'music/rock', items: [], more: false });
    await settlePage();

    expect(view.form.controls.file_path.value).toBeNull();
  });

  it('posts the chosen path, closes with the track, and shows the new length', async () => {
    const fixture = await openEdit(track(3));
    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('(3:45)');

    const view = await openDialog(fixture);
    await chooseFolder(view);
    pick('music/new.wav');
    await settlePage();
    save();
    const post = http.expectOne({ method: 'POST', url: '/api/tracks/3/replace-file' });
    expect(post.request.body).toEqual({ file_path: 'music/new.wav' });
    post.flush(track(3, { file_path: 'music/new.wav', duration_ms: 180_000 }));
    await settlePage();
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);

    http
      .expectOne('/api/tracks/3')
      .flush(track(3, { file_path: 'music/new.wav', duration_ms: 180_000 }));
    await settlePage();
    expect(page.querySelector('.file-fact .value')?.textContent).toContain('music/new.wav');
    expect(page.textContent).toContain('(3:00)');
    expect(page.textContent).toContain('library.replaceFile.success');
    // Nothing was cleared or reset, so neither note is shown.
    expect(page.textContent).not.toContain('library.replaceFile.reviewCleared');
    expect(page.textContent).not.toContain('library.replaceFile.cueReset');
  });

  it('shows the field error of a path that another track has on the file', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view);
    pick('music/new.wav');
    save();
    http.expectOne({ method: 'POST', url: '/api/tracks/3/replace-file' }).flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Unprocessable Entity',
        errors: [
          {
            field: 'file_path',
            code: 'taken',
            message: 'Track 7 already uses this file.',
          },
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(view.form.controls.file_path.hasError('server')).toBe(true);
    expect(overlay.textContent).toContain('Track 7 already uses this file.');
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
  });

  it('shows a refusal with what uses the track, and keeps the dialog open', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view);
    pick('music/new.wav');
    save();
    http.expectOne({ method: 'POST', url: '/api/tracks/3/replace-file' }).flush(
      {
        status: 409,
        code: 'track_in_use',
        title: 'Conflict',
        detail: 'The track is in use and cannot be changed right now.',
        used_by: [{ kind: 'clock', id: 2, name: 'Morning' }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settlePage();

    expect(overlay.textContent).toContain('The track is in use and cannot be changed right now.');
    expect(overlay.textContent).toContain('Morning');
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
  });

  it('shows a missing file (404) and keeps the dialog open', async () => {
    const fixture = await openEdit(track(3));
    const view = await openDialog(fixture);
    await chooseFolder(view);
    pick('music/new.wav');
    save();
    http.expectOne({ method: 'POST', url: '/api/tracks/3/replace-file' }).flush(
      {
        status: 404,
        code: 'track_file_not_found',
        title: 'Not Found',
        detail: 'The audio file of the track was not found.',
      },
      { status: 404, statusText: 'Not Found' },
    );
    await settlePage();

    expect(overlay.textContent).toContain('The audio file of the track was not found.');
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
  });

  it('says when the replace cleared the reviewed mark and reset the cue', async () => {
    const fixture = await openEdit(
      track(3, { reviewed_at: '2026-10-15T08:00:00Z', cue_out_ms: 200_000 }),
    );
    const page = fixture.nativeElement as HTMLElement;

    const view = await openDialog(fixture);
    await chooseFolder(view, 'music', {
      ...FILES,
      items: [file('music/short.mp3', 'new')],
    });
    pick('music/short.mp3');
    save();
    http
      .expectOne({ method: 'POST', url: '/api/tracks/3/replace-file' })
      .flush(track(3, { file_path: 'music/short.mp3', duration_ms: 150_000 }));
    await settlePage();
    http
      .expectOne('/api/tracks/3')
      .flush(track(3, { file_path: 'music/short.mp3', duration_ms: 150_000 }));
    await settlePage();

    expect(page.textContent).toContain('library.replaceFile.reviewCleared');
    expect(page.textContent).toContain('library.replaceFile.cueReset');
  });
});
