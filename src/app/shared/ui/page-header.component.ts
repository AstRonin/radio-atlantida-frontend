import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { HelpPageId } from '../../core/help/help-content';
import { HelpService } from '../../core/help/help.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * The header of every admin page: its title, the page actions (projected), and the help button
 * that opens the page help (design §6.1).
 */
@Component({
  selector: 'app-page-header',
  imports: [MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="title">{{ titleKey() | translate }}</h1>
    <div class="actions">
      <ng-content />
      <button
        matButton="outlined"
        type="button"
        aria-haspopup="dialog"
        (click)="help.open(helpPage())"
      >
        {{ 'help.button' | translate }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .title {
      margin: 0;
      font: var(--mat-sys-headline-small);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
  `,
})
export class PageHeaderComponent {
  /** Translation key of the page title. */
  readonly titleKey = input.required<string>();
  readonly helpPage = input.required<HelpPageId>();

  protected readonly help = inject(HelpService);
}
