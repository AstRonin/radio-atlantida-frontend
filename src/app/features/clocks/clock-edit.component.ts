import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Observable, finalize, forkJoin, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { CatalogService } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { followOperation } from '../../core/operations/operation-run';
import { SettingsService } from '../../core/settings/settings.service';
import { formatHourOffset } from '../../core/time/duration';
import { hourLabel, weekdayName } from '../../core/time/local-date';
import { controlVersion } from '../../shared/forms/field-errors';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  CLOCK_LIMITS,
  Clock,
  ClockSaveResult,
  DEFAULT_INSERT_TOLERANCE_MS,
  Playlist,
  clockBody,
  clockForm,
  fillClockForm,
  fillShares,
  insertForm,
  playlistRowForm,
} from './clock-form';
import { ClockInsertRowComponent } from './clock-insert-row.component';
import { ClockPlaylistRowComponent } from './clock-playlist-row.component';
import { ClockSampleComponent } from './clock-sample.component';

type ClockWarning = ApiSchema<'ClockWarning'>;

interface Loaded {
  clock: Clock | null;
  playlists: Playlist[];
}

/** The setting that holds the start tolerance of a new insert. */
const DEFAULT_TOLERANCE_SETTING = 'rotation.default_fixed_tolerance_ms';

/**
 * Creates or edits a clock (design §6.0, §7.2; frontend F21 §5.3): its playlists with their
 * placement rules, overrides, and shares, and its timed inserts. Saving sends the template; the
 * backend answers with the clock, a sample hour, and warnings, which the page shows as they are.
 * The editor stays open after a save so the result can be read.
 */
@Component({
  selector: 'app-clock-edit',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ClockInsertRowComponent,
    ClockPlaylistRowComponent,
    ClockSampleComponent,
    OperationStatusComponent,
    PageHeaderComponent,
    PlaylistSelectComponent,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      [titleKey]="clockId() === null ? 'clocks.edit.createTitle' : 'clocks.edit.editTitle'"
      helpPage="help.clocks"
    />

    @if (loaded.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()">
      <section class="page-section">
        <div class="form-grid">
          <app-text-input
            [control]="form.controls.name"
            label="clocks.fields.name"
            [maxLength]="limits.nameMax"
            hintPage="help.clocks"
            hintField="name"
          />
        </div>
      </section>

      <section class="page-section" aria-labelledby="playlists-heading">
        <h2 id="playlists-heading" class="section-title">
          {{ 'clocks.playlists.title' | translate }}
        </h2>
        <p class="muted">{{ 'clocks.playlists.note' | translate }}</p>
        @if (form.controls.playlists.length > 0) {
          <ul class="rows">
            @for (row of form.controls.playlists.controls; track row; let i = $index) {
              <app-clock-playlist-row
                [group]="row"
                [playlist]="playlistById().get(row.controls.playlist_id.value)"
                [index]="i"
                [count]="playlistCount()"
                [share]="shares()[i] ?? null"
                [warnings]="playlistWarnings()[i] ?? []"
                (moveUp)="movePlaylist(i, -1)"
                (moveDown)="movePlaylist(i, 1)"
                (remove)="removePlaylist(i)"
              />
            }
          </ul>
        }
        @if (playlistsError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <div class="add">
          <app-playlist-select
            label="clocks.playlists.add"
            [control]="addPlaylist"
            hintPage="help.clocks"
            hintField="playlists"
          />
        </div>
      </section>

      <section class="page-section" aria-labelledby="inserts-heading">
        <h2 id="inserts-heading" class="section-title">
          {{ 'clocks.inserts.title' | translate }}
        </h2>
        <p class="muted">{{ 'clocks.inserts.note' | translate }}</p>
        @if (form.controls.inserts.length > 0) {
          <ul class="rows">
            @for (group of form.controls.inserts.controls; track group; let i = $index) {
              <app-clock-insert-row
                [group]="group"
                [warnings]="insertWarnings()[i] ?? []"
                (remove)="removeInsert(i)"
              />
            }
          </ul>
        }
        <button
          matButton="tonal"
          type="button"
          [disabled]="insertCount() >= limits.insertsMax"
          (click)="addInsert()"
        >
          {{ 'clocks.inserts.add' | translate }}
        </button>
      </section>

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button matButton="filled" type="submit" [disabled]="busy() || invalid()">
          {{ 'clocks.edit.save' | translate }}
        </button>
        <a matButton routerLink="/clocks">{{ 'common.back' | translate }}</a>
      </div>
    </form>

    @if (result(); as saved) {
      <section class="page-section result" aria-labelledby="sample-heading">
        <h2 id="sample-heading" class="section-title">{{ 'clocks.sample.title' | translate }}</h2>
        @if (warnings().length > 0) {
          <p>{{ 'clocks.sample.warnings' | translate }}</p>
          <ul class="warnings" role="status">
            @for (message of warnings(); track $index) {
              <li>{{ message }}</li>
            }
          </ul>
        } @else {
          <p role="status">{{ 'clocks.sample.noWarnings' | translate }}</p>
        }
        <app-operation-status [state]="rebuild.state()" runningLabel="clocks.build.running" />
        @if (saved.sample; as sample) {
          <app-clock-sample [sample]="sample" [playlists]="playlistById()" [stale]="dirty()" />
        } @else {
          <p class="muted">{{ 'clocks.sample.unavailable' | translate }}</p>
        }
      </section>
    }
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .rows {
      margin: 0 0 0.5rem;
      padding: 0;
    }

    .add {
      max-width: 24rem;
    }

    .result {
      padding-top: 1rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .warnings {
      color: var(--mat-sys-error);
    }
  `,
})
export default class ClockEditComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);
  private readonly location = inject(Location);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter; absent on `clocks/new`. */
  readonly id = input<string>();

  protected readonly limits = CLOCK_LIMITS;
  protected readonly form = clockForm();
  /** The select that adds a playlist; it is cleared again after each choice. */
  protected readonly addPlaylist = new FormControl<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The clock as last read or saved; null for a new one. */
  protected readonly stored = signal<Clock | null>(null);
  /** The answer of the last save; null after a load. */
  protected readonly result = signal<ClockSaveResult | null>(null);
  protected readonly rebuild = followOperation();

  protected readonly clockId = computed(() => {
    const id = this.id();
    return this.stored()?.id ?? (id === undefined ? null : Number(id));
  });

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });
  protected readonly dirty = computed(() => {
    this.version();
    return this.form.dirty;
  });
  protected readonly playlistCount = computed(() => {
    this.version();
    return this.form.controls.playlists.length;
  });
  protected readonly insertCount = computed(() => {
    this.version();
    return this.form.controls.inserts.length;
  });
  protected readonly shares = computed(() => {
    this.version();
    return fillShares(this.form.controls.playlists.controls);
  });
  protected readonly playlistsError = computed(() => {
    this.version();
    const rows = this.form.controls.playlists;
    if (!rows.touched && !rows.dirty && !this.form.touched) {
      return null;
    }
    if (rows.hasError('server')) {
      const server = rows.getError('server') as { code: string; message: string };
      const key = `forms.serverErrors.${server.code}`;
      return this.i18n.has(key) ? this.i18n.translate(key) : server.message;
    }
    if (rows.hasError('required')) {
      return this.i18n.translate('clocks.playlists.required');
    }
    if (rows.hasError('fillPlaylistRequired')) {
      return this.i18n.translate('clocks.playlists.fillRequired');
    }
    if (rows.hasError('fillWeightsPartial')) {
      return this.i18n.translate('clocks.playlists.weightsPartial');
    }
    return null;
  });

  protected readonly loaded = rxResource({
    params: () => ({ id: this.id() }),
    stream: ({ params }): Observable<Loaded> =>
      forkJoin({
        clock:
          params.id === undefined
            ? of(null)
            : this.api.get('/api/clocks/{id}', { path: { id: Number(params.id) } }),
        playlists: this.catalog.playlists(),
      }),
  });
  protected readonly loadError = computed(() =>
    this.loaded.status() === 'error' ? errorMessage(this.loaded.error(), this.i18n) : null,
  );
  protected readonly playlistById = computed(
    (): ReadonlyMap<number, Playlist> =>
      new Map(
        (this.loaded.hasValue() ? this.loaded.value().playlists : []).map((playlist) => [
          playlist.id,
          playlist,
        ]),
      ),
  );

  private readonly warningTexts = computed(() =>
    (this.result()?.warnings ?? []).map((warning) => ({
      warning,
      text: this.describeWarning(warning),
    })),
  );
  protected readonly warnings = computed(() => this.warningTexts().map((item) => item.text));
  protected readonly playlistWarnings = computed(() => this.byIndex('playlist_index'));
  protected readonly insertWarnings = computed(() => this.byIndex('insert_index'));

  constructor() {
    effect(() => {
      if (this.loaded.hasValue()) {
        const { clock } = this.loaded.value();
        if (clock) {
          untracked(() => this.fill(clock));
        }
      }
    });
    this.addPlaylist.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => id !== null && this.onAddPlaylist(id));
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  private onAddPlaylist(id: number): void {
    this.addPlaylist.setValue(null, { emitEvent: false });
    const rows = this.form.controls.playlists;
    const playlist = this.playlistById().get(id);
    if (!playlist || rows.controls.some((row) => row.controls.playlist_id.value === id)) {
      return;
    }
    if (rows.length >= CLOCK_LIMITS.playlistsMax) {
      return;
    }
    rows.push(playlistRowForm(this.destroyRef, playlist));
    rows.markAsTouched();
    this.form.markAsDirty();
  }

  protected removePlaylist(index: number): void {
    this.form.controls.playlists.removeAt(index);
    this.form.controls.playlists.markAsTouched();
    this.form.markAsDirty();
  }

  protected movePlaylist(index: number, by: -1 | 1): void {
    const rows = this.form.controls.playlists;
    const target = index + by;
    if (target < 0 || target >= rows.length) {
      return;
    }
    const row = rows.at(index);
    rows.removeAt(index, { emitEvent: false });
    rows.insert(target, row);
    this.form.markAsDirty();
  }

  protected addInsert(): void {
    const setting: unknown = this.settings.get(DEFAULT_TOLERANCE_SETTING)?.value;
    const tolerance = typeof setting === 'number' ? setting : DEFAULT_INSERT_TOLERANCE_MS;
    this.form.controls.inserts.push(insertForm(this.destroyRef, undefined, tolerance));
    this.form.markAsDirty();
  }

  protected removeInsert(index: number): void {
    this.form.controls.inserts.removeAt(index);
    this.form.markAsDirty();
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const body = clockBody(this.form);
    const id = this.clockId();
    const request: Observable<ClockSaveResult> =
      id === null
        ? this.api.post('/api/clocks', { body })
        : this.api.put('/api/clocks/{id}', { path: { id }, body });

    this.busy.set(true);
    this.error.set(null);
    request
      .pipe(
        tap((result) => {
          if (id === null) {
            // The URL then names the clock, so a reload opens it instead of a new form.
            this.location.replaceState(`/clocks/${result.clock.id}`);
          }
          this.result.set(result);
          this.fill(result.clock);
          if (result.build_operation_id !== undefined) {
            this.followRebuild(result.build_operation_id);
          }
        }),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: (error: unknown) => this.error.set(applySubmitError(this.form, error, this.i18n)),
      });
  }

  // A failed build is already an error.alert popup; the page only says when the hours are ready.
  private followRebuild(operationId: number): void {
    this.rebuild
      .run(of({ operation_id: operationId }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  private fill(clock: Clock): void {
    this.stored.set(clock);
    fillClockForm(this.form, clock, this.playlistById(), this.destroyRef);
  }

  private byIndex(key: 'playlist_index' | 'insert_index'): string[][] {
    const rows: string[][] = [];
    for (const { warning, text } of this.warningTexts()) {
      const index = warning[key];
      if (index !== undefined) {
        (rows[index] ??= []).push(text);
      }
    }
    return rows;
  }

  private describeWarning(warning: ClockWarning): string {
    const key = `clocks.warnings.${warning.code}`;
    if (!this.i18n.has(key)) {
      return warning.message;
    }
    // Indexes name the rows of the saved clock, which the form shows in the same order.
    const clock = this.result()?.clock;
    const playlistId =
      warning.playlist_index === undefined
        ? undefined
        : clock?.playlists[warning.playlist_index]?.playlist_id;
    const insert =
      warning.insert_index === undefined ? undefined : clock?.inserts[warning.insert_index];
    return this.i18n.translate(key, {
      playlist:
        (playlistId !== undefined ? this.playlistById().get(playlistId)?.name : undefined) ??
        String((warning.playlist_index ?? 0) + 1),
      insert: insert ? formatHourOffset(insert.offset_ms) : String((warning.insert_index ?? 0) + 1),
      hours: (warning.hours ?? []).map((hour) => this.weekdayHour(hour)).join(', '),
    });
  }

  private weekdayHour(hour: ApiSchema<'WeekdayHour'>): string {
    return `${weekdayName(hour.weekday, this.i18n.locale())} ${hourLabel(hour.hour)}`;
  }
}
