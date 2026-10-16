import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { PlayerService } from '../../core/player/player.service';
import { PlayRulePickerComponent } from './play-rule-picker.component';
import { PlaylistPickerComponent } from './playlist-picker.component';
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
});

const playlist = (id: number, name: string, type: string): ApiSchema<'Playlist'> => ({
  id,
  name,
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
