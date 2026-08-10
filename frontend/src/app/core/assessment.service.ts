import { Injectable, computed, inject, signal } from '@angular/core';

import { AudioCaptureService } from './audio-capture.service';
import {
  AssessmentOptions,
  PhraseResult,
  ServerMessage,
  SummaryResult,
} from './models';
import { PcmRecording } from './recording';
import { apiBase } from './runtime-config';

export type SessionStatus = 'idle' | 'connecting' | 'recording' | 'processing' | 'done' | 'error';

const TARGET_SAMPLE_RATE = 16000;
const QUIET_INPUT_RMS = 0.02;

@Injectable({ providedIn: 'root' })
export class AssessmentService {
  private readonly audio = inject(AudioCaptureService);

  readonly status = signal<SessionStatus>('idle');
  readonly partialText = signal('');
  readonly phrases = signal<PhraseResult[]>([]);
  readonly summary = signal<SummaryResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly elapsedMs = signal(0);
  readonly level = this.audio.level;
  readonly clipping = this.audio.clipping;
  readonly recording = signal<PcmRecording | null>(null);
  readonly lastOptions = signal<AssessmentOptions | null>(null);
  readonly quietInput = signal(false);

  readonly busy = computed(() =>
    ['connecting', 'recording', 'processing'].includes(this.status()),
  );

  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private currentRecording: PcmRecording | null = null;

  async start(options: AssessmentOptions): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.reset();
    this.lastOptions.set(options);
    this.status.set('connecting');

    const url = this.socketUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.fail(`Could not connect to ${url}`);
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', sampleRate: TARGET_SAMPLE_RATE, ...options }));
    };
    ws.onmessage = (event) => {
      void this.handleMessage(JSON.parse(event.data) as ServerMessage);
    };
    ws.onerror = () => {
      if (this.busy()) {
        this.fail('The connection to the server failed.');
      }
    };
    ws.onclose = () => {
      if (this.busy()) {
        this.fail('The connection closed unexpectedly.');
      }
    };
  }

  stop(): void {
    if (this.status() !== 'recording') {
      return;
    }
    this.status.set('processing');
    this.stopTimer();
    void this.audio.stop().then(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      }
    });
  }

  async cancel(): Promise<void> {
    this.stopTimer();
    await this.audio.stop();
    this.closeSocket();
    this.status.set('idle');
  }

  private async handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.currentRecording = new PcmRecording(TARGET_SAMPLE_RATE);
        try {
          await this.audio.start(TARGET_SAMPLE_RATE, (chunk) => {
            this.currentRecording?.append(chunk);
            if (this.ws?.readyState === WebSocket.OPEN && this.busy()) {
              this.ws.send(chunk);
            }
          });
        } catch {
          this.fail('Microphone access was denied.');
          this.closeSocket();
          return;
        }
        this.status.set('recording');
        this.startTimer();
        break;
      case 'recognizing':
        this.partialText.set(message.text);
        break;
      case 'phrase':
        this.partialText.set('');
        this.phrases.update((list) => [
          ...list,
          { text: message.text, scores: message.scores, words: message.words },
        ]);
        break;
      case 'summary':
        this.summary.set(message);
        break;
      case 'error':
        this.error.set(message.message);
        break;
      case 'done':
        this.stopTimer();
        await this.audio.stop();
        this.closeSocket();
        this.partialText.set('');
        this.publishRecording();
        this.status.set(this.summary() ? 'done' : 'error');
        break;
    }
  }

  private socketUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}${apiBase()}/ws/assess`;
  }

  private fail(message: string): void {
    this.error.set(message);
    this.stopTimer();
    this.closeSocket();
    void this.audio.stop().then(() => this.publishRecording());
    this.status.set('error');
  }

  private publishRecording(): void {
    if (this.currentRecording && !this.currentRecording.empty) {
      this.recording.set(this.currentRecording);
      this.quietInput.set(this.audio.peakLevel() < QUIET_INPUT_RMS);
    }
    this.currentRecording = null;
  }

  private reset(): void {
    this.partialText.set('');
    this.phrases.set([]);
    this.summary.set(null);
    this.error.set(null);
    this.elapsedMs.set(0);
    this.recording.set(null);
    this.quietInput.set(false);
    this.currentRecording = null;
  }

  private startTimer(): void {
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      this.elapsedMs.set(Date.now() - this.startedAt);
    }, 250);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
