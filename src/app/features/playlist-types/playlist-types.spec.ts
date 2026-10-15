import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import { PlaylistType, TYPE_CODE_PATTERN } from './playlist-type-dialog.component';
import PlaylistTypesPageComponent from './playlist-types-page.component';

const type = (id: number, code: string, isSystem: boolean, playlists = 0): PlaylistType => ({
  id,
  code,
  name: code[0].toUpperCase() + code.slice(1),
  is_system: isSystem,
  playlist_count: playlists,
  track_count: 0,
  created_at: '2026-10-01T00:00:00Z',
});

describe('PlaylistTypesPageComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PlaylistTypesPageComponent>;
  let overlay: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
    fixture = TestBed.createComponent(PlaylistTypesPageComponent);
    await settle();
    http
      .expectOne('/api/playlist-types')
      .flush({ items: [type(1, 'music', true, 4), type(5, 'promo', false, 2)] });
    await settle();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    flushHelp(http);
    http.verify();
  });

  async function settle(): Promise<void> {
    await settlePage();
  }

  const rows = () => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tr.mat-mdc-row'),
  ];
  const button = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes(label),
    );

  it('lists the types with their usage; system types cannot be deleted', () => {
    const [music, promo] = rows();
    expect(music.textContent).toContain('Music');
    expect(music.textContent).toContain('playlistTypes.system');
    expect(music.textContent).toContain('4');
    expect(button(music, 'common.delete')).toBeUndefined();
    expect(button(music, 'playlistTypes.rename')).toBeDefined();
    expect(button(promo, 'common.delete')).toBeDefined();
  });

  it('shows a refused delete with the playlists and tracks that use the type', async () => {
    button(rows()[1], 'common.delete')?.click();
    await settle();
    button(overlay, 'common.delete')?.click();

    http.expectOne({ method: 'DELETE', url: '/api/playlist-types/5' }).flush(
      {
        status: 409,
        code: 'playlist_type_in_use',
        title: 'Conflict',
        detail: 'The playlist type is used by 2 playlists.',
        used_by: [
          { kind: 'playlist', id: 3, name: 'Morning promos' },
          { kind: 'track', id: 8, name: 'Promo spot' },
        ],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    const dialog = overlay.textContent ?? '';
    expect(dialog).toContain('The playlist type is used by 2 playlists.');
    expect(dialog).toContain('Morning promos');
    expect(dialog).toContain('Promo spot');
  });

  it('reloads the list after a delete', async () => {
    button(rows()[1], 'common.delete')?.click();
    await settle();
    button(overlay, 'common.delete')?.click();
    http.expectOne({ method: 'DELETE', url: '/api/playlist-types/5' }).flush(null);
    await settle();

    http.expectOne('/api/playlist-types').flush({ items: [type(1, 'music', true, 4)] });
    await settle();
    expect(rows()).toHaveLength(1);
  });

  it('creates a type with a valid code and marks a taken code', async () => {
    button(fixture.nativeElement as HTMLElement, 'playlistTypes.add')?.click();
    await settle();

    const [code, name] = [...overlay.querySelectorAll<HTMLInputElement>('input')];
    const save = button(overlay, 'common.save');
    code.value = 'Promo spots';
    code.dispatchEvent(new Event('input'));
    name.value = 'Promo';
    name.dispatchEvent(new Event('input'));
    await settle();
    expect(save?.disabled).toBe(true);

    code.value = 'promo';
    code.dispatchEvent(new Event('input'));
    await settle();
    expect(save?.disabled).toBe(false);
    save?.click();

    const create = http.expectOne({ method: 'POST', url: '/api/playlist-types' });
    expect(create.request.body).toEqual({ code: 'promo', name: 'Promo' });
    create.flush(
      {
        status: 422,
        code: 'validation_failed',
        title: 'Validation failed',
        errors: [{ field: 'code', code: 'taken', message: 'code is taken' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settle();
    expect(overlay.textContent).toContain('code is taken');
  });

  it('accepts only lowercase slugs as codes, like the backend', () => {
    expect(TYPE_CODE_PATTERN.test('promo')).toBe(true);
    expect(TYPE_CODE_PATTERN.test('station-id_2')).toBe(true);
    expect(TYPE_CODE_PATTERN.test('Promo')).toBe(false);
    expect(TYPE_CODE_PATTERN.test('2promo')).toBe(false);
    expect(TYPE_CODE_PATTERN.test('a'.repeat(64))).toBe(false);
  });
});
