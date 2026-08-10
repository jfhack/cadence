import { TestBed } from '@angular/core/testing';

import {
  DEFAULT_LOCALE,
  DEFAULT_REFERENCE_TEXT,
  PracticeSettingsService,
} from './practice-settings.service';
import { PreferencesService } from './preferences.service';

describe('PracticeSettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('starts from the defaults with nothing stored', () => {
    const practice = TestBed.inject(PracticeSettingsService);
    expect(practice.locale()).toBe(DEFAULT_LOCALE);
    expect(practice.referenceText()).toBe(DEFAULT_REFERENCE_TEXT);
  });

  it('restores the language and passage in a new session', () => {
    const first = TestBed.inject(PracticeSettingsService);
    first.locale.set('ru-RU');
    TestBed.tick();
    first.referenceText.set('Съешь ещё этих мягких булок');
    TestBed.tick();

    TestBed.resetTestingModule();
    const second = TestBed.inject(PracticeSettingsService);
    expect(second.locale()).toBe('ru-RU');
    expect(second.referenceText()).toBe('Съешь ещё этих мягких булок');
  });

  it('keeps an empty passage, which means unscripted', () => {
    TestBed.inject(PracticeSettingsService).referenceText.set('');
    TestBed.tick();

    TestBed.resetTestingModule();
    expect(TestBed.inject(PracticeSettingsService).referenceText()).toBe('');
  });

  it('does not restore what the user asked it not to remember', () => {
    const first = TestBed.inject(PracticeSettingsService);
    first.locale.set('es-CL');
    TestBed.tick();
    first.referenceText.set('un secreto');
    TestBed.tick();
    TestBed.inject(PreferencesService).set('referenceText', false);
    TestBed.tick();

    TestBed.resetTestingModule();
    const second = TestBed.inject(PracticeSettingsService);
    expect(second.locale()).toBe('es-CL');
    expect(second.referenceText()).toBe('');
  });

  it('stores the passage on screen when the switch is turned back on', () => {
    const practice = TestBed.inject(PracticeSettingsService);
    const prefs = TestBed.inject(PreferencesService);

    practice.referenceText.set('first version');
    TestBed.tick();
    prefs.set('referenceText', false);

    practice.referenceText.set('second version');
    TestBed.tick();
    prefs.set('referenceText', true);
    TestBed.tick();

    TestBed.resetTestingModule();
    expect(TestBed.inject(PracticeSettingsService).referenceText()).toBe('second version');
  });

  it('keeps a passage per language', () => {
    const practice = TestBed.inject(PracticeSettingsService);
    practice.referenceText.set('an english passage');
    TestBed.tick();

    practice.locale.set('ru-RU');
    TestBed.tick();
    expect(practice.referenceText()).toBe('');
    practice.referenceText.set('русский текст');
    TestBed.tick();

    practice.locale.set(DEFAULT_LOCALE);
    TestBed.tick();
    expect(practice.referenceText()).toBe('an english passage');

    practice.locale.set('ru-RU');
    TestBed.tick();
    expect(practice.referenceText()).toBe('русский текст');
  });

  it('rejects a stored locale that is not a locale', () => {
    localStorage.setItem('cadence.locale', '"../../etc/passwd"');
    expect(TestBed.inject(PracticeSettingsService).locale()).toBe(DEFAULT_LOCALE);
  });
});
