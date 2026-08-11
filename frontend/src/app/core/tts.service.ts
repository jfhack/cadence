import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { PcmRecording } from './recording';
import { TtsCatalog, TtsVoice } from './models';
import { PlaybackSettingsService } from './playback-settings.service';
import { PracticeSettingsService } from './practice-settings.service';
import { PreferencesService } from './preferences.service';
import { persistOnChange } from './persist';

const EMPTY: TtsCatalog = { enabled: false, providers: [], voices: [] };
const STORAGE_KEY = 'cadence.voices';
const CUSTOM_KEY = 'cadence.customVoices';

export interface ModelClip {
  providerId: string;
  providerLabel: string;
  voiceId: string;
  voiceName: string;
  text: string;
  recording: PcmRecording;
}

function ownLocale(voice: TtsVoice): string {
  return (voice.locale || '').toLowerCase();
}

function relevance(voice: TtsVoice, target: string): number {
  const wanted = target.trim().toLowerCase();
  const code = ownLocale(voice);
  if (wanted && code) {
    if (code === wanted) {
      return 0;
    }
    if (code.split('-')[0] === wanted.split('-')[0]) {
      return 1;
    }
  }
  return voice.multilingual ? 2 : 3;
}

function byCodeThenName(a: TtsVoice, b: TtsVoice): number {
  return ownLocale(a).localeCompare(ownLocale(b)) || a.name.localeCompare(b.name);
}

@Injectable({ providedIn: 'root' })
export class TtsService {
  private readonly http = inject(HttpClient);
  private readonly prefs = inject(PreferencesService);
  private readonly playback = inject(PlaybackSettingsService);
  private readonly practice = inject(PracticeSettingsService);

  readonly catalog = httpResource<TtsCatalog>(() => '/api/tts/voices', { defaultValue: EMPTY });

  readonly enabled = computed(() => this.catalog.value().enabled);
  readonly customVoices = signal<TtsVoice[]>(this.restoreCustom());
  readonly allowCustomVoices = computed(() => this.catalog.value().allow_custom_voices === true);

  readonly voices = computed(() => {
    const listed = this.catalog.value().voices;
    if (!this.allowCustomVoices()) {
      return listed;
    }
    const known = new Set(listed.map((voice) => voice.id));
    return [...this.customVoices().filter((voice) => !known.has(voice.id)), ...listed];
  });
  readonly providers = computed(() => this.catalog.value().providers);

  readonly usableProviders = computed(() =>
    this.providers().filter((p) => p.ok !== false && this.voicesFor(p.id).length > 0),
  );

  readonly brokenProviders = computed(() => this.providers().filter((p) => p.ok === false));

  readonly selections = signal<Record<string, Record<string, string>>>(this.restore());

  private get locale(): string {
    return this.practice.locale();
  }

  private forLocale(): Record<string, string> {
    return this.selections()[this.locale] ?? {};
  }

  private readonly pendingKeys = signal<ReadonlySet<string>>(new Set());
  readonly errors = signal<Record<string, string>>({});

  readonly busy = computed(() => this.pendingKeys().size > 0);

  private readonly cache = new Map<string, Blob>();
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private decodeContext: AudioContext | null = null;

  constructor() {
    persistOnChange(this.selections, (value) => this.persist(value));
    this.prefs.onEnable('voices', () => this.persist(this.selections()));
  }

  voicesFor(providerId: string): TtsVoice[] {
    return this.voices().filter((voice) => voice.provider === providerId);
  }

  voiceById(voiceId: string | null | undefined): TtsVoice | null {
    return this.voices().find((voice) => voice.id === voiceId) ?? null;
  }

  selectionFor(providerId: string): string | null {
    return this.forLocale()[providerId] ?? null;
  }

  selectedVoiceFor(providerId: string): TtsVoice | null {
    return this.voiceById(this.selectionFor(providerId));
  }

  setVoice(providerId: string, voiceId: string): void {
    const locale = this.locale;
    this.selections.update((current) => ({
      ...current,
      [locale]: { ...(current[locale] ?? {}), [providerId]: voiceId },
    }));
  }

  isPending(providerId: string, text: string): boolean {
    return this.pendingKeys().has(this.key(providerId, text));
  }

  sortedFor(providerId: string, locale: string): TtsVoice[] {
    return [...this.voicesFor(providerId)].sort(
      (a, b) => relevance(a, locale) - relevance(b, locale) || byCodeThenName(a, b),
    );
  }

  private isLocaleQuery(providerId: string, needle: string): boolean {
    if (!needle) {
      return false;
    }
    const language = needle.split('-')[0];
    return this.voicesFor(providerId).some((voice) => {
      const code = ownLocale(voice);
      return code !== '' && (code === needle || code.split('-')[0] === language);
    });
  }

  private canonicalLocale(providerId: string, needle: string): string {
    for (const voice of this.voicesFor(providerId)) {
      const all = voice.locales.length ? voice.locales : [voice.locale];
      const hit = all.find((l) => l.toLowerCase() === needle);
      if (hit) {
        return hit;
      }
    }
    return needle;
  }

  groupsFor(
    providerId: string,
    locale: string,
    query = '',
  ): { label: string; voices: TtsVoice[] }[] {
    const needle = query.trim().toLowerCase();
    const byLocale = this.isLocaleQuery(providerId, needle);
    const target = byLocale ? needle : locale;
    const language = target.split('-')[0];
    const shown = byLocale ? this.canonicalLocale(providerId, needle) : target;

    const labels = [
      'Your voices',
      target ? `Matches ${shown}` : 'Best match',
      language ? `Same language (${language}-*)` : 'Same language',
      'Multilingual voices',
      'Other languages',
    ];

    const buckets: TtsVoice[][] = [[], [], [], [], []];
    for (const voice of this.voicesFor(providerId)) {
      if (needle && !byLocale && !this.matches(voice, needle)) {
        continue;
      }
      buckets[voice.custom ? 0 : relevance(voice, target) + 1].push(voice);
    }
    return buckets
      .map((voices, index) => ({ label: labels[index], voices: voices.sort(byCodeThenName) }))
      .filter((group) => group.voices.length > 0);
  }

  private matches(voice: TtsVoice, needle: string): boolean {
    return [voice.name, voice.locale, voice.gender, voice.description, ...voice.locales]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  }

  ensureSelectionsFor(locale: string): void {
    const forLocale = { ...(this.selections()[locale] ?? {}) };
    let changed = false;
    for (const provider of this.providers()) {
      const current = this.voiceById(forLocale[provider.id]);
      if (current?.provider === provider.id) {
        continue;
      }
      const best = this.sortedFor(provider.id, locale)[0];
      if (best && forLocale[provider.id] !== best.id) {
        forLocale[provider.id] = best.id;
        changed = true;
      }
    }
    if (changed) {
      this.selections.update((current) => ({ ...current, [locale]: forLocale }));
    }
  }

  private key(providerId: string, text: string): string {
    return `${providerId}|${text.trim()}`;
  }

  private async synthesize(providerId: string, text: string): Promise<Blob | null> {
    const voiceId = this.selectionFor(providerId);
    const phrase = text.trim();
    if (!voiceId || !phrase) {
      return null;
    }
    const rate = this.playback.speechRate();
    const cacheKey = `${voiceId}|${rate}|${phrase}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pendingKey = this.key(providerId, phrase);
    this.pendingKeys.update((keys) => new Set(keys).add(pendingKey));
    this.errors.update(({ [providerId]: _dropped, ...rest }) => rest);
    try {
      const blob = await firstValueFrom(
        this.http.post(
          '/api/tts/speak',
          { voice: voiceId, text: phrase, rate },
          { responseType: 'blob' },
        ),
      );
      this.cache.set(cacheKey, blob);
      return blob;
    } catch {
      this.errors.update((current) => ({
        ...current,
        [providerId]: 'Could not synthesize that phrase.',
      }));
      return null;
    } finally {
      this.pendingKeys.update((keys) => {
        const next = new Set(keys);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  async speak(providerId: string, text: string): Promise<void> {
    const blob = await this.synthesize(providerId, text);
    if (!blob) {
      return;
    }
    this.stop();
    this.audioUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.audioUrl);
    this.audio.preservesPitch = true;
    this.audio.playbackRate = this.playback.playbackRate();
    try {
      await this.audio.play();
    } catch {
      this.errors.update((current) => ({
        ...current,
        [providerId]: 'Playback was blocked by the browser.',
      }));
    }
  }

  stop(): void {
    this.audio?.pause();
    this.audio = null;
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  async synthesizeAll(text: string): Promise<ModelClip[]> {
    const phrase = text.trim();
    if (!phrase) {
      return [];
    }
    const results = await Promise.all(
      this.usableProviders().map((provider) => this.clipFor(provider.id, provider.label, phrase)),
    );
    return results.filter((clip): clip is ModelClip => clip !== null);
  }

  async synthesizeOne(providerId: string, text: string): Promise<ModelClip | null> {
    const provider = this.usableProviders().find((entry) => entry.id === providerId);
    const phrase = text.trim();
    if (!provider || !phrase) {
      return null;
    }
    return this.clipFor(provider.id, provider.label, phrase);
  }

  private async clipFor(
    providerId: string,
    providerLabel: string,
    text: string,
  ): Promise<ModelClip | null> {
    const voice = this.selectedVoiceFor(providerId);
    const blob = await this.synthesize(providerId, text);
    if (!blob || !voice) {
      return null;
    }
    const recording = await this.toRecording(blob, providerId);
    if (!recording) {
      return null;
    }
    return {
      providerId,
      providerLabel,
      voiceId: voice.id,
      voiceName: voice.name,
      text,
      recording,
    };
  }

  private async toRecording(blob: Blob, providerId: string): Promise<PcmRecording | null> {
    try {
      const decoded = await this.decode(await blob.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const pcm = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        pcm[i] = Math.round(sample * 0x7fff);
      }
      const recording = new PcmRecording(decoded.sampleRate);
      recording.append(pcm.buffer);
      return recording;
    } catch {
      this.errors.update((current) => ({
        ...current,
        [providerId]: 'Could not decode the synthesized audio.',
      }));
      return null;
    }
  }

  private decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decodeContext ??= new AudioContext();
    return this.decodeContext.decodeAudioData(bytes);
  }

  addCustomVoice(providerId: string, code: string, label = ''): boolean {
    const trimmed = code.trim();
    if (!this.allowCustomVoices() || !providerId || !trimmed) {
      return false;
    }
    const id = `${providerId}:${trimmed}`;
    if (this.voices().some((voice) => voice.id === id)) {
      return false;
    }
    const voice: TtsVoice = {
      id,
      provider: providerId,
      name: label.trim() || trimmed,
      locale: '',
      gender: '',
      locales: [],
      multilingual: false,
      any_language: true,
      description: 'custom',
      custom: true,
    };
    this.customVoices.update((current) => [...current, voice]);
    this.persistCustom();
    return true;
  }

  removeCustomVoice(id: string): void {
    this.customVoices.update((current) => current.filter((voice) => voice.id !== id));
    this.persistCustom();
    this.selections.update((current) =>
      Object.fromEntries(
        Object.entries(current).map(([locale, byProvider]) => [
          locale,
          Object.fromEntries(Object.entries(byProvider).filter(([, voiceId]) => voiceId !== id)),
        ]),
      ),
    );
  }

  customVoicesFor(providerId: string): TtsVoice[] {
    return this.customVoices().filter((voice) => voice.provider === providerId);
  }

  private restoreCustom(): TtsVoice[] {
    const stored = this.prefs.read<TtsVoice[]>('voices', CUSTOM_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.filter(
      (voice): voice is TtsVoice =>
        !!voice && typeof voice.id === 'string' && typeof voice.provider === 'string',
    );
  }

  private persistCustom(): void {
    this.prefs.write('voices', CUSTOM_KEY, this.customVoices());
  }

  private restore(): Record<string, Record<string, string>> {
    const parsed = this.prefs.read<Record<string, unknown>>('voices', STORAGE_KEY);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const out: Record<string, Record<string, string>> = {};
    for (const [locale, byProvider] of Object.entries(parsed)) {
      if (!byProvider || typeof byProvider !== 'object') {
        continue;
      }
      out[locale] = Object.fromEntries(
        Object.entries(byProvider as Record<string, unknown>).filter(
          ([, voiceId]) => typeof voiceId === 'string',
        ),
      ) as Record<string, string>;
    }
    return out;
  }

  private persist(selections: Record<string, Record<string, string>>): void {
    this.prefs.write('voices', STORAGE_KEY, selections);
  }
}
