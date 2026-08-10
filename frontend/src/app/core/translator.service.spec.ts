import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PreferencesService } from './preferences.service';
import { TranslatorService } from './translator.service';

const SERVER_PROMPT = 'Translate the following text into <selected-language>. Keep the tone';

async function setUp(overrides: Record<string, unknown> = {}): Promise<{
  service: TranslatorService;
  http: HttpTestingController;
}> {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const service = TestBed.inject(TranslatorService);
  TestBed.tick();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/translate/config').flush({
    enabled: true,
    provider: 'openai',
    label: 'OpenAI-compatible',
    prompt: SERVER_PROMPT,
    prompt_editable: false,
    language_placeholder: '<selected-language>',
    locale_placeholder: '<selected-locale>',
    max_chars: 5000,
    ...overrides,
  });
  await Promise.resolve();
  TestBed.tick();
  return { service, http };
}

describe('TranslatorService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('exposes what the server allows', async () => {
    const { service } = await setUp();
    expect(service.enabled()).toBe(true);
    expect(service.promptEditable()).toBe(false);
    expect(service.effectivePrompt()).toBe(SERVER_PROMPT);
  });

  it('sends the language name so the server can fill the placeholder', async () => {
    const { service, http } = await setUp();
    const pending = service.translate('Hola mundo', 'Russian (Russia)', 'ru-RU');

    const request = http.expectOne('/api/translate');
    expect(request.request.body).toEqual({
      text: 'Hola mundo',
      language: 'Russian (Russia)',
      locale: 'ru-RU',
    });
    request.flush({ translation: 'Привет мир' });
    expect(await pending).toBe('Привет мир');
  });

  it('does not send a prompt when editing is disabled', async () => {
    const { service, http } = await setUp();
    service.prompt.set('do something else entirely');

    const pending = service.translate('Hola', 'Russian (Russia)', 'ru-RU');
    const request = http.expectOne('/api/translate');
    expect(request.request.body['prompt']).toBeUndefined();
    request.flush({ translation: 'Привет' });
    await pending;
  });

  it('sends the edited prompt when editing is allowed', async () => {
    const { service, http } = await setUp({ prompt_editable: true });
    service.prompt.set('Translate into <selected-language>, formally');

    const pending = service.translate('Hola', 'Russian (Russia)', 'ru-RU');
    const request = http.expectOne('/api/translate');
    expect(request.request.body['prompt']).toBe('Translate into <selected-language>, formally');
    request.flush({ translation: 'Привет' });
    await pending;
  });

  it('falls back to the server prompt once the override is cleared', async () => {
    const { service } = await setUp({ prompt_editable: true });
    service.prompt.set('mine');
    expect(service.effectivePrompt()).toBe('mine');
    expect(service.isPromptCustomized()).toBe(true);

    service.resetPrompt();
    expect(service.effectivePrompt()).toBe(SERVER_PROMPT);
    expect(service.isPromptCustomized()).toBe(false);
  });

  it('reports a failure instead of throwing', async () => {
    const { service, http } = await setUp();
    const pending = service.translate('Hola', 'Russian (Russia)', 'ru-RU');
    http.expectOne('/api/translate').flush('nope', { status: 502, statusText: 'Bad Gateway' });

    expect(await pending).toBeNull();
    expect(service.error()).toContain('Could not translate');
    expect(service.busy()).toBe(false);
  });

  it('ignores an empty passage without calling the server', async () => {
    const { service, http } = await setUp();
    expect(await service.translate('   ', 'Russian (Russia)', 'ru-RU')).toBeNull();
    http.expectNone('/api/translate');
  });

  it('remembers the edited prompt only while allowed to', async () => {
    const first = await setUp({ prompt_editable: true });
    first.service.prompt.set('remembered prompt');
    TestBed.tick();

    TestBed.resetTestingModule();
    expect((await setUp({ prompt_editable: true })).service.prompt()).toBe('remembered prompt');

    TestBed.inject(PreferencesService).set('translatorPrompt', false);
    TestBed.tick();
    TestBed.resetTestingModule();
    expect((await setUp({ prompt_editable: true })).service.prompt()).toBe('');
  });
});
