import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DurationPipe } from '../../core/time/duration.pipe';
import { Clock, hourOffset } from './clock-form';

const HOUR_MS = 3_600_000;

interface Block {
  kind: 'content' | 'shortfall' | 'overflow' | 'fixed';
  left: number;
  width: number;
}

const percent = (ms: number) => Math.min(100, Math.max(0, (ms / HOUR_MS) * 100));

/**
 * The 60-minute layout of a clock as the backend computed it on nominal durations (design §7.2):
 * segments with their content, shortfall, and overflow, and the fixed elements between them. It
 * only draws `clock.layout`; nothing is recomputed here. The bar is decoration; the table below
 * it carries the same facts for screen readers.
 */
@Component({
  selector: 'app-clock-layout',
  imports: [TranslatePipe, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stale()) {
      <p class="muted">{{ 'clocks.layout.stale' | translate }}</p>
    }
    <div class="bar" aria-hidden="true">
      @for (block of blocks(); track $index) {
        <span
          class="block"
          [class]="block.kind"
          [style.left.%]="block.left"
          [style.width.%]="block.width"
        ></span>
      }
      @for (tick of ticks; track tick) {
        <span class="tick" [style.left.%]="(tick / 60) * 100">:{{ tick }}</span>
      }
    </div>
    <ul class="legend" aria-hidden="true">
      <li><span class="swatch content"></span>{{ 'clocks.layout.content' | translate }}</li>
      <li><span class="swatch fixed"></span>{{ 'clocks.layout.fixed' | translate }}</li>
      <li><span class="swatch shortfall"></span>{{ 'clocks.layout.shortfall' | translate }}</li>
      <li><span class="swatch overflow"></span>{{ 'clocks.layout.overflow' | translate }}</li>
    </ul>

    <div class="table-scroll">
      <table class="segments">
        <caption class="cdk-visually-hidden">
          {{
            'clocks.layout.caption' | translate
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ 'clocks.layout.segment' | translate }}</th>
            <th scope="col">{{ 'clocks.layout.time' | translate }}</th>
            <th scope="col">{{ 'clocks.layout.elements' | translate }}</th>
            <th scope="col">{{ 'clocks.layout.content' | translate }}</th>
            <th scope="col">{{ 'clocks.layout.shortfall' | translate }}</th>
            <th scope="col">{{ 'clocks.layout.filler' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (segment of clock().layout.segments; track segment.index) {
            <tr>
              <td>{{ segment.index + 1 }}</td>
              <td>{{ offset(segment.start_ms) }}–{{ offset(segment.end_ms) }}</td>
              <td>{{ numbers(segment.element_indexes) }}</td>
              <td>{{ segment.content_ms | duration }}</td>
              <td>
                @if (segment.shortfall_ms > 0) {
                  <span class="badge warn">{{ segment.shortfall_ms | duration }}</span>
                } @else if (segment.overflow_ms > 0) {
                  {{
                    'clocks.layout.overflowBy'
                      | translate: { duration: (segment.overflow_ms | duration) }
                  }}
                } @else {
                  —
                }
              </td>
              <td>
                {{ 'filler.modes.' + segment.filler_mode | translate }}
                <span class="muted">
                  ({{ 'clocks.layout.holder' | translate: { number: segment.holder_index + 1 } }})
                </span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .bar {
      position: relative;
      height: 2rem;
      margin: 0.5rem 0 1.75rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface-container);
    }

    .block {
      position: absolute;
      top: 0;
      bottom: 0;
    }

    .content {
      background: var(--mat-sys-primary-container);
    }

    .fixed {
      background: var(--mat-sys-tertiary);
    }

    .shortfall {
      background: repeating-linear-gradient(
        45deg,
        var(--mat-sys-error-container),
        var(--mat-sys-error-container) 4px,
        transparent 4px,
        transparent 8px
      );
    }

    .overflow {
      background: var(--mat-sys-error);
    }

    .tick {
      position: absolute;
      top: 100%;
      transform: translateX(-50%);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      margin: 0 0 0.75rem;
      padding: 0;
      list-style: none;
      font: var(--mat-sys-body-small);
    }

    .legend li {
      display: inline-flex;
      gap: 0.25rem;
      align-items: center;
    }

    .swatch {
      display: inline-block;
      width: 0.75rem;
      height: 0.75rem;
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .segments {
      width: 100%;
      border-collapse: collapse;
    }

    .segments th,
    .segments td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ClockLayoutComponent {
  readonly clock = input.required<Clock>();
  /** The form has changes that are not saved yet, so this layout is the stored one. */
  readonly stale = input(false);

  protected readonly ticks = [0, 15, 30, 45, 60];

  protected readonly blocks = computed(() => {
    const segments = this.clock().layout.segments;
    const blocks: Block[] = [];
    segments.forEach((segment, i) => {
      const contentEnd = segment.start_ms + segment.content_ms;
      blocks.push(block('content', segment.start_ms, contentEnd));
      if (segment.shortfall_ms > 0) {
        blocks.push(block('shortfall', contentEnd, contentEnd + segment.shortfall_ms));
      }
      if (segment.overflow_ms > 0) {
        blocks.push(block('overflow', HOUR_MS - Math.min(segment.overflow_ms, HOUR_MS), HOUR_MS));
      }
      // The closing fixed element runs from where it starts to where the next segment begins.
      const next = segments[i + 1];
      if (segment.fixed_start_ms !== undefined && next) {
        blocks.push(block('fixed', segment.fixed_start_ms, next.start_ms));
      }
    });
    return blocks;
  });

  protected offset(ms: number): string {
    return hourOffset(ms);
  }

  protected numbers(indexes: readonly number[]): string {
    return indexes.map((index) => index + 1).join(', ') || '—';
  }
}

function block(kind: Block['kind'], from: number, to: number): Block {
  const left = percent(from);
  return { kind, left, width: Math.max(0, percent(to) - left) };
}
