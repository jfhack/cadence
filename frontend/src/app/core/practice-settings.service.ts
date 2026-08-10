import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { PreferencesService } from './preferences.service';

const LOCALE_KEY = 'cadence.locale';
const TEXT_KEY = 'cadence.referenceText';
const SOURCE_KEY = 'cadence.sourceText';

export const DEFAULT_LOCALE = 'en-US';
export const DEFAULT_REFERENCE_TEXT = 'The quick brown fox jumps over the lazy dog.';

const MAX_TEXT_CHARS = 5000;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i;

@Injectable({ providedIn: 'root' })
export class PracticeSettingsService {
  private readonly prefs = inject(PreferencesService);

  readonly locale = signal(this.restoreLocale());
  private readonly texts = signal<Record<string, string>>(this.restoreTexts());
  readonly referenceText = signal(this.textFor(this.restoreLocale()));
  readonly sourceText = signal(this.restoreSource());

  private lastLocale = this.locale();

  constructor() {
    effect(() => this.prefs.write('language', LOCALE_KEY, this.locale()));
    effect(() => {
      const locale = this.locale();
      if (locale === this.lastLocale) {
        return;
      }
      this.lastLocale = locale;
      const stored = untracked(this.texts)[locale];
      untracked(() => this.referenceText.set(stored ?? this.defaultTextFor(locale)));
    });
    effect(() => {
      const text = this.referenceText();
      const locale = untracked(this.locale);
      this.texts.update((all) => (all[locale] === text ? all : { ...all, [locale]: text }));
    });
    effect(() => this.prefs.write('referenceText', TEXT_KEY, this.texts()));
    effect(() => this.prefs.write('sourceText', SOURCE_KEY, this.sourceText()));

    this.prefs.onEnable('language', () => this.prefs.write('language', LOCALE_KEY, this.locale()));
    this.prefs.onEnable('referenceText', () =>
      this.prefs.write('referenceText', TEXT_KEY, this.texts()),
    );
    this.prefs.onEnable('sourceText', () =>
      this.prefs.write('sourceText', SOURCE_KEY, this.sourceText()),
    );
  }

  private restoreLocale(): string {
    const stored = this.prefs.read<string>('language', LOCALE_KEY);
    return typeof stored === 'string' && LOCALE_PATTERN.test(stored) ? stored : DEFAULT_LOCALE;
  }

  private restoreSource(): string {
    const stored = this.prefs.read<string>('sourceText', SOURCE_KEY);
    if (typeof stored !== 'string' || stored.length > MAX_TEXT_CHARS) {
      return '';
    }
    return stored;
  }

  private defaultTextFor(locale: string): string {
    return locale === DEFAULT_LOCALE ? DEFAULT_REFERENCE_TEXT : '';
  }

  private textFor(locale: string): string {
    return this.texts()[locale] ?? this.defaultTextFor(locale);
  }

  private restoreTexts(): Record<string, string> {
    const stored = this.prefs.read<Record<string, unknown>>('referenceText', TEXT_KEY);
    if (!stored || typeof stored !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([, text]) => typeof text === 'string' && text.length <= MAX_TEXT_CHARS,
      ),
    ) as Record<string, string>;
  }
}
