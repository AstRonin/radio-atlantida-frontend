import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { HOUR_OFFSET_MAX_MS } from '../../core/time/duration';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { OffsetInputComponent } from '../../shared/forms/offset-input.component';
import { SecondsInputComponent } from '../../shared/forms/seconds-input.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { rangeValidator } from '../../shared/forms/validators';
import { TrackPickerComponent } from '../../shared/pickers/track-picker.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';

export interface HourInsertDialogData {
  /** UTC; the start of the planned hour. */
  hourStartUtc: string;
  /** The start tolerance a new insert proposes (`rotation.default_fixed_tolerance_ms`). */
  toleranceMs: number;
}

/** Limits of `HourInsertBody`; the tolerance in seconds (0 to 600 000 ms). */
export const HOUR_INSERT_LIMITS = { toleranceSeconds: { min: 0, max: 600 } } as const;

/** The track type the picker shows first: today's news is the usual one-time insert. */
export const DEFAULT_INSERT_TYPE = 'news';

/**
 * Adds a one-time insert to a planned hour (design §7.2, frontend F21 §5.4): a track at a time of
 * the hour with seconds and a start tolerance. `POST /api/track-plan/inserts` is refused per field
 * here; when accepted, the dialog closes with the `hour_insert` operation ID, which the page
 * follows. A track that cannot be placed fails the operation, which raises the error popup.
 */
@Component({
  selector: 'app-hour-insert-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    StationTimePipe,
    FieldHintComponent,
    OffsetInputComponent,
    SecondsInputComponent,
    TrackPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'trackPlan.inserts.addTitle' | translate }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <p class="muted">
          {{ 'trackPlan.inserts.hour' | translate: { hour: (data.hourStartUtc | stationTime) } }}
        </p>
        <div class="form-grid">
          <app-offset-input
            label="trackPlan.inserts.offset"
            [control]="form.controls.offset_ms"
            hintPage="help.track-plan"
            hintField="offset_ms"
          />
          <app-seconds-input
            label="trackPlan.inserts.tolerance"
            [control]="form.controls.tolerance_ms"
            [min]="limits.toleranceSeconds.min"
            [max]="limits.toleranceSeconds.max"
            hintPage="help.track-plan"
            hintField="tolerance_ms"
          />
        </div>
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'trackPlan.inserts.trackType' | translate }}</mat-label>
            <mat-select [formControl]="typeFilter">
              <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
              @for (type of types().items; track type.id) {
                <mat-option [value]="type.id">{{ type.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.track-plan" field="track_type" />
        </div>
        <app-track-picker
          label="trackPlan.inserts.track"
          [control]="form.controls.track_id"
          [multiple]="false"
          [typeId]="typeId()"
          hintPage="help.track-plan"
          hintField="track_id"
        />
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="busy() || form.invalid">
          {{ 'trackPlan.inserts.add' | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class HourInsertDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<HourInsertDialogComponent, number>>(MatDialogRef);
  protected readonly data = inject<HourInsertDialogData>(MAT_DIALOG_DATA);

  protected readonly limits = HOUR_INSERT_LIMITS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = catalogList(inject(CatalogService).playlistTypes());

  // Control names are the HourInsertBody's JSON names, so per-field refusals land on them; the
  // hour is not a field here, so its refusal (`hour_started`) is shown with the form.
  protected readonly form = new FormGroup({
    offset_ms: new FormControl<number | null>(null, [
      Validators.required,
      rangeValidator({ min: 0, max: HOUR_OFFSET_MAX_MS, step: 1000 }),
    ]),
    tolerance_ms: new FormControl<number | null>(this.data.toleranceMs, Validators.required),
    track_id: new FormControl<number[] | null>([], Validators.required),
  });
  protected readonly typeFilter = new FormControl<number | null>(null);
  protected readonly typeId = toSignal(this.typeFilter.valueChanges, { initialValue: null });

  constructor() {
    // News first, once the types are known, unless the operator chose a type already.
    let proposed = false;
    effect(() => {
      const types = this.types();
      if (proposed || types.status === 'loading') {
        return;
      }
      proposed = true;
      const news = types.items.find((type) => type.code === DEFAULT_INSERT_TYPE);
      untracked(() => {
        if (news && this.typeFilter.pristine) {
          this.typeFilter.setValue(news.id);
        }
      });
    });
  }

  protected save(): void {
    const value = this.form.getRawValue();
    const trackId = value.track_id?.[0];
    if (this.form.invalid || this.busy() || trackId === undefined || value.offset_ms === null) {
      this.form.markAllAsTouched();
      return;
    }
    const body: ApiSchema<'HourInsertBody'> = {
      hour_start_utc: this.data.hourStartUtc,
      offset_ms: value.offset_ms,
      track_id: trackId,
      ...(value.tolerance_ms !== null ? { tolerance_ms: value.tolerance_ms } : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    this.api
      .post('/api/track-plan/inserts', { body })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accepted) => this.dialogRef.close(accepted.operation_id),
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }
}
