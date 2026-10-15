import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

/**
 * Answers the help files that page headers and field hints read, so a page test can verify that no
 * other request is left open. The files are answered empty: the hints then show no button.
 */
export function flushHelp(http: HttpTestingController): void {
  for (const request of http.match((req) => req.url.startsWith('assets/help/'))) {
    request.flush({});
  }
}

/**
 * Runs change detection and lets timers and dialogs finish. `whenStable()` cannot be used while a
 * page has a resource request open, because that request keeps the application unstable until the
 * test flushes it.
 */
export async function settlePage(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}
