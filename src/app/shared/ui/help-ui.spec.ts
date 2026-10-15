import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HelpContent } from '../../core/help/help-content';
import { HelpService } from '../../core/help/help.service';
import { FieldHintComponent } from './field-hint.component';
import { HelpPanelComponent } from './help-panel.component';
import { PageHeaderComponent } from './page-header.component';

const clocks: HelpContent = {
  title: 'Clocks',
  summary: 'A clock is a 60-minute template.',
  entities: [{ term: 'Element', text: 'One slot of the hour.' }],
  usage: 'Build the hour from elements.',
  steps: ['Add a clock.', 'Add elements.'],
  mistakes: ['Overlapping fixed elements.'],
  example: { title: 'A news hour', text: 'News at :00.' },
  operations: { delete: 'A clock in the grid cannot be deleted.' },
  fields: { nominal_duration_ms: { label: 'Nominal duration', text: 'The length it aims for.' } },
};

@Component({
  imports: [PageHeaderComponent, FieldHintComponent],
  template: `
    <app-page-header title="clocks.title" helpPage="help.clocks">
      <button type="button">Add clock</button>
    </app-page-header>
    <app-field-hint page="help.clocks" field="nominal_duration_ms" />
    <app-field-hint page="help.clocks" field="unknown_field" />
  `,
})
class PageComponent {}

describe('help UI', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('the page header help button opens the page help', async () => {
    const fixture = TestBed.createComponent(PageComponent);
    await fixture.whenStable();
    http.expectOne('assets/help/en/clocks.json').flush(clocks);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('clocks.title');
    const helpButton = [...element.querySelectorAll('app-page-header button')].find((button) =>
      button.textContent?.includes('help.button'),
    );
    (helpButton as HTMLButtonElement).click();

    expect(TestBed.inject(HelpService).panelPage()).toBe('help.clocks');
  });

  it('a field hint shows its text as a tooltip and opens the page help', async () => {
    const fixture = TestBed.createComponent(PageComponent);
    await fixture.whenStable();
    http.expectOne('assets/help/en/clocks.json').flush(clocks);
    await fixture.whenStable();

    const hints = (fixture.nativeElement as HTMLElement).querySelectorAll('app-field-hint');
    // A field without a hint shows no button rather than an empty tooltip.
    expect(hints[1].querySelector('button')).toBeNull();
    const hint = hints[0].querySelector('button');
    expect(hint?.getAttribute('aria-label')).toBe('help.fieldHint');

    hint?.click();
    expect(TestBed.inject(HelpService).panelPage()).toBe('help.clocks');
  });

  it('the help panel shows every section and emits close', () => {
    const fixture = TestBed.createComponent(HelpPanelComponent);
    fixture.componentRef.setInput('content', clocks);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h2')?.textContent).toContain('Clocks');
    expect(element.textContent).toContain('A clock is a 60-minute template.');
    expect(element.querySelectorAll('ol li')).toHaveLength(2);
    expect(element.textContent).toContain('Overlapping fixed elements.');
    expect(element.textContent).toContain('News at :00.');
    expect(element.textContent).toContain('A clock in the grid cannot be deleted.');
    expect(element.textContent).toContain('Nominal duration');

    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    element.querySelector('button')?.click();
    expect(closed).toHaveBeenCalled();
  });

  it('the help panel says when the help cannot be read', () => {
    const fixture = TestBed.createComponent(HelpPanelComponent);
    fixture.componentRef.setInput('content', null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('help.panel.unavailable');
  });
});
