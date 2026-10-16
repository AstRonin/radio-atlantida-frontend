import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatCueTime } from '../../core/time/duration';
import {
  WaveColors,
  WaveContext,
  WaveView,
  clampView,
  drawDbAxis,
  drawWaveform,
  fitView,
  formatDb,
  isFitted,
  msToPx,
  peakScale,
  pxToMs,
  revealMs,
  scrollView,
  zoomView,
} from './waveform-draw';

/** The browser parts the editor uses, so tests run without a canvas or `ResizeObserver`. */
export interface WaveformBrowser {
  context(canvas: HTMLCanvasElement): WaveContext | null;
  /** Calls back with the element's width in CSS pixels now and on every change; returns a stop. */
  observeWidth(element: HTMLElement, callback: (width: number) => void): () => void;
  pixelRatio(): number;
  /** The colours from the CSS custom properties of the element, so both themes work. */
  colors(element: HTMLElement): WaveColors;
}

export const WAVEFORM_BROWSER = new InjectionToken<WaveformBrowser>('WAVEFORM_BROWSER', {
  providedIn: 'root',
  factory: () => {
    const window = inject(DOCUMENT).defaultView;
    return {
      context: (canvas) => canvas.getContext('2d'),
      observeWidth: (element, callback) => {
        callback(element.clientWidth);
        if (!window || typeof window.ResizeObserver === 'undefined') {
          return () => undefined;
        }
        const observer = new window.ResizeObserver(() => callback(element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
      },
      pixelRatio: () => window?.devicePixelRatio ?? 1,
      colors: (element) => {
        const style = window?.getComputedStyle(element);
        const read = (name: string, fallback: string) =>
          style?.getPropertyValue(name).trim() || fallback;
        return {
          wave: read('--waveform-wave', '#3f51b5'),
          dimmed: read('--waveform-dimmed', '#9e9e9e'),
          centre: read('--waveform-centre', '#bdbdbd'),
          envelope: read('--waveform-envelope', '#ff9800'),
          cursor: read('--waveform-cursor', '#e53935'),
          ruler: read('--waveform-ruler', '#616161'),
          grid: read('--waveform-grid', '#e0e0e0'),
        };
      },
    };
  },
});

export interface CueRange {
  cueIn: number;
  /** Always a point in the file here; the end of the file is `durationMs`. */
  cueOut: number;
}

/** What a play request starts from: the cue in, 5 s before the cue out, or the cursor. */
export type WavePlayRequest = 'in' | 'beforeOut' | 'cursor';

type Handle = 'in' | 'out';

const HEIGHT_PX = 160;
/** Room for the widest label, "−12.3 dB". */
const AXIS_WIDTH_PX = 52;
const ZOOM_STEP = 2;
const WHEEL_ZOOM_STEP = 1.25;
const SNAP_PX = 5;

let nextId = 0;

/**
 * The waveform of a track with its cue in and cue out handles (frontend F20 §5.1). Presentational:
 * it draws the peaks it is given and reports what the operator does; the page decides and the
 * backend validates. The shape is mirrored around a centre line, the parts outside the cue are
 * dimmed, and the fades are a sloped envelope. Each handle is a slider for the keyboard. A quiet
 * track is enlarged to its loudest peak, with the factor shown and a switch back to the real level.
 */
@Component({
  selector: 'app-waveform-editor',
  imports: [MatButtonModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <button
        matIconButton
        type="button"
        [attr.aria-label]="'waveform.zoomOut' | translate"
        [matTooltip]="'waveform.zoomOut' | translate"
        [disabled]="fitted()"
        (click)="zoomBy(1 / zoomStep)"
      >
        <span aria-hidden="true">−</span>
      </button>
      <button
        matIconButton
        type="button"
        [attr.aria-label]="'waveform.zoomIn' | translate"
        [matTooltip]="'waveform.zoomIn' | translate"
        (click)="zoomBy(zoomStep)"
      >
        <span aria-hidden="true">+</span>
      </button>
      <button matButton type="button" [disabled]="fitted()" (click)="fit()">
        {{ 'waveform.fit' | translate }}
      </button>
      @if (enlarged(); as factor) {
        <span
          class="muted scale"
          tabindex="0"
          [matTooltip]="'waveform.enlargedHint' | translate: { factor, peak: peakLevel() }"
        >
          {{ 'waveform.enlarged' | translate: { factor } }}
        </span>
        <button
          matButton
          type="button"
          [attr.aria-pressed]="realLevel()"
          [class.pressed]="realLevel()"
          [matTooltip]="'waveform.realLevelHint' | translate"
          (click)="realLevel.set(!realLevel())"
        >
          {{ 'waveform.realLevel' | translate }}
        </button>
      }
      <span class="muted keys" tabindex="0" [matTooltip]="'waveform.shortcuts' | translate">
        {{ 'waveform.keyboard' | translate }}
      </span>
    </div>
    <div class="body">
      <canvas #axis class="axis" aria-hidden="true"></canvas>
      <div
        #stage
        class="stage"
        tabindex="0"
        role="group"
        [attr.aria-label]="'waveform.label' | translate"
        [attr.aria-describedby]="shortcutsId"
        (keydown)="onStageKey($event)"
        (pointerdown)="onStagePointer($event)"
        (wheel)="onWheel($event)"
      >
        <canvas #canvas aria-hidden="true"></canvas>
        @for (handle of handles; track handle) {
          <div
            class="handle"
            [class.in]="handle === 'in'"
            [class.out]="handle === 'out'"
            [class.dragging]="dragging() === handle"
            role="slider"
            tabindex="0"
            [style.left.px]="handlePx()[handle]"
            [attr.aria-label]="(handle === 'in' ? 'waveform.cueIn' : 'waveform.cueOut') | translate"
            [attr.aria-valuemin]="limits()[handle].min"
            [attr.aria-valuemax]="limits()[handle].max"
            [attr.aria-valuenow]="handle === 'in' ? cueIn() : cueOutMs()"
            [attr.aria-valuetext]="handleText()[handle]"
            [attr.aria-disabled]="disabled() || null"
            (pointerdown)="startDrag(handle, $event)"
            (pointermove)="drag($event)"
            (pointerup)="endDrag($event)"
            (pointercancel)="endDrag($event)"
            (keydown)="onHandleKey(handle, $event)"
          ></div>
        }
      </div>
    </div>
    @if (!fitted()) {
      <input
        class="scroll"
        type="range"
        min="0"
        [max]="scrollMax()"
        [value]="view().startMs"
        [attr.aria-label]="'waveform.scroll' | translate"
        (input)="scrollTo($event)"
      />
    }
    <p [id]="shortcutsId" class="cdk-visually-hidden">{{ 'waveform.shortcuts' | translate }}</p>
  `,
  styles: `
    :host {
      --waveform-wave: var(--mat-sys-primary);
      --waveform-dimmed: var(--mat-sys-outline-variant);
      --waveform-centre: var(--mat-sys-outline-variant);
      --waveform-envelope: var(--app-status-warning);
      --waveform-cursor: var(--mat-sys-error);
      --waveform-ruler: var(--mat-sys-on-surface-variant);
      --waveform-grid: var(--mat-sys-surface-container-high);
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .keys {
      margin-left: auto;
      font: var(--mat-sys-body-small);
    }

    .scale {
      margin-left: 0.5rem;
      font: var(--mat-sys-body-small);
    }

    .pressed {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .body {
      display: flex;
    }

    .axis {
      flex: none;
      /* Level with the stage's content, inside its border. */
      margin-top: 1px;
      width: ${AXIS_WIDTH_PX}px;
      height: ${HEIGHT_PX}px;
    }

    .stage {
      position: relative;
      flex: 1;
      min-width: 0;
      height: ${HEIGHT_PX}px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface-container-lowest);
      touch-action: pan-y;
      cursor: text;
    }

    .stage:focus-visible,
    .handle:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }

    canvas {
      display: block;
    }

    .stage canvas {
      width: 100%;
      height: 100%;
    }

    .handle {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 12px;
      margin-left: -6px;
      cursor: ew-resize;
      touch-action: none;
    }

    .handle::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 5px;
      width: 2px;
      background: var(--mat-sys-primary);
    }

    .handle::after {
      content: '';
      position: absolute;
      top: 0;
      width: 10px;
      height: 14px;
      background: var(--mat-sys-primary);
    }

    .handle.in::after {
      left: 6px;
      border-radius: 0 4px 4px 0;
    }

    .handle.out::after {
      right: 6px;
      border-radius: 4px 0 0 4px;
    }

    .handle[aria-disabled='true'] {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .scroll {
      width: calc(100% - ${AXIS_WIDTH_PX}px);
      margin: 0.25rem 0 0 ${AXIS_WIDTH_PX}px;
    }
  `,
})
export class WaveformEditorComponent {
  private readonly browser = inject(WAVEFORM_BROWSER);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Flat `[min0, max0, min1, max1, ...]`, −127 to 127, as `GET /api/tracks/{id}/waveform` sends. */
  readonly peaks = input.required<readonly number[]>();
  readonly bucketMs = input(50);
  /** The loudest peak, 0 to 127 (`max_peak`); the drawing is enlarged to it. */
  readonly maxPeak = input(127);
  readonly durationMs = input.required<number>();
  readonly cueIn = input.required<number>();
  /** Null: the end of the file. */
  readonly cueOut = input.required<number | null>();
  readonly fadeIn = input(0);
  readonly fadeOut = input(0);
  /** The playback cursor in ms; null while nothing of this track plays. */
  readonly position = input<number | null>(null);
  /** The shortest cut the backend accepts (`air_too_short`); a shorter file cannot be cut. */
  readonly minAirMs = input(5000);
  readonly disabled = input(false);

  readonly cueChange = output<CueRange>();
  readonly seek = output<number>();
  readonly playRequest = output<WavePlayRequest>();

  protected readonly handles: readonly Handle[] = ['in', 'out'];
  protected readonly zoomStep = ZOOM_STEP;
  protected readonly shortcutsId = `waveform-keys-${nextId++}`;

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly axis = viewChild.required<ElementRef<HTMLCanvasElement>>('axis');

  private readonly width = signal(0);
  /** Null: the whole track; else the operator's zoom and scroll. */
  private readonly zoom = signal<Omit<WaveView, 'widthPx'> | null>(null);
  protected readonly dragging = signal<Handle | null>(null);
  /** The click position, replaced by the player's position while it plays. */
  private readonly cursor = linkedSignal<number | null>(() => this.position());

  /** The operator's choice to see the file as loud as it is. */
  protected readonly realLevel = signal(false);
  private readonly peakScale = computed(() => peakScale(this.maxPeak()));
  private readonly scale = computed(() => (this.realLevel() ? 1 : this.peakScale()));
  /** The enlargement as shown, "2.6"; null when the track already fills the height. */
  protected readonly enlarged = computed(() => {
    const factor = this.peakScale().toFixed(1);
    return factor === '1.0' ? null : factor;
  });
  protected readonly peakLevel = computed(() => formatDb(-20 * Math.log10(this.peakScale())));

  protected readonly cueOutMs = computed(() => this.cueOut() ?? this.durationMs());

  protected readonly view = computed<WaveView>(() => {
    const widthPx = this.width();
    const zoom = this.zoom();
    return zoom
      ? clampView({ ...zoom, widthPx }, this.durationMs(), this.bucketMs())
      : fitView(this.durationMs(), widthPx);
  });
  protected readonly fitted = computed(() => isFitted(this.view(), this.durationMs()));
  protected readonly scrollMax = computed(() => {
    const view = this.view();
    return Math.max(0, Math.round(this.durationMs() - view.msPerPx * view.widthPx));
  });

  /** What each handle may reach without crossing the other or leaving less than a cut allows. */
  protected readonly limits = computed(() => {
    const duration = this.durationMs();
    const gap = Math.min(this.minAirMs(), duration);
    return {
      in: { min: 0, max: Math.max(0, this.cueOutMs() - gap) },
      out: { min: Math.min(duration, this.cueIn() + gap), max: duration },
    };
  });

  protected readonly handlePx = computed(() => {
    const view = this.view();
    const place = (ms: number) => Math.min(Math.max(msToPx(ms, view), 0), view.widthPx);
    return { in: place(this.cueIn()), out: place(this.cueOutMs()) };
  });
  protected readonly handleText = computed(() => ({
    in: formatCueTime(this.cueIn()),
    out: formatCueTime(this.cueOutMs()),
  }));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const stop = this.browser.observeWidth(this.stage().nativeElement, (width) =>
        this.width.set(width),
      );
      destroyRef.onDestroy(stop);
    });
    afterRenderEffect(() => this.draw());
  }

  protected zoomBy(factor: number, anchorPx?: number): void {
    const view = this.view();
    const cursor = this.cursor();
    const anchor =
      anchorPx ??
      (cursor !== null && msToPx(cursor, view) >= 0 && msToPx(cursor, view) <= view.widthPx
        ? msToPx(cursor, view)
        : view.widthPx / 2);
    this.setView(zoomView(view, factor, anchor, this.durationMs(), this.bucketMs()));
  }

  protected fit(): void {
    this.zoom.set(null);
  }

  protected scrollTo(event: Event): void {
    const startMs = Number((event.target as HTMLInputElement).value);
    this.setView(clampView({ ...this.view(), startMs }, this.durationMs(), this.bucketMs()));
  }

  protected onWheel(event: WheelEvent): void {
    const view = this.view();
    if (event.ctrlKey) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      this.zoomBy(factor, this.pointerPx(event));
    } else if (!isFitted(view, this.durationMs())) {
      // Only a zoomed waveform takes the wheel; otherwise the page scrolls as usual.
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      this.setView(scrollView(view, delta, this.durationMs(), this.bucketMs()));
    }
  }

  protected onStagePointer(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const ms = this.clampMs(pxToMs(this.pointerPx(event), this.view()), 0, this.durationMs());
    this.cursor.set(ms);
    this.seek.emit(ms);
  }

  protected startDrag(handle: Handle, event: PointerEvent): void {
    // A handle never moves the cursor underneath it.
    event.stopPropagation();
    if (this.disabled() || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.focus();
    if (typeof target.setPointerCapture === 'function' && event.pointerId !== undefined) {
      target.setPointerCapture(event.pointerId);
    }
    this.dragging.set(handle);
  }

  protected drag(event: PointerEvent): void {
    const handle = this.dragging();
    if (!handle) {
      return;
    }
    const view = this.view();
    const px = this.pointerPx(event);
    const cursor = this.cursor();
    const ms =
      cursor !== null && Math.abs(msToPx(cursor, view) - px) <= SNAP_PX ? cursor : pxToMs(px, view);
    this.move(handle, ms);
  }

  protected endDrag(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (
      typeof target.hasPointerCapture === 'function' &&
      target.hasPointerCapture(event.pointerId)
    ) {
      target.releasePointerCapture(event.pointerId);
    }
    this.dragging.set(null);
  }

  protected onHandleKey(handle: Handle, event: KeyboardEvent): void {
    const value = handle === 'in' ? this.cueIn() : this.cueOutMs();
    const step = event.altKey ? 10 : event.shiftKey ? 1000 : 100;
    const limits = this.limits()[handle];
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + step;
        break;
      case 'PageDown':
        next = value - 10_000;
        break;
      case 'PageUp':
        next = value + 10_000;
        break;
      case 'Home':
        next = limits.min;
        break;
      case 'End':
        next = limits.max;
        break;
      default:
        // Space, I, O, and the zoom keys work from a handle as from the waveform.
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!this.disabled()) {
      this.move(handle, next);
      this.setView(revealMs(this.view(), next, this.durationMs(), this.bucketMs()));
    }
  }

  protected onStageKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const cursor = this.cursor();
    switch (event.key) {
      case ' ':
        this.playRequest.emit('cursor');
        break;
      case 'i':
      case 'I':
        if (cursor !== null && !this.disabled()) {
          this.move('in', cursor);
        }
        break;
      case 'o':
      case 'O':
        if (cursor !== null && !this.disabled()) {
          this.move('out', cursor);
        }
        break;
      case '+':
      case '=':
        this.zoomBy(ZOOM_STEP);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case '0':
        this.fit();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private move(handle: Handle, ms: number): void {
    const { min, max } = this.limits()[handle];
    const value = Math.round(this.clampMs(ms, min, max));
    const range: CueRange =
      handle === 'in'
        ? { cueIn: value, cueOut: this.cueOutMs() }
        : { cueIn: this.cueIn(), cueOut: value };
    if (range.cueIn !== this.cueIn() || range.cueOut !== this.cueOutMs()) {
      this.cueChange.emit(range);
    }
  }

  private setView(view: WaveView): void {
    this.zoom.set(
      isFitted(view, this.durationMs()) ? null : { startMs: view.startMs, msPerPx: view.msPerPx },
    );
  }

  private clampMs(ms: number, min: number, max: number): number {
    return Math.min(Math.max(ms, min), max);
  }

  private pointerPx(event: MouseEvent): number {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return event.clientX - rect.left;
  }

  private draw(): void {
    const view = this.view();
    const canvas = this.canvas().nativeElement;
    const scene = {
      peaks: this.peaks(),
      bucketMs: this.bucketMs(),
      durationMs: this.durationMs(),
      cueIn: this.cueIn(),
      cueOut: this.cueOutMs(),
      fadeIn: this.fadeIn(),
      fadeOut: this.fadeOut(),
      position: this.cursor(),
      scale: this.scale(),
    };
    if (view.widthPx <= 0) {
      return;
    }
    const ratio = this.browser.pixelRatio();
    const colors = this.browser.colors(this.host.nativeElement);
    const context = this.prepare(canvas, view.widthPx, ratio);
    if (context) {
      drawWaveform(context, { ...scene, view, heightPx: HEIGHT_PX, pixelRatio: ratio, colors });
    }
    const axis = this.prepare(this.axis().nativeElement, AXIS_WIDTH_PX, ratio);
    if (axis) {
      drawDbAxis(axis, {
        scale: scene.scale,
        widthPx: AXIS_WIDTH_PX,
        heightPx: HEIGHT_PX,
        pixelRatio: ratio,
        colors,
      });
    }
  }

  /** Sizes a canvas to the device pixels of its CSS width and the editor's height. */
  private prepare(canvas: HTMLCanvasElement, widthPx: number, ratio: number): WaveContext | null {
    const width = Math.round(widthPx * ratio);
    const height = Math.round(HEIGHT_PX * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return this.browser.context(canvas);
  }
}
