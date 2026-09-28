#!/usr/bin/env python3
"""
Generates the noisy-kitchen test set for measuring real number-capture
accuracy against AssemblyAI's STT.

Method (disclosed honestly in docs/accuracy.md, not hidden):
  - Speech: espeak-ng (offline TTS), 3 voice variants (rate/pitch) per
    phrase to simulate different speakers, NOT real human recordings.
  - Noise: procedurally synthesized "kitchen-like" ambience (broadband
    hiss + low hum + random percussive clangs), NOT a real field
    recording, mixed at 3 target SNRs: clean, moderate, heavy.
  - This produces a real, reproducible, honestly-labeled test set. It is
    not a substitute for real kitchen recordings, and the README/docs say
    so explicitly.

Output: test-audio/<id>_<voice>_<noise>.wav + test-audio/manifest.json
"""
import json
import subprocess
import os
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "test-audio")
TARGET_SR = 16000

VOICES = [
    {"name": "v1", "rate": 150, "pitch": 45},
    {"name": "v2", "rate": 175, "pitch": 55},
    {"name": "v3", "rate": 135, "pitch": 35},
]

NOISE_CONDITIONS = [
    {"name": "clean", "snr_db": None},
    {"name": "moderate", "snr_db": 12},
    {"name": "heavy", "snr_db": 4},
]


def synth_speech(phrase, rate, pitch, out_path):
    subprocess.run(
        ["espeak-ng", "-v", "en-us", "-s", str(rate), "-p", str(pitch), "-w", out_path, phrase],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def load_wav_mono16k(path):
    sr, data = wavfile.read(path)
    if data.dtype != np.int16:
        data = data.astype(np.int16)
    data = data.astype(np.float32) / 32768.0
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != TARGET_SR:
        g = np.gcd(sr, TARGET_SR)
        data = resample_poly(data, TARGET_SR // g, sr // g)
    return data.astype(np.float32)


def synth_kitchen_noise(n_samples, sr, rng):
    """Broadband hiss + 60Hz-ish hum + a few random clangs."""
    hiss = rng.normal(0, 1, n_samples).astype(np.float32)
    # crude low-pass to make it less harsh (moving average)
    kernel = np.ones(5) / 5
    hiss = np.convolve(hiss, kernel, mode="same")

    t = np.arange(n_samples) / sr
    hum = 0.15 * np.sin(2 * np.pi * 60 * t).astype(np.float32)

    clangs = np.zeros(n_samples, dtype=np.float32)
    n_clangs = rng.integers(1, 4)
    for _ in range(n_clangs):
        pos = rng.integers(0, max(1, n_samples - 800))
        burst_len = rng.integers(200, 800)
        burst = rng.normal(0, 1, burst_len).astype(np.float32)
        envelope = np.exp(-np.linspace(0, 8, burst_len)).astype(np.float32)
        clangs[pos : pos + burst_len] += burst * envelope * 2.0

    noise = hiss + hum + clangs
    return noise


def mix_at_snr(speech, noise, snr_db):
    if snr_db is None:
        return speech
    speech_rms = np.sqrt(np.mean(speech**2)) + 1e-9
    noise_rms = np.sqrt(np.mean(noise**2)) + 1e-9
    target_noise_rms = speech_rms / (10 ** (snr_db / 20))
    scaled_noise = noise * (target_noise_rms / noise_rms)
    mixed = speech + scaled_noise
    peak = np.max(np.abs(mixed))
    if peak > 0.99:
        mixed = mixed * (0.99 / peak)
    return mixed


def save_wav(path, data, sr=TARGET_SR):
    int16 = np.clip(data * 32767, -32768, 32767).astype(np.int16)
    wavfile.write(path, sr, int16)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(ROOT, "scripts", "phrases.json")) as f:
        phrases = json.load(f)

    rng = np.random.default_rng(42)
    manifest = []
    tmp_speech = "/tmp/_tc_speech.wav"

    for item in phrases:
        for voice in VOICES:
            synth_speech(item["phrase"], voice["rate"], voice["pitch"], tmp_speech)
            speech = load_wav_mono16k(tmp_speech)
            for noise_cond in NOISE_CONDITIONS:
                noise = synth_kitchen_noise(len(speech), TARGET_SR, rng)
                mixed = mix_at_snr(speech, noise, noise_cond["snr_db"])
                fname = f"{item['id']}_{voice['name']}_{noise_cond['name']}.wav"
                save_wav(os.path.join(OUT_DIR, fname), mixed)
                manifest.append(
                    {
                        "file": fname,
                        "phrase": item["phrase"],
                        "voice": voice["name"],
                        "noise_condition": noise_cond["name"],
                        "snr_db": noise_cond["snr_db"],
                        "expected": {
                            "location": item.get("location"),
                            "food_item": item.get("food_item"),
                            "reading_type": item.get("reading_type"),
                            "temperature_value": item["temperature_value"],
                            "temperature_unit": item["temperature_unit"],
                        },
                        "notes": item.get("notes"),
                    }
                )

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Generated {len(manifest)} test clips from {len(phrases)} phrases x {len(VOICES)} voices x {len(NOISE_CONDITIONS)} noise conditions.")
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
