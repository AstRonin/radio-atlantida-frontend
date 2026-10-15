import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiProblem } from '../../core/api/api-problem';
import type { ApiSchema } from '../../core/api/api-types';
import { I18nService } from '../../core/i18n/i18n.service';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { ConfirmService } from './confirm.service';
import type { ClockSegment, SaveWithFillerBody } from './filler-dialog.component';
import { shortSegments } from './filler-dialog.component';
import { FILLER_DIALOG_CONFIG, FillerDialogService } from './filler-dialog.service';

const segment = (index: number, start: number, end: number, shortfall: number): ClockSegment => ({
  index,
  start_ms: start,
  end_ms: end,
  shortfall_ms: shortfall,
  content_ms: end - start - shortfall,
  element_indexes: [index],
  holder_index: index,
  filler_mode: 'none',
  overflow_ms: 0,
});

describe('dialogs', () => {
  let overlay: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeAudio(new FakeAudio()),
        // Closing then completes without waiting for the exit animation.
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
  });

  const buttons = () => [
    ...overlay.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'),
  ];
  const button = (label: string) => buttons().find((item) => item.textContent?.includes(label));

  async function settle(): Promise<void> {
    TestBed.tick();
    await TestBed.inject(ApplicationRef).whenStable();
  }

  describe('confirm dialog', () => {
    it('closes with true on confirm', async () => {
      const results: boolean[] = [];
      TestBed.inject(ConfirmService)
        .confirm({ title: 'dialogs.delete.title', message: 'dialogs.delete.message' })
        .subscribe((result) => results.push(result));
      await settle();

      button('common.confirm')?.click();
      await settle();
      expect(results).toEqual([true]);
    });

    it('closes with false on cancel', async () => {
      const results: boolean[] = [];
      TestBed.inject(ConfirmService)
        .confirm({ title: 't', message: 'm' })
        .subscribe((result) => results.push(result));
      await settle();

      button('common.cancel')?.click();
      await settle();
      expect(results).toEqual([false]);
    });

    it('runs the delete and closes when it succeeds', async () => {
      const results: boolean[] = [];
      const action = vi.fn(() => of(null));
      TestBed.inject(ConfirmService)
        .confirmDelete({ name: 'Pop hits', action })
        .subscribe((result) => results.push(result));
      await settle();
      expect(overlay.textContent).toContain('dialogs.delete.title');

      button('common.delete')?.click();
      await settle();
      expect(action).toHaveBeenCalledOnce();
      expect(results).toEqual([true]);
    });

    it('shows a refused delete with the entities that block it', async () => {
      const results: boolean[] = [];
      const refusal = new ApiProblem({
        status: 409,
        code: 'playlist_in_use',
        title: 'Conflict',
        detail: 'playlist is used by 2 clocks',
        used_by: [
          { kind: 'clock', id: 3, name: 'Weekday morning' },
          { kind: 'clock', id: 4, name: 'Weekend brunch' },
        ],
      });
      TestBed.inject(ConfirmService)
        .confirmDelete({ name: 'Pop hits', action: () => throwError(() => refusal) })
        .subscribe((result) => results.push(result));
      await settle();

      button('common.delete')?.click();
      await settle();

      expect(results).toEqual([]);
      expect(overlay.querySelector('[role=alert]')?.textContent).toContain(
        'playlist is used by 2 clocks',
      );
      const items = [...overlay.querySelectorAll('app-used-by-list li')].map(
        (li) => li.textContent,
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toContain('Weekday morning');

      button('common.close')?.click();
      await settle();
      expect(results).toEqual([false]);
    });
  });

  describe('filler dialog', () => {
    let saved: SaveWithFillerBody[];
    let incomplete: number;
    let save: (body: SaveWithFillerBody) => Observable<unknown>;
    let result: string[];

    function open(segments: ClockSegment[]): void {
      TestBed.inject(FillerDialogService)
        .open({
          clockName: 'News hour',
          segments,
          save: (body) => {
            saved.push(body);
            return save(body);
          },
          saveIncomplete: () => {
            incomplete++;
            return of(null);
          },
        })
        .subscribe((value) => result.push(value));
    }

    beforeEach(() => {
      saved = [];
      incomplete = 0;
      save = () => of(null);
      result = [];
    });

    it('cannot be closed by a click outside or Escape', async () => {
      expect(FILLER_DIALOG_CONFIG.disableClose).toBe(true);
      open([segment(0, 300_000, 1_800_000, 40_000)]);
      await settle();

      overlay.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      overlay
        .querySelector('mat-dialog-container')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();

      expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
      expect(result).toEqual([]);
    });

    it('lists every short segment with its shortfall', async () => {
      const translate = vi.spyOn(TestBed.inject(I18nService), 'translate');
      open([segment(0, 300_000, 1_800_000, 40_000), segment(1, 1_830_000, 3_600_000, 95_000)]);
      await settle();

      const titles = [...overlay.querySelectorAll('.segment-title')].map(
        (item) => item.textContent,
      );
      expect(titles).toHaveLength(2);
      expect(translate).toHaveBeenCalledWith('filler.dialog.shortfall', { duration: '1:35' });
      expect(translate).toHaveBeenCalledWith('filler.dialog.segment', {
        number: 2,
        from: '30:30',
        to: '60:00',
      });
    });

    it('saves only when every segment has a mode, then closes', async () => {
      open([segment(0, 0, 1_800_000, 40_000)]);
      await settle();
      const saveButton = buttons()[1];
      expect(saveButton.disabled).toBe(true);

      chooseMode(0, 'random');
      await settle();
      expect(saveButton.disabled).toBe(false);

      saveButton.click();
      await settle();
      expect(saved).toEqual([{ segments: [{ segment: 0, filler_mode: 'random' }] }]);
      expect(result).toEqual(['filler']);
    });

    it('needs the playlist for the playlist mode and sends it as the source', async () => {
      open([segment(2, 0, 3_600_000, 60_000)]);
      await settle();

      chooseMode(0, 'playlist');
      await settle();
      expect(buttons()[1].disabled).toBe(true);
      TestBed.inject(HttpTestingController).expectOne('/api/playlists').flush({ items: [] });

      formOf().controls.segments.at(0).controls.filler_source_id.setValue(5);
      await settle();
      buttons()[1].click();
      await settle();

      expect(saved[0].segments).toEqual([
        { segment: 2, filler_mode: 'playlist', filler_source_id: 5 },
      ]);
    });

    it('stays open and marks the field when the backend refuses the choice', async () => {
      const refusal = new Subject<unknown>();
      save = () => refusal;
      open([segment(0, 0, 3_600_000, 60_000)]);
      await settle();
      chooseMode(0, 'pool');
      await settle();
      buttons()[1].click();
      refusal.error(
        new ApiProblem({
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [{ field: 'segments[0].filler_mode', code: 'invalid', message: 'pool is empty' }],
        }),
      );
      await settle();

      expect(result).toEqual([]);
      expect(formOf().controls.segments.at(0).controls.filler_mode.hasError('server')).toBe(true);
      // The track picker of the pool reads its first page.
      TestBed.inject(HttpTestingController)
        .match((req) => req.url === '/api/tracks')
        .forEach((req) => req.flush({ items: [] }));
    });

    it('saves the clock incomplete by the explicit action', async () => {
      open([segment(0, 0, 3_600_000, 60_000)]);
      await settle();

      button('filler.dialog.saveIncomplete')?.click();
      await settle();

      expect(incomplete).toBe(1);
      expect(result).toEqual(['incomplete']);
    });

    it('takes the short segments from a clock save result', () => {
      const short = segment(1, 0, 0, 10);
      const result = {
        check: { short_segments: [1], shortfall_ms: 10, requires_filler_choice: true },
        clock: { layout: { segments: [segment(0, 0, 0, 0), short], shortfall_ms: 10 } },
      } as unknown as ApiSchema<'ClockSaveResult'>;
      expect(shortSegments(result)).toEqual([short]);
    });
  });

  interface DialogForm {
    controls: {
      segments: {
        at(index: number): {
          controls: {
            filler_mode: { setValue(value: string): void; hasError(key: string): boolean };
            filler_source_id: { setValue(value: number): void };
          };
        };
      };
    };
  }

  function formOf(): DialogForm {
    const dialog = TestBed.inject(MatDialog).openDialogs[0];
    return (dialog.componentInstance as unknown as { form: DialogForm }).form;
  }

  function chooseMode(index: number, mode: string): void {
    formOf().controls.segments.at(index).controls.filler_mode.setValue(mode);
  }
});
