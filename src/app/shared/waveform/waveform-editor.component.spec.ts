import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CueRange, WavePlayRequest, WaveformEditorComponent } from './waveform-editor.component';
import { FakeWaveformBrowser, provideFakeWaveformBrowser } from './waveform.testing';

// 300 s of full-scale peaks in 50 ms buckets.
const PEAKS = Array.from({ length: 6000 }, () => [-100, 100]).flat();

@Component({
  imports: [WaveformEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-waveform-editor
      [peaks]="peaks"
      [maxPeak]="maxPeak()"
      [durationMs]="300000"
      [cueIn]="cueIn()"
      [cueOut]="cueOut()"
      [fadeIn]="1000"
      [fadeOut]="2000"
      [position]="position()"
      [disabled]="disabled()"
      (cueChange)="changes.push($event)"
      (seek)="seeks.push($event)"
      (playRequest)="plays.push($event)"
    />
  `,
})
class HostComponent {
  readonly peaks = PEAKS;
  readonly maxPeak = signal(100);
  readonly cueIn = signal(10_000);
  readonly cueOut = signal<number | null>(null);
  readonly position = signal<number | null>(null);
  readonly disabled = signal(false);
  readonly changes: CueRange[] = [];
  readonly seeks: number[] = [];
  readonly plays: WavePlayRequest[] = [];
}

describe('WaveformEditorComponent', () => {
  let browser: FakeWaveformBrowser;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let page: HTMLElement;

  beforeEach(async () => {
    browser = new FakeWaveformBrowser();
    TestBed.configureTestingModule({ providers: [provideFakeWaveformBrowser(browser)] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    page = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const handle = (which: 'in' | 'out') =>
    page.querySelector<HTMLElement>(`.handle.${which}`) as HTMLElement;
  const stage = () => page.querySelector<HTMLElement>('.stage') as HTMLElement;
  const key = (target: HTMLElement, init: KeyboardEventInit) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  const pointer = (target: HTMLElement, type: string, clientX: number) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));

  it('draws the peaks on the canvas at its width', () => {
    // 300 s over 600 px: 500 ms per pixel; the cue in at 10 s is pixel 20.
    const waveBars = browser.ctx.bars.filter((bar) => bar.color === 'wave');
    const dimmed = browser.ctx.bars.filter((bar) => bar.color === 'dimmed');
    expect(waveBars).toHaveLength(580);
    expect(dimmed).toHaveLength(20);
    expect(handle('in').style.left).toBe('20px');
    expect(handle('out').style.left).toBe('600px');
  });

  it('enlarges a quiet track, says so, and draws the real level on request', async () => {
    const waveTop = () => browser.ctx.bars.find((bar) => bar.color === 'wave')?.y;
    const realButton = () =>
      Array.from(page.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('waveform.realLevel'),
      ) as HTMLButtonElement;
    // Peaks of 100 enlarged to fill the height: the bar starts under the ruler.
    expect(waveTop()).toBe(18);
    expect(page.querySelector('.scale')?.textContent).toContain('waveform.enlarged');
    expect(realButton().getAttribute('aria-pressed')).toBe('false');
    expect(browser.axisCtx.texts[0]).toBe('−2.1 dB');

    realButton().click();
    await fixture.whenStable();
    expect(realButton().getAttribute('aria-pressed')).toBe('true');
    expect(waveTop()).toBeGreaterThan(18);
    expect(browser.axisCtx.texts[0]).toBe('0 dB');

    host.maxPeak.set(127);
    await fixture.whenStable();
    expect(page.querySelector('.scale')).toBeNull();
    expect(realButton()).toBeUndefined();
  });

  it('describes each handle as a slider', () => {
    const start = handle('in');
    expect(start.getAttribute('role')).toBe('slider');
    expect(start.getAttribute('aria-valuetext')).toBe('0:10.000');
    expect(start.getAttribute('aria-valuemax')).toBe('295000');
    expect(handle('out').getAttribute('aria-valuetext')).toBe('5:00.000');
    expect(handle('out').getAttribute('aria-valuemin')).toBe('15000');
  });

  it('moves a handle with the arrow keys, Shift, Alt, Home, and End', async () => {
    key(handle('in'), { key: 'ArrowRight' });
    key(handle('in'), { key: 'ArrowRight', shiftKey: true });
    key(handle('in'), { key: 'ArrowLeft', altKey: true });
    key(handle('out'), { key: 'Home' });
    key(handle('in'), { key: 'Home' });
    expect(host.changes).toEqual([
      { cueIn: 10_100, cueOut: 300_000 },
      { cueIn: 11_000, cueOut: 300_000 },
      { cueIn: 9_990, cueOut: 300_000 },
      { cueIn: 10_000, cueOut: 15_000 },
      { cueIn: 0, cueOut: 300_000 },
    ]);

    host.cueIn.set(10_100);
    await fixture.whenStable();
    expect(handle('in').getAttribute('aria-valuetext')).toBe('0:10.100');
  });

  it('keeps the handles from crossing', async () => {
    host.cueOut.set(16_000);
    await fixture.whenStable();
    key(handle('in'), { key: 'ArrowRight', shiftKey: true });
    key(handle('in'), { key: 'End' });
    key(handle('out'), { key: 'ArrowLeft', shiftKey: true });
    // 5 s must stay between them: cue in up to 11 s, cue out down to 15 s.
    expect(host.changes).toEqual([
      { cueIn: 11_000, cueOut: 16_000 },
      { cueIn: 11_000, cueOut: 16_000 },
      { cueIn: 10_000, cueOut: 15_000 },
    ]);
  });

  it('drags a handle and snaps it to the cursor', async () => {
    pointer(handle('out'), 'pointerdown', 600);
    pointer(handle('out'), 'pointermove', 400);
    expect(host.changes.at(-1)).toEqual({ cueIn: 10_000, cueOut: 200_000 });

    host.position.set(100_250);
    await fixture.whenStable();
    pointer(handle('out'), 'pointermove', 203);
    expect(host.changes.at(-1)).toEqual({ cueIn: 10_000, cueOut: 100_250 });
    pointer(handle('out'), 'pointerup', 203);

    // After the drag, a move does nothing.
    const count = host.changes.length;
    pointer(handle('out'), 'pointermove', 500);
    expect(host.changes).toHaveLength(count);
    // The handle took the press, so the cursor did not move.
    expect(host.seeks).toEqual([]);
  });

  it('moves the cursor on a click and sets the points there with I and O', () => {
    pointer(stage(), 'pointerdown', 100);
    expect(host.seeks).toEqual([50_000]);

    key(stage(), { key: 'i' });
    pointer(stage(), 'pointerdown', 300);
    key(stage(), { key: 'O' });
    expect(host.changes).toEqual([
      { cueIn: 50_000, cueOut: 300_000 },
      { cueIn: 10_000, cueOut: 150_000 },
    ]);
  });

  it('asks to play on Space, from a handle too', () => {
    key(stage(), { key: ' ' });
    key(handle('in'), { key: ' ' });
    expect(host.plays).toEqual(['cursor', 'cursor']);
  });

  it('zooms with the keys and buttons and fits again', async () => {
    const scroll = () => page.querySelector('input.scroll');
    expect(scroll()).toBeNull();

    key(stage(), { key: '+' });
    await fixture.whenStable();
    expect(scroll()).not.toBeNull();
    // The scrollbar sits under the axis and the waveform, not beside them.
    expect(scroll()?.closest('.body')).toBeNull();
    // Zoomed around the middle: 250 ms per pixel, the cue in now at pixel -260 is kept at the edge.
    expect(handle('in').style.left).toBe('0px');

    key(stage(), { key: '0' });
    await fixture.whenStable();
    expect(scroll()).toBeNull();
    expect(handle('in').style.left).toBe('20px');
  });

  it('blocks changes while disabled', async () => {
    host.disabled.set(true);
    await fixture.whenStable();
    expect(handle('in').getAttribute('aria-disabled')).toBe('true');

    key(handle('in'), { key: 'ArrowRight' });
    pointer(handle('out'), 'pointerdown', 600);
    pointer(handle('out'), 'pointermove', 400);
    pointer(stage(), 'pointerdown', 100);
    key(stage(), { key: 'i' });
    expect(host.changes).toEqual([]);
    // Listening still works.
    expect(host.seeks).toEqual([50_000]);
  });
});
