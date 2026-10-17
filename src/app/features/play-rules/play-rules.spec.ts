import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import PlayRuleEditComponent from './play-rule-edit.component';
import {
  PlayRule,
  intervalMaxMinutes,
  playRuleBody,
  playRuleForm,
  playRuleFormValue,
} from './play-rule-form';

const rule = (overrides: Partial<PlayRule> = {}): PlayRule => ({
  id: 7,
  name: 'Morning jingles',
  notes: '',
  track_ids: [],
  playlist_ids: [],
  track_count: 0,
  playlist_count: 0,
  created_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('play rules', () => {
  describe('form validation (design §6.2, §7.3)', () => {
    it('needs at least one limit', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'Empty' });
      expect(form.hasError('atLeastOne')).toBe(true);
      expect(form.valid).toBe(false);

      for (const limit of [
        { min_interval_minutes: 10 },
        { max_per_hour: 1 },
        { weekdays: [1, 2] },
        { window_from: '06:00', window_to: '08:00' },
      ]) {
        const withLimit = playRuleForm();
        withLimit.patchValue({ name: 'Limited', ...limit });
        expect(withLimit.valid, JSON.stringify(limit)).toBe(true);
      }
    });

    it('does not count an empty weekday list as a limit', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'No days', weekdays: [] });
      expect(form.hasError('atLeastOne')).toBe(true);
    });

    it('needs both ends of the window or neither', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'Half window', window_from: '06:00', max_per_hour: 1 });
      expect(form.hasError('bothOrNone')).toBe(true);
      expect(form.controls.window_to.hasError('bothOrNone')).toBe(true);

      form.patchValue({ window_to: '08:00' });
      expect(form.valid).toBe(true);
      expect(form.controls.window_to.errors).toBeNull();
    });

    it('accepts a window across midnight but not one that ends where it starts', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'Night', window_from: '22:00', window_to: '02:00' });
      expect(form.valid).toBe(true);

      form.patchValue({ window_to: '22:00' });
      expect(form.hasError('sameWindow')).toBe(true);
    });

    it('limits the interval, the plays per hour, and the text lengths', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'Ranges', min_interval_minutes: 0, max_per_hour: 61 });
      expect(form.controls.min_interval_minutes.hasError('range')).toBe(true);
      expect(form.controls.max_per_hour.hasError('range')).toBe(true);

      form.patchValue({ min_interval_minutes: 10_080, max_per_hour: 60 });
      expect(form.controls.min_interval_minutes.valid).toBe(true);
      expect(form.controls.max_per_hour.valid).toBe(true);

      form.patchValue({ artist_min_interval_minutes: 0 });
      expect(form.controls.artist_min_interval_minutes.hasError('range')).toBe(true);

      form.controls.name.setValue('x'.repeat(201));
      expect(form.controls.name.hasError('maxlength')).toBe(true);
      form.controls.name.setValue('');
      expect(form.controls.name.hasError('required')).toBe(true);
    });

    it('caps both intervals at the play log retention', () => {
      expect(intervalMaxMinutes(10)).toBe(14_400);
      expect(intervalMaxMinutes(undefined)).toBe(525_600);
      const form = playRuleForm(intervalMaxMinutes(10));
      form.patchValue({ name: 'Rotation', min_interval_minutes: 14_400 });
      expect(form.controls.min_interval_minutes.valid).toBe(true);
      form.patchValue({ min_interval_minutes: 14_401, artist_min_interval_minutes: 14_401 });
      expect(form.controls.min_interval_minutes.hasError('range')).toBe(true);
      expect(form.controls.artist_min_interval_minutes.hasError('range')).toBe(true);
    });

    it('takes an artist interval alone as a limit', () => {
      const form = playRuleForm();
      form.patchValue({ name: 'Artists', artist_min_interval_minutes: 120 });
      expect(form.valid).toBe(true);
    });
  });

  describe('request body', () => {
    it('sends no weekdays for every day and nulls for unset limits', () => {
      const form = playRuleForm();
      form.patchValue({ name: '  Once an hour ', max_per_hour: 1, weekdays: [] });
      expect(playRuleBody(form)).toEqual({
        name: 'Once an hour',
        window_from: null,
        window_to: null,
        weekdays: undefined,
        min_interval_minutes: null,
        artist_min_interval_minutes: null,
        max_per_hour: 1,
        notes: '',
      });
    });

    it('round-trips a stored rule', () => {
      const form = playRuleForm();
      form.reset(
        playRuleFormValue(
          rule({ window_from: '06:00', window_to: '08:00', weekdays: [1, 5], notes: 'A' }),
        ),
      );
      expect(playRuleBody(form)).toEqual({
        name: 'Morning jingles',
        window_from: '06:00',
        window_to: '08:00',
        weekdays: [1, 5],
        min_interval_minutes: null,
        artist_min_interval_minutes: null,
        max_per_hour: null,
        notes: 'A',
      });
    });
  });

  describe('PlayRuleEditComponent', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([apiProblemInterceptor])),
          provideHttpClientTesting(),
          provideRouter([]),
          provideFakeAudio(new FakeAudio()),
          { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      flushHelp(http);
      http.verify();
    });

    async function settle(): Promise<void> {
      await settlePage();
    }

    function flushPickers(): void {
      http.expectOne('/api/playlists').flush({ items: [] });
      http.expectOne((req) => req.url === '/api/tracks').flush({ items: [] });
    }

    it('creates the rule, then sets its targets, then returns to the list', async () => {
      const fixture = TestBed.createComponent(PlayRuleEditComponent);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await settle();
      flushPickers();

      const component = fixture.componentInstance as unknown as {
        form: ReturnType<typeof playRuleForm>;
        save(): void;
      };
      component.form.patchValue({ name: 'Hourly', max_per_hour: 1, playlist_ids: [3] });
      component.form.markAsDirty();
      component.save();

      const create = http.expectOne({ method: 'POST', url: '/api/play-rules' });
      expect(create.request.body).toMatchObject({ name: 'Hourly', max_per_hour: 1 });
      create.flush(rule({ id: 9, name: 'Hourly', max_per_hour: 1 }));

      const targets = http.expectOne({ method: 'PUT', url: '/api/play-rules/9/targets' });
      expect(targets.request.body).toEqual({ track_ids: [], playlist_ids: [3] });
      targets.flush(rule({ id: 9, playlist_ids: [3], playlist_count: 1 }));
      await settle();

      expect(navigate).toHaveBeenCalledWith('/play-rules');
      expect(component.form.dirty).toBe(false);
    });

    it('shows the backend refusal of a constraint next to its field', async () => {
      const fixture = TestBed.createComponent(PlayRuleEditComponent);
      await settle();
      flushPickers();

      const component = fixture.componentInstance as unknown as {
        form: ReturnType<typeof playRuleForm>;
        save(): void;
      };
      component.form.patchValue({ name: 'Taken', max_per_hour: 1 });
      component.save();
      http.expectOne({ method: 'POST', url: '/api/play-rules' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Validation failed',
          errors: [{ field: 'name', code: 'taken', message: 'another play rule has this name' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settle();

      expect(component.form.controls.name.hasError('server')).toBe(true);
      // Tests load no translations, so the texts fall back to the backend's own.
      const text = (fixture.nativeElement as HTMLElement).textContent;
      expect(text).toContain('another play rule has this name');
      expect(text).toContain('Validation failed');
    });

    it('enters the intervals as hours and minutes and shows a retention refusal on its field', async () => {
      const fixture = TestBed.createComponent(PlayRuleEditComponent);
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await settle();
      flushPickers();

      const component = fixture.componentInstance as unknown as {
        form: ReturnType<typeof playRuleForm>;
        save(): void;
      };
      const page = fixture.nativeElement as HTMLElement;
      const [track, artist] = [...page.querySelectorAll('app-interval-input')];
      const type = (field: Element, index: number, value: string) => {
        const input = field.querySelectorAll('input')[index];
        input.value = value;
        input.dispatchEvent(new Event('input'));
      };
      type(track, 0, '72');
      type(artist, 0, '1');
      type(artist, 1, '30');
      expect(component.form.controls.min_interval_minutes.value).toBe(4_320);
      expect(component.form.controls.artist_min_interval_minutes.value).toBe(90);
      component.form.patchValue({ name: 'Music rotation' });
      component.save();

      const create = http.expectOne({ method: 'POST', url: '/api/play-rules' });
      expect(create.request.body).toMatchObject({
        min_interval_minutes: 4_320,
        artist_min_interval_minutes: 90,
      });
      create.flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Validation failed',
          errors: [
            {
              field: 'artist_min_interval_minutes',
              code: 'interval_beyond_retention',
              message: 'longer than the play log',
            },
          ],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settle();
      expect(component.form.controls.artist_min_interval_minutes.hasError('server')).toBe(true);
      expect(component.form.controls.min_interval_minutes.hasError('server')).toBe(false);
      expect(artist.textContent).toContain('longer than the play log');
    });
  });
});
