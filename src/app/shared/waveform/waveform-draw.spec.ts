import { formatCueTime, parseCueTime } from '../../core/time/duration';
import { FakeWaveContext } from './waveform.testing';
import {
  WaveScene,
  clampView,
  columnPeaks,
  dbLines,
  drawDbAxis,
  drawWaveform,
  fitView,
  formatDb,
  formatRulerTime,
  isFitted,
  msToPx,
  peakDb,
  peakScale,
  pxToMs,
  revealMs,
  rulerStep,
  scrollView,
  zoomView,
} from './waveform-draw';

describe('waveform mapping', () => {
  const view = { startMs: 10_000, msPerPx: 50, widthPx: 600 };

  it('maps ms to px and back at any zoom', () => {
    expect(msToPx(10_000, view)).toBe(0);
    expect(msToPx(15_000, view)).toBe(100);
    expect(pxToMs(100, view)).toBe(15_000);
    const close = { startMs: 0, msPerPx: 2.5, widthPx: 600 };
    expect(pxToMs(msToPx(1234, close), close)).toBeCloseTo(1234);
  });

  it('fits the whole track and clamps zoom and scroll', () => {
    const fit = fitView(300_000, 600);
    expect(fit.msPerPx).toBe(500);
    expect(isFitted(fit, 300_000)).toBe(true);

    // Past the closest zoom (50 ms bucket over 20 px) and past the end.
    const clamped = clampView({ startMs: 299_000, msPerPx: 0.1, widthPx: 600 }, 300_000, 50);
    expect(clamped.msPerPx).toBe(2.5);
    expect(clamped.startMs).toBe(300_000 - 2.5 * 600);
    expect(clampView({ startMs: -5, msPerPx: 9999, widthPx: 600 }, 300_000, 50)).toEqual(fit);
  });

  it('zooms around the anchor and scrolls by pixels', () => {
    const fit = fitView(300_000, 600);
    const zoomed = zoomView(fit, 2, 300, 300_000, 50);
    expect(zoomed.msPerPx).toBe(250);
    expect(pxToMs(300, zoomed)).toBe(pxToMs(300, fit));
    expect(isFitted(zoomed, 300_000)).toBe(false);

    const scrolled = scrollView(zoomed, 100, 300_000, 50);
    expect(scrolled.startMs).toBe(zoomed.startMs + 25_000);
    expect(scrollView(zoomed, 10_000, 300_000, 50).startMs).toBe(150_000);
  });

  it('reveals a point out of view and leaves a visible one alone', () => {
    const zoomed = { startMs: 0, msPerPx: 10, widthPx: 600 };
    expect(revealMs(zoomed, 3000, 300_000, 50)).toBe(zoomed);
    expect(revealMs(zoomed, 100_000, 300_000, 50).startMs).toBe(97_000);
  });
});

describe('columnPeaks', () => {
  const peaks = [-10, 20, -50, 40, -5, 5];

  it('joins the buckets a column covers', () => {
    expect(columnPeaks(peaks, 50, 0, 100)).toEqual([-50, 40]);
    expect(columnPeaks(peaks, 50, 0, 150)).toEqual([-50, 40]);
    expect(columnPeaks(peaks, 50, 100, 150)).toEqual([-5, 5]);
  });

  it('repeats a bucket over narrow columns and ends after the data', () => {
    expect(columnPeaks(peaks, 50, 10, 12)).toEqual([-10, 20]);
    expect(columnPeaks(peaks, 50, 12, 14)).toEqual([-10, 20]);
    expect(columnPeaks(peaks, 50, 150, 200)).toBeNull();
  });
});

describe('ruler and cue time', () => {
  it('chooses a step whose labels do not overlap', () => {
    expect(rulerStep(500)).toBe(60_000);
    expect(rulerStep(50)).toBe(5_000);
    expect(rulerStep(2.5)).toBe(200);
  });

  it('formats and reads cue times', () => {
    expect(formatCueTime(62_340)).toBe('1:02.340');
    expect(formatCueTime(3_723_400)).toBe('1:02:03.400');
    expect(formatRulerTime(65_500, 500)).toBe('1:05.5');
    expect(formatRulerTime(65_000, 5000)).toBe('1:05');

    expect(parseCueTime('1:02.340')).toBe(62_340);
    expect(parseCueTime('1:02.3')).toBe(62_300);
    expect(parseCueTime('1:02')).toBe(62_000);
    expect(parseCueTime('62,5')).toBe(62_500);
    expect(parseCueTime('1:02:03.400')).toBe(3_723_400);
    expect(parseCueTime('1:75')).toBeNull();
    expect(parseCueTime('abc')).toBeNull();
    expect(parseCueTime('')).toBeNull();
  });
});

describe('level scale', () => {
  it('enlarges the peaks to the loudest one, never silence', () => {
    expect(peakScale(49)).toBeCloseTo(127 / 49);
    expect(peakScale(127)).toBe(1);
    expect(peakScale(0)).toBe(1);
    expect(peakScale(200)).toBe(1);
  });

  it('reads the linear peaks in dBFS', () => {
    expect(peakDb(127)).toBe(0);
    expect(formatDb(peakDb(-127))).toBe('0 dB');
    expect(formatDb(peakDb(63))).toBe('−6.1 dB');
    expect(formatDb(peakDb(49))).toBe('−8.3 dB');
    expect(formatDb(peakDb(13))).toBe('−19.8 dB');
    expect(formatDb(-12)).toBe('−12 dB');
    expect(formatDb(peakDb(0))).toBe('−∞');
  });

  it('places the level lines by the real level, unevenly, and keeps the labels apart', () => {
    // Real level: 0 dB at the top, −6 dB at half the height, −20 dB at a tenth.
    const real = dbLines(1, 200);
    expect(real.map((line) => line.db)).toEqual([0, -6, -12, -20]);
    expect(real[1].offsetPx).toBeCloseTo(100.2, 1);
    expect(real[3].offsetPx).toBeCloseTo(20, 1);
    // In the editor's height −20 dB is too close to the centre for its label.
    expect(dbLines(1, 71).map((line) => line.db)).toEqual([0, -6, -12]);

    // Enlarged to a peak of −8.3 dB: the top is the peak, 0 and −6 dB lie above the view.
    const enlarged = dbLines(127 / 49, 71);
    expect(enlarged[0].db).toBeCloseTo(-8.27, 2);
    expect(enlarged[0].offsetPx).toBe(71);
    expect(enlarged.slice(1).map((line) => line.db)).toEqual([-12, -20]);
    expect(enlarged[1].offsetPx).toBeCloseTo(46.2, 1);
  });
});

describe('drawWaveform', () => {
  const colors = {
    wave: 'wave',
    dimmed: 'dimmed',
    centre: 'centre',
    envelope: 'envelope',
    cursor: 'cursor',
    ruler: 'ruler',
    grid: 'grid',
  };
  // 10 buckets of 50 ms, full scale.
  const peaks = Array.from({ length: 10 }, () => [-127, 127]).flat();
  const scene = (overrides: Partial<WaveScene> = {}): WaveScene => ({
    peaks,
    bucketMs: 50,
    durationMs: 500,
    cueIn: 100,
    cueOut: 400,
    fadeIn: 100,
    fadeOut: 0,
    position: 250,
    view: { startMs: 0, msPerPx: 50, widthPx: 10 },
    heightPx: 118,
    pixelRatio: 2,
    scale: 1,
    colors,
    ...overrides,
  });

  it('draws one mirrored bar per column, dimmed outside the cue', () => {
    const ctx = new FakeWaveContext();
    drawWaveform(ctx, scene());

    const bars = ctx.bars.filter((bar) => bar.color === 'wave' || bar.color === 'dimmed');
    expect(bars.map((bar) => bar.color)).toEqual([
      'dimmed',
      'dimmed',
      'wave',
      'wave',
      'wave',
      'wave',
      'wave',
      'wave',
      'dimmed',
      'dimmed',
    ]);
    // Full scale: from the top of the wave area (under the ruler) to the bottom.
    expect(bars[0].y).toBe(18);
    expect(bars[0].h).toBe(100);
    expect(ctx.bars.some((bar) => bar.color === 'cursor' && bar.x === 5)).toBe(true);
    expect(ctx.transforms).toBe(1);
  });

  it('draws the fade envelope above and below the centre line', () => {
    const ctx = new FakeWaveContext();
    drawWaveform(ctx, scene());

    expect(ctx.lines).toHaveLength(2);
    const [upper, lower] = ctx.lines;
    // cue in at gain 0 (centre), full gain 100 ms later, then a hard cut at cue out.
    expect(upper).toEqual([
      [2, 68],
      [4, 18],
      [8, 18],
      [8, 68],
    ]);
    expect(lower[1]).toEqual([4, 118]);
  });

  it('enlarges a quiet track to the height and labels the levels from the real value', () => {
    const quiet = Array.from({ length: 10 }, () => [-49, 49]).flat();
    const waveBars = (ctx: FakeWaveContext) => ctx.bars.filter((bar) => bar.color === 'wave');

    const enlarged = new FakeWaveContext();
    drawWaveform(enlarged, scene({ peaks: quiet, scale: 127 / 49 }));
    expect(waveBars(enlarged)[0].y).toBe(18);
    expect(waveBars(enlarged)[0].h).toBe(100);
    expect(enlarged.texts.some((text) => text.includes('dB'))).toBe(false);

    const real = new FakeWaveContext();
    drawWaveform(real, scene({ peaks: quiet, scale: 1 }));
    expect(waveBars(real)[0].h).toBeCloseTo(100 * (49 / 127));
    // Each level line is drawn above and below the centre.
    expect(real.bars.filter((bar) => bar.color === 'grid')).toHaveLength(2 * dbLines(1, 50).length);
  });

  it('labels the levels on an axis of its own, above and below the centre', () => {
    const axis = (scale: number) => {
      const ctx = new FakeWaveContext();
      drawDbAxis(ctx, { scale, widthPx: 52, heightPx: 160, pixelRatio: 2, colors });
      return ctx.texts;
    };
    expect(axis(1)).toEqual(['0 dB', '0 dB', '−6 dB', '−6 dB', '−12 dB', '−12 dB', '−∞']);
    expect(axis(127 / 49)).toEqual([
      '−8.3 dB',
      '−8.3 dB',
      '−12 dB',
      '−12 dB',
      '−20 dB',
      '−20 dB',
      '−∞',
    ]);
  });

  it('labels the ruler and hides a cursor out of view', () => {
    const ctx = new FakeWaveContext();
    drawWaveform(ctx, scene({ position: null, view: { startMs: 0, msPerPx: 5, widthPx: 100 } }));
    expect(ctx.texts[0]).toBe('0:00.0');
    expect(ctx.bars.some((bar) => bar.color === 'cursor')).toBe(false);
  });
});
