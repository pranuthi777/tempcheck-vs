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

/**
 * Demo mode ("try it without a mic"): plays a pre-recorded sample kitchen
 * clip (public/demo/demo-kitchen.mp3, see manifest.json) through the exact
 * same PCM worklet pipeline as a real microphone, so it exercises the real
 * WebSocket/tool-call/rule-engine path end to end — nothing about the app's
 * response is faked or scripted, only the "microphone" input is. The audio
 * is also routed to real speakers so a judge watching can hear the sample
 * dialogue play. Returns a stop() function, and calls onEnded() once
 * playback finishes naturally (so the caller can show a "demo finished"
 * state without the user needing to click anything).
 */
export async function startDemoCapture(onChunk, onEnded) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule("/pcm-processor.js");

  const resp = await fetch("/demo/demo-kitchen.mp3");
  const arrayBuffer = await resp.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;

  const workletNode = new AudioWorkletNode(ctx, "pcm-processor");
  workletNode.port.onmessage = (event) => {
    onChunk(int16BufferToBase64(event.data));
  };
  source.connect(workletNode);
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  workletNode.connect(silentGain);
  silentGain.connect(ctx.destination);

  // Also connect straight to real output so the sample dialogue is audible.
  source.connect(ctx.destination);

  let stopped = false;
  source.onended = () => {
    if (!stopped) onEnded?.();
  };
  source.start();

  function stop() {
    stopped = true;
    try {
      source.stop();
    } catch {
      /* already stopped/ended */
    }
    try {
      workletNode.disconnect();
      source.disconnect();
      silentGain.disconnect();
    } catch {
      /* ignore */
    }
    ctx.close();
  }

  return stop;
}
