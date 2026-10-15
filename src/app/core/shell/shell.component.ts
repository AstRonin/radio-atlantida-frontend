import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { HelpPanelComponent } from '../../shared/ui/help-panel.component';
import { OutageBannerComponent } from '../alerts/outage-banner.component';
import { OutageService } from '../alerts/outage.service';
import { HelpService } from '../help/help.service';
import { LanguageSwitchComponent } from '../i18n/language-switch.component';
import { TranslatePipe } from '../i18n/translate.pipe';
import { OperationsMenuComponent } from '../operations/operations-menu.component';
import { PlayerBarComponent } from '../player/player-bar.component';
import { ConnectionStatusComponent } from '../realtime/connection-status.component';
import { SettingsService } from '../settings/settings.service';
import { navigationItems } from './navigation';

// Below this width the navigation overlays the content instead of taking a column.
const NARROW_QUERY = '(max-width: 959.98px)';

@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    ConnectionStatusComponent,
    HelpPanelComponent,
    LanguageSwitchComponent,
    OperationsMenuComponent,
    OutageBannerComponent,
    PlayerBarComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(NARROW_QUERY)
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  // The route config is fixed after bootstrap, so the list is computed once.
  protected readonly navigation = navigationItems(inject(Router).config);
  protected readonly stationName = inject(SettingsService).stationName;
  protected readonly openOutage = inject(OutageService).openOutage;
  protected readonly help = inject(HelpService);
}
