import { OverlayContainer } from '@angular/cdk/overlay';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { ApiProblem } from '../../core/api/api-problem';
import { FakeAudio, provideFakeAudio } from '../../core/player/fake-audio.testing';
import { ConfirmService } from './confirm.service';

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
});
