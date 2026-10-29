import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { Subject, catchError, map, merge, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api-client.service';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema, FieldError } from '../../core/api/api-types';
import { errorMessage, problemMessage } from '../../core/api/problem-message';
import {
  GRAFANA_LOGS_DASHBOARD,
  RuntimeConfigService,
} from '../../core/config/runtime-config.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LOG_COMPONENTS,
  LOG_LEVELS,
  LOG_SEARCH_MAX_LENGTH,
  LogComponent,
  LogLevel,
  REQUEST_ID_PATTERN,
} from '../../core/logs/log-query';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { StationTimeService } from '../../core/time/station-time.service';
import { setServerError } from '../../shared/forms/server-errors';
import { TextInputComponent } from '../../shared/forms/text-input.component';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  LogsRequest,
  LogsState,
  RANGE_PRESET_IDS,
  RangeChoice,
  DEFAULT_RANGE,
  paramsFromState,
  requestFor,
  stateFromParams,
  stateKey,
} from './log-state';

type LogEntry = ApiSchema<'LogEntry'>;

export const LOG_PAGE_SIZE = 100;

interface PageRequest {
  request: LogsRequest;
  cursor: string | null;
  /** Whether the page's entries are added to the loaded ones (Load more) or replace them. */
  append: boolean;
}

interface LogRow {
  entry: LogEntry;
  /** The entry's other fields as `key: value` lines. */
  attrs: string[];
  warn: boolean;
}

/**
 * The backend's log, read from Loki (`GET /api/logs`) newest first (design §10.1). The filters
 * are a time range, level, component, text, and request ID. Nothing announces new lines, so the
 * page reads again on Refresh. The URL keeps the filters, and the error popup's link opens the
 * log of one event by its time span and request ID.
 */
@Component({
  selector: 'app-logs-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    StationTimePipe,
    FieldHintComponent,
    PageHeaderComponent,
    TextInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header titleKey="logs.title" helpPage="help.logs">
      @if (grafanaUrl(); as grafana) {
        <a
          matButton="outlined"
          [href]="grafana + grafanaLogs"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ 'logs.openGrafana' | translate }} <span aria-hidden="true">↗</span>
          <span class="cdk-visually-hidden">{{ 'common.opensInNewTab' | translate }}</span>
        </a>
      }
    </app-page-header>

    <section class="page-section" aria-labelledby="filters-heading">
      <h2 id="filters-heading" class="section-title">{{ 'logs.filters' | translate }}</h2>
      <p class="muted">{{ 'logs.note' | translate: { zone: zone() } }}</p>
      @if (formError(); as message) {
        <p class="load-error" role="alert">{{ message }}</p>
      }
      @if (rangeError(); as message) {
        <p class="load-error" role="alert">{{ message }}</p>
      }
      <form class="filters" [formGroup]="form" (ngSubmit)="apply()">
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.range' | translate }}</mat-label>
            <mat-select formControlName="range">
              @for (preset of presets; track preset) {
                <mat-option [value]="preset">{{ 'logs.range.' + preset | translate }}</mat-option>
              }
              @if (linkedLabel(); as label) {
                <mat-option value="window">{{ label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="range" />
        </div>
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.level' | translate }}</mat-label>
            <mat-select formControlName="level">
              <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
              @for (level of levels; track level) {
                <mat-option [value]="level">{{ 'logs.levels.' + level | translate }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="level" />
        </div>
        <div class="field-row">
          <mat-form-field>
            <mat-label>{{ 'logs.fields.component' | translate }}</mat-label>
            <mat-select formControlName="component">
              <mat-option [value]="null">{{ 'common.all' | translate }}</mat-option>
              @for (component of components; track component) {
                <mat-option [value]="component">{{ component }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-field-hint page="help.logs" field="component" />
        </div>
        <app-text-input
          [control]="form.controls.search"
          label="logs.fields.search"
          [maxLength]="searchMaxLength"
          [hintPage]="'help.logs'"
          hintField="search"
        />
        <app-text-input
          [control]="form.controls.request_id"
          label="logs.fields.requestId"
          [spellcheck]="false"
          [hintPage]="'help.logs'"
          hintField="request_id"
        />
        <div class="form-actions">
          <button matButton="filled" type="submit" [disabled]="loading()">
            {{ 'logs.refresh' | translate }}
          </button>
        </div>
      </form>
    </section>

    <section class="page-section" aria-labelledby="entries-heading">
      <h2 id="entries-heading" class="section-title">
        {{ 'logs.entries' | translate }}
        @if (loaded()) {
          <span class="muted count">
            @if (total(); as count) {
              {{ 'logs.shown' | translate: { shown: rows().length, total: count } }}
            } @else {
              {{ 'logs.shownOnly' | translate: { shown: rows().length } }}
            }
          </span>
        }
      </h2>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="'common.loading' | translate" />
      }
      @if (loadError(); as message) {
        <p class="load-error" role="alert">
          {{ message }}
          <button matButton type="button" (click)="read()">
            {{ 'common.retry' | translate }}
          </button>
        </p>
      }
      <div class="table-scroll">
        <table class="entries">
          <thead>
            <tr>
              <th scope="col">{{ 'logs.columns.time' | translate }}</th>
              <th scope="col">{{ 'logs.columns.level' | translate }}</th>
              <th scope="col">{{ 'logs.columns.component' | translate }}</th>
              <th scope="col">{{ 'logs.columns.message' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              @let entry = row.entry;
              @let requested = !!state().requestId && entry.request_id === state().requestId;
              <tr [class.requested]="requested">
                <td class="nowrap">
                  <time [attr.datetime]="entry.time">{{
                    entry.time | stationTime: 'datetime-seconds'
                  }}</time>
                </td>
                <td>
                  <span class="badge" [class.warn]="row.warn">{{ entry.level }}</span>
                </td>
                <td>{{ entry.component }}</td>
                <td class="message">
                  <div>
                    {{ entry.message }}
                    @if (requested) {
                      <span class="badge">{{ 'logs.requested' | translate }}</span>
                    }
                  </div>
                  @if (entry.error) {
                    <div class="error">{{ entry.error }}</div>
                  }
                  @if (entry.request_id) {
                    <div class="detail">
                      {{ 'logs.requestId' | translate: { id: entry.request_id } }}
                    </div>
                  }
                  @for (attr of row.attrs; track $index) {
                    <div class="detail">{{ attr }}</div>
                  }
                </td>
              </tr>
            } @empty {
              @if (loaded() && !loading() && !loadError()) {
                <tr>
                  <td class="muted" colspan="4">{{ 'logs.empty' | translate }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      @if (nextCursor()) {
        <button matButton type="button" [disabled]="loading()" (click)="loadMore()">
          {{ 'common.loadMore' | translate }}
        </button>
      }
    </section>
  `,
  styles: `
    .section-title {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }

    .count {
      margin-inline-start: 0.5rem;
      font: var(--mat-sys-body-medium);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
      align-items: baseline;
    }

    .entries {
      width: 100%;
      border-collapse: collapse;
    }

    .entries th,
    .entries td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      vertical-align: top;
    }

    .nowrap {
      white-space: nowrap;
    }

    .message {
      overflow-wrap: anywhere;
    }

    .error {
      color: var(--mat-sys-error);
    }

    .detail {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .requested {
      background: color-mix(in srgb, var(--mat-sys-primary-container) 50%, transparent);
    }
  `,
})
export default class LogsPageComponent {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly time = inject(StationTimeService);

  /** Query parameters, named as the URL and the error popup's link use them (`log-state.ts`). */
  readonly range = input<string>();
  readonly from = input<string>();
  readonly to = input<string>();
  readonly level = input<string>();
  readonly component = input<string>();
  readonly search = input<string>();
  readonly request = input<string>();

  protected readonly zone = this.time.zone;
  protected readonly grafanaUrl = inject(RuntimeConfigService).grafanaUrl;
  protected readonly grafanaLogs = GRAFANA_LOGS_DASHBOARD;
  protected readonly presets = RANGE_PRESET_IDS;
  protected readonly levels = LOG_LEVELS;
  protected readonly components = LOG_COMPONENTS;
  protected readonly searchMaxLength = LOG_SEARCH_MAX_LENGTH;

  protected readonly form = new FormGroup({
    range: new FormControl<RangeChoice>(DEFAULT_RANGE, { nonNullable: true }),
    level: new FormControl<LogLevel | null>(null),
    component: new FormControl<LogComponent | null>(null),
    search: new FormControl<string | null>(null, [Validators.maxLength(LOG_SEARCH_MAX_LENGTH)]),
    request_id: new FormControl<string | null>(null, [Validators.pattern(REQUEST_ID_PATTERN)]),
  });

  /** The filters the list shows; they change only when the page is applied or opened. */
  protected readonly state = signal<LogsState>(stateFromParams({}));
  private appliedKey: string | null = null;
  /** The span of an error popup's link, listed as a range choice while it is applied. */
  protected readonly linkedLabel = computed(() => {
    const span = this.state().span;
    return span === null
      ? null
      : this.i18n.translate('logs.range.linked', {
          from: this.time.format(span.from, 'datetime-seconds'),
          to: this.time.format(span.to, 'datetime-seconds'),
        });
  });

  protected readonly loaded = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** A 422 about the time range, shown under the range choice. */
  protected readonly rangeError = signal<string | null>(null);
  /** A 422 about a field the page has no control for. */
  protected readonly formError = signal<string | null>(null);

  private readonly entries = signal<readonly LogEntry[]>([]);
  protected readonly rows = computed(() => this.entries().map(rowOf));
  protected readonly total = signal<number | null>(null);
  protected readonly nextCursor = signal<string | null>(null);

  /** The request of the list on screen; Load more continues it. */
  private shown: LogsRequest | null = null;
  private readonly pages = new Subject<PageRequest>();

  constructor() {
    // The page opens with the URL's state, and again when the URL changes while it is open (an
    // error popup's link on this page). The state the page wrote itself is not read again.
    effect(() => {
      const state = stateFromParams({
        range: this.range(),
        from: this.from(),
        to: this.to(),
        level: this.level(),
        component: this.component(),
        search: this.search(),
        request: this.request(),
      });
      untracked(() => this.open(state));
    });

    this.pages
      .pipe(
        switchMap((page) => {
          this.loading.set(true);
          this.loadError.set(null);
          const cursor = page.cursor ? { cursor: page.cursor } : {};
          return this.api
            .get('/api/logs', { query: { ...page.request, ...cursor, limit: LOG_PAGE_SIZE } })
            .pipe(
              map((result) => ({ page, result, error: null as unknown })),
              catchError((error: unknown) => of({ page, result: null, error })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ page, result, error }) => {
        this.loading.set(false);
        if (!result) {
          this.showError(error);
          return;
        }
        this.rangeError.set(null);
        this.formError.set(null);
        this.entries.update((rows) => (page.append ? [...rows, ...result.items] : result.items));
        this.total.set(result.total ?? null);
        this.nextCursor.set(result.next_cursor ?? null);
        this.loaded.set(true);
      });

    // A change of a select reads the first page again, with the other filters as they are.
    merge(
      this.form.controls.range.valueChanges,
      this.form.controls.level.valueChanges,
      this.form.controls.component.valueChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.apply());
  }

  /** Applies the filters on the form and reads the first page again (Refresh and each filter). */
  protected apply(): void {
    // Server errors belong to the last read; a new try is judged by the form's own rules alone.
    for (const control of Object.values<AbstractControl>(this.form.controls)) {
      control.updateValueAndValidity({ emitEvent: false });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.commit({
      range: value.range,
      span: value.range === 'window' ? this.state().span : null,
      level: value.level,
      component: value.component,
      search: value.search || null,
      requestId: value.request_id || null,
    });
  }

  /** Reads the first page of the current filters again. */
  protected read(): void {
    const request = requestFor(this.state(), new Date());
    this.shown = request;
    this.nextCursor.set(null);
    this.pages.next({ request, cursor: null, append: false });
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor && this.shown) {
      this.pages.next({ request: this.shown, cursor, append: true });
    }
  }

  /** Opens a state the URL or a link gives; nothing is read again when it is the one shown. */
  private open(state: LogsState): void {
    if (stateKey(state) === this.appliedKey) {
      return;
    }
    this.form.setValue(
      {
        range: state.range,
        level: state.level,
        component: state.component,
        search: state.search,
        request_id: state.requestId,
      },
      { emitEvent: false },
    );
    this.setState(state);
    this.read();
  }

  private commit(state: LogsState): void {
    this.setState(state);
    // Written as the URL, so a reload or a link restores this view (`log-state.ts`).
    const tree = this.router.parseUrl(this.router.url);
    tree.queryParams = paramsFromState(state);
    void this.router.navigateByUrl(tree, { replaceUrl: true });
    this.read();
  }

  private setState(state: LogsState): void {
    this.state.set(state);
    this.appliedKey = stateKey(state);
  }

  /**
   * A failed read keeps the rows on screen. A 422 names a field of the form, or the range; the
   * rest is the problem's text (a 503 when Loki does not answer, for example).
   */
  private showError(error: unknown): void {
    if (error instanceof ApiProblem && error.status === 422) {
      if (error.code === 'range_too_long') {
        this.rangeError.set(problemMessage(error, this.i18n));
        return;
      }
      if (error.errors.length > 0) {
        const unmatched = this.applyFieldErrors(error.errors);
        if (unmatched.length > 0) {
          this.formError.set(problemMessage(error, this.i18n));
        }
        return;
      }
    }
    this.loadError.set(errorMessage(error, this.i18n));
  }

  /**
   * Puts the field errors of `query.<parameter>` on the control of the same name. The time range
   * has no control of its own, so `from` and `to` are shown on the range choice.
   */
  private applyFieldErrors(errors: readonly FieldError[]): FieldError[] {
    const unmatched: FieldError[] = [];
    for (const error of errors) {
      const control = controlOf(this.form, error.field);
      if (control) {
        setServerError(control, error);
      } else {
        unmatched.push(error);
      }
    }
    return unmatched;
  }
}

function controlOf(form: FormGroup, field: string): AbstractControl | null {
  if (!field.startsWith('query.')) {
    return null;
  }
  const parameter = field.slice('query.'.length);
  if (parameter === 'from' || parameter === 'to') {
    return form.get('range');
  }
  return form.get(parameter);
}

function rowOf(entry: LogEntry): LogRow {
  return {
    entry,
    attrs: Object.entries(entry.attrs ?? {}).map(
      ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    ),
    warn: entry.level === 'ERROR' || entry.level === 'WARN',
  };
}
