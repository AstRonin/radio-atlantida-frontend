import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ApiSchema } from '../../core/api/api-types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { controlErrorMessage } from '../../shared/forms/field-errors';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';

/** The value of the "whole media folder" option; the page sends no `folder` for it. */
export const MEDIA_ROOT = '';

/**
 * The folder of the media root to import (backend phase 18), in the backend's order with its
 * counts. Nested folders show their full path, so no tree is needed. The value is the folder path,
 * `MEDIA_ROOT` for the whole media folder, and null while nothing is chosen.
 */
@Component({
  selector: 'app-import-folder-select',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    FieldHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field field-row">
      <mat-form-field>
        <mat-label>{{ 'import.form.folder' | translate }}</mat-label>
        <mat-select [formControl]="control()">
          @if (root(); as counts) {
            <mat-option [value]="mediaRoot">{{
              'import.folder.rootOption'
                | translate: { new: counts.new_files, total: counts.audio_files }
            }}</mat-option>
          }
          @for (folder of folders(); track folder.path) {
            <mat-option [value]="folder.path">{{
              'import.folder.option'
                | translate: { path: folder.path, new: folder.new_files, total: folder.audio_files }
            }}</mat-option>
          }
        </mat-select>
        @if (more()) {
          <mat-hint>{{ 'import.folder.moreFolders' | translate }}</mat-hint>
        }
        @if (error(); as message) {
          <mat-error>{{ message }}</mat-error>
        }
      </mat-form-field>
      <app-field-hint page="help.import" field="folder" />
    </div>
  `,
  styles: `
    .field {
      width: 100%;
      max-width: 32rem;
    }
  `,
})
export class ImportFolderSelectComponent {
  readonly control = input.required<FormControl<string | null>>();
  readonly folders = input.required<readonly ApiSchema<'ImportFolder'>[]>();
  readonly root = input.required<ApiSchema<'ImportCounts'> | null>();
  readonly more = input(false);

  protected readonly mediaRoot = MEDIA_ROOT;
  protected readonly error = controlErrorMessage(this.control);
}
