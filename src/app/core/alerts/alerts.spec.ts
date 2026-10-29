import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component, ErrorHandler, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiProblem } from '../api/api-problem';
import { FakeSocketServer } from '../realtime/fake-socket.testing';
import type { RealtimeEventOf } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import { AlertsService } from './alerts.service';
import { GlobalErrorHandler } from './global-error-handler';
import { OutageBannerComponent } from './outage-banner.component';
import { OutageService } from './outage.service';

const alert = (message: string): RealtimeEventOf<'error.alert'> => ({
  type: 'error.alert',
  time: '2026-10-15T08:00:00Z',
  data: { message, error: 'dial tcp: connection refused', component: 'icecast', request_id: 'r-1' },
});

const started: RealtimeEventOf<'broadcast_outage.started'> = {
  type: 'broadcast_outage.started',
  time: '2026-10-15T08:00:10Z',
  data: {
    outage_id: 3,
    started_at: '2026-10-15T08:00:00Z',
    component: 'icecast',
    detected_by: 'icecast',
    reason: 'mount /live not found',
  },
};

const ended = (outageId: number): RealtimeEventOf<'broadcast_outage.ended'> => ({
  type: 'broadcast_outage.ended',
  time: '2026-10-15T08:10:00Z',
  data: {
    outage_id: outageId,
    started_at: '2026-10-15T08:00:00Z',
    ended_at: '2026-10-15T08:09:30Z',
    component: 'icecast',
    missed_count: 3,
  },
});

/** The shell's banner slot, without the rest of the shell. */
@Component({
  imports: [OutageBannerComponent],
  template: `@if (outage(); as open) {
    <app-outage-banner [outage]="open" />
  }`,
})
class BannerHostComponent {
  protected readonly outage = inject(OutageService).openOutage;
}

describe('alerts', () => {
  let server: FakeSocketServer;
  let http: HttpTestingController;

  beforeEach(() => {
    server = new FakeSocketServer();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        server.provider,
        { provide: ErrorHandler, useClass: GlobalErrorHandler },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  function connect(): void {
    TestBed.inject(RealtimeService).connect();
    server.latest.open();
  }

  function dialogText(): string {
    TestBed.inject(ApplicationRef).tick();
    return document.querySelector('app-error-alert-dialog')?.textContent ?? '';
  }

  describe('error popup', () => {
    let alerts: AlertsService;

    beforeEach(() => {
      alerts = TestBed.inject(AlertsService);
      connect();
    });

    it('opens on error.alert with the error text and the station time', () => {
      server.latest.send(alert('icecast connection lost'));
      const text = dialogText();
      expect(text).toContain('icecast connection lost');
      expect(text).toContain('dial tcp: connection refused');
      expect(text).toContain('alerts.dialog.requestId');
      // 08:00 UTC is 12:00 in Asia/Yerevan.
      expect(text).toContain('12:00:00');
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    });

    it('links each alert to the log of the 30 minutes around it', () => {
      server.latest.send(alert('icecast connection lost'));
      dialogText();
      const link = document.querySelector<HTMLAnchorElement>('app-error-alert-dialog a.log-link');
      expect(link?.textContent?.trim()).toBe('alerts.dialog.openLog');
      expect(link?.getAttribute('href')).toBe(
        '/logs?from=2026-10-15T07:45:00Z&to=2026-10-15T08:15:00Z&component=icecast&request=r-1',
      );
    });

    it('collects a burst of alerts in one dialog, newest first', () => {
      server.latest.send(alert('first'));
      server.latest.send(alert('second'));
      dialogText();
      expect(document.querySelectorAll('app-error-alert-dialog')).toHaveLength(1);
      expect(alerts.alerts().map((entry) => entry.message)).toEqual(['second', 'first']);
    });

    it('clears the list when the dialog is closed', async () => {
      server.latest.send(alert('first'));
      dialogText();
      document.querySelector<HTMLButtonElement>('button[mat-dialog-close]')?.click();
      TestBed.inject(ApplicationRef).tick();
      await vi.waitFor(() => expect(alerts.alerts()).toEqual([]));
    });

    it('shows errors the panel did not handle', () => {
      TestBed.inject(ErrorHandler).handleError(
        new ApiProblem({
          status: 409,
          code: 'missed_item_resolved',
          title: 'Conflict',
          request_id: 'r-9',
        }),
      );
      const text = dialogText();
      expect(text).toContain('alerts.panelError');
      expect(alerts.alerts()[0]).toEqual(
        expect.objectContaining({ requestId: 'r-9', error: 'Conflict' }),
      );
    });
  });

  describe('outage banner', () => {
    let outages: OutageService;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-15T08:30:00Z'));
      outages = TestBed.inject(OutageService);
    });

    afterEach(() => {
      http.verify();
      vi.useRealTimers();
    });

    function syncOutages(items: unknown[]): void {
      http.expectOne((req) => req.url === '/api/outages').flush({ items });
    }

    function bannerText(): string | null {
      const fixture = TestBed.createComponent(BannerHostComponent);
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[role="alert"]')?.textContent ?? null;
    }

    it('reads the open outage once per connection, an hour around now', () => {
      connect();
      const sync = http.expectOne((req) => req.url === '/api/outages');
      expect(sync.request.params.get('from')).toBe('2026-10-15T07:30:00.000Z');
      expect(sync.request.params.get('to')).toBe('2026-10-15T09:30:00.000Z');
      sync.flush({ items: [] });
    });

    it('opens on broadcast_outage.started and closes on broadcast_outage.ended', () => {
      connect();
      syncOutages([]);
      expect(bannerText()).toBeNull();

      server.latest.send(started);
      expect(outages.openOutage()).toEqual({
        id: 3,
        startedAt: '2026-10-15T08:00:00Z',
        component: 'icecast',
        reason: 'mount /live not found',
      });
      const text = bannerText();
      expect(text).toContain('alerts.outage.title');
      expect(text).toContain('mount /live not found');

      // The end of another outage does not close this one.
      server.latest.send(ended(2));
      expect(outages.openOutage()?.id).toBe(3);

      server.latest.send(ended(3));
      expect(outages.openOutage()).toBeNull();
      expect(bannerText()).toBeNull();
    });

    it('shows an outage that was already open when the panel connected', () => {
      connect();
      syncOutages([
        {
          id: 5,
          started_at: '2026-10-15T08:20:00Z',
          detected_by: 'liquidsoap_control',
          component: 'liquidsoap',
          missed_count: 0,
        },
        {
          id: 4,
          started_at: '2026-10-15T07:40:00Z',
          ended_at: '2026-10-15T07:45:00Z',
          detected_by: 'icecast',
          component: 'icecast',
          missed_count: 2,
        },
      ]);
      expect(outages.openOutage()).toEqual(
        expect.objectContaining({ id: 5, component: 'liquidsoap' }),
      );
    });

    it('clears an outage that ended while the socket was down', () => {
      connect();
      syncOutages([]);
      server.latest.send(started);

      server.latest.drop();
      vi.advanceTimersByTime(1_000);
      server.latest.open();
      syncOutages([]);

      expect(outages.openOutage()).toBeNull();
    });

    it('ignores a sync answer that an outage event has overtaken', () => {
      connect();
      server.latest.send(started);
      syncOutages([]);
      expect(outages.openOutage()?.id).toBe(3);
    });
  });
});
