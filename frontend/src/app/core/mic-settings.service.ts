import { Injectable, computed, effect, signal } from '@angular/core';

export interface MicProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export type MicProcessingKey = keyof MicProcessing;

const STORAGE_KEY = 'cadence.mic';

const DEFAULTS: MicProcessing = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

export const MIN_GAIN_DB = -12;
export const MAX_GAIN_DB = 12;
const DEFAULT_GAIN_DB = 0;

@Injectable({ providedIn: 'root' })
export class MicSettingsService {
  readonly processing = signal<MicProcessing>(this.restore());

  readonly gainDb = signal(this.restoreGain());

  readonly gainLinear = computed(() => 10 ** (this.gainDb() / 20));

  private readonly supported: Partial<Record<MicProcessingKey, boolean>> =
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};

  constructor() {
    effect(() => this.persist(this.processing(), this.gainDb()));
  }

  setGainDb(value: number): void {
    const clamped = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, Math.round(value)));
    this.gainDb.set(Number.isFinite(clamped) ? clamped : DEFAULT_GAIN_DB);
  }

  resetGain(): void {
    this.gainDb.set(DEFAULT_GAIN_DB);
  }

  supports(key: MicProcessingKey): boolean {
    return this.supported[key] === true;
  }

  set(key: MicProcessingKey, value: boolean): void {
    this.processing.update((current) => ({ ...current, [key]: value }));
  }

  reset(): void {
    this.processing.set({ ...DEFAULTS });
    this.resetGain();
  }

  constraints(): MediaTrackConstraints {
    const current = this.processing();
    const audio: MediaTrackConstraints = { channelCount: 1 };
    for (const key of Object.keys(DEFAULTS) as MicProcessingKey[]) {
      if (this.supports(key)) {
        audio[key] = current[key];
      }
    }
    return audio;
  }

  private restore(): MicProcessing {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULTS };
      }
      const parsed = JSON.parse(raw) as Partial<MicProcessing>;
      const merged = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as MicProcessingKey[]) {
        if (typeof parsed[key] === 'boolean') {
          merged[key] = parsed[key];
        }
      }
      return merged;
    } catch {
      return { ...DEFAULTS };
    }
  }

  private restoreGain(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { gainDb?: unknown }) : null;
      const stored = parsed?.gainDb;
      if (typeof stored !== 'number' || !Number.isFinite(stored)) {
        return DEFAULT_GAIN_DB;
      }
      return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, stored));
    } catch {
      return DEFAULT_GAIN_DB;
    }
  }

  private persist(processing: MicProcessing, gainDb: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...processing, gainDb }));
    } catch {}
  }
}
