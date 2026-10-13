import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { I18nService } from './i18n.service';
import { TranslatePipe } from './translate.pipe';

@Component({
  selector: 'app-language-switch',
  imports: [MatFormFieldModule, MatSelectModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="language-switch" subscriptSizing="dynamic" appearance="outline">
      <mat-label>{{ 'language.label' | translate }}</mat-label>
      <mat-select [value]="i18n.language()" (selectionChange)="i18n.use($event.value)">
        @for (language of i18n.languages(); track language.code) {
          <mat-option [value]="language.code">{{ language.name }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
  `,
  styles: `
    .language-switch {
      width: 9rem;
    }
  `,
})
export class LanguageSwitchComponent {
  protected readonly i18n = inject(I18nService);
}
