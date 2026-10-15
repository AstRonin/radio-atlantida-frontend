import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import type { ApiSchema } from '../api/api-types';
import { I18nService } from '../i18n/i18n.service';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import { RealtimeService } from '../realtime/realtime.service';
import { formatElapsedMs } from '../time/duration';
import { BroadcastStatusComponent } from './broadcast-status.component';

const status = (
  overrides: Partial<ApiSchema<'BroadcastStatus'>> = {},
): ApiSchema<'BroadcastStatus'> => ({
  state: 'connected',
  since: '2026-10-15T08:00:00Z',
  mount_ok: true,
  last_check_at: '2026-10-15T08:00:30Z',
  time: '2026-10-15T08:15:00Z',
  ...overrides,
});

describe('formatElapsedMs', () => {
  it('counts hours without splitting days', () => {
    expect(formatElapsedMs(0)).toBe('0:00:00');
    expect(formatElapsedMs(65_000)).toBe('0:01:05');
    expect(formatElapsedMs((27 * 3600 + 14 * 60 + 3) * 1000)).toBe('27:14:03');
    // A `since` slightly ahead of the synced clock is not a negative duration.
    expect(formatElapsedMs(-2_000)).toBe('0:00:00');
  });
});

describe('BroadcastStatusComponent', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;
  let fixture: ComponentFixture<BroadcastStatusComponent>;

  function setUp(narrow = false): void {
    const breakpoints: Pick<BreakpointObserver, 'observe'> = {
      observe: () => of<BreakpointState>({ matches: narrow, breakpoints: {} }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        server.provider,
        { provide: BreakpointObserver, useValue: breakpoints },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BroadcastStatusComponent);
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  }

  function answer(value: ApiSchema<'BroadcastStatus'>): void {
    http.expectOne('/api/broadcast/status').flush(value);
    fixture.detectChanges();
  }

  function query(selector: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // The browser clock is five minutes behind the server.
    vi.setSystemTime(new Date('2026-10-15T08:10:00Z'));
    server = new FakeSocketServer();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('shows no status and no timer until the backend answers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setUp();
    fixture.detectChanges();
    expect(query('.label')?.textContent?.trim()).toBe('broadcast.state.unknown');
    expect(query('.timer')).toBeNull();
    http.expectOne('/api/broadcast/status').flush(null, { status: 404, statusText: 'Not Found' });
  });

  it('counts the state duration on the server clock, every second', () => {
    setUp();
    answer(status());
    expect(query('.broadcast')?.classList).toContain('connected');
    expect(query('.label')?.textContent?.trim()).toBe('broadcast.state.connected');
    // 15 minutes on the server clock, not the browser's 10.
    expect(query('.timer')?.textContent).toBe('0:15:00');

    vi.advanceTimersByTime(2_000);
    fixture.detectChanges();
    expect(query('.timer')?.textContent).toBe('0:15:02');
  });

  it('stops ticking when the component is destroyed', () => {
    setUp();
    answer(status());
    expect(vi.getTimerCount()).toBe(1);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('announces the state, not the timer', () => {
    setUp();
    answer(status({ state: 'reconnecting', since: '2026-10-15T08:14:00Z' }));
    const label = query('.label');
    expect(label?.getAttribute('role')).toBe('status');
    expect(label?.getAttribute('aria-live')).toBe('polite');
    expect(query('.timer')?.getAttribute('aria-hidden')).toBe('true');
    expect(query('.dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(query('.broadcast')?.getAttribute('tabindex')).toBe('0');
  });

  it('keeps the label for screen readers only at narrow width', () => {
    setUp(true);
    answer(status());
    expect(query('.label')?.classList).toContain('cdk-visually-hidden');
    expect(query('.label')?.textContent?.trim()).toBe('broadcast.state.connected');
    expect(query('.timer')?.textContent).toBe('0:15:00');
  });

  it('lists the start in station time, the reason, and the mount check in the tooltip', () => {
    setUp();
    const translate = vi.spyOn(TestBed.inject(I18nService), 'translate');
    answer(
      status({
        state: 'unreachable',
        reason: 'icecast',
        outage_id: 7,
        mount_ok: false,
        last_check_at: '2026-10-15T08:14:30Z',
      }),
    );
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    expect(tooltip.message.split('\n')).toEqual([
      'broadcast.since',
      'broadcast.reason',
      'broadcast.mount.failed',
    ]);
    // 08:00 UTC is 12:00 in Asia/Yerevan.
    expect(translate).toHaveBeenCalledWith('broadcast.since', {
      time: expect.stringContaining('12:00:00'),
    });
    expect(translate).toHaveBeenCalledWith('broadcast.reason', { reason: 'icecast' });
    expect(translate).toHaveBeenCalledWith('broadcast.mount.failed', {
      time: expect.stringContaining('12:14:30'),
    });
  });

  it('says when the mount has not been checked yet', () => {
    setUp();
    answer(status({ state: 'unknown', since: null, mount_ok: null, last_check_at: null }));
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    expect(tooltip.message).toBe('broadcast.mount.unchecked');
    expect(query('.timer')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
