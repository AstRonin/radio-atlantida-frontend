import { Routes } from '@angular/router';

// Register a feature route only in the phase that builds it; the side navigation lists every
// route that has `data.navLabel` (see core/shell/navigation.ts).
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./core/shell/home.component'),
  },
  { path: '**', redirectTo: '' },
];
