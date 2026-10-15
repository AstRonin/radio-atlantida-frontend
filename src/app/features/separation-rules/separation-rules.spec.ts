import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { Setting, SettingsService } from '../../core/settings/settings.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import SeparationRulesPageComponent from './separation-rules-page.component';

const playLogDays: Setting = {
  key: 'retention.play_log_days',
  group: 'retention',
  description: '',
  type: 'integer',
  value: 5,
  default: 10,
  is_default: false,
  nullable: false,
  apply: 'immediate',
  affects_air: false,
};

describe('SeparationRulesPageComponent', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        new FakeSocketServer().provider,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes(label),
    );

  it('limits the interval to the play log retention and saves the rule', async () => {
    TestBed.inject(SettingsService).load();
    http.expectOne('/api/settings').flush({ items: [playLogDays] });

    const fixture = TestBed.createComponent(SeparationRulesPageComponent);
    await settlePage();
    http.expectOne('/api/separation-rules').flush({
      items: [{ id: 1, scope: 'track', min_interval_hours: 72, notes: 'Reference value' }],
    });
    await settlePage();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('separationRules.scopes.track');
    button(page, 'common.edit')?.click();
    await settlePage();

    const hours = overlay.querySelector<HTMLInputElement>('input[type="number"]');
    expect(hours?.getAttribute('max')).toBe('120');
    const save = button(overlay, 'common.save');
    if (!hours) {
      throw new Error('No hours field.');
    }
    hours.value = '121';
    hours.dispatchEvent(new Event('input'));
    await settlePage();
    expect(save?.disabled).toBe(true);

    hours.value = '96';
    hours.dispatchEvent(new Event('input'));
    await settlePage();
    save?.click();
    const put = http.expectOne({ method: 'PUT', url: '/api/separation-rules/1' });
    expect(put.request.body).toEqual({ min_interval_hours: 96, notes: 'Reference value' });
    put.flush({ id: 1, scope: 'track', min_interval_hours: 96, notes: 'Reference value' });
    await settlePage();

    http.expectOne('/api/separation-rules').flush({
      items: [{ id: 1, scope: 'track', min_interval_hours: 96, notes: 'Reference value' }],
    });
  });
});
