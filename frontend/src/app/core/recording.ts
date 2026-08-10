export interface WavePeak {
  min: number;
  max: number;
}

export class PcmRecording {
  private readonly chunks: Int16Array<ArrayBuffer>[] = [];
  private cache: Int16Array<ArrayBuffer> | null = null;

  constructor(readonly sampleRate: number) {}

  append(chunk: ArrayBuffer): void {
    this.chunks.push(new Int16Array(chunk));
    this.cache = null;
  }

  get sampleCount(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  get durationSeconds(): number {
    return this.sampleCount / this.sampleRate;
  }

  get empty(): boolean {
    return this.sampleCount === 0;
  }

  samples(): Int16Array<ArrayBuffer> {
    if (this.cache === null) {
      const all = new Int16Array(this.sampleCount);
      let offset = 0;
      for (const chunk of this.chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      this.cache = all;
    }
    return this.cache;
  }

  peaks(buckets: number): WavePeak[] {
    const data = this.samples();
    const result: WavePeak[] = [];
    if (buckets <= 0 || data.length === 0) {
      return result;
    }
    const size = data.length / buckets;
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * size);
      const end = Math.min(Math.floor((i + 1) * size), data.length);
      let min = 0;
      let max = 0;
      for (let j = start; j < end; j++) {
        const value = data[j];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      result.push({ min: min / 0x8000, max: max / 0x8000 });
    }
    return result;
  }

  toWavBlob(startSec?: number, endSec?: number): Blob {
    const all = this.samples();
    let data: Int16Array<ArrayBuffer> = all;
    if (startSec !== undefined || endSec !== undefined) {
      const clampIndex = (seconds: number) =>
        Math.min(Math.max(Math.round(seconds * this.sampleRate), 0), all.length);
      const from = clampIndex(startSec ?? 0);
      const to = Math.max(clampIndex(endSec ?? this.durationSeconds), from);
      data = all.subarray(from, to);
    }
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeTag = (offset: number, tag: string) => {
      for (let i = 0; i < tag.length; i++) {
        view.setUint8(offset + i, tag.charCodeAt(i));
      }
    };
    writeTag(0, 'RIFF');
    view.setUint32(4, 36 + data.length * 2, true);
    writeTag(8, 'WAVE');
    writeTag(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // pcm
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, this.sampleRate, true); // sample rate
    view.setUint32(28, this.sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeTag(36, 'data');
    view.setUint32(40, data.length * 2, true);
    return new Blob([header, data], { type: 'audio/wav' });
  }
}
