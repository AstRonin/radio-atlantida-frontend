import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ApiSchema } from '../../core/api/api-types';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';

/**
 * Multi-select of play rules for the track and playlist forms (design §6.2). Each option shows how
 * many tracks and playlists use the rule. The value is a list of rule IDs.
 */
@Component({
  selector: 'app-play-rule-picker',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ label() | translate }}</mat-label>
      <mat-select multiple [formControl]="control()">
        @for (rule of rules().items; track rule.id) {
          <mat-option [value]="rule.id">
            {{ rule.name }}
            <span class="meta">· {{ 'pickers.ruleUses' | translate: { count: uses(rule) } }}</span>
          </mat-option>
        }
      </mat-select>
      @if (hintPage(); as page) {
        <app-field-hint matSuffix [page]="page" [field]="hintField() ?? ''" />
      }
      @if (rules().error; as message) {
        <mat-hint class="load-error" role="alert">{{ message }}</mat-hint>
      }
      @if (error(); as message) {
        <mat-error>{{ message }}</mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    .field {
      width: 100%;
    }

    .meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .load-error {
      color: var(--mat-sys-error);
    }
  `,
})
export class PlayRulePickerComponent {
  readonly control = input.required<FormControl<number[] | null>>();
  readonly label = input('pickers.playRules');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly rules = catalogList(inject(CatalogService).playRules());
  protected readonly error = controlErrorMessage(this.control);

  protected uses(rule: ApiSchema<'PlayRule'>): number {
    return rule.track_count + rule.playlist_count;
  }
}
