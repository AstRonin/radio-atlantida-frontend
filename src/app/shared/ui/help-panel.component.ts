import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { HelpContent, HelpField } from '../../core/help/help-content';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * The page help (design §6.1): what the page is, its terms, how to use it, typical steps, common
 * mistakes, a worked example, notes per operation, and the field hints. The shell shows it in a
 * side panel, which closes with Escape.
 */
@Component({
  selector: 'app-help-panel',
  imports: [MatButtonModule, MatProgressBarModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <h2 class="title" id="help-panel-title">
        {{ content()?.title ?? ('help.panel.title' | translate) }}
      </h2>
      <button matButton type="button" (click)="closed.emit()">
        {{ 'common.close' | translate }}
      </button>
    </header>

    @if (content(); as help) {
      <div class="body">
        <p class="summary">{{ help.summary }}</p>

        <h3>{{ 'help.panel.entities' | translate }}</h3>
        <dl class="terms">
          @for (entity of help.entities; track entity.term) {
            <dt>{{ entity.term }}</dt>
            <dd>{{ entity.text }}</dd>
          }
        </dl>

        <h3>{{ 'help.panel.usage' | translate }}</h3>
        <p>{{ help.usage }}</p>

        <h3>{{ 'help.panel.steps' | translate }}</h3>
        <ol>
          @for (step of help.steps; track $index) {
            <li>{{ step }}</li>
          }
        </ol>

        <h3>{{ 'help.panel.mistakes' | translate }}</h3>
        <ul>
          @for (mistake of help.mistakes; track $index) {
            <li>{{ mistake }}</li>
          }
        </ul>

        <h3>{{ 'help.panel.example' | translate }}: {{ help.example.title }}</h3>
        <p>{{ help.example.text }}</p>

        @if (help.operations.create || help.operations.edit || help.operations.delete) {
          <h3>{{ 'help.panel.operations' | translate }}</h3>
          <dl class="terms">
            @if (help.operations.create) {
              <dt>{{ 'help.panel.create' | translate }}</dt>
              <dd>{{ help.operations.create }}</dd>
            }
            @if (help.operations.edit) {
              <dt>{{ 'help.panel.edit' | translate }}</dt>
              <dd>{{ help.operations.edit }}</dd>
            }
            @if (help.operations.delete) {
              <dt>{{ 'help.panel.delete' | translate }}</dt>
              <dd>{{ help.operations.delete }}</dd>
            }
          </dl>
        }

        @if (fieldHints(help).length > 0) {
          <h3>{{ 'help.panel.fields' | translate }}</h3>
          <dl class="terms">
            @for (field of fieldHints(help); track field.label) {
              <dt>{{ field.label }}</dt>
              <dd>{{ field.text }}</dd>
            }
          </dl>
        }
      </div>
    } @else if (content() === null) {
      <p class="body">{{ 'help.panel.unavailable' | translate }}</p>
    } @else {
      <mat-progress-bar mode="indeterminate" [attr.aria-label]="'help.panel.loading' | translate" />
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 1rem 1.25rem 2rem;
    }

    .header {
      display: flex;
      gap: 1rem;
      align-items: center;
      justify-content: space-between;
    }

    .title {
      margin: 0;
      font: var(--mat-sys-title-large);
    }

    .summary {
      font: var(--mat-sys-body-large);
    }

    h3 {
      margin: 1.25rem 0 0.5rem;
      font: var(--mat-sys-title-small);
    }

    .terms dt {
      font-weight: 600;
    }

    .terms dd {
      margin: 0 0 0.5rem;
    }

    ol,
    ul {
      padding-left: 1.25rem;
    }

    li + li {
      margin-top: 0.25rem;
    }
  `,
})
export class HelpPanelComponent {
  /** Undefined while loading, null when the help cannot be read. */
  readonly content = input<HelpContent | null | undefined>();
  readonly closed = output();

  protected fieldHints(help: HelpContent): HelpField[] {
    return Object.values(help.fields);
  }
}
