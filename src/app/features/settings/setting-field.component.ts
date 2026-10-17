import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { Setting } from '../../core/settings/settings.service';
import { TimeZoneSelectComponent } from '../../core/time/time-zone-select.component';
import { controlErrorMessage } from '../../shared/forms/field-errors';
import { NumberInputComponent } from '../../shared/forms/number-input.component';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { settingKind } from './settings-form';

/**
 * One setting: its input, chosen from the backend's definition, and under it the default value,
 * whether the default is in use, and when a change takes effect (docs/frontend-init-plan.md F5).
 */
@Component({
  selector: 'app-setting-field',
  imports: [
    MatCheckboxModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
    NumberInputComponent,
    PlaylistSelectComponent,
    TextInputComponent,
    TimeZoneSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('number') {
        <app-number-input
          [control]="numberControl()"
          [label]="label()"
          [min]="setting().minimum ?? null"
          [max]="setting().maximum ?? null"
          [step]="setting().type === 'integer' ? 1 : 'any'"
          [suffix]="unit()"
          hintPage="help.settings"
          [hintField]="setting().key"
        />
      }
      @case ('select') {
        <div class="field field-row">
          <mat-form-field>
            <mat-label>{{ label() | translate }}</mat-label>
            <mat-select [formControl]="valueControl()">
              @for (option of setting().enum; track $index) {
                <mat-option [value]="option">{{ optionLabel(option) }}</mat-option>
              }
            </mat-select>
            @if (error(); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>
          <app-field-hint page="help.settings" [field]="setting().key" />
        </div>
      }
      @case ('boolean') {
        <div class="checkbox">
          <mat-checkbox [formControl]="valueControl()">{{ label() | translate }}</mat-checkbox>
          <app-field-hint page="help.settings" [field]="setting().key" />
        </div>
      }
      @case ('timezone') {
        <div class="with-hint">
          <app-time-zone-select [control]="textControl()" [label]="label()" />
          <app-field-hint page="help.settings" [field]="setting().key" />
        </div>
      }
      @case ('playlist') {
        <app-playlist-select
          [control]="numberControl()"
          [label]="label()"
          noneLabel="settings.none"
          hintPage="help.settings"
          [hintField]="setting().key"
        />
      }
      @default {
        <app-text-input
          [control]="textControl()"
          [label]="label()"
          [maxLength]="setting().maximum ?? null"
          [spellcheck]="false"
          hintPage="help.settings"
          [hintField]="setting().key"
        />
      }
    }
    <p class="meta">
      @if (setting().is_default) {
        <span class="badge">{{ 'settings.meta.isDefault' | translate }}</span>
      } @else {
        <span>{{ 'settings.meta.default' | translate: { value: defaultText() } }}</span>
      }
      <span class="badge" [class.warn]="setting().apply === 'reconnect'">
        {{ 'settings.apply.' + setting().apply | translate }}
      </span>
      @if (setting().affects_air) {
        <span class="badge">{{ 'settings.meta.affectsAir' | translate }}</span>
      }
    </p>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 0.75rem;
    }

    .field {
      width: 100%;
    }

    .checkbox,
    .with-hint {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .with-hint > :first-child {
      flex: 1;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      align-items: center;
      margin: -0.75rem 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class SettingFieldComponent {
  private readonly i18n = inject(I18nService);

  readonly setting = input.required<Setting>();
  readonly control = input.required<AbstractControl>();

  protected readonly kind = computed(() => settingKind(this.setting()));

  /** Settings this build has no label for (added in a newer backend) show their key. */
  protected readonly label = computed(() => {
    const key = `settings.fields.${this.setting().key}`;
    return this.i18n.has(key) ? key : this.setting().key;
  });

  protected readonly unit = computed(() => {
    const unit = this.setting().unit;
    const key = `forms.units.${unit?.toLowerCase()}`;
    return unit && this.i18n.has(key) ? key : null;
  });

  // The template picks the input by kind, so each view matches the control `settingControl` made.
  protected readonly numberControl = computed(() => this.control() as FormControl<number | null>);
  protected readonly textControl = computed(() => this.control() as FormControl<string | null>);
  protected readonly valueControl = computed(() => this.control() as FormControl<unknown>);
  protected readonly error = controlErrorMessage(this.control);

  protected readonly defaultText = computed(() => this.valueText(this.setting().default));

  protected optionLabel(option: unknown): string {
    const unit = this.unit();
    return unit ? `${String(option)} ${this.i18n.translate(unit)}` : String(option);
  }

  private valueText(value: unknown): string {
    if (value === null || value === undefined) {
      return this.i18n.translate('settings.none');
    }
    if (typeof value === 'boolean') {
      return this.i18n.translate(value ? 'common.yes' : 'common.no');
    }
    if (value === '') {
      return this.i18n.translate('settings.empty');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number') {
      const number = new Intl.NumberFormat(this.i18n.locale(), { useGrouping: false }).format(
        value,
      );
      const unit = this.unit();
      return unit ? `${number} ${this.i18n.translate(unit)}` : number;
    }
    return String(value);
  }
}
