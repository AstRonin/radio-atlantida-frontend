import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { problemMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import {
  FillerModeSelectComponent,
  SegmentFillerMode,
} from '../forms/filler-mode-select.component';
import { controlVersion } from '../forms/field-errors';
import { applyServerErrors } from '../forms/server-errors';
import { ArtistSelectComponent } from '../pickers/artist-select.component';
import { PlaylistSelectComponent } from '../pickers/playlist-select.component';
import { TrackPickerComponent } from '../pickers/track-picker.component';

export type ClockSegment = ApiSchema<'ClockSegment'>;
export type SaveWithFillerBody = ApiSchema<'SaveWithFillerBody'>;

export interface FillerDialogData {
  clockName: string;
  /** The short segments to choose a filler for (see `shortSegments`). */
  segments: readonly ClockSegment[];
  /** `POST /api/clocks/{id}/save-with-filler`; a refusal keeps the dialog open with its errors. */
  save: (body: SaveWithFillerBody) => Observable<unknown>;
  /** `POST /api/clocks/{id}/save-incomplete`. */
  saveIncomplete: () => Observable<unknown>;
}

/** How the dialog ended: every short segment has a filler, or the clock was saved incomplete. */
export type FillerDialogResult = 'filler' | 'incomplete';

/** The segments a clock save result asks a filler choice for (design §6.0). */
export function shortSegments(result: ApiSchema<'ClockSaveResult'>): ClockSegment[] {
  const short = new Set(result.check.short_segments);
  return result.clock.layout.segments.filter((segment) => short.has(segment.index));
}

type SegmentForm = FormGroup<{
  segment: FormControl<number>;
  filler_mode: FormControl<SegmentFillerMode | null>;
  filler_source_id: FormControl<number | null>;
}>;

// Control names match SaveWithFillerBody, so field errors such as segments[0].filler_source_id land.
type FillerForm = FormGroup<{
  segments: FormArray<SegmentForm>;
  pool_track_ids: FormControl<number[] | null>;
}>;

/**
 * The blocking filler dialog (design §6.0, §6.2). It lists every short segment of the clock and
 * asks for a filler mode for each. It cannot be closed by clicking outside or with Escape: only by
 * saving with the chosen fillers, or by the explicit "save incomplete" action.
 */
@Component({
  selector: 'app-filler-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    ReactiveFormsModule,
    TranslatePipe,
    DurationPipe,
    FillerModeSelectComponent,
    PlaylistSelectComponent,
    ArtistSelectComponent,
    TrackPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'filler.dialog.title' | translate: { clock: data.clockName } }}</h2>
    <mat-dialog-content>
      <p>{{ 'filler.dialog.intro' | translate: { count: data.segments.length } }}</p>

      <form [formGroup]="form" (ngSubmit)="save()">
        @for (group of form.controls.segments.controls; track $index; let i = $index) {
          <section class="segment" [attr.aria-labelledby]="'filler-segment-' + i">
            <h3 class="segment-title" [id]="'filler-segment-' + i">
              {{
                'filler.dialog.segment'
                  | translate
                    : {
                        number: data.segments[i].index + 1,
                        from: minute(data.segments[i].start_ms),
                        to: minute(data.segments[i].end_ms),
                      }
              }}
            </h3>
            <p class="shortfall">
              {{
                'filler.dialog.shortfall'
                  | translate: { duration: (data.segments[i].shortfall_ms | duration) }
              }}
            </p>
            <app-filler-mode-select
              modes="segment"
              [control]="group.controls.filler_mode"
              hintPage="help.clocks"
              hintField="filler_mode"
            />
            @switch (modes()[i]) {
              @case ('playlist') {
                <app-playlist-select
                  label="filler.dialog.sourcePlaylist"
                  [control]="group.controls.filler_source_id"
                />
              }
              @case ('artist') {
                <app-artist-select
                  label="filler.dialog.sourceArtist"
                  [control]="group.controls.filler_source_id"
                />
              }
            }
          </section>
        }

        @if (usesPool()) {
          <app-track-picker
            label="filler.dialog.pool"
            [ordered]="true"
            [control]="form.controls.pool_track_ids"
          />
          <p class="note">{{ 'filler.dialog.poolNote' | translate }}</p>
        }
      </form>

      @if (formError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [disabled]="busy()" (click)="saveIncomplete()">
        {{ 'filler.dialog.saveIncomplete' | translate }}
      </button>
      <button matButton="filled" type="button" [disabled]="!canSave()" (click)="save()">
        {{ 'filler.dialog.save' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .segment {
      padding: 0.5rem 0;
    }

    .segment + .segment {
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .segment-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .shortfall {
      margin: 0.25rem 0 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .note {
      margin-top: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .form-error {
      color: var(--mat-sys-error);
    }
  `,
})
export class FillerDialogComponent {
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<FillerDialogComponent, FillerDialogResult>>(MatDialogRef);
  protected readonly data = inject<FillerDialogData>(MAT_DIALOG_DATA);

  protected readonly form: FillerForm = new FormGroup({
    segments: new FormArray(this.data.segments.map((segment) => this.segmentForm(segment))),
    pool_track_ids: new FormControl<number[] | null>([]),
  });
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);

  // Reactive forms do not notify OnPush views; this follows every change of the form.
  private readonly version = controlVersion(computed(() => this.form));
  protected readonly modes = computed(() => {
    this.version();
    return this.form.controls.segments.controls.map((group) => group.controls.filler_mode.value);
  });
  protected readonly usesPool = computed(() => this.modes().includes('pool'));
  protected readonly canSave = computed(() => {
    this.version();
    return !this.busy() && this.form.valid;
  });

  /** Minute and second of the hour, `mm:ss`, so 60:00 is the end of the hour. */
  protected minute(ms: number): string {
    const seconds = Math.round(ms / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.run(this.data.save(this.body()), 'filler');
  }

  protected saveIncomplete(): void {
    if (!this.busy()) {
      this.run(this.data.saveIncomplete(), 'incomplete');
    }
  }

  private run(request: Observable<unknown>, result: FillerDialogResult): void {
    this.busy.set(true);
    this.formError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      complete: () => this.dialogRef.close(result),
      error: (error: unknown) => {
        this.busy.set(false);
        if (error instanceof ApiProblem) {
          const unmatched = applyServerErrors(this.form, error.errors);
          this.formError.set(
            unmatched.length > 0 || error.errors.length === 0
              ? problemMessage(error, this.i18n)
              : null,
          );
        } else {
          this.formError.set(this.i18n.translate('alerts.panelError'));
        }
      },
    });
  }

  private body(): SaveWithFillerBody {
    const segments = this.form.controls.segments.controls.map((group) => {
      const mode = group.controls.filler_mode.value ?? 'random';
      const source = group.controls.filler_source_id.value;
      return {
        segment: group.controls.segment.value,
        filler_mode: mode,
        ...(needsSource(mode) && source !== null ? { filler_source_id: source } : {}),
      };
    });
    const pool = this.form.controls.pool_track_ids.value ?? [];
    // An empty choice keeps the clock's pool as it is; the backend refuses an empty pool.
    return this.usesPool() && pool.length > 0 ? { segments, pool_track_ids: pool } : { segments };
  }

  private segmentForm(segment: ClockSegment): SegmentForm {
    const group: SegmentForm = new FormGroup({
      segment: new FormControl(segment.index, { nonNullable: true }),
      filler_mode: new FormControl<SegmentFillerMode | null>(null, Validators.required),
      filler_source_id: new FormControl<number | null>(null),
    });
    // A playlist or artist mode needs its source; other modes send none.
    group.controls.filler_mode.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((mode) => {
        const source = group.controls.filler_source_id;
        source.setValue(null);
        source.setValidators(mode && needsSource(mode) ? Validators.required : null);
        source.updateValueAndValidity();
        source.markAsUntouched();
      });
    return group;
  }
}

function needsSource(mode: SegmentFillerMode): boolean {
  return mode === 'playlist' || mode === 'artist';
}
