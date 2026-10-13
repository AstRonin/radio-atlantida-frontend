import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';

/** Landing page until the feature pages exist. */
@Component({
  selector: 'app-home',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'home.title' | translate }}</h1>
    <p>{{ 'home.intro' | translate }}</p>
  `,
  styles: `
    h1 {
      margin-top: 0;
      font: var(--mat-sys-headline-medium);
    }
    p {
      font: var(--mat-sys-body-large);
      max-width: 60ch;
    }
  `,
})
export default class HomeComponent {}
