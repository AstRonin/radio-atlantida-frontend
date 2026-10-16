/**
 * Pure parts of the waveform editor: the mapping between milliseconds and pixels, zoom and scroll,
 * the peaks of one pixel column, the ruler step and labels, the level scale in dB, and the drawing
 * itself on a 2D
 * context. Kept apart from the component so they are tested without a canvas.
 */

import { formatCueTime } from '../../core/time/duration';

/** The visible part of the track: its first millisecond, the zoom, and the width it is drawn in. */
export interface WaveView {
  startMs: number;
  msPerPx: number;
  widthPx: number;
}

/** The closest zoom: a 50 ms bucket is 20 pixels wide. */
export const MIN_MS_PER_PX_FACTOR = 1 / 20;

export function msToPx(ms: number, view: WaveView): number {
  return (ms - view.startMs) / view.msPerPx;
}

export function pxToMs(px: number, view: WaveView): number {
  return view.startMs + px * view.msPerPx;
}

/** The whole track in the width. */
export function fitView(durationMs: number, widthPx: number): WaveView {
  return { startMs: 0, msPerPx: widthPx > 0 ? Math.max(durationMs, 1) / widthPx : 1, widthPx };
}

/** Whether the whole track is visible. */
export function isFitted(view: WaveView, durationMs: number): boolean {
  return view.startMs <= 0 && view.msPerPx * view.widthPx >= durationMs;
}

/** Keeps the view inside the track and between the closest zoom and the whole track. */
export function clampView(view: WaveView, durationMs: number, bucketMs: number): WaveView {
  const fit = fitView(durationMs, view.widthPx);
  const msPerPx = Math.min(Math.max(view.msPerPx, bucketMs * MIN_MS_PER_PX_FACTOR), fit.msPerPx);
  const visibleMs = msPerPx * view.widthPx;
  const startMs = Math.min(Math.max(view.startMs, 0), Math.max(0, durationMs - visibleMs));
  return { startMs, msPerPx, widthPx: view.widthPx };
}

/** Zooms by `factor` (above 1 zooms in) and keeps the millisecond under `anchorPx` in place. */
export function zoomView(
  view: WaveView,
  factor: number,
  anchorPx: number,
  durationMs: number,
  bucketMs: number,
): WaveView {
  const anchorMs = pxToMs(anchorPx, view);
  const msPerPx = view.msPerPx / factor;
  return clampView(
    { startMs: anchorMs - anchorPx * msPerPx, msPerPx, widthPx: view.widthPx },
    durationMs,
    bucketMs,
  );
}

/** Moves the view by a number of pixels. */
export function scrollView(
  view: WaveView,
  deltaPx: number,
  durationMs: number,
  bucketMs: number,
): WaveView {
  return clampView(
    { ...view, startMs: view.startMs + deltaPx * view.msPerPx },
    durationMs,
    bucketMs,
  );
}

/** Scrolls only as far as needed to show `ms`. */
export function revealMs(
  view: WaveView,
  ms: number,
  durationMs: number,
  bucketMs: number,
): WaveView {
  const endMs = pxToMs(view.widthPx, view);
  if (ms >= view.startMs && ms <= endMs) {
    return view;
  }
  const visibleMs = view.msPerPx * view.widthPx;
  return clampView({ ...view, startMs: ms - visibleMs / 2 }, durationMs, bucketMs);
}

/**
 * The lowest and highest peak of the buckets one pixel column covers. When a bucket is wider than a
 * pixel, neighbouring columns share it, so a close zoom shows wide bars of the same data.
 */
export function columnPeaks(
  peaks: readonly number[],
  bucketMs: number,
  fromMs: number,
  toMs: number,
): [number, number] | null {
  const buckets = Math.floor(peaks.length / 2);
  const first = Math.max(0, Math.floor(fromMs / bucketMs));
  const last = Math.min(buckets - 1, Math.max(first, Math.ceil(toMs / bucketMs) - 1));
  if (first >= buckets || last < first) {
    return null;
  }
  let min = 0;
  let max = 0;
  for (let bucket = first; bucket <= last; bucket++) {
    min = Math.min(min, peaks[bucket * 2]);
    max = Math.max(max, peaks[bucket * 2 + 1]);
  }
  return [min, max];
}

const RULER_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  900_000, 1_800_000, 3_600_000,
];

/** The smallest ruler step whose labels are at least `minLabelPx` apart. */
export function rulerStep(msPerPx: number, minLabelPx = 72): number {
  return (
    RULER_STEPS_MS.find((step) => step / msPerPx >= minLabelPx) ??
    RULER_STEPS_MS[RULER_STEPS_MS.length - 1]
  );
}

/** A ruler label: `1:05`, or `1:05.5` for steps below a second. */
export function formatRulerTime(ms: number, stepMs: number): string {
  const text = formatCueTime(ms);
  return stepMs < 1000 ? text.slice(0, -2) : text.slice(0, -4);
}

/** Full scale of the peaks: 127 is 0 dBFS. */
export const FULL_SCALE = 127;

/**
 * How much the drawing enlarges the peaks so the loudest one fills the height. A quiet master
 * (a compressed file after a loudness fix peaks well below full scale) then reads like a loud one.
 * Silence has nothing to enlarge and is drawn as it is.
 */
export function peakScale(maxPeak: number): number {
  const peak = Math.min(Math.max(maxPeak, 0), FULL_SCALE);
  return peak > 0 ? FULL_SCALE / peak : 1;
}

/** The level of a peak value in dBFS; −Infinity for 0. The peaks are linear. */
export function peakDb(value: number): number {
  return 20 * Math.log10(Math.abs(value) / FULL_SCALE);
}

/** A level label: `0 dB`, `−8.3 dB`, `−12 dB`, `−∞`. */
export function formatDb(db: number): string {
  if (db === -Infinity) {
    return '−∞';
  }
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) {
    return '0 dB';
  }
  const text = Number.isInteger(rounded) ? String(-rounded) : (-rounded).toFixed(1);
  return `${rounded < 0 ? '−' : ''}${text} dB`;
}

const DB_LEVELS = [0, -6, -12, -20];
/** A label is centred on its line; the edge ones sit inside the edge, so they need more room. */
const LABEL_GAP_PX = 11;
const EDGE_LABEL_GAP_PX = 17;

export interface DbLine {
  db: number;
  /** Distance from the centre line in CSS pixels. */
  offsetPx: number;
}

/**
 * The level lines of one half of the waveform at `scale`: the top edge (the loudest peak when the
 * drawing is enlarged, else 0 dB), then the usual levels that fit below it. In the linear scale
 * they are uneven (−6 dB at half the height, −20 dB at a tenth), so a level too close to its
 * neighbour or to the centre is left out to keep the labels apart.
 */
export function dbLines(scale: number, halfPx: number): DbLine[] {
  const lines: DbLine[] = [{ db: scale > 1 ? -20 * Math.log10(scale) : 0, offsetPx: halfPx }];
  for (const db of DB_LEVELS) {
    const offsetPx = 10 ** (db / 20) * scale * halfPx;
    const previous = lines[lines.length - 1];
    const gap = lines.length === 1 ? EDGE_LABEL_GAP_PX : LABEL_GAP_PX;
    if (previous.offsetPx - offsetPx >= gap && offsetPx >= LABEL_GAP_PX) {
      lines.push({ db, offsetPx });
    }
  }
  return lines;
}

/** The part of `CanvasRenderingContext2D` the drawing uses, so tests can pass a fake. */
export type WaveContext = Pick<
  CanvasRenderingContext2D,
  | 'clearRect'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'fillText'
  | 'setTransform'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textBaseline'
  | 'textAlign'
>;

export interface WaveColors {
  wave: string;
  dimmed: string;
  centre: string;
  envelope: string;
  cursor: string;
  ruler: string;
  grid: string;
}

export interface WaveScene {
  peaks: readonly number[];
  bucketMs: number;
  durationMs: number;
  cueIn: number;
  cueOut: number;
  fadeIn: number;
  fadeOut: number;
  /** The playback cursor; null hides it. */
  position: number | null;
  view: WaveView;
  /** CSS pixels. */
  heightPx: number;
  pixelRatio: number;
  /** What the peaks are multiplied by (`peakScale`); 1 draws the real level. */
  scale: number;
  colors: WaveColors;
}

export const RULER_HEIGHT_PX = 18;

/**
 * Draws the scene: the ruler, the level lines, the centre line, one bar per pixel column from its
 * lowest to its highest peak (mirrored around zero, as audio editors do), dimmed outside the cue,
 * the fade envelope, and the cursor. The level labels are a separate axis (`drawDbAxis`). Coordinates are CSS pixels; the transform scales to the device.
 */
export function drawWaveform(ctx: WaveContext, scene: WaveScene): void {
  const { view, heightPx, colors } = scene;
  ctx.setTransform(scene.pixelRatio, 0, 0, scene.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, view.widthPx, heightPx);

  const top = RULER_HEIGHT_PX;
  const half = (heightPx - top) / 2;
  const centre = top + half;

  drawRuler(ctx, scene);

  const levels = dbLines(scene.scale, half);
  ctx.fillStyle = colors.grid;
  for (const { offsetPx } of levels) {
    ctx.fillRect(0, Math.round(centre - offsetPx), view.widthPx, 1);
    ctx.fillRect(0, Math.round(centre + offsetPx) - 1, view.widthPx, 1);
  }

  ctx.fillStyle = colors.centre;
  ctx.fillRect(0, centre, view.widthPx, 1);

  for (let px = 0; px < view.widthPx; px++) {
    const fromMs = pxToMs(px, view);
    if (fromMs >= scene.durationMs) {
      break;
    }
    const column = columnPeaks(scene.peaks, scene.bucketMs, fromMs, pxToMs(px + 1, view));
    if (!column) {
      continue;
    }
    const [min, max] = column;
    const inside = fromMs >= scene.cueIn && fromMs < scene.cueOut;
    const level = (peak: number) => Math.min(Math.max((peak / FULL_SCALE) * scene.scale, -1), 1);
    const y1 = centre - level(max) * half;
    const y2 = centre - level(min) * half;
    ctx.fillStyle = inside ? colors.wave : colors.dimmed;
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }

  drawEnvelope(ctx, scene, centre, half);

  if (scene.position !== null) {
    const x = msToPx(scene.position, view);
    if (x >= 0 && x <= view.widthPx) {
      ctx.fillStyle = colors.cursor;
      ctx.fillRect(Math.round(x), top, 1, heightPx - top);
    }
  }
}

function drawRuler(ctx: WaveContext, scene: WaveScene): void {
  const { view, colors } = scene;
  const step = rulerStep(view.msPerPx);
  const endMs = Math.min(pxToMs(view.widthPx, view), scene.durationMs);
  ctx.fillStyle = colors.ruler;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  for (let ms = Math.ceil(view.startMs / step) * step; ms <= endMs; ms += step) {
    const x = Math.round(msToPx(ms, view));
    ctx.fillRect(x, RULER_HEIGHT_PX - 5, 1, 5);
    ctx.fillText(formatRulerTime(ms, step), x + 3, 2);
  }
}

export interface AxisScene {
  scale: number;
  /** CSS pixels; the height is the waveform's, so the lines meet the labels. */
  widthPx: number;
  heightPx: number;
  pixelRatio: number;
  colors: WaveColors;
}

/**
 * The dB axis left of the waveform: a tick and a label for every level line, above and below the
 * centre as the waveform is two-sided, and −∞ at the centre. The edge labels sit inside the edge.
 */
export function drawDbAxis(ctx: WaveContext, axis: AxisScene): void {
  const { widthPx, heightPx, colors } = axis;
  ctx.setTransform(axis.pixelRatio, 0, 0, axis.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, widthPx, heightPx);

  const top = RULER_HEIGHT_PX;
  const half = (heightPx - top) / 2;
  const centre = top + half;
  const textX = widthPx - 7;

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  const mark = (y: number, text: string, baseline: CanvasTextBaseline, textY: number) => {
    ctx.fillStyle = colors.grid;
    ctx.fillRect(widthPx - 4, y, 4, 1);
    ctx.fillStyle = colors.ruler;
    ctx.textBaseline = baseline;
    ctx.fillText(text, textX, textY);
  };
  dbLines(axis.scale, half).forEach(({ db, offsetPx }, index) => {
    const text = formatDb(db);
    const up = Math.round(centre - offsetPx);
    const down = Math.round(centre + offsetPx) - 1;
    if (index === 0) {
      mark(up, text, 'top', up + 1);
      mark(down, text, 'bottom', down);
    } else {
      mark(up, text, 'middle', up);
      mark(down, text, 'middle', down);
    }
  });
  mark(centre, formatDb(-Infinity), 'middle', centre);
  ctx.textAlign = 'left';
}

/** The gain over the cue as a sloped line at both edges of the waveform. */
function drawEnvelope(ctx: WaveContext, scene: WaveScene, centre: number, half: number): void {
  const { view, cueIn, cueOut } = scene;
  const fadeIn = Math.min(scene.fadeIn, cueOut - cueIn);
  const fadeOut = Math.min(scene.fadeOut, cueOut - cueIn - fadeIn);
  const points: [number, number][] = [
    [cueIn, 0],
    [cueIn + fadeIn, 1],
    [cueOut - fadeOut, 1],
    [cueOut, 0],
  ];
  ctx.strokeStyle = scene.colors.envelope;
  ctx.lineWidth = 1.5;
  for (const sign of [1, -1]) {
    ctx.beginPath();
    points.forEach(([ms, gain], index) => {
      const x = msToPx(ms, view);
      const y = centre - sign * gain * half;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
}
