import { Provider } from '@angular/core';
import type { WaveContext } from './waveform-draw';
import { WAVEFORM_BROWSER, WaveformBrowser } from './waveform-editor.component';

/** A 2D context that records its calls. */
export class FakeWaveContext implements WaveContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  font = '';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  textAlign: CanvasTextAlign = 'start';
  readonly bars: { x: number; y: number; h: number; color: string }[] = [];
  readonly texts: string[] = [];
  readonly lines: [number, number][][] = [];
  transforms = 0;
  clears = 0;
  private path: [number, number][] = [];

  clearRect(): void {
    this.clears++;
    this.bars.length = 0;
    this.texts.length = 0;
    this.lines.length = 0;
  }
  fillRect(x: number, y: number, _w: number, h: number): void {
    this.bars.push({ x, y, h, color: String(this.fillStyle) });
  }
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.path.push([x, y]);
  }
  stroke(): void {
    this.lines.push(this.path);
  }
  fillText(text: string): void {
    this.texts.push(text);
  }
  setTransform(): void {
    this.transforms++;
  }
}

/** The editor's browser parts for unit tests: a fixed width and a recording context. */
export class FakeWaveformBrowser implements WaveformBrowser {
  readonly ctx = new FakeWaveContext();
  /** The dB axis beside the waveform. */
  readonly axisCtx = new FakeWaveContext();
  width = 600;

  context(canvas: HTMLCanvasElement): WaveContext {
    return canvas.classList.contains('axis') ? this.axisCtx : this.ctx;
  }

  observeWidth(_element: HTMLElement, callback: (width: number) => void): () => void {
    callback(this.width);
    return () => undefined;
  }

  pixelRatio(): number {
    return 1;
  }

  colors() {
    return {
      wave: 'wave',
      dimmed: 'dimmed',
      centre: 'centre',
      envelope: 'envelope',
      cursor: 'cursor',
      ruler: 'ruler',
      grid: 'grid',
    };
  }
}

export function provideFakeWaveformBrowser(browser: FakeWaveformBrowser): Provider {
  return { provide: WAVEFORM_BROWSER, useValue: browser };
}
