import { PcmRecording } from './recording';

const RATE = 16000;

function recordingOfSeconds(seconds: number): PcmRecording {
  const recording = new PcmRecording(RATE);
  const samples = new Int16Array(RATE * seconds);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = i % 100;
  }
  recording.append(samples.buffer);
  return recording;
}

describe('PcmRecording', () => {
  it('exports the whole take as a 44-byte-header WAV', async () => {
    const recording = recordingOfSeconds(2);
    const blob = recording.toWavBlob();
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + RATE * 2 * 2);

    const header = new DataView(await blob.slice(0, 44).arrayBuffer());
    const tag = String.fromCharCode(header.getUint8(0), header.getUint8(1), header.getUint8(2), header.getUint8(3));
    expect(tag).toBe('RIFF');
    expect(header.getUint32(24, true)).toBe(RATE); // sample rate
    expect(header.getUint16(34, true)).toBe(16); // bits per sample
  });

  it('exports only the selected range', () => {
    const recording = recordingOfSeconds(2);
    const blob = recording.toWavBlob(0.5, 1.5);
    expect(blob.size).toBe(44 + RATE * 2);
  });

  it('clamps out-of-bounds ranges', () => {
    const recording = recordingOfSeconds(1);
    const blob = recording.toWavBlob(-5, 99);
    expect(blob.size).toBe(44 + RATE * 2);
  });
});
