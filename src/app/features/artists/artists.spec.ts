import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import ArtistsPageComponent from './artists-page.component';

describe('ArtistsPageComponent', () => {
  let http: HttpTestingController;
  let overlay: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes(label),
    );

  it('adds an artist and marks a name that is taken', async () => {
    const fixture = TestBed.createComponent(ArtistsPageComponent);
    await settlePage();
    http
      .expectOne((req) => req.url === '/api/artists' && !req.params.has('q'))
      .flush({ items: [{ id: 1, name: 'Arto Tunçboyacıyan', track_count: 3 }] });
    await settlePage();

    button(fixture.nativeElement as HTMLElement, 'artists.add')?.click();
    await settlePage();
    const name = overlay.querySelector<HTMLInputElement>('input');
    if (!name) {
      throw new Error('No name field.');
    }
    name.value = 'Arto Tunçboyacıyan';
    name.dispatchEvent(new Event('input'));
    await settlePage();
    button(overlay, 'common.save')?.click();

    http.expectOne({ method: 'POST', url: '/api/artists' }).flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Validation failed',
        errors: [{ field: 'name', code: 'taken', message: 'another artist has this name' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settlePage();
    expect(overlay.textContent).toContain('another artist has this name');
  });
});
