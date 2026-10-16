import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { DeferBlockState, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { Observable, map } from 'rxjs';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { OperationState, OperationsService } from '../../core/operations/operations.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { PlayerService } from '../../core/player/player.service';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { SettingsService } from '../../core/settings/settings.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import {
  FakeWaveformBrowser,
  provideFakeWaveformBrowser,
} from '../../shared/waveform/waveform.testing';
import { cueForm } from './track-cue-form';
import { TrackCueComponent } from './track-cue.component';
import TrackEditComponent from './track-edit.component';
import { Track } from './track-form';

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 7,
  title: 'Live at the Hall',
  artist: { id: 50, name: 'Band' },
  duration_ms: 240_000,
  air_duration_ms: 240_000,
  file_path: 'music/live.mp3',
  file_checksum: 'abc',
  format: 'mp3',
  quality_ok: true,
  quality_issues: [],
  quality_notes: '',
  fixes: [],
  play_rule_ids: [],
  playlist_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  ...overrides,
});

const WAVEFORM = {
  duration_ms: 240_000,
  bucket_ms: 50,
  peaks: Array.from({ length: 4800 }, () => [-90, 90]).flat(),
  max_peak: 90,
};

const problem = (status: number, code: string, errors: unknown[] = []) => ({
  status,
  code,
  title: 'Refused',
  detail: code,
  errors,
});

interface CueView {
  form: ReturnType<typeof cueForm>;
  save(): void;
}

describe('track cue editor (F20)', () => {
  let http: HttpTestingController;
  let audio: FakeAudio;
  let runOperation: ReturnType<typeof vi.fn>;
  let snackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    audio = new FakeAudio();
    snackBar = { open: vi.fn() };
    const rebuild: OperationState = {
      id: 31,
      kind: 'clock_build',
      status: 'running',
      updatedAt: '2026-10-16T10:00:00Z',
    };
    runOperation = vi.fn((start: Observable<{ operation_id: number }>) =>
      start.pipe(map(() => rebuild)),
    );
    const defaults: Record<string, number> = {
      'liquidsoap.cue_fade_in_ms': 1000,
      'liquidsoap.cue_fade_out_ms': 2000,
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        new FakeSocketServer().provider,
        provideFakeAudio(audio),
        provideFakeWaveformBrowser(new FakeWaveformBrowser()),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatSnackBar, useValue: snackBar },
        {
          provide: SettingsService,
          useValue: {
            get: (key: string) => (key in defaults ? { key, value: defaults[key] } : undefined),
          },
        },
        {
          provide: OperationsService,
          useValue: { operations: signal([rebuild]).asReadonly(), runOperation },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.trim() === label,
    );

  async function open(stored = track(), waveform: object | null = WAVEFORM) {
    const fixture = TestBed.createComponent(TrackCueComponent);
    const saved: Track[] = [];
    fixture.componentRef.setInput('track', stored);
    fixture.componentInstance.saved.subscribe((value) => saved.push(value));
    await settlePage();
    if (waveform) {
      http.expectOne('/api/tracks/7/waveform').flush(waveform);
      await settlePage();
    }
    return {
      fixture,
      saved,
      page: fixture.nativeElement as HTMLElement,
      view: fixture.componentInstance as unknown as CueView,
    };
  }

  const expectCue = () => http.expectOne({ method: 'PUT', url: '/api/tracks/7/cue' });

  it('reads the waveform and shows the stored points on it and in the fields', async () => {
    const { page, view } = await open(
      track({ cue_in_ms: 1500, cue_out_ms: 230_000, fade_in_ms: 1000, fade_out_ms: 2000 }),
    );

    expect(page.querySelector('app-waveform-editor')).not.toBeNull();
    expect(page.querySelector('.handle.in')?.getAttribute('aria-valuetext')).toBe('0:01.500');
    expect(page.querySelector('.handle.out')?.getAttribute('aria-valuetext')).toBe('3:50.000');
    const fields = [...page.querySelectorAll<HTMLInputElement>('app-duration-input input')];
    expect(fields.map((field) => field.value)).toEqual(['0:01.500', '3:50.000']);
    expect(view.form.controls.fade_out_ms.value).toBe(2000);
    expect(page.textContent).toContain('library.cue.onAir');
  });

  it('says when the file cannot be read', async () => {
    const { page } = await open(track(), null);
    http
      .expectOne('/api/tracks/7/waveform')
      .flush(problem(409, 'waveform_unavailable'), { status: 409, statusText: 'Conflict' });
    await settlePage();

    // Tests load no translations, so the message is the problem's detail.
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('waveform_unavailable');
    expect(page.querySelector('app-waveform-editor')).toBeNull();
  });

  it('asks for an analysis first when the length is unknown', async () => {
    const { page } = await open(
      track({ duration_ms: undefined, air_duration_ms: undefined }),
      null,
    );
    expect(page.textContent).toContain('library.cue.analyseFirst');
    http.expectNone('/api/tracks/7/waveform');
  });

  it('keeps the fields and the handles in step', async () => {
    const { fixture, page, view } = await open();
    const startField = page.querySelector<HTMLInputElement>('app-duration-input input');
    if (!startField) {
      throw new Error('no start field');
    }
    startField.value = '0:12.5';
    startField.dispatchEvent(new Event('input'));
    await settlePage();
    expect(view.form.controls.cue_in_ms.value).toBe(12_500);
    expect(page.querySelector('.handle.in')?.getAttribute('aria-valuenow')).toBe('12500');

    page
      .querySelector('.handle.in')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    await settlePage();
    expect(view.form.controls.cue_in_ms.value).toBe(13_500);
    expect(startField.value).toBe('0:13.500');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);

    startField.value = 'soon';
    startField.dispatchEvent(new Event('input'));
    startField.dispatchEvent(new Event('blur'));
    await settlePage();
    expect(view.form.controls.cue_in_ms.hasError('cueTime')).toBe(true);
    expect(page.querySelector('app-duration-input mat-error')).not.toBeNull();
  });

  it('proposes the default fades when a point leaves the file edge', async () => {
    const { view } = await open();
    view.form.controls.cue_in_ms.setValue(3000);
    view.form.controls.cue_out_ms.setValue(200_000);
    expect(view.form.controls.fade_in_ms.value).toBe(1000);
    expect(view.form.controls.fade_out_ms.value).toBe(2000);

    // A fade the operator chose is kept.
    view.form.patchValue({ cue_in_ms: 0, fade_in_ms: 0 });
    view.form.controls.fade_in_ms.setValue(500);
    view.form.controls.cue_in_ms.setValue(4000);
    expect(view.form.controls.fade_in_ms.value).toBe(500);
  });

  it('mirrors the backend rules before sending', async () => {
    const { page, view } = await open();
    view.form.patchValue({ cue_in_ms: 10_000, cue_out_ms: 12_000 });
    await settlePage();
    expect(view.form.errors?.['cue']).toEqual({ code: 'air_too_short', field: 'cue_out_ms' });
    expect(page.textContent).toContain('forms.serverErrors.air_too_short');
    expect(button(page, 'library.cue.save')?.disabled).toBe(true);

    view.form.patchValue({ cue_out_ms: 9000 });
    expect(view.form.errors?.['cue'].code).toBe('cue_order');
    view.form.patchValue({ cue_out_ms: 250_000 });
    expect(view.form.errors?.['cue'].code).toBe('cue_beyond_end');
    view.form.patchValue({ cue_out_ms: 15_000, fade_in_ms: 3000, fade_out_ms: 3000 });
    expect(view.form.errors?.['cue'].code).toBe('fades_too_long');
    // The whole file passes even when it is short, and a 5 s cut passes.
    view.form.patchValue({ cue_in_ms: 0, cue_out_ms: 240_000, fade_in_ms: 0, fade_out_ms: 0 });
    expect(view.form.valid).toBe(true);
    view.form.patchValue({ cue_in_ms: 10_000, cue_out_ms: 15_000 });
    expect(view.form.valid).toBe(true);
  });

  it('saves the four fields, then marks the track reviewed', async () => {
    const { saved, view } = await open();
    view.form.patchValue({ cue_in_ms: 1200, fade_in_ms: 1000 });
    view.form.markAsDirty();
    view.save();

    const put = expectCue();
    // The end of the file is sent as null.
    expect(put.request.body).toEqual({
      cue_in_ms: 1200,
      cue_out_ms: null,
      fade_in_ms: 1000,
      fade_out_ms: 0,
    });
    put.flush({ track: track({ cue_in_ms: 1200, fade_in_ms: 1000 }) });

    const review = http.expectOne({ method: 'POST', url: '/api/tracks/review' });
    expect(review.request.body).toEqual({ track_ids: [7], reviewed: true });
    review.flush({ updated: 1, not_found: [] });
    http
      .expectOne({ method: 'GET', url: '/api/tracks/7' })
      .flush(track({ cue_in_ms: 1200, fade_in_ms: 1000, reviewed_at: '2026-10-16T10:00:00Z' }));
    await settlePage();

    expect(saved.map((value) => value.reviewed_at)).toEqual(['2026-10-16T10:00:00Z']);
    expect(view.form.dirty).toBe(false);
    expect(runOperation).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledExactlyOnceWith(
      'library.cue.savedReviewed',
      'common.close',
      expect.objectContaining({ duration: expect.any(Number) }),
    );
  });

  it('leaves the mark alone when unticked', async () => {
    const { saved, view } = await open();
    view.form.patchValue({ cue_out_ms: 200_000, reviewed: false });
    view.save();
    const put = expectCue();
    expect(put.request.body.cue_out_ms).toBe(200_000);
    put.flush({ track: track({ cue_out_ms: 200_000 }) });
    await settlePage();

    http.expectNone('/api/tracks/review');
    expect(saved).toHaveLength(1);
    expect(snackBar.open).toHaveBeenCalledExactlyOnceWith(
      'library.cue.saved',
      'common.close',
      expect.anything(),
    );
  });

  it('follows the rebuild of the planned hours', async () => {
    const { page, saved, view } = await open();
    view.form.patchValue({ cue_out_ms: 200_000, reviewed: false });
    view.save();
    expectCue().flush({ track: track({ cue_out_ms: 200_000 }), build_operation_id: 31 });
    await settlePage();

    expect(runOperation).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(1);
    expect(http.match('/api/tracks/review')).toHaveLength(0);
    expect(page.querySelector('app-operation-status')?.textContent).toContain(
      'library.cue.rebuilding',
    );
  });

  it('puts a refused field on its control and sends no review', async () => {
    const { page, view } = await open();
    view.form.patchValue({ cue_out_ms: 200_000 });
    view.save();
    expectCue().flush(
      problem(422, 'validation_failed', [
        { field: 'cue_out_ms', code: 'cue_beyond_end', message: 'past the end' },
      ]),
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();

    expect(view.form.controls.cue_out_ms.hasError('server')).toBe(true);
    expect(page.querySelector('app-duration-input mat-error')?.textContent).toContain(
      'past the end',
    );
    http.expectNone('/api/tracks/review');
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('keeps the changes when the track is on air', async () => {
    const { fixture, page, view } = await open();
    view.form.patchValue({ cue_out_ms: 200_000 });
    view.form.markAsDirty();
    view.save();
    expectCue().flush(
      { ...problem(409, 'track_on_air'), detail: 'The track is queued.' },
      { status: 409, statusText: 'Conflict' },
    );
    await settlePage();

    expect(page.querySelector('.form-error')?.textContent).toContain('The track is queued.');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    http.expectNone('/api/tracks/review');

    // While the backend says it plays, Save waits with a hint.
    fixture.componentRef.setInput('track', track({ playout_state: 'queued' }));
    await settlePage();
    expect(page.textContent).toContain('library.cue.onAirHint.queued');
    expect(button(page, 'library.cue.save')?.disabled).toBe(true);
  });

  it('previews the unsaved points with their fades, and the file from the cursor', async () => {
    const { page, view } = await open();
    view.form.patchValue({ cue_in_ms: 2000, cue_out_ms: 200_000 });
    await settlePage();

    button(page, 'library.cue.playIn')?.click();
    expect(audio.src).toBe('/api/tracks/7/audio');
    expect(audio.currentTime).toBe(2);

    button(page, 'library.cue.playBeforeOut')?.click();
    expect(audio.currentTime).toBe(195);

    // A click on the waveform at pixel 300 of 600 is 2:00; Space plays the file from there.
    TestBed.inject(PlayerService).stop();
    page
      .querySelector('.stage')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 300 }));
    page
      .querySelector('.stage')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(audio.currentTime).toBe(120);
    // No request is left open: previews read audio only.
    http.expectNone('/api/tracks/7/cue');
  });

  describe('on the track page', () => {
    it('loads the section deferred and counts its changes as unsaved', async () => {
      const fixture = TestBed.createComponent(TrackEditComponent);
      fixture.componentRef.setInput('id', '7');
      await settlePage();
      http.expectOne('/api/tracks/7').flush(track());
      for (const request of http.match((req) => req.url !== '/api/tracks/7/waveform')) {
        request.flush({ items: [] });
      }
      await settlePage();

      const [deferred] = await fixture.getDeferBlocks();
      await deferred.render(DeferBlockState.Complete);
      await settlePage();
      http.expectOne('/api/tracks/7/waveform').flush(WAVEFORM);
      await settlePage();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.querySelector('app-track-cue')).not.toBeNull();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

      page
        .querySelector('.handle.out')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
      await settlePage();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });
  });
});
