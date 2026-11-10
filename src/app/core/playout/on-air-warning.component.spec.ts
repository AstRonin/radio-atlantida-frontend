import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { I18nService } from '../i18n/i18n.service';
import { OnAirWarningComponent } from './on-air-warning.component';
import { OnAirWarning, OnAirWarningService } from './on-air-warning.service';

describe('OnAirWarningComponent', () => {
  const current = signal<OnAirWarning | null>(null);
  let fixture: ComponentFixture<OnAirWarningComponent>;

  beforeEach(() => {
    current.set(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: OnAirWarningService, useValue: { warning: computed(() => current()) } },
      ],
    });
    fixture = TestBed.createComponent(OnAirWarningComponent);
    fixture.detectChanges();
  });

  function show(warning: OnAirWarning | null): void {
    current.set(warning);
    fixture.detectChanges();
  }

  const query = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);

  const tooltip = () =>
    fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);

  it('shows nothing, but keeps the live region for a later announcement', () => {
    expect(query('.warning')).toBeNull();
    expect(query('.region')?.getAttribute('role')).toBe('status');
    expect(query('.region')?.getAttribute('aria-live')).toBe('polite');
    expect(query('.region')?.getAttribute('aria-label')).toBe('onAirWarning.label');
  });

  it('shows the emergency track in amber with its title', () => {
    const translate = vi.spyOn(TestBed.inject(I18nService), 'translate');
    show({ kind: 'emergency', title: 'Reserve Song' });
    expect(query('.warning')?.classList).toContain('emergency');
    expect(query('.warning')?.classList).not.toContain('safety');
    expect(translate).toHaveBeenCalledWith('onAirWarning.emergency', { title: 'Reserve Song' });
    expect(query('.text')?.textContent).toBe('onAirWarning.emergency');
    expect(tooltip().message).toBe('onAirWarning.emergency');
    expect(query('.warning')?.getAttribute('tabindex')).toBe('0');
    expect(query('.icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the safety tone in red', () => {
    show({ kind: 'safety' });
    expect(query('.warning')?.classList).toContain('safety');
    expect(query('.warning')?.classList).not.toContain('emergency');
    expect(query('.text')?.textContent).toBe('onAirWarning.safety');
  });

  it('removes the warning when the state clears', () => {
    show({ kind: 'safety' });
    show(null);
    expect(query('.warning')).toBeNull();
  });
});
