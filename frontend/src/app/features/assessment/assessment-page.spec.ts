import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Locale } from '../../core/models';
import { PcmRecording } from '../../core/recording';
import { TtsService } from '../../core/tts.service';
import { AssessmentPage } from './assessment-page';

const LOCALES: Locale[] = [
  { locale: 'en-US', name: 'English (United States)', voices: [] },
  { locale: 'ru-RU', name: 'Russian (Russia)', voices: [] },
  { locale: 'es-CL', name: 'Spanish (Chile)', voices: [] },
  { locale: 'es-ES', name: 'Spanish (Spain)', voices: [] },
];

const VOICE_CATALOG = {
  enabled: true,
  providers: [{ id: 'azure', label: 'Azure', ok: true, error: null, voice_count: 2 }],
  voices: [
    {
      id: 'azure:en',
      provider: 'azure',
      name: 'Ava',
      locale: 'en-US',
      gender: 'female',
      locales: ['en-US'],
      multilingual: false,
      any_language: false,
      description: '',
    },
    {
      id: 'azure:ru',
      provider: 'azure',
      name: 'Svetlana',
      locale: 'ru-RU',
      gender: 'female',
      locales: ['ru-RU'],
      multilingual: false,
      any_language: false,
      description: '',
    },
  ],
};

const TRANSLATOR_CONFIG = {
  enabled: true,
  provider: 'openai',
  label: 'OpenAI-compatible',
  prompt: 'Translate the following text into <selected-language>.',
  prompt_editable: true,
  language_placeholder: '<selected-language>',
  locale_placeholder: '<selected-locale>',
  max_chars: 5000,
};

describe('AssessmentPage language picker', () => {
  let fixture: ComponentFixture<AssessmentPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssessmentPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AssessmentPage);
    fixture.detectChanges();
    TestBed.tick();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/locales').flush(LOCALES);
    http.expectOne('/api/tts/voices').flush(VOICE_CATALOG);
    http.expectOne('/api/translate/config').flush(TRANSLATOR_CONFIG);
    await fixture.whenStable();
  });

  function localeInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('.locale-field input');
  }

  function openPanel(): void {
    localeInput().dispatchEvent(new Event('focusin', { bubbles: true }));
  }

  function type(text: string): void {
    const input = localeInput();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function optionLabels(): string[] {
    return Array.from(document.querySelectorAll('mat-option')).map(
      (option) => option.textContent?.trim() ?? '',
    );
  }

  it('shows every language sorted by name', async () => {
    openPanel();
    await fixture.whenStable();
    const labels = optionLabels();
    expect(labels.length).toBe(LOCALES.length);
    expect(labels[0]).toContain('English');
    expect(labels[1]).toContain('Russian');
  });

  it('filters the list as the user types', async () => {
    openPanel();
    await fixture.whenStable();
    type('russian');
    await fixture.whenStable();

    const labels = optionLabels();
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain('Russian (Russia)');
  });

  it('model text follows edits to the reference textarea', async () => {
    const page = fixture.componentInstance as any;
    expect(page.modelText()).toContain('quick brown fox');

    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector(
      '.reference-field textarea',
    );
    textarea.value = 'Съешь ещё этих мягких французских булок';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(page.modelText()).toBe('Съешь ещё этих мягких французских булок');
    expect(page.modelText()).not.toContain('fox');
  });

  it('drops synthesized audio when the text or the voice changes', async () => {
    const page = fixture.componentInstance as any;
    const tts = TestBed.inject(TtsService);
    tts.setVoice('azure', 'azure:en');

    const recording = new PcmRecording(16000);
    recording.append(new Int16Array(1600).buffer);
    const clipFor = (text: string) => [
      {
        providerId: 'azure',
        providerLabel: 'Azure',
        voiceId: 'azure:en',
        voiceName: 'Ava',
        text,
        recording,
      },
    ];

    page.synthesized.set(clipFor(page.modelText()));
    expect(page.modelClips().length).toBe(1);

    page.referenceText.set('a completely different sentence');
    await fixture.whenStable();
    expect(page.modelClips()).toEqual([]);

    page.synthesized.set(clipFor(page.modelText()));
    expect(page.modelClips().length).toBe(1);
    tts.setVoice('azure', 'azure:ru');
    await fixture.whenStable();
    expect(page.modelClips()).toEqual([]);
  });

  it('picks a voice for the newly selected language', async () => {
    const page = fixture.componentInstance as any;
    const tts = TestBed.inject(TtsService);
    tts.setVoice('azure', 'azure:en');

    page.onLocaleSelected({ option: { value: { locale: 'ru-RU' } } });
    await fixture.whenStable();

    expect(page.selectedLocale()).toBe('ru-RU');
    expect(tts.selectionFor('azure')).toBe('azure:ru');
  });

  it('matches locale codes and ignores accents/case', async () => {
    openPanel();
    await fixture.whenStable();
    type('es-');
    await fixture.whenStable();

    const labels = optionLabels().join(' ');
    expect(labels).toContain('Spanish (Chile)');
    expect(labels).toContain('Spanish (Spain)');
    expect(labels).not.toContain('Russian');
  });
});
