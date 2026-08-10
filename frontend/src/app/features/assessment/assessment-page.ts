import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AssessmentService } from '../../core/assessment.service';
import { LocalesService } from '../../core/locales.service';
import { PlaybackSettingsService, RATE_STEPS } from '../../core/playback-settings.service';
import { PracticeSettingsService } from '../../core/practice-settings.service';
import { PreferencesService, RememberKey } from '../../core/preferences.service';
import { TranslatorService } from '../../core/translator.service';
import {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  MicProcessingKey,
  MicSettingsService,
} from '../../core/mic-settings.service';
import {
  AssessmentMode,
  Locale,
  PhonemeAlphabet,
  PhraseResult,
  SummaryResult,
  WordResult,
} from '../../core/models';
import { ModelClip, TtsService } from '../../core/tts.service';
import { AudioPlayer } from '../../shared/audio-player';
import { LevelMeter } from '../../shared/level-meter';
import { ScoreGauge } from '../../shared/score-gauge';
import { SpeakButton } from '../../shared/speak-button';
import { VoicePicker } from '../../shared/voice-picker';

@Component({
  selector: 'app-assessment-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSliderModule,
    MatMenuModule,
    MatDividerModule,
    AudioPlayer,
    LevelMeter,
    ScoreGauge,
    SpeakButton,
    VoicePicker,
  ],
  templateUrl: './assessment-page.html',
  styleUrl: './assessment-page.scss',
})
export class AssessmentPage {
  private readonly localesService = inject(LocalesService);
  protected readonly session = inject(AssessmentService);
  protected readonly mic = inject(MicSettingsService);
  protected readonly practice = inject(PracticeSettingsService);

  protected readonly micOptions: {
    key: MicProcessingKey;
    label: string;
    hint: string;
  }[] = [
    {
      key: 'autoGainControl',
      label: 'Automatic gain control',
      hint: 'Levels your voice automatically, but ramps the volume down over the first seconds of a take.',
    },
    {
      key: 'noiseSuppression',
      label: 'Noise suppression',
      hint: 'Removes background noise; can also shave quiet consonants.',
    },
    {
      key: 'echoCancellation',
      label: 'Echo cancellation',
      hint: 'Prevents speaker audio from leaking back into the microphone.',
    },
  ];

  protected readonly prefs = inject(PreferencesService);
  protected readonly translator = inject(TranslatorService);

  private readonly allRememberOptions: {
    key: RememberKey;
    label: string;
    hint: string;
    available?: () => boolean;
  }[] = [
    {
      key: 'language',
      label: 'Language',
      hint: 'Reopen with the language you last practiced.',
    },
    {
      key: 'referenceText',
      label: 'Reference text',
      hint: 'Keep your passage between sessions. Turn off if you paste anything private.',
    },
    {
      key: 'sourceText',
      label: 'Text in your language',
      hint: 'Keep what you wrote before translating.',
      available: () => this.translator.enabled(),
    },
    {
      key: 'voices',
      label: 'Voice choices',
      hint: 'Remember the voice picked for each provider.',
    },
    {
      key: 'translatorPrompt',
      label: 'Translation prompt',
      hint: 'Keep your edited prompt.',
      available: () => this.translator.enabled() && this.translator.promptEditable(),
    },
  ];

  protected readonly rememberOptions = computed(() =>
    this.allRememberOptions.filter((option) => option.available?.() ?? true),
  );

  protected readonly rememberSummary = computed(() => {
    const options = this.rememberOptions();
    const on = options.filter((option) => this.prefs.isOn(option.key));
    if (on.length === 0) {
      return 'Nothing remembered';
    }
    if (on.length === options.length) {
      return 'Everything remembered';
    }
    return on.map((option) => option.label).join(' · ');
  });

  protected readonly sourceText = this.practice.sourceText;
  protected readonly showTranslator = signal(this.practice.sourceText().trim().length > 0);

  protected readonly selectedLocaleName = computed(() => {
    const match = this.locales.value().find((item) => item.locale === this.selectedLocale());
    return match?.name ?? this.selectedLocale();
  });

  protected toggleTranslator(): void {
    this.showTranslator.update((open) => !open);
  }

  protected async translateSource(): Promise<void> {
    const translated = await this.translator.translate(
      this.sourceText(),
      this.selectedLocaleName(),
      this.selectedLocale(),
    );
    if (translated) {
      this.referenceText.set(translated);
    }
  }

  protected readonly playback = inject(PlaybackSettingsService);
  protected readonly rateSteps = RATE_STEPS;

  protected formatRate(rate: number): string {
    return `${rate}×`;
  }

  protected readonly ratelessProviders = computed(() =>
    this.tts
      .usableProviders()
      .filter((provider) => provider.supports_rate === false)
      .map((provider) => provider.label),
  );

  protected readonly customProvider = signal('');
  protected readonly customCode = signal('');

  protected addCustomVoice(): void {
    const providerId = this.customProvider() || this.tts.usableProviders()[0]?.id;
    if (providerId && this.tts.addCustomVoice(providerId, this.customCode())) {
      this.customCode.set('');
    }
  }

  protected readonly minGainDb = MIN_GAIN_DB;
  protected readonly maxGainDb = MAX_GAIN_DB;

  protected readonly formatGain = (value: number): string =>
    `${value > 0 ? '+' : ''}${value} dB`;

  protected readonly locales = this.localesService.locales;

  protected readonly localeInput = signal<Locale | string | null>(null);
  protected readonly selectedLocale = this.practice.locale;
  protected readonly localeQuery = signal<string | null>(null);

  protected readonly sortedLocales = computed(() =>
    [...this.locales.value()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected readonly filteredLocales = computed(() => {
    const query = this.normalize(this.localeQuery() ?? '');
    const all = this.sortedLocales();
    if (!query) {
      return all;
    }
    return all.filter(
      (item) =>
        this.normalize(item.name).includes(query) || this.normalize(item.locale).includes(query),
    );
  });

  protected readonly localeName = (value: Locale | string | null): string =>
    typeof value === 'object' && value !== null ? value.name : (value ?? '');

  constructor() {
    effect(() => {
      const all = this.locales.value();
      if (all.length > 0 && this.localeInput() === null) {
        const initial = all.find((item) => item.locale === this.selectedLocale()) ?? all[0];
        this.localeInput.set(initial);
        this.selectedLocale.set(initial.locale);
      }
    });
    effect(() => {
      if (this.tts.voices().length > 0) {
        this.tts.ensureSelectionsFor(this.selectedLocale());
      }
    });
  }

  protected readonly referenceText = this.practice.referenceText;
  protected readonly mode = signal<AssessmentMode>('single');
  protected readonly enableProsody = signal(true);
  protected readonly enableMiscue = signal(true);
  protected readonly phonemeAlphabet = signal<PhonemeAlphabet>('IPA');
  protected readonly nbestPhonemeCount = signal(0);

  protected readonly selectedWord = signal<WordResult | null>(null);
  protected readonly tts = inject(TtsService);

  protected readonly modelText = computed(
    () => this.referenceText().trim() || this.session.summary()?.text?.trim() || '',
  );

  private readonly synthesized = signal<ModelClip[]>([]);

  protected readonly modelClips = computed(() => {
    const text = this.modelText();
    return this.synthesized().filter(
      (clip) => clip.text === text && clip.voiceId === this.tts.selectionFor(clip.providerId),
    );
  });

  protected readonly synthesizingPhrase = computed(() =>
    this.tts.usableProviders().some((p) => this.tts.isPending(p.id, this.modelText())),
  );

  protected readonly voicesSummary = computed(() =>
    this.tts
      .usableProviders()
      .map((provider) => this.tts.selectedVoiceFor(provider.id)?.name ?? provider.label)
      .join(' · '),
  );

  protected readonly statusLabel = computed(() => {
    switch (this.session.status()) {
      case 'idle':
        return 'Ready when you are';
      case 'connecting':
        return 'Connecting…';
      case 'recording':
        return this.mode() === 'single' ? 'Listening (stops after one utterance)' : 'Listening…';
      case 'processing':
        return 'Scoring your pronunciation…';
      case 'done':
        return 'Assessment complete';
      case 'error':
        return 'Something went wrong';
    }
  });

  protected readonly displayResult = computed<SummaryResult | PhraseResult | null>(
    () => this.session.summary(),
  );

  protected readonly downloadText = computed(
    () => this.session.lastOptions()?.referenceText || this.session.summary()?.text || '',
  );

  protected async toggleRecording(): Promise<void> {
    const status = this.session.status();
    if (status === 'recording') {
      this.session.stop();
      return;
    }
    if (status === 'connecting' || status === 'processing') {
      await this.session.cancel();
      return;
    }
    this.selectedWord.set(null);
    await this.session.start({
      locale: this.selectedLocale(),
      referenceText: this.referenceText().trim(),
      mode: this.mode(),
      enableProsody: this.enableProsody(),
      enableMiscue: this.enableMiscue(),
      phonemeAlphabet: this.phonemeAlphabet(),
      nbestPhonemeCount: this.nbestPhonemeCount(),
    });
  }

  protected onLocaleSelected(event: MatAutocompleteSelectedEvent): void {
    const item = event.option.value as Locale;
    this.selectedLocale.set(item.locale);
    this.tts.ensureSelectionsFor(item.locale);
  }

  protected async listenToPhrase(): Promise<void> {
    this.tts.ensureSelectionsFor(this.selectedLocale());
    const clips = await this.tts.synthesizeAll(this.modelText());
    if (clips.length > 0) {
      this.synthesized.set(clips);
    }
  }

  protected async listenWith(providerId: string): Promise<void> {
    this.tts.ensureSelectionsFor(this.selectedLocale());
    const clip = await this.tts.synthesizeOne(providerId, this.modelText());
    if (clip) {
      this.synthesized.update((clips) => [
        ...clips.filter((existing) => existing.providerId !== providerId),
        clip,
      ]);
    }
  }

  protected readonly listenAllLabel = computed(() =>
    this.tts.usableProviders().length === 2 ? 'Both' : 'All voices',
  );

  protected onLocaleTyped(input: HTMLInputElement): void {
    this.localeQuery.set(input.value);
  }

  protected onLocaleClosed(): void {
    this.localeQuery.set(null);
  }

  protected onLocaleFocus(input: HTMLInputElement): void {
    input.select();
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
  }

  protected selectWord(word: WordResult): void {
    this.selectedWord.set(this.selectedWord() === word ? null : word);
  }

  protected wordClass(word: WordResult): string {
    switch (word.error_type) {
      case 'Omission':
        return 'word omission';
      case 'Insertion':
        return 'word insertion';
      case 'Mispronunciation':
        return 'word bad';
      default:
        return `word ${this.scoreClass(word.accuracy_score)}`;
    }
  }

  protected wordTooltip(word: WordResult): string {
    if (word.error_type === 'Omission') {
      return 'Omitted';
    }
    if (word.error_type === 'Insertion') {
      return `Inserted · ${this.formatScore(word.accuracy_score)}`;
    }
    return `Accuracy ${this.formatScore(word.accuracy_score)}`;
  }

  protected scoreClass(score: number | null | undefined): string {
    if (score === null || score === undefined) {
      return 'neutral';
    }
    return score >= 80 ? 'good' : score >= 60 ? 'mid' : 'bad';
  }

  protected phonemeTooltip(phoneme: { nbest_phonemes: { phoneme: string; score: number }[] }): string {
    if (phoneme.nbest_phonemes.length === 0) {
      return '';
    }
    const heard = phoneme.nbest_phonemes
      .map((candidate) => `/${candidate.phoneme}/ ${Math.round(candidate.score)}`)
      .join(', ');
    return `Heard: ${heard}`;
  }

  protected formatScore(score: number | null | undefined): string {
    return score === null || score === undefined ? '-' : `${Math.round(score)}`;
  }

  protected formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  protected recordIcon(): string {
    switch (this.session.status()) {
      case 'recording':
        return 'stop';
      case 'connecting':
      case 'processing':
        return 'close';
      default:
        return 'mic';
    }
  }
}
