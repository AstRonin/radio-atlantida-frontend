import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { OperationState } from '../../core/operations/operations.service';
import { OperationStatusComponent } from './operation-status.component';

@Component({
  imports: [OperationStatusComponent],
  template: `<app-operation-status [state]="state()" runningLabel="import.form.running" />`,
})
class HostComponent {
  readonly state = signal<OperationState | null>(null);
}

describe('OperationStatusComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function render(state: OperationState | null): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.state.set(state);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const base: OperationState = { id: 1, kind: 'import', status: 'running', updatedAt: null };

  it('shows nothing before an operation starts', async () => {
    const element = await render(null);
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('shows the progress with a determinate bar when the total is known', async () => {
    const element = await render({ ...base, progress: { done: 3, total: 12, message: '3 of 12' } });
    const bar = element.querySelector('mat-progress-bar');
    expect(bar?.getAttribute('mode')).toBe('determinate');
    expect(bar?.getAttribute('aria-valuenow')).toBe('25');
    expect(element.textContent).toContain('import.form.running');
    expect(element.textContent).toContain('3 of 12');
  });

  it('runs the bar without a value while the total is unknown', async () => {
    const element = await render({ ...base, status: 'accepted' });
    expect(element.querySelector('mat-progress-bar')?.getAttribute('mode')).toBe('indeterminate');
  });

  it('shows the summary on completion and only names a failure', async () => {
    let element = await render({ ...base, status: 'completed', summary: '9 imported' });
    expect(element.querySelector('mat-progress-bar')).toBeNull();
    expect(element.textContent).toContain('9 imported');

    element = await render({ ...base, status: 'failed', error: 'ffprobe failed' });
    expect(element.textContent).toContain('operationStatus.failed');
    expect(element.textContent).not.toContain('ffprobe failed');
  });
});
