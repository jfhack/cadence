import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TtsVoice } from './models';
import { PlaybackSettingsService } from './playback-settings.service';
import { PracticeSettingsService } from './practice-settings.service';
import { TtsService } from './tts.service';

function voice(partial: Partial<TtsVoice> & { id: string; name: string }): TtsVoice {
  return {
    provider: 'azure',
    locale: '',
    gender: '',
    locales: [],
    multilingual: false,
    any_language: false,
    description: '',
    ...partial,
  };
}

const VOICES: TtsVoice[] = [
  voice({ id: 'azure:fr', name: 'Fabrice', locale: 'fr-FR', locales: ['fr-FR'] }),
  voice({ id: 'azure:esES', name: 'Elvira', locale: 'es-ES', locales: ['es-ES'] }),
  voice({ id: 'azure:esCL', name: 'Catalina', locale: 'es-CL', locales: ['es-CL'] }),
  voice({
    id: 'azure:multi',
    name: 'Ava',
    locale: 'en-US',
    locales: ['en-US', 'es-CL', 'fr-FR'],
    multilingual: true,
  }),
  voice({
    id: 'elevenlabs:rachel',
    name: 'Rachel',
    provider: 'elevenlabs',
    any_language: true,
    multilingual: true,
  }),
];

const PROVIDERS = [
  { id: 'azure', label: 'Azure', ok: true, error: null, voice_count: 4 },
  { id: 'elevenlabs', label: 'ElevenLabs', ok: true, error: null, voice_count: 1 },
];

describe('TtsService', () => {
  let service: TtsService;
  let practice: PracticeSettingsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    practice = TestBed.inject(PracticeSettingsService);
    practice.locale.set('es-CL');
    service = TestBed.inject(TtsService);
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/tts/voices')
      .flush({ enabled: true, allow_custom_voices: true, providers: PROVIDERS, voices: VOICES });
    TestBed.tick();
  });

  it('scopes each picker to its own provider', () => {
    expect(service.voicesFor('azure').map((v) => v.name)).toEqual([
      'Fabrice',
      'Elvira',
      'Catalina',
      'Ava',
    ]);
    expect(service.voicesFor('elevenlabs').map((v) => v.name)).toEqual(['Rachel']);
  });

  it('orders by own code: exact, same language, multilingual, then the rest', () => {
    expect(service.sortedFor('azure', 'es-CL').map((v) => v.name)).toEqual([
      'Catalina',
      'Elvira',
      'Ava',
      'Fabrice',
    ]);
  });

  it('keeps voices of other languages out of a locale group', () => {
    const groups = service.groupsFor('azure', 'es-CL');
    const exact = groups.find((g) => g.label === 'Matches es-CL')!;
    expect(exact.voices.map((v) => v.name)).toEqual(['Catalina']);
    expect(groups.find((g) => g.label === 'Multilingual voices')!.voices.map((v) => v.name)).toEqual(
      ['Ava'],
    );
  });

  it('searching a locale re-ranks around it, not around the practiced one', () => {
    const groups = service.groupsFor('azure', 'en-US', 'es-CL');
    expect(groups.map((g) => g.label)).toEqual([
      'Matches es-CL',
      'Same language (es-*)',
      'Multilingual voices',
      'Other languages',
    ]);
    expect(groups[0].voices.map((v) => v.name)).toEqual(['Catalina']);
    expect(groups[1].voices.map((v) => v.name)).toEqual(['Elvira']);
    expect(groups[3].voices.map((v) => v.name)).toEqual(['Fabrice']);
  });

  it('filters by name or description within the provider', () => {
    const found = service.groupsFor('azure', 'es-CL', 'catal').flatMap((g) => g.voices);
    expect(found.map((v) => v.name)).toEqual(['Catalina']);
    expect(service.groupsFor('azure', 'es-CL', 'zzz')).toEqual([]);
  });

  it('gives every provider its own voice for the locale', () => {
    service.ensureSelectionsFor('es-CL');
    expect(service.selectedVoiceFor('azure')?.name).toBe('Catalina');
    expect(service.selectedVoiceFor('elevenlabs')?.name).toBe('Rachel');
  });

  it('keeps each language on its own voice', () => {
    service.setVoice('azure', 'azure:esCL');

    practice.locale.set('fr-FR');
    service.ensureSelectionsFor('fr-FR');
    expect(service.selectionFor('azure')).toBe('azure:fr');

    practice.locale.set('es-CL');
    service.ensureSelectionsFor('es-CL');
    expect(service.selectionFor('azure')).toBe('azure:esCL');
  });

  it('never overrides a choice already made for that language', () => {
    service.setVoice('azure', 'azure:fr');
    service.ensureSelectionsFor('es-CL');
    expect(service.selectionFor('azure')).toBe('azure:fr');

    expect(service.selectionFor('elevenlabs')).toBe('elevenlabs:rachel');
  });

  it('persists the choices keyed by language', () => {
    service.setVoice('azure', 'azure:fr');
    practice.locale.set('ru-RU');
    service.setVoice('azure', 'azure:multi');
    TestBed.tick();

    expect(JSON.parse(localStorage.getItem('cadence.voices')!)).toEqual({
      'es-CL': { azure: 'azure:fr' },
      'ru-RU': { azure: 'azure:multi' },
    });
  });

  it('restores a language choice in a new session', () => {
    service.setVoice('azure', 'azure:fr');
    TestBed.tick();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(PracticeSettingsService).locale.set('es-CL');
    const revived = TestBed.inject(TtsService);
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/tts/voices')
      .flush({ enabled: true, allow_custom_voices: true, providers: PROVIDERS, voices: VOICES });
    TestBed.tick();

    expect(revived.selectionFor('azure')).toBe('azure:fr');
  });

  it('keys the cache by rate, so a new speed re-synthesizes', async () => {
    const playback = TestBed.inject(PlaybackSettingsService);
    const http = TestBed.inject(HttpTestingController);
    service.setVoice('azure', 'azure:esCL');

    const first = service.speak('azure', 'hola');
    const a = http.expectOne('/api/tts/speak');
    expect(a.request.body.rate).toBe(1);
    a.flush(new Blob(['x']));
    await first;

    const cached = service.speak('azure', 'hola');
    http.expectNone('/api/tts/speak');
    await cached;

    playback.setSpeechRate(0.75);
    const slower = service.speak('azure', 'hola');
    const b = http.expectOne('/api/tts/speak');
    expect(b.request.body.rate).toBe(0.75);
    b.flush(new Blob(['y']));
    await slower;
  });

  it('adds a custom voice into its provider group', () => {
    expect(service.addCustomVoice('azure', 'en-US-PrivateNeural')).toBe(true);
    expect(service.voicesFor('azure').some((v) => v.id === 'azure:en-US-PrivateNeural')).toBe(true);

    const groups = service.groupsFor('azure', 'es-CL');
    expect(groups[0].label).toBe('Your voices');
    expect(groups[0].voices.map((v) => v.name)).toEqual(['en-US-PrivateNeural']);
  });

  it('refuses duplicate or blank custom voices', () => {
    expect(service.addCustomVoice('azure', '   ')).toBe(false);
    expect(service.addCustomVoice('azure', 'esCL')).toBe(false);
    service.addCustomVoice('azure', 'mine');
    expect(service.addCustomVoice('azure', 'mine')).toBe(false);
  });

  it('deselects a custom voice when it is removed', () => {
    service.addCustomVoice('azure', 'mine');
    service.setVoice('azure', 'azure:mine');
    expect(service.selectionFor('azure')).toBe('azure:mine');

    service.removeCustomVoice('azure:mine');
    expect(service.selectionFor('azure')).toBeNull();
    expect(service.voicesFor('azure').some((v) => v.custom)).toBe(false);
  });

  it('reports only providers that answered and have voices', () => {
    expect(service.usableProviders().map((p) => p.id)).toEqual(['azure', 'elevenlabs']);
    expect(service.brokenProviders()).toEqual([]);
  });
});

describe('TtsService with a failed provider', () => {
  let service: TtsService;
  let practice: PracticeSettingsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    practice = TestBed.inject(PracticeSettingsService);
    practice.locale.set('es-CL');
    service = TestBed.inject(TtsService);
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/tts/voices')
      .flush({
        enabled: true,
        providers: [
          { id: 'azure', label: 'Azure', ok: true, error: null, voice_count: 1 },
          { id: 'elevenlabs', label: 'ElevenLabs', ok: false, error: 'HTTP 401', voice_count: 0 },
        ],
        voices: [voice({ id: 'azure:a', name: 'Ava', locale: 'en-US', locales: ['en-US'] })],
      });
    TestBed.tick();
  });

  it('hides the broken provider but reports why', () => {
    expect(service.usableProviders().map((p) => p.id)).toEqual(['azure']);
    expect(service.brokenProviders().map((p) => p.error)).toEqual(['HTTP 401']);
  });
});
