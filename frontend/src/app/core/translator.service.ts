import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { TranslatorConfig } from './models';
import { PreferencesService } from './preferences.service';
import { persistOnChange } from './persist';

const PROMPT_KEY = 'cadence.translatorPrompt';

const EMPTY: TranslatorConfig = {
  enabled: false,
  provider: '',
  label: '',
  prompt: '',
  prompt_editable: false,
  language_placeholder: '<selected-language>',
  locale_placeholder: '<selected-locale>',
  max_chars: 5000,
};

@Injectable({ providedIn: 'root' })
export class TranslatorService {
  private readonly http = inject(HttpClient);
  private readonly prefs = inject(PreferencesService);

  readonly config = httpResource<TranslatorConfig>(() => '/api/translate/config', {
    defaultValue: EMPTY,
  });

  readonly enabled = computed(() => this.config.value().enabled);
  readonly promptEditable = computed(() => this.config.value().prompt_editable);
  readonly languagePlaceholder = computed(() => this.config.value().language_placeholder);
  readonly maxChars = computed(() => this.config.value().max_chars);

  readonly prompt = signal(this.restorePrompt());
  readonly effectivePrompt = computed(() =>
    this.promptEditable() && this.prompt().trim() ? this.prompt() : this.config.value().prompt,
  );
  readonly isPromptCustomized = computed(
    () => this.promptEditable() && this.prompt().trim() !== '' &&
      this.prompt().trim() !== this.config.value().prompt.trim(),
  );

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    persistOnChange(this.prompt, (value) => this.prefs.write('translatorPrompt', PROMPT_KEY, value));
    this.prefs.onEnable('translatorPrompt', () =>
      this.prefs.write('translatorPrompt', PROMPT_KEY, this.prompt()),
    );
  }

  resetPrompt(): void {
    this.prompt.set('');
  }

  async translate(text: string, language: string, locale: string): Promise<string | null> {
    const source = text.trim();
    if (!source || !this.enabled()) {
      return null;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const body: Record<string, string> = { text: source, language, locale };
      if (this.promptEditable() && this.prompt().trim()) {
        body['prompt'] = this.prompt().trim();
      }
      const response = await firstValueFrom(
        this.http.post<{ translation: string }>('/api/translate', body),
      );
      return response.translation;
    } catch {
      this.error.set('Could not translate that text. Check the server logs.');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private restorePrompt(): string {
    const stored = this.prefs.read<string>('translatorPrompt', PROMPT_KEY);
    return typeof stored === 'string' ? stored : '';
  }
}
