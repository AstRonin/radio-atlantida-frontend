import { Routes } from '@angular/router';
import { navigationItems } from './navigation';

describe('navigationItems', () => {
  it('lists only routes with a navigation label', () => {
    const routes: Routes = [
      { path: '', children: [] },
      { path: 'library', data: { navLabel: 'nav.library' }, children: [] },
      { path: 'hidden', data: { other: true }, children: [] },
      { path: '**', redirectTo: '' },
    ];
    expect(navigationItems(routes)).toEqual([{ path: '/library', label: 'nav.library' }]);
  });
});
