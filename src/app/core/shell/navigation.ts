import { Route, Routes } from '@angular/router';

/** Route `data` for pages that appear in the side navigation. */
export interface NavigationData {
  /** Translation key of the navigation label. */
  navLabel: string;
}

export interface NavigationItem {
  path: string;
  label: string;
}

/**
 * Builds the side navigation from the registered routes, so only pages whose phase is done
 * are listed (docs/frontend-init-plan.md, F1 task 6 and F5 task 8).
 */
export function navigationItems(routes: Routes): NavigationItem[] {
  return routes.filter(hasNavigation).map((route) => ({
    path: `/${route.path ?? ''}`,
    label: route.data.navLabel,
  }));
}

function hasNavigation(route: Route): route is Route & { data: NavigationData } {
  const label: unknown = route.data?.['navLabel'];
  return typeof label === 'string' && label.length > 0;
}
