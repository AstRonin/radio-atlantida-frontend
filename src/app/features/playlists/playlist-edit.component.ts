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
  viewChild,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import {
  EMPTY,
  Observable,
  catchError,
  concatMap,
  expand,
  forkJoin,
  map,
  of,
  reduce,
  switchMap,
} from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { CatalogService } from '../../core/catalog/catalog.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { followOperation } from '../../core/operations/operation-run';
import { SETTING_KEYS, SettingsService } from '../../core/settings/settings.service';
import {
  ClockRule,
  ClockRuleInputComponent,
  linkClockCount,
} from '../../shared/forms/clock-rule-input.component';
import { controlVersion } from '../../shared/forms/field-errors';
import { PlaylistTypeSelectComponent } from '../../shared/forms/playlist-type-select.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { PlayRulePickerComponent } from '../../shared/pickers/play-rule-picker.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { OperationStatusComponent } from '../../shared/ui/operation-status.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PlaylistTracksComponent } from './playlist-tracks.component';

type Playlist = ApiSchema<'Playlist'>;
type PlaylistSaved = ApiSchema<'PlaylistSaved'>;
type Track = ApiSchema<'Track'>;

export const PLAYLIST_NAME_MAX = 200;
/** The largest page `GET /api/tracks` returns; the members are read in pages of this size. */
export const MEMBER_PAGE_SIZE = 500;

interface Loaded {
  playlist: Playlist;
  members: Track[];
}

interface EmergencyPlaylist {
  id: number | null;
  name: string | null;
}

/**
 * Creates or edits a playlist: name, type (required), placement rule in clocks, play rules, and its
 * tracks. The playlist, its rules, and its tracks are separate requests (design §6.4); only the
 * changed parts are sent. A changed placement rule rebuilds the hours of the clocks that use the
 * playlist; the page then stays to follow that build (frontend F21 §5.2). The box "Use as emergency
 * playlist" writes the same setting as the field in Settings, after the playlist is saved.
 */
@Component({
  selector: 'app-playlist-edit',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ClockRuleInputComponent,
    FieldHintComponent,
    OperationStatusComponent,
    PageHeaderComponent,
    PlayRulePickerComponent,
    PlaylistTracksComponent,
    PlaylistTypeSelectComponent,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header
      [titleKey]="stored() === null ? 'playlists.edit.createTitle' : 'playlists.edit.editTitle'"
      helpPage="help.playlists"
      backTo="/playlists"
    />

    @if (loaded.isLoading()) {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
    }
    @if (loadError(); as message) {
      <p class="load-error" role="alert">{{ message }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()">
      <div class="form-grid">
        <app-text-input
          [control]="form.controls.name"
          label="playlists.fields.name"
          [maxLength]="nameMax"
          hintPage="help.playlists"
          hintField="name"
        />
        <app-playlist-type-select
          [control]="form.controls.type_id"
          label="playlists.fields.type_id"
          hintPage="help.playlists"
          hintField="type_id"
        />
      </div>
      <section class="page-section" aria-labelledby="clock-rule-heading">
        <h2 id="clock-rule-heading" class="section-title">
          {{ 'playlists.clockRule.title' | translate }}
        </h2>
        <p class="muted">{{ 'playlists.clockRule.note' | translate }}</p>
        <app-clock-rule-input
          [rule]="form.controls.clock_rule"
          [count]="form.controls.clock_count"
          hintPage="help.playlists"
        />
      </section>
      <app-play-rule-picker
        [control]="form.controls.rule_ids"
        label="playlists.fields.rule_ids"
        hintPage="help.playlists"
        hintField="rule_ids"
      />
      <div class="emergency">
        <div class="checkbox">
          <mat-checkbox [formControl]="form.controls.emergency">
            {{ 'playlists.emergency.label' | translate }}
          </mat-checkbox>
          <app-field-hint page="help.playlists" field="emergency" />
        </div>
        @if (emergencyReadFailed()) {
          <p class="load-error" role="alert">{{ 'playlists.emergency.readFailed' | translate }}</p>
        }
        @for (note of emergencyNotes(); track note) {
          <p class="muted note" role="status">{{ note }}</p>
        }
      </div>
      <app-playlist-tracks [control]="form.controls.track_ids" [members]="members()" />

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      <div class="form-actions">
        <button matButton="filled" type="submit" [disabled]="busy() || invalid()">
          {{ 'common.save' | translate }}
        </button>
        <a matButton routerLink="/playlists">{{ 'common.back' | translate }}</a>
      </div>
      <app-operation-status
        [state]="rebuild.state()"
        runningLabel="playlists.clockRule.rebuilding"
      />
    </form>
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .emergency {
      margin-bottom: 1rem;
    }

    .checkbox {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .note,
    .load-error {
      margin: 0.25rem 0 0;
    }
  `,
})
export default class PlaylistEditComponent implements PendingChanges {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly catalog = inject(CatalogService);
  private readonly settings = inject(SettingsService);

  /** Route parameter; absent on `playlists/new`. */
  readonly id = input<string>();

  protected readonly nameMax = PLAYLIST_NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The playlist as last read or saved; null for a new one. */
  protected readonly stored = signal<Playlist | null>(null);
  protected readonly members = signal<readonly Track[]>([]);
  /** Track IDs as stored, to send the membership only when it changed. */
  private storedTrackIds: readonly number[] = [];

  protected readonly form = new FormGroup({
    name: new FormControl<string | null>('', [
      Validators.required,
      Validators.maxLength(PLAYLIST_NAME_MAX),
    ]),
    type_id: new FormControl<number | null>(null, Validators.required),
    clock_rule: new FormControl<ClockRule | null>('fill', Validators.required),
    clock_count: new FormControl<number | null>({ value: null, disabled: true }),
    rule_ids: new FormControl<number[] | null>([]),
    track_ids: new FormControl<number[] | null>([]),
    // Not a playlist field: disabled until the setting is read, and it stays so if the read fails.
    emergency: new FormControl({ value: false, disabled: true }, { nonNullable: true }),
  });

  protected readonly rebuild = followOperation();

  private readonly version = controlVersion(signal(this.form));
  protected readonly invalid = computed(() => {
    this.version();
    return this.form.invalid;
  });

  protected readonly loaded = rxResource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : Number(id);
    },
    stream: ({ params: id }) =>
      forkJoin({
        playlist: this.api.get('/api/playlists/{id}', { path: { id } }),
        members: this.readMembers(id),
      }),
  });
  protected readonly loadError = computed(() =>
    this.loaded.status() === 'error' ? errorMessage(this.loaded.error(), this.i18n) : null,
  );

  protected readonly emergency = rxResource({
    stream: () => this.settings.emergencyPlaylistId().pipe(switchMap((id) => this.withName(id))),
  });
  private readonly currentEmergency = computed((): EmergencyPlaylist =>
    this.emergency.hasValue() ? this.emergency.value() : { id: null, name: null },
  );
  protected readonly emergencyReadFailed = computed(() => this.emergency.status() === 'error');

  private readonly tracks = viewChild(PlaylistTracksComponent);

  protected readonly emergencyNotes = computed((): readonly string[] => {
    this.version();
    const box = this.form.controls.emergency;
    if (box.disabled) {
      return [];
    }
    const { id: current, name } = this.currentEmergency();
    const isCurrent = current !== null && current === this.stored()?.id;
    const notes: string[] = [];
    if (box.value && current !== null && !isCurrent) {
      notes.push(
        name === null
          ? this.i18n.translate('playlists.emergency.replacesUnnamed')
          : this.i18n.translate('playlists.emergency.replaces', { name }),
      );
    }
    if (!box.value && isCurrent) {
      notes.push(this.i18n.translate('playlists.emergency.clears'));
    }
    if (box.value && !(this.tracks()?.hasKnownDuration() ?? true)) {
      notes.push(this.i18n.translate('playlists.emergency.noPlayable'));
    }
    return notes;
  });

  constructor() {
    effect(() => {
      if (this.loaded.hasValue()) {
        const loaded = this.loaded.value();
        untracked(() => this.fill(loaded));
      }
    });
    // After the effect above: filling the form resets every control, this box included.
    effect(() => {
      if (this.emergency.hasValue() && (this.id() === undefined || this.loaded.hasValue())) {
        const current = this.currentEmergency().id;
        untracked(() =>
          this.form.controls.emergency.reset({
            value: current === this.stored()?.id,
            disabled: false,
          }),
        );
      }
    });
    linkClockCount(this.form.controls.clock_rule, this.form.controls.clock_count, this.destroyRef);
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty;
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const rule = value.clock_rule ?? 'fill';
    const body = {
      name: (value.name ?? '').trim(),
      type_id: value.type_id ?? 0,
      clock_rule: rule,
      ...(rule === 'spread' ? { clock_count: value.clock_count } : {}),
    };
    const ruleIds = value.rule_ids ?? [];
    const trackIds = value.track_ids ?? [];
    const stored = this.stored();

    const { name, type_id, clock_rule, clock_count } = this.form.controls;
    const savePlaylist: Observable<PlaylistSaved> = !stored
      ? this.api.post('/api/playlists', { body })
      : name.dirty || type_id.dirty || clock_rule.dirty || clock_count.dirty
        ? this.api.put('/api/playlists/{id}', { path: { id: stored.id }, body })
        : of(stored);

    this.busy.set(true);
    this.error.set(null);
    savePlaylist
      .pipe(
        concatMap((saved) => {
          if (!stored) {
            // Later failures are then retried as edits of this playlist, not as a second create.
            this.stored.set(saved);
            this.location.replaceState(`/playlists/${saved.id}`);
          }
          const rules: Observable<unknown> = sameIds(saved.play_rule_ids, ruleIds)
            ? of(null)
            : this.api.put('/api/playlists/{id}/play-rules', {
                path: { id: saved.id },
                body: { rule_ids: ruleIds },
              });
          return rules.pipe(map(() => saved));
        }),
        concatMap((saved): Observable<PlaylistSaved> =>
          sameIds(this.storedTrackIds, trackIds)
            ? of(saved)
            : this.api
                .put('/api/playlists/{id}/tracks', {
                  path: { id: saved.id },
                  body: { track_ids: trackIds },
                })
                // The build the rule change started is named only by the first response.
                .pipe(map((updated) => ({ ...updated, ...pickBuild(saved) }))),
        ),
        concatMap((saved) =>
          this.saveEmergency(saved.id).pipe(map((emergencyError) => ({ saved, emergencyError }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ saved, emergencyError }) => {
          const { build_operation_id: buildId, ...playlist } = saved;
          if (buildId === undefined && emergencyError === null) {
            this.form.markAsPristine();
            void this.router.navigateByUrl('/playlists');
            return;
          }
          this.busy.set(false);
          // Without the build ID, so a later save that only changes the box does not follow it.
          this.stored.set(playlist);
          this.storedTrackIds = [...trackIds];
          this.form.markAsPristine();
          if (emergencyError !== null) {
            this.error.set(emergencyError);
            // The playlist is saved; only the box is still to be saved.
            this.form.controls.emergency.markAsDirty();
          }
          if (buildId !== undefined) {
            this.followRebuild(buildId);
          }
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(applySubmitError(this.form, error, this.i18n));
        },
      });
  }

  /**
   * Writes the setting if the box changed. The playlist is saved by now, so a refused write is not
   * a failed save: it comes back as the text to show, and the page stays open for another try.
   */
  private saveEmergency(playlistId: number): Observable<string | null> {
    const box = this.form.controls.emergency;
    if (box.disabled || box.value === (this.currentEmergency().id === playlistId)) {
      return of(null);
    }
    const ticked = box.value;
    const value = ticked ? playlistId : null;
    return this.settings.save(SETTING_KEYS.emergencyPlaylistId, value).pipe(
      map((): string | null => {
        this.emergency.set({ id: value, name: null });
        return null;
      }),
      catchError((error: unknown) =>
        of(
          this.i18n.translate(
            ticked ? 'playlists.emergency.setFailed' : 'playlists.emergency.clearFailed',
            { reason: errorMessage(error, this.i18n) },
          ),
        ),
      ),
    );
  }

  // The name is only for a message: without it the message goes without the name.
  private withName(id: number | null): Observable<EmergencyPlaylist> {
    if (id === null) {
      return of({ id, name: null });
    }
    return this.catalog.playlists().pipe(
      map((playlists) => ({ id, name: playlists.find((item) => item.id === id)?.name ?? null })),
      catchError(() => of({ id, name: null })),
    );
  }

  private fill({ playlist, members }: Loaded): void {
    this.stored.set(playlist);
    this.members.set(members);
    this.storedTrackIds = members.map((track) => track.id);
    this.form.reset({
      name: playlist.name,
      type_id: playlist.type.id,
      clock_rule: playlist.clock_rule,
      clock_count: playlist.clock_count ?? null,
      rule_ids: playlist.play_rule_ids,
      track_ids: [...this.storedTrackIds],
    });
  }

  private followRebuild(operationId: number): void {
    this.rebuild
      .run(of({ operation_id: operationId }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  // Every page of the playlist's tracks; the membership request needs the whole set.
  private readMembers(id: number): Observable<Track[]> {
    const page = (cursor?: string) =>
      this.api.get('/api/tracks', {
        query: { playlist_id: id, limit: MEMBER_PAGE_SIZE, cursor },
      });
    return page().pipe(
      expand((result) => (result.next_cursor ? page(result.next_cursor) : EMPTY)),
      reduce((tracks: Track[], result) => [...tracks, ...result.items], []),
    );
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

function pickBuild(saved: PlaylistSaved): Pick<PlaylistSaved, 'build_operation_id'> {
  return saved.build_operation_id === undefined
    ? {}
    : { build_operation_id: saved.build_operation_id };
}
