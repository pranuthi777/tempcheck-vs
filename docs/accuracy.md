# Measured accuracy — noisy-kitchen test set

**Status: not yet measured.** This file is committed now, before the numbers exist, on
purpose — TempCheck's whole premise is "every number must be real and measured, never
invented." The harness that produces this report is already built and code-complete
(`scripts/generate_test_audio.py`, `/dev/accuracy-test`); it needs a live deployment to
reach AssemblyAI's real transcription API (this dev sandbox's network doesn't reach it —
see the constraint noted in `README.md`). The first real run will replace this section
with the actual result, unedited.

## Method (disclosed before the result, so it can't be shaped to fit one)

- **Test set:** 270 clips — 30 ground-truth phrases (covering every FDA category,
  boundary values, unit conversion, mid-sentence self-corrections, and an intentionally
  unrecognized item) × 3 synthesized voices (espeak-ng, varied rate/pitch) × 3 noise
  conditions (clean, moderate ~12dB SNR, heavy ~4dB SNR kitchen-like noise: broadband
  hiss + 60Hz hum + random clangs, procedurally generated).
- **Important limitation, stated plainly:** this is synthetic speech and synthetic
  noise, not real cooks in a real kitchen. It measures whether AssemblyAI's STT can
  recover a number under a controlled, reproducible noise model — not a certified
  real-world accuracy figure. Anyone can regenerate the exact same set with
  `python3 scripts/generate_test_audio.py` and check the numbers below against it.
- **Scoring:** each clip's real AssemblyAI transcript is parsed for the spoken number
  and unit (`src/lib/parseTemperatureFromText.js`, unit tested) and compared to the
  ground truth in `public/test-audio/manifest.json`. A clip counts as correct only if
  both the number and the unit match exactly.
- **What this does *not* measure:** the app's own safety net. Every flagged reading is
  read back to the cook for confirmation before being logged — so a raw STT miss caught
  at that step is not a safety failure in practice, only an STT accuracy statistic.

## Result

_(to be filled in after the first `/dev/accuracy-test` run against the deployed app)_
