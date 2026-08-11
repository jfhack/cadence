import { Injectable, effect, signal } from '@angular/core';
import { persistOnChange } from './persist';

export type RememberKey =
  | 'language'
  | 'referenceText'
  | 'sourceText'
  | 'voices'
  | 'translatorPrompt';

export const REMEMBER_KEYS: RememberKey[] = [
  'language',
  'referenceText',
  'sourceText',
  'voices',
  'translatorPrompt',
];

const STORAGE_KEY = 'cadence.remember';

const DEFAULTS: Record<RememberKey, boolean> = {
  language: true,
  referenceText: true,
  sourceText: true,
  voices: true,
  translatorPrompt: true,
};

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly remember = signal<Record<RememberKey, boolean>>(this.restore());

  private readonly flushers = new Map<RememberKey, () => void>();

  constructor() {
    persistOnChange(this.remember, (value) => this.persist(value));
  }

  isOn(category: RememberKey): boolean {
    return this.remember()[category];
  }

  set(category: RememberKey, on: boolean): void {
    if (this.isOn(category) === on) {
      return;
    }
    this.remember.update((current) => ({ ...current, [category]: on }));
    if (on) {
      this.flushers.get(category)?.();
    }
  }

  onEnable(category: RememberKey, flush: () => void): void {
    this.flushers.set(category, flush);
  }

  read<T>(category: RememberKey, key: string): T | null {
    if (!this.isOn(category)) {
      return null;
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  write(category: RememberKey, key: string, value: unknown): void {
    if (!this.isOn(category)) {
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  private restore(): Record<RememberKey, boolean> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULTS };
      }
      const parsed = JSON.parse(raw) as Partial<Record<RememberKey, unknown>>;
      const merged = { ...DEFAULTS };
      for (const key of REMEMBER_KEYS) {
        if (typeof parsed[key] === 'boolean') {
          merged[key] = parsed[key];
        }
      }
      return merged;
    } catch {
      return { ...DEFAULTS };
    }
  }

  private persist(value: Record<RememberKey, boolean>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {}
  }
}
