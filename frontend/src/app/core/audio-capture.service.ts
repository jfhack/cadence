import { Injectable, effect, inject, signal } from '@angular/core';

import { MicSettingsService } from './mic-settings.service';

class LinearResampler {
  private remainder = new Float32Array(0);
  private position = 0;

  constructor(
    private readonly inputRate: number,
    private readonly outputRate: number,
  ) {}

  process(input: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) {
      return input;
    }
    const data = new Float32Array(this.remainder.length + input.length);
    data.set(this.remainder);
    data.set(input, this.remainder.length);

    const step = this.inputRate / this.outputRate;
    const output: number[] = [];
    let pos = this.position;
    while (pos + 1 < data.length) {
      const i = Math.floor(pos);
      const t = pos - i;
      output.push(data[i] * (1 - t) + data[i + 1] * t);
      pos += step;
    }
    const keep = Math.max(Math.floor(pos), 0);
    this.remainder = data.slice(keep);
    this.position = pos - keep;
    return Float32Array.from(output);
  }
}

class PcmChunkEncoder {
  private readonly resampler: LinearResampler;
  private pending: number[] = [];

  constructor(
    inputRate: number,
    outputRate: number,
    private readonly chunkSamples: number,
  ) {
    this.resampler = new LinearResampler(inputRate, outputRate);
  }

  push(samples: Float32Array): ArrayBuffer | null {
    const resampled = this.resampler.process(samples);
    for (let i = 0; i < resampled.length; i++) {
      this.pending.push(resampled[i]);
    }
    if (this.pending.length < this.chunkSamples) {
      return null;
    }
    return this.drain(this.pending.splice(0, this.chunkSamples));
  }

  flush(): ArrayBuffer | null {
    if (this.pending.length === 0) {
      return null;
    }
    return this.drain(this.pending.splice(0));
  }

  private drain(samples: number[]): ArrayBuffer {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = Math.round(s * 0x7fff);
    }
    return pcm.buffer;
  }
}

export type AudioChunkHandler = (chunk: ArrayBuffer) => void;

const CLIP_THRESHOLD = 0.99;
const CLIP_HOLD_MS = 1200;

@Injectable({ providedIn: 'root' })
export class AudioCaptureService {
  readonly level = signal(0);
  readonly peakLevel = signal(0);
  readonly clipping = signal(false);

  private readonly micSettings = inject(MicSettingsService);
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private clipTimer: ReturnType<typeof setTimeout> | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private encoder: PcmChunkEncoder | null = null;
  private onChunk: AudioChunkHandler | null = null;
  private lastLevelUpdate = 0;

  constructor() {
    effect(() => {
      const gain = this.micSettings.gainLinear();
      if (this.gainNode && this.context) {
        this.gainNode.gain.setTargetAtTime(gain, this.context.currentTime, 0.02);
      }
    });
  }

  get running(): boolean {
    return this.context !== null;
  }

  async start(targetRate: number, onChunk: AudioChunkHandler): Promise<void> {
    if (this.running) {
      await this.stop();
    }
    this.onChunk = onChunk;
    this.peakLevel.set(0);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: this.micSettings.constraints(),
    });

    try {
      this.context = new AudioContext({ sampleRate: targetRate });
    } catch {
      this.context = new AudioContext();
    }
    await this.context.audioWorklet.addModule('pcm-recorder.worklet.js');
    this.encoder = new PcmChunkEncoder(this.context.sampleRate, targetRate, targetRate / 5);

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, 'pcm-recorder');
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.handleSamples(event.data);
    };
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.micSettings.gainLinear();
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.worklet);
    this.worklet.connect(this.context.destination);
    await this.context.resume();
  }

  async stop(): Promise<void> {
    const finalChunk = this.encoder?.flush() ?? null;
    if (finalChunk && this.onChunk) {
      this.onChunk(finalChunk);
    }
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.gainNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') {
      await this.context.close();
    }
    this.context = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.gainNode = null;
    this.encoder = null;
    this.onChunk = null;
    this.level.set(0);
    if (this.clipTimer !== null) {
      clearTimeout(this.clipTimer);
      this.clipTimer = null;
    }
    this.clipping.set(false);
  }

  private flagClipping(): void {
    this.clipping.set(true);
    if (this.clipTimer !== null) {
      clearTimeout(this.clipTimer);
    }
    this.clipTimer = setTimeout(() => {
      this.clipping.set(false);
      this.clipTimer = null;
    }, CLIP_HOLD_MS);
  }

  private handleSamples(samples: Float32Array): void {
    this.updateLevel(samples);
    const chunk = this.encoder?.push(samples) ?? null;
    if (chunk && this.onChunk) {
      this.onChunk(chunk);
    }
  }

  private updateLevel(samples: Float32Array): void {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      sum += sample * sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    if (peak >= CLIP_THRESHOLD) {
      this.flagClipping();
    }
    const rms = Math.sqrt(sum / samples.length);
    if (rms > this.peakLevel()) {
      this.peakLevel.set(rms);
    }
    const now = performance.now();
    if (now - this.lastLevelUpdate < 100) {
      return;
    }
    this.lastLevelUpdate = now;
    this.level.set(Math.min(1, rms * 4));
  }
}
