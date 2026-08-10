import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlaybackSettingsService } from '../core/playback-settings.service';
import { PcmRecording } from '../core/recording';
import { AudioPlayer } from './audio-player';

function recording(seconds = 2, rate = 16000): PcmRecording {
  const clip = new PcmRecording(rate);
  clip.append(new Int16Array(rate * seconds).buffer);
  return clip;
}

describe('AudioPlayer speed', () => {
  let fixture: ComponentFixture<AudioPlayer>;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    URL.createObjectURL ??= () => 'blob:stub';
    URL.revokeObjectURL ??= () => undefined;

    await TestBed.configureTestingModule({ imports: [AudioPlayer] }).compileComponents();
    fixture = TestBed.createComponent(AudioPlayer);
    fixture.componentRef.setInput('recording', recording());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function player(): any {
    return fixture.componentInstance as any;
  }

  it('keeps the selection and playhead when the speed changes', async () => {
    const page = player();
    page.selection.set({ start: 0.4, end: 1.2 });
    page.positionSec.set(0.6);
    await fixture.whenStable();

    page.setRate(0.75);
    await fixture.whenStable();

    expect(page.rate()).toBe(0.75);
    expect(page.selection()).toEqual({ start: 0.4, end: 1.2 });
    expect(page.positionSec()).toBe(0.6);
  });

  it('changes speed on the live element, without rebuilding the clip', async () => {
    const page = player();
    const before = page.audio;
    const beforeUrl = page.objectUrl;
    expect(before).toBeTruthy();

    page.setRate(1.25);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(page.audio).toBe(before);
    expect(page.objectUrl).toBe(beforeUrl);
    expect(page.audio.playbackRate).toBe(1.25);
  });

  it('still clears the selection when a different recording arrives', async () => {
    const page = player();
    page.selection.set({ start: 0.4, end: 1.2 });
    await fixture.whenStable();

    fixture.componentRef.setInput('recording', recording(3));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(page.selection()).toBeNull();
  });

  it('does not re-time other players, but does set the default for new ones', async () => {
    const first = player();
    first.setRate(1.5);
    await fixture.whenStable();

    const other = TestBed.createComponent(AudioPlayer);
    other.componentRef.setInput('recording', recording());
    other.detectChanges();
    await other.whenStable();

    expect((other.componentInstance as any).rate()).toBe(1.5);

    (other.componentInstance as any).setRate(0.5);
    await other.whenStable();
    expect(first.rate()).toBe(1.5);
    expect(TestBed.inject(PlaybackSettingsService).playbackRate()).toBe(0.5);
  });
});
