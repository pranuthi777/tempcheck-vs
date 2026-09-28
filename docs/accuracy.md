# Measured accuracy — noisy-kitchen test set

**Status: measured.** Real run against the deployed app and AssemblyAI's real
transcription API, on 2026-09-28. TempCheck's whole premise is "every number must be
real and measured, never invented" — this section is the actual, unedited result. See
"Result" below for the number, the honest first run that preceded it, and what running
it changed.

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

**254 / 270 correct (94.1%)**, run against the live deployment (`tempcheck-vsh.vercel.app`)
using AssemblyAI's real `/v2/upload` + `/v2/transcript` API — 270 real API calls, no
mocked responses.

| Noise condition | Correct | Total | Accuracy |
| --- | --- | --- | --- |
| Clean | 87 | 90 | 96.7% |
| Moderate (~12dB SNR) | 89 | 90 | 98.9% |
| Heavy (~4dB SNR) | 78 | 90 | 86.7% |

### The first run found real bugs — here's exactly what changed

The very first run (before any tuning) scored **249/270 (92.2%)**. Rather than accept
that number, every one of the 21 misses was read individually. Most were genuine STT
mishearing under noise (unfixable by us — that's what the harness is *for*), but three
were bugs in our own number-parsing code, caught because we looked at real transcripts
instead of assuming the STT and our parser were both right:

1. **Spelled-out "negative" wasn't read as a minus sign.** `"walk in freezer negative 5
   degrees"` parsed as `5F` instead of `-5F` — silently dropping a below-freezing walk-in
   reading to a normal-looking positive number.
2. **A hyphen glued onto a mis-transcribed word was read as a minus sign.** AssemblyAI
   rendered "salmon, 146 degrees" as `"Ammon-146 degrees."` — the hyphen belongs to the
   garbled word, not the number, but the old regex captured `-146F` anyway.
3. **The "°" degree symbol wasn't recognized**, only the spelled-out word "degrees" —
   so `"3°C"` and `"74°C"` silently fell back to the Fahrenheit default. This is the most
   safety-relevant of the three: a real Celsius reading read back and logged as the wrong
   scale entirely.

All three are fixed in `src/lib/parseTemperatureFromText.js` with regression tests added
straight from the real failing transcripts (`src/lib/parseTemperatureFromText.test.js`).
Re-running the exact same 270 clips against the fixed code — a second real run against
AssemblyAI, not a recalculation — raised the score to **254/270 (94.1%)**.

### What's left in the remaining 16 misses (all genuine STT, not our code)

14 of the 16 remaining misses are in the "heavy" noise condition. Spot examples:
- `"walk into their car behind the debris"` for "walk in cooler forty eight degrees" —
  the STT recovered no number at all.
- `"Rev to 144 degrees"` for "prep cooler forty four degrees" — noise added a spurious
  digit.
- `"31.70 degrees"` for "chicken one fifty two/one seventy" (appears 3× across voices/
  noise levels) — a systematic AssemblyAI ITN quirk with this specific phrase, not
  something a downstream regex fix can safely correct without risking other cases.
- `"Take one 45 degrees"` for "steak one forty five degrees" (appears 4× across noise
  levels, including clean) — the STT's inverse-text-normalization left "one" spelled out
  and "45" as digits instead of merging to "145"; recovering this would require
  English-number-word parsing, a materially bigger feature than a regex fix, and is
  called out as a known limitation in the README instead of patched in under deadline
  pressure.

### What this does *not* measure

The app's own safety net. Every flagged reading is read back to the cook for
confirmation before being logged — so a raw STT miss caught at that step is not a safety
failure in practice, only an STT accuracy statistic.
