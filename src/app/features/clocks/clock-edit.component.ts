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
  viewChild,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Observable, finalize, map, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import type { ApiSchema } from '../../core/api/api-types';
import { errorMessage } from '../../core/api/problem-message';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { OperationStatus, OperationsService } from '../../core/operations/operations.service';
import { formatDurationMs } from '../../core/time/duration';
import { hourLabel, weekdayName } from '../../core/time/local-date';
import { DurationPipe } from '../../core/time/duration.pipe';
import { controlVersion } from '../../shared/forms/field-errors';
import { FillerModeSelectComponent } from '../../shared/forms/filler-mode-select.component';
import { applySubmitError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { PendingChanges, warnBeforeUnload } from '../../shared/forms/unsaved-changes';
import { ArtistSelectComponent } from '../../shared/pickers/artist-select.component';
import { PlaylistSelectComponent } from '../../shared/pickers/playlist-select.component';
import { FillerDialogService } from '../../shared/ui/filler-dialog.service';
import { shortSegments } from '../../shared/ui/filler-dialog.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { ClockElementComponent } from './clock-element.component';
import { ClockFillerPoolComponent } from './clock-filler-pool.component';
import {
  CLOCK_LIMITS,
  Clock,
  ClockElement,
  ClockSaveResult,
  clockBody,
  clockForm,
  elementForm,
  fillClockForm,
} from './clock-form';
import { ClockLayoutComponent } from './clock-layout.component';

type ClockCheck = ApiSchema<'ClockCheck'>;
type ClockWarning = ApiSchema<'ClockWarning'>;

/**
 * Creates or edits a clock (design §6.0, §7.2). Saving sends the template; the backend runs the
 * dry check and answers with the layout, warnings, and replaced fixed elements, which the page shows
 * as they are. A short clock opens the blocking filler dialog. The editor stays open after a save so
 * the result can be read.
 */
@Component({
  selector: 'app-clock-edit',
  imports: [
    MatButtonModule,
    MatProgressBarModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    ArtistSelectComponent,
    ClockElementComponent,
    ClockFillerPoolComponent,
    ClockLayoutComponent,
    FillerModeSelectComponent,
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
          <app-filler-mode-select
            modes="default"
            label="clocks.fields.default_filler_mode"
            [control]="form.controls.default_filler_mode"
            hintPage="help.clocks"
            hintField="default_filler_mode"
          />
          @switch (defaultMode()) {
            @case ('playlist') {
              <app-playlist-select
                label="clocks.fields.filler_playlist"
                [control]="form.controls.default_filler_source_id"
                hintPage="help.clocks"
                hintField="filler_source_id"
              />
            }
            @case ('artist') {
              <app-artist-select
                label="clocks.fields.filler_artist"
                [control]="form.controls.default_filler_source_id"
                hintPage="help.clocks"
                hintField="filler_source_id"
              />
            }
          }
        </div>
      </section>

      <section class="page-section" aria-labelledby="elements-heading">
        <h2 id="elements-heading" class="section-title">
          {{ 'clocks.edit.elements' | translate }}
        </h2>
        <p class="muted">{{ 'clocks.edit.elementsNote' | translate }}</p>
        @for (group of form.controls.elements.controls; track group; let i = $index) {
          <app-clock-element
            [group]="group"
            [index]="i"
            [count]="elementCount()"
            [warnings]="elementWarnings()[i] ?? []"
            (moveUp)="move(i, -1)"
            (moveDown)="move(i, 1)"
            (remove)="removeElement(i)"
          />
        }
        @if (elementsMissing()) {
          <p class="form-error" role="alert">{{ 'clocks.edit.noElements' | translate }}</p>
        }
        <button matButton="tonal" type="button" (click)="addElement()">
          {{ 'clocks.edit.addElement' | translate }}
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

    @if (stored(); as clock) {
      <section class="page-section result" aria-labelledby="check-heading">
        <h2 id="check-heading" class="section-title">{{ 'clocks.check.title' | translate }}</h2>
        <p role="status">
          @if (clock.status === 'complete') {
            <span class="badge">{{ 'clocks.status.complete' | translate }}</span>
          } @else {
            <span class="badge warn">{{ 'clocks.status.incomplete' | translate }}</span>
            {{ 'clocks.check.incompleteNote' | translate }}
          }
        </p>
        <p>
          @if (clock.layout.shortfall_ms > 0) {
            {{
              'clocks.check.shortfall'
                | translate: { duration: (clock.layout.shortfall_ms | duration) }
            }}
          } @else {
            {{ 'clocks.check.full' | translate }}
          }
        </p>
        @if (replaced().length > 0) {
          <div role="status">
            <p>{{ 'clocks.check.replaced' | translate }}</p>
            <ul>
              @for (element of replaced(); track element.id) {
                <li>{{ describeReplaced(element) }}</li>
              }
            </ul>
          </div>
        }
        @if (generalWarnings().length > 0) {
          <p>{{ 'clocks.check.warnings' | translate }}</p>
          <ul class="warnings">
            @for (message of generalWarnings(); track $index) {
              <li>{{ message }}</li>
            }
          </ul>
        }
        @if (buildStatus(); as status) {
          <p class="muted" role="status">{{ 'clocks.build.' + status | translate }}</p>
        }

        <h3 class="subtitle">{{ 'clocks.layout.title' | translate }}</h3>
        <app-clock-layout [clock]="clock" [stale]="dirty()" />
      </section>

      <section class="page-section" aria-labelledby="pool-heading">
        <h2 id="pool-heading" class="section-title">{{ 'clocks.pool.title' | translate }}</h2>
        <p class="muted">{{ 'clocks.pool.note' | translate }}</p>
        <app-clock-filler-pool [clockId]="clock.id" />
      </section>
    }
  `,
  styles: `
    .section-title {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-title-medium);
    }

    .subtitle {
      margin: 1rem 0 0.25rem;
      font: var(--mat-sys-title-small);
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
  private readonly i18n = inject(I18nService);
  private readonly location = inject(Location);
  private readonly operations = inject(OperationsService);
  private readonly fillerDialog = inject(FillerDialogService);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter; absent on `clocks/new`. */
  readonly id = input<string>();

  protected readonly limits = CLOCK_LIMITS;
  protected readonly form = clockForm(this.destroyRef);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The clock as last read or saved; null for a new one. */
  protected readonly stored = signal<Clock | null>(null);
  /** The dry check of the last save; null after a load. */
  private readonly check = signal<ClockCheck | null>(null);
  protected readonly buildStatus = signal<OperationStatus | null>(null);

  private readonly pool = viewChild(ClockFillerPoolComponent);

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
  protected readonly elementCount = computed(() => {
    this.version();
    return this.form.controls.elements.length;
  });
  protected readonly elementsMissing = computed(() => {
    this.version();
    const elements = this.form.controls.elements;
    return elements.length === 0 && (this.form.touched || this.form.dirty);
  });
  protected readonly defaultMode = computed(() => {
    this.version();
    return this.form.controls.default_filler_mode.value;
  });

  protected readonly replaced = computed(() => this.check()?.replaced_elements ?? []);
  protected readonly elementWarnings = computed(() => {
    const byElement: string[][] = [];
    for (const warning of this.check()?.warnings ?? []) {
      if (warning.element_index !== undefined) {
        (byElement[warning.element_index] ??= []).push(this.describeWarning(warning));
      }
    }
    return byElement;
  });
  protected readonly generalWarnings = computed(() =>
    (this.check()?.warnings ?? []).map((warning) => this.describeWarning(warning)),
  );

  protected readonly loaded = rxResource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : Number(id);
    },
    stream: ({ params: id }) => this.api.get('/api/clocks/{id}', { path: { id } }),
  });
  protected readonly loadError = computed(() =>
    this.loaded.status() === 'error' ? errorMessage(this.loaded.error(), this.i18n) : null,
  );

  constructor() {
    effect(() => {
      if (this.loaded.hasValue()) {
        const clock = this.loaded.value();
        untracked(() => this.fill(clock));
      }
    });
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty || (this.pool()?.hasUnsavedChanges() ?? false);
  }

  protected addElement(): void {
    this.form.controls.elements.push(elementForm(this.destroyRef));
    this.form.markAsDirty();
  }

  protected removeElement(index: number): void {
    this.form.controls.elements.removeAt(index);
    this.form.markAsDirty();
  }

  protected move(index: number, by: -1 | 1): void {
    const elements = this.form.controls.elements;
    const target = index + by;
    if (target < 0 || target >= elements.length) {
      return;
    }
    const group = elements.at(index);
    elements.removeAt(index, { emitEvent: false });
    elements.insert(target, group);
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
          this.applyResult(result);
        }),
        switchMap((result) =>
          result.check.requires_filler_choice ? this.askFiller(result) : of(null),
        ),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: (error: unknown) => this.error.set(applySubmitError(this.form, error, this.i18n)),
      });
  }

  /**
   * The blocking filler dialog (design §6.0). Its actions return the clock as saved; the replaced
   * elements of the first save are kept, since the follow-up request replaces nothing.
   */
  private askFiller(first: ClockSaveResult): Observable<unknown> {
    const path = { id: first.clock.id };
    const keep = (result: ClockSaveResult) =>
      this.applyResult({
        ...result,
        check: { ...result.check, replaced_elements: first.check.replaced_elements },
      });
    return this.fillerDialog
      .open({
        clockName: first.clock.name,
        segments: shortSegments(first),
        save: (body) =>
          this.api.post('/api/clocks/{id}/save-with-filler', { path, body }).pipe(tap(keep)),
        saveIncomplete: () =>
          this.api.post('/api/clocks/{id}/save-incomplete', { path }).pipe(tap(keep)),
      })
      .pipe(map(() => null));
  }

  private applyResult(result: ClockSaveResult): void {
    this.check.set(result.check);
    this.fill(result.clock);
    if (result.build_operation_id !== undefined) {
      this.watchBuild(result.build_operation_id);
    }
  }

  // A failed build is already an error.alert popup; the page only says when the hours are ready.
  private watchBuild(id: number): void {
    this.buildStatus.set('running');
    this.operations
      .waitFor(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => this.buildStatus.set(state.status));
  }

  private fill(clock: Clock): void {
    this.stored.set(clock);
    fillClockForm(this.form, clock, this.destroyRef);
  }

  protected describeReplaced(element: ClockElement): string {
    return this.i18n.translate('clocks.check.replacedElement', {
      minute: element.fixed_minute ?? 0,
      duration: formatDurationMs(element.nominal_duration_ms),
    });
  }

  private describeWarning(warning: ClockWarning): string {
    const key = `clocks.warnings.${warning.code}`;
    if (!this.i18n.has(key)) {
      return warning.message;
    }
    return this.i18n.translate(key, {
      element: (warning.element_index ?? 0) + 1,
      segment: (warning.segment_index ?? 0) + 1,
      hours: (warning.hours ?? []).map((hour) => this.weekdayHour(hour)).join(', '),
    });
  }

  private weekdayHour(hour: ApiSchema<'WeekdayHour'>): string {
    return `${weekdayName(hour.weekday, this.i18n.locale())} ${hourLabel(hour.hour)}`;
  }
}
