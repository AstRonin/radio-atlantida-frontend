import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { concatMap, filter, of, pairwise, startWith } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { followOperation } from '../../core/operations/operation-run';
import { PlayerService, PreviewTrack } from '../../core/player/player.service';
import { SettingsService } from '../../core/settings/settings.service';
import { formatCueTime } from '../../core/time/duration';
import { DurationInputComponent } from '../../shared/forms/duration-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import {
  CueRange,
  WavePlayRequest,
  WaveformEditorComponent,
} from '../../shared/waveform/waveform-editor.component';
import {
  CUE_LIMITS,
  CueError,
  FADE_CHOICES_MS,
  cueBody,
  cueForm,
  cueFormValue,
} from './track-cue-form';

type Track = ApiSchema<'Track'>;

/** The settings the editor proposes when a point leaves the file edge (backend phase 22 §2.2). */
/** How long the "saved" notice stays in the corner. */
export const CUE_SAVED_NOTICE_MS = 4000;

const DEFAULT_FADE_KEYS = {
  in: 'liquidsoap.cue_fade_in_ms',
  out: 'liquidsoap.cue_fade_out_ms',
} as const;

/**
 * "Start and stop" of a track (frontend F20 §5.2): the cue in and cue out on the waveform and in
 * fields, the fades, a preview of the unsaved points, and Save with `PUT /api/tracks/{id}/cue`.
 * The file is never changed. A save that changes the cut of a planned track rebuilds those hours;
 * the section follows that operation.
 */
@Component({
  selector: 'app-track-cue',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    TranslatePipe,
    DurationInputComponent,
    NumberInputComponent,
    OperationStatusComponent,
    WaveformEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-section" aria-labelledby="cue-heading">
      <h2 id="cue-heading" class="section-title">{{ 'library.cue.title' | translate }}</h2>
      @if (durationMs(); as duration) {
        @if (waveform.isLoading()) {
          <mat-progress-bar
            mode="indeterminate"
            [attr.aria-label]="'library.cue.loadingWaveform' | translate"
          />
          <p class="muted">{{ 'library.cue.loadingWaveform' | translate }}</p>
        }
        @if (waveformError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (waveform.hasValue()) {
          @let wave = waveform.value();
          <app-waveform-editor
            [peaks]="wave.peaks"
            [bucketMs]="wave.bucket_ms"
            [maxPeak]="wave.max_peak"
            [durationMs]="duration"
            [cueIn]="points().cueIn"
            [cueOut]="points().cueOut"
            [fadeIn]="points().fadeIn"
            [fadeOut]="points().fadeOut"
            [position]="position()"
            [minAirMs]="limits.minAirMs"
            (cueChange)="setCue($event)"
            (seek)="seek($event)"
            (playRequest)="play($event)"
          />
        }

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-grid">
            <app-duration-input
              [control]="form.controls.cue_in_ms"
              label="library.cue.cue_in_ms"
              hintPage="help.library"
              hintField="cue_in_ms"
            />
            <app-duration-input
              [control]="form.controls.cue_out_ms"
              label="library.cue.cue_out_ms"
              hintPage="help.library"
              hintField="cue_out_ms"
            />
            @for (fade of fades; track fade.control) {
              <div class="fade">
                <app-number-input
                  [control]="form.controls[fade.control]"
                  [label]="'library.cue.' + fade.control"
                  [min]="0"
                  [max]="limits.fadeMaxMs"
                  [step]="100"
                  suffix="forms.units.ms"
                  hintPage="help.library"
                  [hintField]="fade.control"
                />
                <div
                  class="choices"
                  role="group"
                  [attr.aria-label]="'library.cue.fadeChoices' | translate"
                >
                  @for (ms of fadeChoices; track ms) {
                    <button
                      matButton
                      type="button"
                      [attr.aria-label]="
                        'library.cue.setFade'
                          | translate
                            : {
                                fade: ('library.cue.' + fade.control | translate),
                                seconds: ms / 1000,
                              }
                      "
                      (click)="setFade(fade.control, ms)"
                    >
                      {{ 'library.cue.seconds' | translate: { seconds: ms / 1000 } }}
                    </button>
                  }
                </div>
              </div>
            }
          </div>

          @if (airText(); as text) {
            <p class="muted">{{ text }}</p>
          }
          @if (cueError(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }

          <div class="cue-actions">
            <button matButton="outlined" type="button" [disabled]="invalid()" (click)="play('in')">
              {{ 'library.cue.playIn' | translate }}
            </button>
            <button
              matButton="outlined"
              type="button"
              [disabled]="invalid()"
              (click)="play('beforeOut')"
            >
              {{ 'library.cue.playBeforeOut' | translate }}
            </button>
            <button matButton type="button" (click)="reset()">
              {{ 'library.cue.reset' | translate }}
            </button>
          </div>

          <mat-checkbox [formControl]="form.controls.reviewed">
            {{ 'library.cue.markReviewed' | translate }}
          </mat-checkbox>
          @if (track().playout_state; as state) {
            <p class="muted">{{ 'library.cue.onAirHint.' + state | translate }}</p>
          }
          @if (error(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }
          <div class="form-actions">
            <button
              matButton="filled"
              type="submit"
              [disabled]="busy() || invalid() || !!track().playout_state"
            >
              {{ 'library.cue.save' | translate }}
            </button>
          </div>
          <app-operation-status [state]="rebuild.state()" runningLabel="library.cue.rebuilding" />
        </form>
      } @else {
        <p class="muted">{{ 'library.cue.analyseFirst' | translate }}</p>
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    app-waveform-editor {
      margin-bottom: 1rem;
    }

    .choices {
      display: flex;
      flex-wrap: wrap;
      margin-top: -0.75rem;
      margin-bottom: 0.5rem;
    }

    .cue-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.5rem 0;
    }
  `,
})
export class TrackCueComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly player = inject(PlayerService);
  private readonly settings = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly track = input.required<Track>();
  /** The track after a save, with the reviewed mark as it now is. */
  readonly saved = output<Track>();

  protected readonly limits = CUE_LIMITS;
  protected readonly fadeChoices = FADE_CHOICES_MS;
  protected readonly fades = [{ control: 'fade_in_ms' }, { control: 'fade_out_ms' }] as const;

  protected readonly durationMs = computed(() => this.track().duration_ms ?? null);
  /**
   * The length the validator checks against. A plain field: the form runs its validators when it
   * is built, before the track input is set.
   */
  private knownDurationMs: number | null = null;
  protected readonly form = cueForm(() => this.knownDurationMs);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly rebuild = followOperation();
  /** Where the operator clicked on the waveform, for Space. */
  private cursorMs: number | null = null;
  /** True while the form shows a stored cue, which never proposes a fade. */
  private filling = false;

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });

  /** The form's points, always numbers, for the waveform and the preview. */
  protected readonly points = computed(() => {
    this.version();
    const value = this.form.getRawValue();
    const duration = this.durationMs() ?? 0;
    return {
      cueIn: value.cue_in_ms ?? 0,
      cueOut: value.cue_out_ms ?? duration,
      fadeIn: value.fade_in_ms ?? 0,
      fadeOut: value.fade_out_ms ?? 0,
    };
  });

  protected readonly airText = computed(() => {
    const duration = this.durationMs();
    if (duration === null || this.invalid()) {
      return null;
    }
    const { cueIn, cueOut } = this.points();
    return this.i18n.translate('library.cue.onAir', {
      air: formatCueTime(cueOut - cueIn),
      file: formatCueTime(duration),
    });
  });

  protected readonly cueError = computed(() => {
    this.version();
    const error = this.form.errors?.['cue'] as CueError | undefined;
    return error ? this.i18n.translate(`forms.serverErrors.${error.code}`) : null;
  });

  /** The file the peaks belong to; a save or a new usage mark keeps it, a new file does not. */
  private readonly waveformFile = computed(
    () => {
      const track = this.track();
      return track.duration_ms === undefined
        ? undefined
        : { id: track.id, checksum: track.file_checksum ?? '' };
    },
    { equal: (a, b) => a?.id === b?.id && a?.checksum === b?.checksum },
  );
  protected readonly waveform = rxResource({
    params: () => this.waveformFile(),
    stream: ({ params }) => this.api.get('/api/tracks/{id}/waveform', { path: { id: params.id } }),
  });
  protected readonly waveformError = computed(() =>
    this.waveform.status() === 'error' ? errorMessage(this.waveform.error(), this.i18n) : null,
  );

  /** The player's position in ms while it plays this track. */
  protected readonly position = computed(() =>
    this.player.isCurrent(this.track().id) ? Math.round(this.player.position() * 1000) : null,
  );

  constructor() {
    // A track read again (after an analysis or a save elsewhere) shows its stored cue, unless
    // the operator is editing.
    effect(() => {
      const track = this.track();
      untracked(() => {
        this.knownDurationMs = track.duration_ms ?? null;
        if (!this.form.dirty) {
          this.fill(track);
        }
        this.form.updateValueAndValidity();
      });
    });

    // A point that leaves the file edge takes the station's default fade when it had none.
    const { cue_in_ms: cueIn, cue_out_ms: cueOut } = this.form.controls;
    cueIn.valueChanges
      .pipe(
        startWith(cueIn.value),
        pairwise(),
        filter(() => !this.filling),
        takeUntilDestroyed(),
      )
      .subscribe(([before, after]) => {
        if (before === 0 && after !== null && after > 0) {
          this.proposeFade('fade_in_ms', DEFAULT_FADE_KEYS.in);
        }
      });
    cueOut.valueChanges
      .pipe(
        startWith(cueOut.value),
        pairwise(),
        filter(() => !this.filling),
        takeUntilDestroyed(),
      )
      .subscribe(([before, after]) => {
        const duration = this.durationMs();
        if (duration !== null && before === duration && after !== null && after < duration) {
          this.proposeFade('fade_out_ms', DEFAULT_FADE_KEYS.out);
        }
      });
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  protected setCue(range: CueRange): void {
    this.form.patchValue({ cue_in_ms: range.cueIn, cue_out_ms: range.cueOut });
    this.form.markAsDirty();
  }

  protected setFade(control: 'fade_in_ms' | 'fade_out_ms', ms: number): void {
    this.form.controls[control].setValue(ms);
    this.form.markAsDirty();
  }

  /** The whole file, no fades. */
  protected reset(): void {
    this.form.patchValue({
      cue_in_ms: 0,
      cue_out_ms: this.durationMs(),
      fade_in_ms: 0,
      fade_out_ms: 0,
    });
    this.form.markAsDirty();
  }

  protected seek(ms: number): void {
    this.cursorMs = ms;
    if (this.player.isCurrent(this.track().id)) {
      this.player.seek(ms / 1000);
    }
  }

  /**
   * The cue buttons play the unsaved points with their fades; Space plays the file as it is from
   * the cursor, so the parts outside the cue can be heard too. Previews never go to air.
   */
  protected play(request: WavePlayRequest): void {
    const track = this.track();
    const { cueIn, cueOut } = this.points();
    if (request === 'cursor') {
      if (this.player.isPlaying(track.id)) {
        this.player.pause();
      } else {
        this.player.play(this.preview(false), this.cursorMs ?? cueIn);
      }
      return;
    }
    const from = request === 'in' ? cueIn : Math.max(cueIn, cueOut - CUE_LIMITS.previewBeforeOutMs);
    this.player.play(this.preview(true), from);
  }

  protected save(): void {
    const duration = this.durationMs();
    if (this.form.invalid || this.busy() || duration === null) {
      this.form.markAllAsTouched();
      return;
    }
    const id = this.track().id;
    const markReviewed = this.form.controls.reviewed.value;
    const body = cueBody(this.form, duration);
    let cueSaved = false;
    this.busy.set(true);
    this.error.set(null);
    this.api
      .put('/api/tracks/{id}/cue', { path: { id }, body })
      .pipe(
        concatMap((result) => {
          cueSaved = true;
          this.fill(result.track);
          if (result.build_operation_id !== undefined) {
            this.followRebuild(result.build_operation_id);
          }
          return markReviewed
            ? this.api
                .post('/api/tracks/review', { body: { track_ids: [id], reviewed: true } })
                .pipe(concatMap(() => this.api.get('/api/tracks/{id}', { path: { id } })))
            : of(result.track);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (track) => {
          this.busy.set(false);
          this.saved.emit(track);
          // The form resets to the stored values, so nothing on it shows that the save landed.
          this.snackBar.open(
            this.i18n.translate(markReviewed ? 'library.cue.savedReviewed' : 'library.cue.saved'),
            this.i18n.translate('common.close'),
            { duration: CUE_SAVED_NOTICE_MS },
          );
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(
            cueSaved
              ? `${this.i18n.translate('library.cue.reviewFailed')} ${errorMessage(error, this.i18n)}`
              : applySubmitError(this.form, error, this.i18n),
          );
        },
      });
  }

  private fill(track: Track): void {
    this.filling = true;
    this.form.reset(cueFormValue(track));
    this.filling = false;
  }

  private followRebuild(operationId: number): void {
    this.rebuild
      .run(of({ operation_id: operationId }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private proposeFade(control: 'fade_in_ms' | 'fade_out_ms', key: string): void {
    const fade = this.form.controls[control];
    const proposed: unknown = this.settings.get(key)?.value;
    if (fade.value === 0 && typeof proposed === 'number') {
      fade.setValue(proposed);
    }
  }

  private preview(withCue: boolean): PreviewTrack {
    const track = this.track();
    const base: PreviewTrack = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      format: track.format,
    };
    if (!withCue) {
      return base;
    }
    const { cueIn, cueOut, fadeIn, fadeOut } = this.points();
    return {
      ...base,
      cue_in_ms: cueIn,
      cue_out_ms: cueOut,
      fade_in_ms: fadeIn,
      fade_out_ms: fadeOut,
    };
  }
}
