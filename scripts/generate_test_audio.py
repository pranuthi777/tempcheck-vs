#!/usr/bin/env python3
"""
Generates the noisy-kitchen test set for measuring real number-capture
accuracy against AssemblyAI's STT.

Method (disclosed honestly in docs/accuracy.md, not hidden):
  - Speech: espeak-ng (offline TTS). The baseline matrix uses 3 en-US
    voice variants (rate/pitch) per phrase to simulate different
    speakers; an accent matrix adds 4 real espeak-ng accent voices
    (British, Scottish, Caribbean, and a German-accented-English mbrola
    voice as a non-native-speaker proxy); a fast-rate matrix adds one
    much faster en-US voice. None of this is a real human recording.
  - Noise: procedurally synthesized ambience, NOT a real field recording.
    The baseline matrix uses a generic "hiss + hum + clangs" kitchen
    noise mixed at 3 target SNRs (clean/moderate/heavy). An extra-noise
    matrix adds 4 more specific, still-synthesized profiles (fryer
    sizzle, hood fan, dishwasher, a shouting coworker synthesized via
    espeak-ng) at one representative SNR each.
  - This produces a real, reproducible, honestly-labeled test set. It is
    not a substitute for real kitchen recordings or real accented
    speakers, and the README/docs say so explicitly.

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

# Baseline voices: en-US, varied rate/pitch only (matches the original
# 270-clip run so that result stays comparable).
VOICES = [
    {"name": "v1", "espeak_voice": "en-us", "rate": 150, "pitch": 45},
    {"name": "v2", "espeak_voice": "en-us", "rate": 175, "pitch": 55},
    {"name": "v3", "espeak_voice": "en-us", "rate": 135, "pitch": 35},
]

# Real espeak-ng accent voices (not a rate/pitch trick — genuinely different
# phoneme/accent models). en-german-2 is an mbrola voice that speaks English
# with a German accent — used here as an honest, disclosed proxy for a
# non-native English speaker, not a claim about any real nationality.
ACCENT_VOICES = [
    {"name": "acc-gb", "espeak_voice": "en-gb", "rate": 150, "pitch": 45, "label": "British"},
    {"name": "acc-scot", "espeak_voice": "en-gb-scotland", "rate": 150, "pitch": 45, "label": "Scottish"},
    {"name": "acc-carib", "espeak_voice": "en-029", "rate": 150, "pitch": 45, "label": "Caribbean"},
    {"name": "acc-de", "espeak_voice": "en-german-2", "rate": 150, "pitch": 45, "label": "Non-native (German-accented) English"},
]

# A single much-faster en-US voice, for "cooks talking fast" robustness.
FAST_VOICE = {"name": "fast", "espeak_voice": "en-us", "rate": 230, "pitch": 50}

NOISE_CONDITIONS = [
    {"name": "clean", "snr_db": None},
    {"name": "moderate", "snr_db": 12},
    {"name": "heavy", "snr_db": 4},
]


def synth_speech(phrase, espeak_voice, rate, pitch, out_path):
    subprocess.run(
        ["espeak-ng", "-v", espeak_voice, "-s", str(rate), "-p", str(pitch), "-w", out_path, phrase],
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


def synth_fryer_noise(n_samples, sr, rng):
    """Sizzle/fry: dense, continuous high-frequency crackle (many short,
    random-amplitude bursts layered densely), plus a steady mid hiss under
    it — meant to sound like oil actively frying, not occasional clangs."""
    hiss = rng.normal(0, 0.4, n_samples).astype(np.float32)
    crackle = np.zeros(n_samples, dtype=np.float32)
    n_bursts = n_samples // 60  # dense
    for _ in range(n_bursts):
        pos = rng.integers(0, max(1, n_samples - 40))
        burst_len = rng.integers(10, 40)
        burst = rng.normal(0, 1, burst_len).astype(np.float32)
        envelope = np.exp(-np.linspace(0, 6, burst_len)).astype(np.float32)
        crackle[pos : pos + burst_len] += burst * envelope
    return hiss + 0.8 * crackle


def synth_hood_fan_noise(n_samples, sr, rng):
    """A commercial exhaust hood: a strong, steady low-frequency rumble
    plus broadband air-rush hiss — louder and steadier than the generic
    kitchen hum, deliberately less "textured" than fryer/dishwasher."""
    t = np.arange(n_samples) / sr
    rumble = 0.5 * np.sin(2 * np.pi * 90 * t) + 0.3 * np.sin(2 * np.pi * 140 * t)
    hiss = rng.normal(0, 0.6, n_samples).astype(np.float32)
    kernel = np.ones(9) / 9
    hiss = np.convolve(hiss, kernel, mode="same")
    return rumble.astype(np.float32) + hiss


def synth_dishwasher_noise(n_samples, sr, rng):
    """A rhythmic wash/rinse cycle: broadband noise amplitude-modulated by
    a slow sine (the "swish"), plus a motor hum."""
    t = np.arange(n_samples) / sr
    swish_env = 0.5 + 0.5 * np.sin(2 * np.pi * 0.7 * t)  # ~0.7 Hz wash cycle
    noise = rng.normal(0, 1, n_samples).astype(np.float32)
    kernel = np.ones(7) / 7
    noise = np.convolve(noise, kernel, mode="same")
    hum = 0.2 * np.sin(2 * np.pi * 50 * t)
    return (noise * swish_env).astype(np.float32) + hum.astype(np.float32)


_SHOUT_CACHE = {}


def synth_shouting_noise(n_samples, sr, rng):
    """A coworker shouting something unrelated in the background —
    synthesized speech (espeak-ng), not procedural noise, looped/placed
    under the target phrase. Honest proxy for real cross-talk."""
    shout_phrases = ["order up", "behind you", "table five ready", "hands please", "hot pan coming through"]
    phrase = shout_phrases[rng.integers(0, len(shout_phrases))]
    if phrase not in _SHOUT_CACHE:
        tmp = f"/tmp/_tc_shout_{abs(hash(phrase))}.wav"
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "190", "-p", "70", "-w", tmp, phrase],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        _SHOUT_CACHE[phrase] = load_wav_mono16k(tmp)
    shout = _SHOUT_CACHE[phrase]
    out = np.zeros(n_samples, dtype=np.float32)
    if len(shout) >= n_samples:
        out[:] = shout[:n_samples]
    else:
        pos = rng.integers(0, max(1, n_samples - len(shout)))
        out[pos : pos + len(shout)] += shout
    # A little ambient hiss under the shout so it's not pin-drop silent otherwise.
    out += rng.normal(0, 0.2, n_samples).astype(np.float32)
    return out


EXTRA_NOISE_TYPES = [
    {"name": "fryer", "fn": synth_fryer_noise, "snr_db": 7},
    {"name": "hood_fan", "fn": synth_hood_fan_noise, "snr_db": 7},
    {"name": "dishwasher", "fn": synth_dishwasher_noise, "snr_db": 7},
    {"name": "shouting", "fn": synth_shouting_noise, "snr_db": 5},
]


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


def make_clip(item, voice, noise_name, noise_samples_or_none, snr_db, manifest, tmp_speech, extra_tag=None):
    synth_speech(item["phrase"], voice["espeak_voice"], voice["rate"], voice["pitch"], tmp_speech)
    speech = load_wav_mono16k(tmp_speech)
    noise = noise_samples_or_none(len(speech)) if callable(noise_samples_or_none) else noise_samples_or_none
    mixed = mix_at_snr(speech, noise, snr_db) if noise is not None else speech
    fname = f"{item['id']}_{voice['name']}_{noise_name}.wav"
    save_wav(os.path.join(OUT_DIR, fname), mixed)
    entry = {
        "file": fname,
        "phrase": item["phrase"],
        "voice": voice["name"],
        "noise_condition": noise_name,
        "snr_db": snr_db,
        "expected": {
            "location": item.get("location"),
            "food_item": item.get("food_item"),
            "reading_type": item.get("reading_type"),
            "temperature_value": item["temperature_value"],
            "temperature_unit": item["temperature_unit"],
        },
        "notes": item.get("notes"),
    }
    if extra_tag:
        entry["test_group"] = extra_tag
    if "label" in voice:
        entry["accent_label"] = voice["label"]
    manifest.append(entry)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(ROOT, "scripts", "phrases.json")) as f:
        phrases = json.load(f)

    rng = np.random.default_rng(42)
    manifest = []
    tmp_speech = "/tmp/_tc_speech.wav"

    # 1) Baseline matrix: all phrases x 3 en-US rate/pitch voices x 3 generic
    #    noise levels. Directly comparable to the original 270-clip run.
    for item in phrases:
        for voice in VOICES:
            for noise_cond in NOISE_CONDITIONS:
                make_clip(
                    item, voice, noise_cond["name"],
                    (lambda n, _rng=rng: synth_kitchen_noise(n, TARGET_SR, _rng)) if noise_cond["snr_db"] is not None else None,
                    noise_cond["snr_db"], manifest, tmp_speech, extra_tag="baseline",
                )

    # 2) Accent matrix: all phrases x 4 real accent voices, clean audio only
    #    (isolates accent effect from noise effect).
    for item in phrases:
        for voice in ACCENT_VOICES:
            make_clip(item, voice, "clean", None, None, manifest, tmp_speech, extra_tag="accent")

    # 3) Fast-speech matrix: all phrases x 1 fast-rate voice, clean audio only.
    for item in phrases:
        make_clip(item, FAST_VOICE, "clean", None, None, manifest, tmp_speech, extra_tag="fast_speech")

    # 4) Extra real-kitchen noise types: all phrases x voice v1 x each of the
    #    4 specific noise profiles, at one representative SNR each.
    for item in phrases:
        for noise_type in EXTRA_NOISE_TYPES:
            make_clip(
                item, VOICES[0], noise_type["name"],
                (lambda n, _fn=noise_type["fn"], _rng=rng: _fn(n, TARGET_SR, _rng)),
                noise_type["snr_db"], manifest, tmp_speech, extra_tag="extra_noise",
            )

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    by_group = {}
    for e in manifest:
        by_group[e.get("test_group", "?")] = by_group.get(e.get("test_group", "?"), 0) + 1
    print(f"Generated {len(manifest)} test clips from {len(phrases)} phrases.")
    print("By group:", by_group)
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
