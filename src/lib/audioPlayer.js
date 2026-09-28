import { base64ToInt16Array, int16ToFloat32 } from "./pcmBase64";

const SAMPLE_RATE = 24000;

/**
 * Gapless PCM16/24kHz playback queue for the agent's spoken replies.
 * flush() is called on interruption (barge-in) to stop instantly.
 */
export class PCMPlayer {
  constructor() {
    this.ctx = null;
    this.nextStartTime = 0;
    this.activeSources = [];
  }

  _ensureContext() {
    if (!this.ctx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextCtor({ sampleRate: SAMPLE_RATE });
      this.nextStartTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  enqueueBase64(base64Chunk) {
    const ctx = this._ensureContext();
    const int16 = base64ToInt16Array(base64Chunk);
    const float32 = int16ToFloat32(int16);
    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(this.nextStartTime, ctx.currentTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };
  }

  /** Stop all queued/playing audio immediately (barge-in / interruption). */
  flush() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources = [];
    if (this.ctx) this.nextStartTime = this.ctx.currentTime;
  }

  close() {
    this.flush();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
