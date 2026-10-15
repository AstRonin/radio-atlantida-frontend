import { DestroyRef, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { of } from 'rxjs';
import { ConfirmService } from '../ui/confirm.service';

/** A page with a form that can hold changes not saved yet. */
export interface PendingChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Asks before leaving a page with unsaved changes (docs/frontend-init-plan.md F5). Put it in
 * `canDeactivate` of the page's route; the page implements `PendingChanges`.
 */
export const unsavedChangesGuard: CanDeactivateFn<PendingChanges> = (page) =>
  page.hasUnsavedChanges()
    ? inject(ConfirmService).confirm({
        title: 'dialogs.unsaved.title',
        message: 'dialogs.unsaved.message',
        confirmLabel: 'dialogs.unsaved.leave',
        destructive: true,
      })
    : of(true);

/**
 * Lets the browser ask before a reload or a closed tab drops unsaved changes; the router guard
 * does not see those. Call in the page's injection context.
 */
export function warnBeforeUnload(hasUnsavedChanges: () => boolean): void {
  const listener = (event: BeforeUnloadEvent) => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
    }
  };
  window.addEventListener('beforeunload', listener);
  inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', listener));
}
