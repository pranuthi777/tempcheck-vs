import { int16BufferToBase64 } from "./pcmBase64";

const SAMPLE_RATE = 24000;

/**
 * Captures the microphone, resamples to 24kHz PCM16 via an AudioWorklet,
 * and calls onChunk(base64String) for every ~audio frame.
 * Returns a stop() function.
 */
export async function startMicCapture(onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule("/pcm-processor.js");

  const source = ctx.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(ctx, "pcm-processor");
  workletNode.port.onmessage = (event) => {
    onChunk(int16BufferToBase64(event.data));
  };
  source.connect(workletNode);
  // Worklet needs a destination in the graph to keep running in some browsers;
  // route through a silent gain node instead of speakers.
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  workletNode.connect(silentGain);
  silentGain.connect(ctx.destination);

  function stop() {
    try {
      workletNode.disconnect();
      source.disconnect();
      silentGain.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  }

  return stop;
}
