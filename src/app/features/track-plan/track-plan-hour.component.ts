import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { PreviewTrack } from '../../core/player/player.service';
import { DurationPipe, PlannedLengthPipe } from '../../core/time/duration.pipe';
import { StationTimePipe } from '../../core/time/station-time.pipe';
import { FieldHintComponent } from '../../shared/ui/field-hint.component';
import { PlayButtonComponent } from '../../shared/ui/play-button.component';
import type { PlanMoveTarget } from './track-plan-move';

export interface PlanRowView {
  item: ApiSchema<'TrackPlanItem'>;
  /** What the play button needs; built once per load, not on every check. */
  preview: PreviewTrack;
  /** How the row moves; null when it has no handle and no move buttons. */
  move: PlanMoveTarget | null;
  /** The one-time insert that fixes this row; null for a row that is not fixed. */
  lock: PlanInsertView | null;
}

/** A row dropped or stepped onto the row at index `to` of its hour. */
export interface PlanRowMove {
  row: PlanRowView;
  to: number;
}

export interface PlanHourView {
  hour: ApiSchema<'TrackPlanHour'>;
  rows: readonly PlanRowView[];
  /** UTC; the start of the next hour. */
  endUtc: string;
  /** Already translated. */
  warnings: readonly string[];
  /** One-time inserts of the hour, with what the list shows of them. */
  inserts: readonly PlanInsertView[];
  /** The hour has not started, so inserts may be added or removed (the backend still decides). */
  editable: boolean;
  /** On air or within the pre-push window: nothing in the hour can move or be unpinned. */
  frozen: boolean;
}

export interface PlanInsertView {
  insert: ApiSchema<'TrackPlanInsert'>;
  /** `mm:ss`, or the translated placement of a start or end insert. */
  at: string;
  /** The track's title, or `#id` when the hour's items do not hold it. */
  title: string;
}

/** Plan item sources that come from an insert, marked in the list. */
const INSERT_SOURCES: ReadonlySet<string> = new Set(['insert', 'hour_insert', 'reschedule']);

/**
 * One built hour of the track plan: its clock, build time, items in time order, the engine's
 * warnings, and its one-time inserts. An hour that has not started offers "Add insert" and, for
 * each one-time insert, "Remove" (frontend F21 §5.4). Presentational; times are shown in the
 * station zone.
 */
@Component({
  selector: 'app-track-plan-hour',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkScrollable,
    MatButtonModule,
    MatProgressBarModule,
    RouterLink,
    TranslatePipe,
    DurationPipe,
    PlannedLengthPipe,
    StationTimePipe,
    FieldHintComponent,
    PlayButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let hour = view().hour;
    <section class="hour" [attr.aria-labelledby]="headingId()">
      <header class="hour-head">
        <h3 class="hour-title" [id]="headingId()">
          {{ hour.hour_start_utc | stationTime: 'datetime' }} –
          {{ view().endUtc | stationTime: 'time' }}
        </h3>
        <a [routerLink]="['/clocks', hour.clock.id]">{{ hour.clock.name }}</a>
        <span class="muted">
          {{ 'trackPlan.builtAt' | translate: { time: (hour.built_at | stationTime) } }}
        </span>
        @if (view().editable) {
          <button matButton type="button" (click)="addInsert.emit()">
            {{ 'trackPlan.inserts.add' | translate }}
          </button>
        }
      </header>

      @if (busy()) {
        <mat-progress-bar
          mode="indeterminate"
          [attr.aria-label]="'trackPlan.moves.running' | translate"
        />
        <p class="muted" role="status">{{ 'trackPlan.moves.running' | translate }}</p>
      }
      @if (moveError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      @if (view().warnings.length > 0) {
        <ul class="warnings" [attr.aria-label]="'trackPlan.warningsLabel' | translate">
          @for (warning of view().warnings; track $index) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      @if (view().inserts.length > 0) {
        <ul class="inserts" [attr.aria-label]="'trackPlan.inserts.title' | translate">
          @for (row of view().inserts; track row.insert.id) {
            <li>
              <span class="badge">{{ 'trackPlan.inserts.label' | translate }}</span>
              <span class="time">{{ row.at }}</span>
              <span>{{ row.title }}</span>
              @if (row.insert.missed_id !== undefined) {
                <span class="muted">{{ 'trackPlan.inserts.rescheduled' | translate }}</span>
              }
              @if (view().editable) {
                <button
                  matButton
                  type="button"
                  [attr.aria-label]="
                    'trackPlan.inserts.removeLabel' | translate: { title: row.title }
                  "
                  (click)="removeInsert.emit(row)"
                >
                  {{ 'common.remove' | translate }}
                </button>
              }
            </li>
          }
        </ul>
      }

      <!-- cdkScrollable: a drag keeps its drop positions and auto-scrolls when the rows scroll here. -->
      <div class="table-scroll" cdkScrollable>
        <table class="items">
          <thead>
            <tr>
              <th scope="col">{{ 'trackPlan.columns.start' | translate }}</th>
              <th scope="col">
                <span class="cdk-visually-hidden">{{
                  'trackPlan.columns.preview' | translate
                }}</span>
              </th>
              <th scope="col">{{ 'trackPlan.columns.title' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.artist' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.length' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.source' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.type' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.status' | translate }}</th>
              <th scope="col">{{ 'trackPlan.columns.position' | translate }}</th>
            </tr>
          </thead>
          <tbody
            cdkDropList
            cdkDropListLockAxis="y"
            [cdkDropListDisabled]="view().frozen || blocked()"
            (cdkDropListDropped)="dropped($event)"
          >
            @for (row of view().rows; track row.item.id) {
              @let item = row.item;
              <!-- Every row is a cdkDrag, or the drop indexes would skip the rows that cannot move. -->
              <tr
                cdkDrag
                cdkDragPreviewContainer="parent"
                [cdkDragData]="row"
                [cdkDragDisabled]="row.move === null || blocked()"
                [class.insert]="isInsert(item.source)"
              >
                <td class="time">{{ item.planned_start_utc | stationTime: 'time-seconds' }}</td>
                <td>
                  <app-play-button [track]="row.preview" />
                </td>
                <td>{{ item.title }}</td>
                <td>{{ item.artist_name }}</td>
                <td class="time">
                  {{ item.planned_out_ms | plannedLength: item.planned_in_ms }}
                  @if (item.truncated) {
                    <span class="badge warn">
                      {{
                        'trackPlan.truncated' | translate: { length: (item.duration_ms | duration) }
                      }}
                    </span>
                  }
                </td>
                <td class="source">
                  @if (isInsert(item.source)) {
                    <span class="insert-mark" aria-hidden="true">⏱</span>
                  }
                  {{ 'trackPlan.sources.' + item.source | translate }}
                </td>
                <td [title]="item.playlist?.name ?? ''">{{ item.playlist?.type ?? '–' }}</td>
                <td>
                  <span class="badge" [class.warn]="item.status === 'missed'">
                    {{ 'trackPlan.statuses.' + item.status | translate }}
                  </span>
                </td>
                <td>
                  <div class="position">
                    @if (row.move !== null) {
                      <span
                        class="handle"
                        cdkDragHandle
                        aria-hidden="true"
                        [title]="'trackPlan.moves.handle' | translate"
                        >⠿</span
                      >
                      <button
                        matIconButton
                        type="button"
                        [disabled]="blocked() || $first"
                        [attr.aria-label]="
                          'trackPlan.moves.moveUp' | translate: { title: item.title }
                        "
                        (click)="move.emit({ row, to: $index - 1 })"
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        matIconButton
                        type="button"
                        [disabled]="blocked() || $last"
                        [attr.aria-label]="
                          'trackPlan.moves.moveDown' | translate: { title: item.title }
                        "
                        (click)="move.emit({ row, to: $index + 1 })"
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                    }
                    @if (row.lock; as lock) {
                      @if (view().frozen) {
                        <span class="lock" aria-hidden="true">🔒</span>
                      } @else {
                        <button
                          matIconButton
                          type="button"
                          class="lock"
                          [disabled]="blocked()"
                          [attr.aria-label]="
                            'trackPlan.moves.unpinLabel' | translate: { title: item.title }
                          "
                          (click)="unpin.emit(lock)"
                        >
                          <span aria-hidden="true">🔒</span>
                        </button>
                      }
                      <app-field-hint page="help.track-plan" textKey="trackPlan.moves.fixed" />
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="muted" colspan="9">{{ 'trackPlan.noItems' | translate }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    /* An hour fits whole on a 1080p screen; the page, not the table, scrolls through the hours. */
    .table-scroll {
      --table-max-height: max(calc(100dvh - 12rem), 20rem);
    }

    .hour {
      margin-bottom: 1.5rem;
    }

    .hour-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      align-items: baseline;
    }

    .hour-title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .warnings {
      margin: 0.5rem 0;
      padding: 0.5rem 0.5rem 0.5rem 1.75rem;
      border-left: 4px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .inserts {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0.5rem 0;
      padding: 0;
      list-style: none;
    }

    .inserts li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }

    .items tr.insert {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .insert-mark {
      margin-inline-end: 0.25rem;
    }

    .items {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }

    .items th,
    .items td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }

    /* Holds the widest source label, so a row that becomes a one-time insert does not shift columns. */
    .source {
      min-width: 8.5rem;
      white-space: nowrap;
    }

    /* Holds the width of the handle, move buttons, lock, and hint, so a pin does not shift columns. */
    .position {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      min-width: 10.5rem;
    }

    .handle {
      padding-inline: 0.25rem;
      cursor: grab;
      user-select: none;
    }

    .lock {
      white-space: nowrap;
    }

    tr.cdk-drag-placeholder {
      opacity: 0.4;
    }

    tr.cdk-drag-preview {
      background: var(--mat-sys-surface-container-high);
      box-shadow: var(--mat-sys-level3);
    }

    .time {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class TrackPlanHourComponent {
  readonly view = input.required<PlanHourView>();
  /** A move or unpin of this hour is being applied. */
  readonly busy = input(false);
  /** No move may start: one is running, or the plan is being read again. */
  readonly blocked = input(false);
  /** Already translated; why the last move of this hour was refused. */
  readonly moveError = input<string | null>(null);

  readonly addInsert = output();
  readonly removeInsert = output<PlanInsertView>();
  readonly move = output<PlanRowMove>();
  readonly unpin = output<PlanInsertView>();

  protected dropped(event: CdkDragDrop<unknown, unknown, PlanRowView>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.move.emit({ row: event.item.data, to: event.currentIndex });
    }
  }

  protected isInsert(source: string): boolean {
    return INSERT_SOURCES.has(source);
  }

  protected headingId(): string {
    return `plan-hour-${Date.parse(this.view().hour.hour_start_utc)}`;
  }
}
