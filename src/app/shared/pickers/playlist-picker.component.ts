import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { CatalogService, catalogList } from '../../core/catalog/catalog.service';
import type { HelpPageId } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage } from '../forms/field-errors';
import { FieldHintComponent } from '../ui/field-hint.component';

/**
 * Multi-select of playlists of every type (design §6.2): one clock element may combine, for
 * example, music and jingle playlists. Each option shows its type. The value is a list of IDs.
 */
@Component({
  selector: 'app-playlist-picker',
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
        @for (playlist of playlists().items; track playlist.id) {
          <mat-option [value]="playlist.id">
            {{ playlist.name }}
            <span class="meta">
              · {{ playlist.type.name }} ·
              {{ 'pickers.trackCount' | translate: { count: playlist.track_count } }}
            </span>
          </mat-option>
        }
      </mat-select>
      @if (hintPage(); as page) {
        <app-field-hint matSuffix [page]="page" [field]="hintField() ?? ''" />
      }
      @if (playlists().error; as message) {
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
export class PlaylistPickerComponent {
  readonly control = input.required<FormControl<number[] | null>>();
  readonly label = input('pickers.playlists');
  readonly hintPage = input<HelpPageId | null>(null);
  readonly hintField = input<string | null>(null);

  protected readonly playlists = catalogList(inject(CatalogService).playlists());
  protected readonly error = controlErrorMessage(this.control);
}
