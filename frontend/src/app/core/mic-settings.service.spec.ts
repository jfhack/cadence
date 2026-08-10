import { TestBed } from '@angular/core/testing';

import { MicSettingsService } from './mic-settings.service';

describe('MicSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('defaults automatic gain control to off', () => {
    const service = TestBed.inject(MicSettingsService);
    expect(service.processing().autoGainControl).toBe(false);
    expect(service.processing().noiseSuppression).toBe(true);
  });

  it('persists changes and restores them in a new instance', () => {
    TestBed.inject(MicSettingsService).set('autoGainControl', true);
    TestBed.tick();

    TestBed.resetTestingModule();
    expect(TestBed.inject(MicSettingsService).processing().autoGainControl).toBe(true);
  });

  it('only sends constraints the browser actually supports', () => {
    const service = TestBed.inject(MicSettingsService);
    const constraints = service.constraints();
    expect(constraints.channelCount).toBe(1);
    for (const key of ['autoGainControl', 'noiseSuppression', 'echoCancellation'] as const) {
      if (service.supports(key)) {
        expect(constraints[key]).toBe(service.processing()[key]);
      } else {
        expect(key in constraints).toBe(false);
      }
    }
  });

  it('defaults the gain to 0 dB with a unit multiplier', () => {
    const service = TestBed.inject(MicSettingsService);
    expect(service.gainDb()).toBe(0);
    expect(service.gainLinear()).toBeCloseTo(1, 6);
  });

  it('converts dB to a linear multiplier', () => {
    const service = TestBed.inject(MicSettingsService);
    service.setGainDb(6);
    expect(service.gainLinear()).toBeCloseTo(1.995, 3);
    service.setGainDb(-6);
    expect(service.gainLinear()).toBeCloseTo(0.501, 3);
  });

  it('clamps the gain to the allowed range', () => {
    const service = TestBed.inject(MicSettingsService);
    service.setGainDb(999);
    expect(service.gainDb()).toBe(12);
    service.setGainDb(-999);
    expect(service.gainDb()).toBe(-12);
  });

  it('persists the gain alongside the processing switches', () => {
    const first = TestBed.inject(MicSettingsService);
    first.setGainDb(5);
    first.set('noiseSuppression', false);
    TestBed.tick();

    TestBed.resetTestingModule();
    const second = TestBed.inject(MicSettingsService);
    expect(second.gainDb()).toBe(5);
    expect(second.processing().noiseSuppression).toBe(false);
  });

  it('falls back to 0 dB when the stored gain is nonsense', () => {
    localStorage.setItem('cadence.mic', '{"gainDb":"loud"}');
    expect(TestBed.inject(MicSettingsService).gainDb()).toBe(0);

    TestBed.resetTestingModule();
    localStorage.setItem('cadence.mic', '{"gainDb":500}');
    expect(TestBed.inject(MicSettingsService).gainDb()).toBe(12);
  });

  it('ignores corrupted stored settings', () => {
    localStorage.setItem('cadence.mic', '{"autoGainControl":"yes"}');
    expect(TestBed.inject(MicSettingsService).processing().autoGainControl).toBe(false);
  });
});
