export interface Voice {
  code: string;
  name: string;
  gender: string;
}

export interface Locale {
  locale: string;
  name: string;
  voices: Voice[];
}

export interface TranslatorConfig {
  enabled: boolean;
  provider: string;
  label: string;
  prompt: string;
  prompt_editable: boolean;
  language_placeholder: string;
  locale_placeholder: string;
  max_chars: number;
}

export interface TtsProvider {
  id: string;
  label: string;
  ok?: boolean;
  error?: string | null;
  voice_count?: number;
  supports_rate?: boolean;
}

export interface TtsVoice {
  id: string;
  provider: string;
  name: string;
  locale: string;
  gender: string;
  locales: string[];
  multilingual: boolean;
  any_language: boolean;
  description: string;
  custom?: boolean;
}

export interface TtsCatalog {
  enabled: boolean;
  allow_custom_voices?: boolean;
  providers: TtsProvider[];
  voices: TtsVoice[];
}

export type AssessmentMode = 'single' | 'continuous';
export type PhonemeAlphabet = 'IPA' | 'SAPI';

export interface AssessmentOptions {
  locale: string;
  referenceText: string;
  mode: AssessmentMode;
  enableProsody: boolean;
  enableMiscue: boolean;
  phonemeAlphabet: PhonemeAlphabet;
  nbestPhonemeCount: number;
}

export type ErrorType =
  | 'None'
  | 'Mispronunciation'
  | 'Omission'
  | 'Insertion'
  | 'UnexpectedBreak'
  | 'MissingBreak'
  | 'Monotone';

export interface NBestPhoneme {
  phoneme: string;
  score: number;
}

export interface PhonemeResult {
  phoneme: string;
  accuracy_score: number | null;
  nbest_phonemes: NBestPhoneme[];
  offset: number;
  duration: number;
}

export interface SyllableResult {
  syllable: string;
  grapheme: string | null;
  accuracy_score: number | null;
  offset: number;
  duration: number;
}

export interface WordResult {
  word: string;
  accuracy_score: number | null;
  error_type: ErrorType;
  offset: number;
  duration: number;
  phonemes: PhonemeResult[];
  syllables: SyllableResult[];
}

export interface Scores {
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  prosody: number | null;
  pronunciation: number | null;
}

export interface PhraseResult {
  text: string;
  scores: Scores;
  words: WordResult[];
}

export interface SummaryResult extends PhraseResult {
  mode: AssessmentMode;
}

export type ServerMessage =
  | { type: 'ready'; mode: AssessmentMode; locale: string }
  | { type: 'recognizing'; text: string }
  | ({ type: 'phrase' } & PhraseResult)
  | ({ type: 'summary' } & SummaryResult)
  | { type: 'error'; message: string }
  | { type: 'done' };
