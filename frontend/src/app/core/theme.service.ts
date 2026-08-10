import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'cadence.theme';
const MODES: ThemeMode[] = ['system', 'light', 'dark'];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.restore());

  private readonly media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly effectiveScheme = computed<'light' | 'dark'>(() => {
    const mode = this.mode();
    return mode === 'system' ? (this.systemDark() ? 'dark' : 'light') : mode;
  });

  constructor() {
    this.media?.addEventListener('change', (event) => this.systemDark.set(event.matches));
    effect(() => this.apply(this.mode()));
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  private restore(): ThemeMode {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      return stored !== null && MODES.includes(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  private apply(mode: ThemeMode): void {
    document.body.classList.toggle('theme-light', mode === 'light');
    document.body.classList.toggle('theme-dark', mode === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }
}
