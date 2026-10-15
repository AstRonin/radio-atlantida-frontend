import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { rangeValidator } from '../../shared/forms/validators';

export type SeparationRule = ApiSchema<'SeparationRule'>;

export const NOTES_MAX = 2000;

export interface SeparationRuleDialogData {
  rule: SeparationRule;
  /**
   * The longest allowed interval: the play log retention in hours, because separation is checked
   * against aired history (`UpdateSeparationRule.min_interval_hours`).
   */
  maxHours: number;
}

/** Edits the minimum interval and the notes of one separation rule. */
@Component({
  selector: 'app-separation-rule-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    ReactiveFormsModule,
    TranslatePipe,
    NumberInputComponent,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      {{ 'separationRules.dialog.title' | translate: { scope: scopeLabel } }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <app-number-input
          [control]="form.controls.min_interval_hours"
          label="separationRules.fields.min_interval_hours"
          [min]="1"
          [max]="data.maxHours"
          suffix="forms.units.hours"
          hintPage="help.separation-rules"
          hintField="min_interval_hours"
        />
        <p class="muted">
          {{ 'separationRules.dialog.retentionNote' | translate: { hours: data.maxHours } }}
        </p>
        <app-text-input
          [control]="form.controls.notes"
          label="separationRules.fields.notes"
          [maxLength]="notesMax"
          [multiline]="true"
          hintPage="help.separation-rules"
          hintField="notes"
        />
        @if (error(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" [mat-dialog-close]="undefined">
          {{ 'common.cancel' | translate }}
        </button>
        <button matButton="filled" type="submit" [disabled]="busy() || form.invalid">
          {{ 'common.save' | translate }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class SeparationRuleDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef =
    inject<MatDialogRef<SeparationRuleDialogComponent, SeparationRule>>(MatDialogRef);

  protected readonly data = inject<SeparationRuleDialogData>(MAT_DIALOG_DATA);
  protected readonly notesMax = NOTES_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly scopeLabel = this.i18n.translate(
    `separationRules.scopes.${this.data.rule.scope}`,
  );

  protected readonly form = new FormGroup({
    min_interval_hours: new FormControl<number | null>(this.data.rule.min_interval_hours, [
      Validators.required,
      rangeValidator({ min: 1, max: this.data.maxHours, step: 1 }),
    ]),
    notes: new FormControl<string | null>(this.data.rule.notes, Validators.maxLength(NOTES_MAX)),
  });

  protected save(): void {
    const hours = this.form.controls.min_interval_hours.value;
    if (this.form.invalid || this.busy() || hours === null) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api
      .put('/api/separation-rules/{id}', {
        path: { id: this.data.rule.id },
        body: { min_interval_hours: hours, notes: this.form.controls.notes.value ?? '' },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => this.dialogRef.close(saved),
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }
}
