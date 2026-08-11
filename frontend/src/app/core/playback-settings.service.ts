import { Injectable, effect, signal } from '@angular/core';
import { persistOnChange } from './persist';

const STORAGE_KEY = 'cadence.playback';

export const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;

const MIN_RATE = RATE_STEPS[0];
const MAX_RATE = RATE_STEPS[RATE_STEPS.length - 1];

function clamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(MAX_RATE, Math.max(MIN_RATE, value));
}

@Injectable({ providedIn: 'root' })
export class PlaybackSettingsService {
  readonly speechRate = signal(this.restore('speechRate'));
  readonly playbackRate = signal(this.restore('playbackRate'));

  constructor() {
    persistOnChange(
      () => ({ speechRate: this.speechRate(), playbackRate: this.playbackRate() }),
      (value) => this.persist(value),
    );
  }

  setSpeechRate(value: number): void {
    this.speechRate.set(clamp(value) ?? 1);
  }

  setPlaybackRate(value: number): void {
    this.playbackRate.set(clamp(value) ?? 1);
  }

  private restore(key: 'speechRate' | 'playbackRate'): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      return clamp(parsed?.[key]) ?? 1;
    } catch {
      return 1;
    }
  }

  private persist(value: { speechRate: number; playbackRate: number }): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {}
  }
}
