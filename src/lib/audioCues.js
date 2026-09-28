"use client";

/**
 * Short synthesized audio cues so a cook with their hands full (and maybe
 * not looking at the screen) still gets feedback: a clear "logged" beep on
 * every reading, and a distinct, more urgent alert tone when the verdict is
 * amber or red. Generated with the Web Audio API (a couple of oscillators),
 * not audio files — nothing to fetch, nothing to fail to load.
 *
 * One shared AudioContext, created lazily on first use (browsers block audio
 * until a user gesture anyway, and Start Shift is that gesture).
 */
let ctx = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    ctx = new AudioContextCtor();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, startAt, durationSec, { gain = 0.15, type = "sine" } = {}) {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(gain, startAt + 0.01);
  gainNode.gain.linearRampToValueAtTime(0, startAt + durationSec);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/** A short, pleasant two-note chime for any reading successfully logged. */
export function playLogBeep() {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  tone(880, now, 0.09);
  tone(1320, now + 0.09, 0.12);
}

/**
 * A lower, more insistent tone for an amber or red verdict — deliberately
 * different in pitch and rhythm from the log beep so a cook can tell them
 * apart without looking at the screen. Red gets one extra repeat.
 */
export function playAlertTone(severity = "amber") {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const reps = severity === "red" ? 3 : 2;
  for (let i = 0; i < reps; i++) {
    const t = now + i * 0.22;
    tone(330, t, 0.14, { gain: 0.18, type: "square" });
  }
}
