import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { FakeAudio, provideFakeAudio } from './core/player/fake-audio.testing';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFakeAudio(new FakeAudio()),
      ],
    }).compileComponents();
  });

  it('renders the shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-shell')).not.toBeNull();
    expect(element.querySelector('main#main-content')).not.toBeNull();
    // Mounted once in the shell, so playback survives navigation; empty until a track is played.
    expect(element.querySelector('app-player-bar')).not.toBeNull();
  });
});
