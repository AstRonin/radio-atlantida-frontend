import { Routes } from '@angular/router';
import type { NavigationData } from './core/shell/navigation';

const nav = (navLabel: string): NavigationData => ({ navLabel });

// Register a feature route only in the phase that builds it; the side navigation lists every
// route that has `data.navLabel` (see core/shell/navigation.ts), in this order.
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./core/shell/home.component'),
  },
  {
    path: 'library',
    loadChildren: () => import('./features/library/library.routes'),
    data: nav('nav.library'),
  },
  {
    path: 'artists',
    loadChildren: () => import('./features/artists/artists.routes'),
    data: nav('nav.artists'),
  },
  {
    path: 'playlists',
    loadChildren: () => import('./features/playlists/playlists.routes'),
    data: nav('nav.playlists'),
  },
  {
    path: 'playlist-types',
    loadChildren: () => import('./features/playlist-types/playlist-types.routes'),
    data: nav('nav.playlistTypes'),
  },
  {
    path: 'play-rules',
    loadChildren: () => import('./features/play-rules/play-rules.routes'),
    data: nav('nav.playRules'),
  },
  {
    path: 'separation-rules',
    loadChildren: () => import('./features/separation-rules/separation-rules.routes'),
    data: nav('nav.separationRules'),
  },
  {
    path: 'settings',
    loadChildren: () => import('./features/settings/settings.routes'),
    data: nav('nav.settings'),
  },
  { path: '**', redirectTo: '' },
];
