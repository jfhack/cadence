class PcmRecorderProcessor extends AudioWorkletProcessor {
  static BATCH_SIZE = 2048;

  constructor() {
    super();
    this.batch = new Float32Array(PcmRecorderProcessor.BATCH_SIZE);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }
    let offset = 0;
    while (offset < channel.length) {
      const room = this.batch.length - this.filled;
      const take = Math.min(room, channel.length - offset);
      this.batch.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.batch.length) {
        this.port.postMessage(this.batch.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor);
