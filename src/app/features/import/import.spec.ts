import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import type { ApiSchema } from '../../core/api/api-types';
import { apiProblemInterceptor } from '../../core/api/api.interceptors';
import { FakeSocketServer } from '../../core/realtime/fake-socket.testing';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { flushHelp, settlePage } from '../../core/testing/page.testing';
import ImportPageComponent from './import-page.component';

type Inbox = ApiSchema<'Inbox'>;

const inbox = (overrides: Partial<Inbox> = {}): Inbox => ({
  dir: 'incoming',
  items: [
    { path: 'incoming/a.mp3', size: 5_242_880, modified_at: '2026-10-15T08:00:00Z' },
    { path: 'incoming/jingles/b.wav', size: 900, modified_at: '2026-10-15T08:01:00Z' },
  ],
  more: false,
  ...overrides,
});

interface ImportView {
  form: FormGroup<{
    type_id: FormControl<number | null>;
    playlist_ids: FormControl<number[] | null>;
  }>;
}

describe('import', () => {
  describe('ImportPageComponent', () => {
    let http: HttpTestingController;
    let server: FakeSocketServer;

    beforeEach(() => {
      server = new FakeSocketServer();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([apiProblemInterceptor])),
          provideHttpClientTesting(),
          provideRouter([]),
          server.provider,
          { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      TestBed.inject(RealtimeService).connect();
      server.latest.open();
    });

    afterEach(() => {
      flushHelp(http);
      http.verify();
    });

    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (element) => element.textContent?.trim() === label,
      );

    async function open(list: Inbox = inbox()): Promise<ComponentFixture<unknown>> {
      const fixture = TestBed.createComponent(ImportPageComponent);
      await settlePage();
      http.expectOne('/api/import/inbox').flush(list);
      http.expectOne('/api/playlist-types').flush({
        items: [{ id: 1, code: 'music', name: 'Music' }],
      });
      http.expectOne('/api/playlists').flush({ items: [] });
      await settlePage();
      return fixture;
    }

    function fill(fixture: ComponentFixture<unknown>): ImportView {
      const view = fixture.componentInstance as ImportView;
      view.form.setValue({ type_id: 1, playlist_ids: [4, 5] });
      return view;
    }

    function completed(id: number, summary: string): void {
      server.latest.send({
        type: 'import.completed',
        time: '2026-10-15T08:05:00Z',
        operation_id: id,
        data: { kind: 'import', summary },
      });
    }

    it('lists the files waiting in the inbox', async () => {
      const fixture = await open(inbox({ more: true }));
      const page = fixture.nativeElement as HTMLElement;
      const rows = page.querySelectorAll('tr.mat-mdc-row');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('incoming/a.mp3');
      expect(rows[0].textContent).toContain('5 MB');
      expect(page.textContent).toContain('import.inbox.more');
    });

    it('says where to copy files and keeps Import off while the inbox is empty', async () => {
      const fixture = await open(inbox({ items: [] }));
      fill(fixture);
      await settlePage();
      const page = fixture.nativeElement as HTMLElement;
      expect(page.textContent).toContain('import.inbox.empty');
      expect(button(page, 'import.form.start')?.disabled).toBe(true);
    });

    it('imports with the type and playlists, follows the progress, and reloads the inbox', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      expect(button(page, 'import.form.start')?.disabled).toBe(true);
      fill(fixture);
      await settlePage();

      button(page, 'import.form.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/import' });
      expect(start.request.body).toEqual({ type_id: 1, playlist_ids: [4, 5] });
      start.flush({ operation_id: 31 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'import.form.start')?.disabled).toBe(true);

      server.latest.send({
        type: 'import.progress',
        time: '2026-10-15T08:04:00Z',
        operation_id: 31,
        data: { kind: 'import', done: 1, total: 2, message: '1 of 2 files' },
      });
      await settlePage();
      expect(page.textContent).toContain('1 of 2 files');

      completed(31, '1 imported, 1 duplicate');
      await settlePage();
      http.expectOne('/api/import/inbox').flush(inbox({ items: inbox().items.slice(1) }));
      await settlePage();
      expect(page.textContent).toContain('1 imported, 1 duplicate');
      const link = page.querySelector<HTMLAnchorElement>('a[href*="quality=issues"]');
      expect(link?.getAttribute('href')).toBe('/library?quality=issues');
      expect(page.querySelectorAll('tr.mat-mdc-row')).toHaveLength(1);
    });

    it('reloads the inbox when an import started elsewhere ends', async () => {
      await open();
      completed(40, '2 imported');
      await settlePage();
      http.expectOne('/api/import/inbox').flush(inbox({ items: [] }));
    });

    it('shows a refusal while another media operation runs, and field errors on the control', async () => {
      const fixture = await open();
      const view = fill(fixture);
      const page = fixture.nativeElement as HTMLElement;
      await settlePage();

      button(page, 'import.form.start')?.click();
      http.expectOne({ method: 'POST', url: '/api/import' }).flush(
        {
          status: 409,
          code: 'media_operation_running',
          title: 'Conflict',
          detail: 'An analysis is running.',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settlePage();
      expect(page.querySelector('.form-error')?.textContent).toContain('An analysis is running.');
      expect(button(page, 'import.form.start')?.disabled).toBe(false);

      button(page, 'import.form.start')?.click();
      http.expectOne({ method: 'POST', url: '/api/import' }).flush(
        {
          status: 422,
          code: 'validation_failed',
          title: 'Unprocessable Entity',
          errors: [{ field: 'type_id', code: 'not_found', message: 'No such type.' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await settlePage();
      expect(view.form.controls.type_id.hasError('server')).toBe(true);
    });

    it('analyses every track never analysed', async () => {
      const fixture = await open();
      const page = fixture.nativeElement as HTMLElement;
      button(page, 'import.analyse.start')?.click();
      const start = http.expectOne({ method: 'POST', url: '/api/tracks/analyse' });
      expect(start.request.body).toEqual({});
      start.flush({ operation_id: 32 }, { status: 202, statusText: 'Accepted' });
      await settlePage();
      expect(button(page, 'import.analyse.start')?.disabled).toBe(true);

      server.latest.send({
        type: 'analyse.completed',
        time: '2026-10-15T08:05:00Z',
        operation_id: 32,
        data: { kind: 'analyse', summary: '12 analysed' },
      });
      await settlePage();
      expect(page.textContent).toContain('12 analysed');
      expect(button(page, 'import.analyse.start')?.disabled).toBe(false);
    });
  });
});
