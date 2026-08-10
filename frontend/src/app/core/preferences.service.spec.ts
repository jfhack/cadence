import { TestBed } from '@angular/core/testing';

import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function service(): PreferencesService {
    return TestBed.inject(PreferencesService);
  }

  it('remembers everything by default', () => {
    const prefs = service();
    expect(prefs.isOn('language')).toBe(true);
    expect(prefs.isOn('referenceText')).toBe(true);
    expect(prefs.isOn('voices')).toBe(true);
  });

  it('always persists the switches themselves', () => {
    service().set('referenceText', false);
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem('cadence.remember')!).referenceText).toBe(false);

    TestBed.resetTestingModule();
    expect(service().isOn('referenceText')).toBe(false);
  });

  it('reads and writes only while a category is on', () => {
    const prefs = service();
    prefs.write('language', 'cadence.locale', 'es-CL');
    expect(prefs.read('language', 'cadence.locale')).toBe('es-CL');

    prefs.set('language', false);
    prefs.write('language', 'cadence.locale', 'ru-RU');
    expect(prefs.read('language', 'cadence.locale')).toBeNull();
  });

  it('leaves stored data intact when a category is switched off', () => {
    const prefs = service();
    prefs.write('referenceText', 'cadence.referenceText', 'hello world');

    prefs.set('referenceText', false);

    expect(prefs.read('referenceText', 'cadence.referenceText')).toBeNull();
    expect(localStorage.getItem('cadence.referenceText')).toBe('"hello world"');
  });

  it('overwrites with the current value when a category is switched back on', () => {
    const prefs = service();
    prefs.write('voices', 'cadence.voices', { azure: 'old' });
    prefs.set('voices', false);

    let current = { azure: 'old' };
    prefs.onEnable('voices', () => prefs.write('voices', 'cadence.voices', current));

    current = { azure: 'new' };
    prefs.set('voices', true);

    expect(prefs.read('voices', 'cadence.voices')).toEqual({ azure: 'new' });
  });

  it('does not re-flush when set to the value it already has', () => {
    const prefs = service();
    let flushes = 0;
    prefs.onEnable('voices', () => flushes++);

    prefs.set('voices', true);
    expect(flushes).toBe(0);

    prefs.set('voices', false);
    prefs.set('voices', true);
    expect(flushes).toBe(1);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('cadence.remember', '{oh no');
    expect(service().isOn('voices')).toBe(true);

    TestBed.resetTestingModule();
    localStorage.setItem('cadence.remember', '{"voices":"yes"}');
    expect(service().isOn('voices')).toBe(true);
  });

  it('ignores unreadable stored values', () => {
    const prefs = service();
    localStorage.setItem('cadence.locale', '{not json');
    expect(prefs.read('language', 'cadence.locale')).toBeNull();
  });
});
