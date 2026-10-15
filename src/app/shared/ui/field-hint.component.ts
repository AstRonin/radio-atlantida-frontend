import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { switchMap } from 'rxjs';
import type { HelpPageId } from '../../core/help/help-content';
import { HelpService } from '../../core/help/help.service';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * A field's short hint from the page help (design §6.1): a tooltip on hover or focus, and a click
 * opens the full page help. Place it beside a form field in a `.field-row` (global styles), or next
 * to its label.
 */
@Component({
  selector: 'app-field-hint',
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hint(); as text) {
      <button
        type="button"
        class="hint"
        [matTooltip]="text"
        [attr.aria-label]="label()"
        aria-haspopup="dialog"
        (click)="openHelp($event)"
      >
        ?
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 50%;
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      cursor: pointer;
    }

    .hint:hover {
      color: var(--mat-sys-primary);
      border-color: var(--mat-sys-primary);
    }
  `,
})
export class FieldHintComponent {
  private readonly help = inject(HelpService);
  private readonly i18n = inject(I18nService);

  readonly page = input.required<HelpPageId>();
  /** Control name of the field, as keyed in the help file's `fields`. */
  readonly field = input.required<string>();

  private readonly content = toSignal(
    toObservable(this.page).pipe(switchMap((page) => this.help.content(page))),
  );

  /** No button is shown for a field without a hint, so a missing hint is never an empty tooltip. */
  protected readonly hint = computed(() => this.content()?.fields[this.field()]?.text ?? null);

  protected readonly label = computed(() =>
    this.i18n.translate('help.fieldHint', {
      field: this.content()?.fields[this.field()]?.label ?? this.field(),
      hint: this.hint() ?? '',
    }),
  );

  protected openHelp(event: Event): void {
    // Inside a form field, a click would otherwise focus the input behind the suffix.
    event.stopPropagation();
    this.help.open(this.page());
  }
}
