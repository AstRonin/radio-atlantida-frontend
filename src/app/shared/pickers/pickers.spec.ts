import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { PlayerService } from '../../core/player/player.service';
import {
  ARTIST_SELECT_DEBOUNCE_MS,
  ARTIST_SELECT_LIMIT,
  ArtistSelectComponent,
} from './artist-select.component';
import { PlayRulePickerComponent } from './play-rule-picker.component';
import { PlaylistPickerComponent } from './playlist-picker.component';
import type { TrackFilterForm } from './track-filters.component';
import {
  TRACK_PAGE_SIZE,
  TRACK_SEARCH_DEBOUNCE_MS,
  TrackPickerComponent,
} from './track-picker.component';

const track = (id: number, title: string, artist?: string): ApiSchema<'Track'> => ({
  id,
  title,
  artist: artist ? { id: id + 100, name: artist } : undefined,
  duration_ms: 225_000,
  file_path: `music/${id}.mp3`,
  format: 'mp3',
  fixes: [],
  play_rule_ids: [],
  cue_in_ms: 0,
  fade_in_ms: 0,
  fade_out_ms: 0,
  playlist_ids: [],
  quality_issues: [],
  quality_notes: '',
  created_at: '2026-10-01T00:00:00Z',
  type: { id: 1, code: 'music', name: 'Music' },
  in_use: null,
});

const playlist = (id: number, name: string, type: string): ApiSchema<'Playlist'> => ({
  id,
  name,
  clock_rule: 'fill',
  play_rule_ids: [],
  track_count: 12,
  created_at: '2026-10-01T00:00:00Z',
  type: { id: id + 10, code: type, name: type },
});

describe('pickers', () => {
  let http: HttpTestingController;
  let audio: FakeAudio;

  beforeEach(() => {
    audio = new FakeAudio();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiProblemInterceptor])),
        provideHttpClientTesting(),
        provideFakeAudio(audio),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('TrackPickerComponent', () => {
    let fixture: ComponentFixture<TrackPickerComponent>;
    let control: FormControl<number[] | null>;

    const element = () => fixture.nativeElement as HTMLElement;
    const trackSearch = (q?: string, cursor?: string): TestRequest =>
      http.expectOne(
        (req) =>
          req.url === '/api/tracks' &&
          req.params.get('q') === (q ?? null) &&
          req.params.get('cursor') === (cursor ?? null) &&
          req.params.get('limit') === String(TRACK_PAGE_SIZE),
      );

    async function create(value: number[] = [], inputs: Record<string, unknown> = {}) {
      control = new FormControl<number[] | null>(value);
      fixture = TestBed.createComponent(TrackPickerComponent);
      fixture.componentRef.setInput('control', control);
      for (const [name, input] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, input);
      }
      await fixture.whenStable();
    }

    function checkbox(index: number): HTMLInputElement {
      const boxes = element().querySelectorAll<HTMLInputElement>('.results input[type=checkbox]');
      return boxes[index];
    }

    it('lists tracks with title, artist, duration, and a play button', async () => {
      await create();
      trackSearch().flush({ items: [track(1, 'Summer', 'Band'), track(2, 'Station ID')] });
      await fixture.whenStable();

      const rows = element().querySelectorAll('.results .row');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('Summer');
      expect(rows[0].textContent).toContain('Band');
      expect(rows[0].textContent).toContain('3:45');
      expect(rows[0].querySelector('app-play-button')).not.toBeNull();
    });

    it('searches on the backend after the operator stops typing', async () => {
      await create();
      trackSearch().flush({ items: [] });

      const input = element().querySelector('input[type=search]') as HTMLInputElement;
      input.value = 'sum';
      input.dispatchEvent(new Event('input'));
      TestBed.tick();
      http.expectNone((req) => req.params.get('q') === 'sum');

      await new Promise((resolve) => setTimeout(resolve, TRACK_SEARCH_DEBOUNCE_MS + 20));
      trackSearch('sum').flush({ items: [track(1, 'Summer', 'Band')] });
    });

    it('loads the next page with the cursor', async () => {
      await create();
      trackSearch().flush({ items: [track(1, 'A')], next_cursor: 'c2' });
      await fixture.whenStable();

      element().querySelector<HTMLButtonElement>('fieldset > button')?.click();
      trackSearch(undefined, 'c2').flush({ items: [track(2, 'B')] });
      await fixture.whenStable();

      expect(element().querySelectorAll('.results .row')).toHaveLength(2);
      expect(element().querySelector('fieldset > button')).toBeNull();
    });

    it('chooses several tracks in the order of choice', async () => {
      await create();
      trackSearch().flush({ items: [track(1, 'A'), track(2, 'B'), track(3, 'C')] });
      await fixture.whenStable();

      checkbox(2).click();
      checkbox(0).click();
      expect(control.value).toEqual([3, 1]);

      checkbox(2).click();
      expect(control.value).toEqual([1]);
      expect(control.dirty).toBe(true);
    });

    it('keeps one track in single mode', async () => {
      await create([], { multiple: false });
      trackSearch().flush({ items: [track(1, 'A'), track(2, 'B')] });
      await fixture.whenStable();

      checkbox(0).click();
      checkbox(1).click();
      expect(control.value).toEqual([2]);
    });

    it('reorders chosen tracks when the order matters', async () => {
      await create([], { ordered: true });
      trackSearch().flush({ items: [track(1, 'A'), track(2, 'B')] });
      await fixture.whenStable();
      checkbox(0).click();
      checkbox(1).click();
      await fixture.whenStable();

      const moveUp = element()
        .querySelectorAll<HTMLButtonElement>('.selected .row')[1]
        .querySelector<HTMLButtonElement>('button[aria-label^="pickers.tracks.moveUp"]');
      moveUp?.click();
      expect(control.value).toEqual([2, 1]);
    });

    it('reads chosen tracks it has not seen, to show their names', async () => {
      await create([42]);
      trackSearch().flush({ items: [] });
      http.expectOne('/api/tracks/42').flush(track(42, 'Old favourite', 'Singer'));
      await fixture.whenStable();

      expect(element().querySelector('.selected')?.textContent).toContain('Old favourite');
    });

    it('previews a track without choosing it', async () => {
      await create();
      trackSearch().flush({ items: [track(1, 'Summer', 'Band')] });
      await fixture.whenStable();

      element().querySelector<HTMLButtonElement>('.results app-play-button button')?.click();

      expect(TestBed.inject(PlayerService).track()?.id).toBe(1);
      expect(audio.src).toBe('/api/tracks/1/audio');
      expect(control.value).toEqual([]);
    });

    describe('filters', () => {
      const filters = () =>
        (fixture.componentInstance as unknown as { filters: TrackFilterForm }).filters;
      const toggle = () =>
        element().querySelector<HTMLButtonElement>('.filters-toggle') as HTMLButtonElement;

      async function showFilters(withType = true) {
        toggle().click();
        await fixture.whenStable();
        if (withType) {
          http.expectOne('/api/playlist-types').flush({ items: [] });
        }
        http.expectOne('/api/playlists').flush({ items: [playlist(7, 'Morning', 'music')] });
        await fixture.whenStable();
      }

      it('reads the filter lists only when the filters are shown', async () => {
        await create();
        trackSearch().flush({ items: [] });
        expect(element().querySelector('.filters')).toBeNull();
        expect(toggle().getAttribute('aria-expanded')).toBe('false');

        await showFilters();

        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(element().querySelector('.filters app-playlist-type-select')).not.toBeNull();
        expect(element().querySelector('.filters app-playlist-select')).not.toBeNull();
        expect(element().querySelector('.filters app-artist-select')).not.toBeNull();
      });

      it('narrows the search by type, playlist, and artist', async () => {
        await create();
        trackSearch().flush({ items: [] });
        await showFilters();

        filters().controls.playlist_id.setValue(7);
        http
          .expectOne((req) => req.url === '/api/tracks' && req.params.get('playlist_id') === '7')
          .flush({ items: [track(1, 'A')] });

        filters().controls.artist_id.setValue(3);
        filters().controls.type_id.setValue(2);
        await fixture.whenStable();
        http.expectOne('/api/artists/3').flush({ id: 3, name: 'Ann', track_count: 2 });
        const requests = http.match((req) => req.url === '/api/tracks');
        const last = requests[requests.length - 1];
        expect(last.request.params.get('playlist_id')).toBe('7');
        expect(last.request.params.get('artist_id')).toBe('3');
        expect(last.request.params.get('type_id')).toBe('2');
        last.flush({ items: [] });

        filters().controls.reviewed.setValue('false');
        filters().controls.without_playlist.setValue(true);
        await fixture.whenStable();
        const more = http.match((req) => req.url === '/api/tracks');
        const latest = more[more.length - 1];
        expect(latest.request.params.get('reviewed')).toBe('false');
        expect(latest.request.params.get('in_playlist')).toBe('false');
        latest.flush({ items: [] });
        await fixture.whenStable();
        expect(toggle().textContent).toContain('pickers.tracks.filtersActive');

        element().querySelector<HTMLButtonElement>('.clear-filters')?.click();
        const cleared = http.expectOne((req) => req.url === '/api/tracks');
        expect(cleared.request.params.keys()).toEqual(['limit']);
        cleared.flush({ items: [] });
      });

      it('keeps a type fixed by the input and hides the type filter', async () => {
        await create([], { typeId: 5 });
        http
          .expectOne((req) => req.url === '/api/tracks' && req.params.get('type_id') === '5')
          .flush({ items: [] });
        await showFilters(false);

        expect(element().querySelector('.filters app-playlist-type-select')).toBeNull();
        filters().controls.playlist_id.setValue(7);
        const request = http.expectOne((req) => req.url === '/api/tracks');
        expect(request.request.params.get('type_id')).toBe('5');
        expect(request.request.params.get('playlist_id')).toBe('7');
        request.flush({ items: [] });
      });
    });

    it('shows a failed search as a message', async () => {
      await create();
      trackSearch().flush(
        { status: 500, code: 'internal_error', title: 'Internal Server Error' },
        { status: 500, statusText: 'Internal Server Error' },
      );
      await fixture.whenStable();

      // Without loaded translations, the problem's own title is shown.
      expect(element().querySelector('.load-error')?.textContent).toContain(
        'Internal Server Error',
      );
    });
  });

  describe('ArtistSelectComponent', () => {
    let fixture: ComponentFixture<ArtistSelectComponent>;
    let control: FormControl<number | null>;

    const input = () =>
      (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
    const options = () => [
      ...TestBed.inject(OverlayContainer)
        .getContainerElement()
        .querySelectorAll<HTMLElement>('mat-option'),
    ];
    const artist = (id: number, name: string): ApiSchema<'Artist'> => ({
      id,
      name,
      track_count: 1,
    });
    const search = (q: string | null) =>
      http.expectOne(
        (req) =>
          req.url === '/api/artists' &&
          req.params.get('q') === q &&
          req.params.get('limit') === String(ARTIST_SELECT_LIMIT) &&
          req.params.get('sort') === 'name',
      );

    async function create(value: number | null = null) {
      control = new FormControl<number | null>(value);
      fixture = TestBed.createComponent(ArtistSelectComponent);
      fixture.componentRef.setInput('control', control);
      await fixture.whenStable();
    }

    async function type(text: string) {
      input().value = text;
      input().dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, ARTIST_SELECT_DEBOUNCE_MS));
      await fixture.whenStable();
    }

    async function focus() {
      input().dispatchEvent(new Event('focus'));
      input().dispatchEvent(new Event('focusin'));
      await fixture.whenStable();
    }

    it('reads nothing until focused, then searches the typed text on the server', async () => {
      await create();
      http.expectNone('/api/artists');

      await focus();
      search(null).flush({ items: [artist(1, 'Ann'), artist(2, 'Bob')], total: 2 });
      await fixture.whenStable();
      expect(options().map((option) => option.textContent?.trim())).toEqual(['Ann', 'Bob']);

      await type(' an ');
      search('an').flush({ items: [artist(1, 'Ann')], total: 1 });
      await fixture.whenStable();
      expect(options().map((option) => option.textContent?.trim())).toEqual(['Ann']);

      options()[0].click();
      await fixture.whenStable();
      expect(control.value).toBe(1);
      expect(input().value).toBe('Ann');
      // The autocomplete focuses the field again; a chosen name is no search, so page 1 is read.
      for (const request of http.match((req) => req.url === '/api/artists')) {
        expect(request.request.params.get('q')).toBeNull();
        request.flush({ items: [], total: 0 });
      }
    });

    it('offers at most the limit and says how many more there are', async () => {
      await create();
      await focus();
      const items = Array.from({ length: ARTIST_SELECT_LIMIT }, (_, index) =>
        artist(index + 1, `Artist ${index + 1}`),
      );
      search(null).flush({ items, total: 120 });
      await fixture.whenStable();
      const shown = options();
      expect(shown).toHaveLength(ARTIST_SELECT_LIMIT + 1);
      const more = shown[shown.length - 1];
      expect(more.textContent).toContain('artists.pickerMore');
      expect(more.getAttribute('aria-disabled')).toBe('true');
    });

    it('shows the name of a start value that is on no page of the results', async () => {
      await create(5);
      http.expectOne('/api/artists/5').flush(artist(5, 'Zed'));
      await fixture.whenStable();
      expect(input().value).toBe('Zed');

      await focus();
      search(null).flush({ items: [artist(1, 'Ann')], total: 80 });
      await fixture.whenStable();
      expect(input().value).toBe('Zed');
      expect(control.value).toBe(5);

      // Text equal to the kept name keeps the value, though no option matches it.
      await type('Zed');
      search('Zed').flush({ items: [], total: 0 });
      await fixture.whenStable();
      expect(control.value).toBe(5);
      expect(options().map((option) => option.textContent?.trim())).toEqual(['pickers.noMatches']);

      await type('Zedd');
      search('Zedd').flush({ items: [], total: 0 });
      await fixture.whenStable();
      expect(control.value).toBeNull();
      expect(input().value).toBe('Zedd');
    });

    it('keeps an unknown start value and says it is unknown', async () => {
      await create(5);
      http
        .expectOne('/api/artists/5')
        .flush(
          { status: 404, code: 'not_found', title: 'Not Found' },
          { status: 404, statusText: 'Not Found' },
        );
      await fixture.whenStable();
      expect(control.value).toBe(5);
      expect(input().value).toBe('artists.unknown');
      expect((fixture.nativeElement as HTMLElement).querySelector('.load-error')).toBeNull();
    });

    it('reads the name again when the form resets to another artist', async () => {
      await create(5);
      http.expectOne('/api/artists/5').flush(artist(5, 'Zed'));
      await fixture.whenStable();

      control.reset(7);
      await fixture.whenStable();
      http.expectOne('/api/artists/7').flush(artist(7, 'Yara'));
      await fixture.whenStable();
      expect(input().value).toBe('Yara');

      control.reset(null);
      await fixture.whenStable();
      expect(input().value).toBe('');
    });
  });

  it('PlaylistPickerComponent offers playlists of every type', async () => {
    const control = new FormControl<number[] | null>([2]);
    const fixture = TestBed.createComponent(PlaylistPickerComponent);
    fixture.componentRef.setInput('control', control);
    fixture.detectChanges();

    http.expectOne('/api/playlists').flush({
      items: [playlist(1, 'Pop hits', 'music'), playlist(2, 'Jingles', 'jingle')],
    });
    await fixture.whenStable();

    const state = (
      fixture.componentInstance as unknown as {
        playlists(): { items: readonly ApiSchema<'Playlist'>[] };
      }
    ).playlists();
    expect(state.items.map((item) => item.type.code)).toEqual(['music', 'jingle']);
    expect((fixture.nativeElement as HTMLElement).querySelector('mat-select')).not.toBeNull();
  });

  it('PlaylistPickerComponent shows a failed read', async () => {
    const fixture = TestBed.createComponent(PlaylistPickerComponent);
    fixture.componentRef.setInput('control', new FormControl<number[] | null>([]));
    fixture.detectChanges();

    http.expectOne('/api/playlists').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Network error');
  });

  it('PlayRulePickerComponent counts the uses of each rule', async () => {
    const fixture = TestBed.createComponent(PlayRulePickerComponent);
    fixture.componentRef.setInput('control', new FormControl<number[] | null>([]));
    fixture.detectChanges();

    http.expectOne('/api/play-rules').flush({
      items: [
        {
          id: 1,
          name: 'Morning',
          notes: '',
          window_from: '06:00',
          window_to: '08:00',
          track_count: 2,
          playlist_count: 1,
          track_ids: [1, 2],
          playlist_ids: [3],
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      rules(): { items: readonly ApiSchema<'PlayRule'>[] };
      uses(rule: ApiSchema<'PlayRule'>): number;
    };
    expect(component.uses(component.rules().items[0])).toBe(3);
  });
});
