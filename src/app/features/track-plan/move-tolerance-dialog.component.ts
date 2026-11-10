import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SecondsInputComponent } from '../../shared/forms/seconds-input.component';
import { HOUR_INSERT_LIMITS } from './hour-insert-dialog.component';

/** The start tolerance a move proposes: ±1 minute, as a one-time insert. */
export const MOVE_DEFAULT_TOLERANCE_MS = 60_000;

export interface MoveToleranceResult {
  toleranceMs: number;
  /** Later moves in this hour use this value without asking. */
  skipForHour: boolean;
}

/**
 * Asks for the start tolerance of a moved track. Closes with the answer, or with nothing when the
 * operator cancels, which cancels the move.
 */
@Component({
  selector: 'app-move-tolerance-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    ReactiveFormsModule,
    TranslatePipe,
    SecondsInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'trackPlan.moves.toleranceTitle' | translate }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <p class="muted">{{ 'trackPlan.moves.toleranceNote' | translate }}</p>
        <app-seconds-input
          label="trackPlan.inserts.tolerance"
          [control]="form.controls.tolerance_ms"
          [min]="limits.toleranceSeconds.min"
          [max]="limits.toleranceSeconds.max"
          hintPage="help.track-plan"
          hintField="tolerance_ms"
        />
        <mat-checkbox [formControl]="form.controls.skip">
          {{ 'trackPlan.moves.skipDialog' | translate }}
        </mat-checkbox>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" [mat-dialog-close]="undefined">
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="form.invalid">
          {{ 'trackPlan.moves.confirm' | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class MoveToleranceDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<MoveToleranceDialogComponent, MoveToleranceResult>>(MatDialogRef);

  protected readonly limits = HOUR_INSERT_LIMITS;
  protected readonly form = new FormGroup({
    tolerance_ms: new FormControl<number | null>(MOVE_DEFAULT_TOLERANCE_MS, Validators.required),
    skip: new FormControl(false, { nonNullable: true }),
  });

  protected save(): void {
    const { tolerance_ms: toleranceMs, skip } = this.form.getRawValue();
    if (this.form.invalid || toleranceMs === null) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close({ toleranceMs, skipForHour: skip });
  }
}
