import { TestBed } from '@angular/core/testing';

import { PlaybackSettingsService, RATE_STEPS } from './playback-settings.service';

describe('PlaybackSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function service(): PlaybackSettingsService {
    return TestBed.inject(PlaybackSettingsService);
  }

  it('starts at normal pace', () => {
    expect(service().speechRate()).toBe(1);
    expect(service().playbackRate()).toBe(1);
  });

  it('offers 1x among the steps, so there is always a way back', () => {
    expect(RATE_STEPS).toContain(1);
  });

  it('keeps the two rates independent of each other', () => {
    const settings = service();
    settings.setSpeechRate(0.75);
    expect(settings.playbackRate()).toBe(1);

    settings.setPlaybackRate(1.5);
    expect(settings.speechRate()).toBe(0.75);
  });

  it('clamps out-of-range rates', () => {
    const settings = service();
    settings.setPlaybackRate(99);
    expect(settings.playbackRate()).toBe(RATE_STEPS[RATE_STEPS.length - 1]);
    settings.setPlaybackRate(0.01);
    expect(settings.playbackRate()).toBe(RATE_STEPS[0]);
  });

  it('remembers both rates for the next session', () => {
    const first = service();
    first.setSpeechRate(1.25);
    first.setPlaybackRate(0.75);
    TestBed.tick();

    TestBed.resetTestingModule();
    const second = service();
    expect(second.speechRate()).toBe(1.25);
    expect(second.playbackRate()).toBe(0.75);
  });

  it('falls back to normal pace when storage is unusable', () => {
    localStorage.setItem('cadence.playback', '{not json');
    expect(service().playbackRate()).toBe(1);

    TestBed.resetTestingModule();
    localStorage.setItem('cadence.playback', '{"playbackRate":"fast"}');
    expect(service().playbackRate()).toBe(1);
  });
});
