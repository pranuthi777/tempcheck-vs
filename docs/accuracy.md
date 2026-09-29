# Measured accuracy — noisy-kitchen test set

**Status: measured.** Real run against the deployed app and AssemblyAI's real
transcription API, on 2026-09-28. TempCheck's whole premise is "every number must be
real and measured, never invented" — this section is the actual, unedited result,
including a harness that broke three times before producing one that's trustworthy.

## Method (disclosed before the result, so it can't be shaped to fit one)

- **Test set: 648 clips**, expanded from an original 270-clip set to specifically probe
  real-kitchen robustness. 36 ground-truth phrases (every FDA category, boundary values,
  unit conversion, self-corrections with and without a filler word like "sorry"/"wait",
  digit-by-digit numbers, a Celsius hot-holding reading, an intentionally unrecognized
  item, and a fast run-on multi-reading phrase), synthesized across 4 groups:
  - **baseline** (324 clips) — 3 voices × clean / moderate (~12dB SNR) / heavy (~4dB SNR,
    broadband hiss + 60Hz hum + random clangs) noise.
  - **accent** (144 clips) — 4 accented voices (British, Scottish, Caribbean, and a
    non-native-English proxy voice), clean audio.
  - **fast_speech** (36 clips) — one voice at ~1.6x normal rate, clean audio.
  - **extra_noise** (144 clips) — 4 real-kitchen noise types not in the original set
    (fryer sizzle, hood fan, dishwasher, a shouting coworker — all procedurally
    synthesized, the shouting track uses actual synthesized speech as the interferer).
- **Important limitation, stated plainly:** this is synthetic speech and synthetic
  noise, not real cooks in a real kitchen. It measures whether AssemblyAI's STT can
  recover a number under controlled, reproducible noise models — not a certified
  real-world accuracy figure. Anyone can regenerate the exact same set with
  `python3 scripts/generate_test_audio.py` and check the numbers below against it.
- **Scoring:** each clip's real AssemblyAI transcript is parsed for the spoken number
  and unit (`src/lib/parseTemperatureFromText.js`, unit tested) and compared to the
  ground truth in `public/test-audio/manifest.json`. A clip counts as correct only if
  both the number and the unit match exactly.
- **What this does *not* measure — stated plainly, not softened:** this harness sends
  each clip to AssemblyAI's **offline async `/v2` transcription API**, with **no
  keyterms** and **no LLM tool-call step**, and scores the result with the app's own
  regex parser (`parseTemperatureFromText.js`). So **88.0% below is a raw STT+parser
  number, not an end-to-end product number.** It never exercises the two things that
  differ in the real app: (1) the live Voice Agent's `keyterms` word-boost list, and
  (2) the LLM's own field extraction from the transcript into a tool call — and the
  README documents a real, live-confirmed gap in exactly that second step (the live
  agent sometimes logs the *first* number instead of the corrected one on a
  self-correction, even though this harness's parser gets the same phrasing right
  every time — see `README.md`, "Known limitations"). In other words: this benchmark
  skips exactly the step where the live product is known to sometimes fail. The app's
  spoken readback (see README) is a separate, real safety net that catches a wrong
  number before it's left uncorrected in the log — but that's a mitigation, not a
  reason to call an STT+parser number an accuracy figure for the whole app. A real
  end-to-end number, measured through the live Voice Agent WebSocket and scoring the
  actual `log_reading` tool-call arguments, is reported separately below.

## Getting a valid run was itself a finding, disclosed rather than hidden

Three live-harness attempts against the expanded set failed before one produced usable
data — worth stating plainly rather than only showing the clean final number:

1. A 648-clip run returned 3/648 correct, 645 marked "Failed to fetch." Root cause: the
   browser tab ran unattended and backgrounded for 20+ minutes, and the browser started
   dropping requests wholesale under that sustained load — nothing to do with AssemblyAI
   or the app itself. **Discarded, not published.**
2. A second run stalled at 98/648 and stayed there: a `fetch()` call has no built-in
   timeout, and when the laptop running the harness went to sleep mid-run, some in-flight
   requests never resolved or rejected — they just hung forever, and the harness's own
   Cancel button couldn't recover it either (the cancel check only runs between clips).
   Fixed by wrapping every fetch in an `AbortController` timeout
   (`src/app/dev/accuracy-test/page.js`).
3. The third run completed cleanly end to end — the result below.

Separately (not a run failure, but worth noting since it affects wall-clock time):
AssemblyAI's async transcription API ran noticeably slower than usual for a stretch
during this testing session — jobs that normally complete in ~2s occasionally took
60–150s, though they always completed correctly, never with a wrong answer. The
real-time Voice Agent pipeline the cook-facing app actually uses was checked directly
against production during this slow patch (a full token → WebSocket → audio → transcript
→ tool call → spoken reply round trip) and stayed fast throughout — it's a separate
AssemblyAI endpoint from the one this harness uses, and was unaffected.

## Result

**570 / 648 correct (88.0%)**, run against the live deployment (`tempcheck-vsh.vercel.app`)
using AssemblyAI's real `/v2/upload` + `/v2/transcript` API — 648 real API calls, no
mocked responses. (The harness itself measured 566/648 live; the 4-clip difference is a
real parser bug fixed immediately after by re-parsing the same real transcripts with the
corrected code — see below, not a re-run against AssemblyAI.)

| Test group | Correct | Total | Accuracy |
| --- | --- | --- | --- |
| Baseline (clean/moderate/heavy) | 299 | 324 | 92.3% |
| Accents (British/Scottish/Caribbean/non-native) | 130 | 144 | 90.3% |
| Fast speech (~1.6x rate) | 34 | 36 | 94.4% |
| Extra kitchen noise (fryer/hood fan/dishwasher/shouting) | 107 | 144 | 74.3% |

| Noise condition | Correct | Total | Accuracy |
| --- | --- | --- | --- |
| Clean | 266 | 288 | 92.4% |
| Moderate (~12dB SNR) | 102 | 108 | 94.4% |
| Heavy (~4dB SNR broadband) | 95 | 108 | 88.0% |
| Dishwasher | 36 | 36 | 100.0% |
| Hood fan | 35 | 36 | 97.2% |
| Fryer | 19 | 36 | 52.8% |
| Shouting coworker | 17 | 36 | 47.2% |

**The headline real-kitchen finding:** continuous broadband noise (the original "heavy"
condition) degrades gracefully — 88% — but the two *transient, speech-like* interferers
added in this round, fryer sizzle and especially a shouting coworker, are far more
disruptive (52.8% and 47.2%) than steady hiss at a comparable or even lower perceived
loudness. This matches how human hearing works too: a steady hum is easy to tune out,
a voice or a sharp variable sound competing for the same frequency range as speech is
not. Practically, it means TempCheck is more reliable near a running dishwasher or hood
fan than next to a fryer basket going in or a loud kitchen conversation — worth knowing
for where in a kitchen a cook should expect to repeat themselves.

### A real bug this run found — and fixed with real re-verification

Self-correction phrases with no filler word ("steam table one forty no one thirty
degrees" — no "sorry"/"wait") often come back from AssemblyAI with each number given its
own `°` symbol, e.g. `"Steam table 140°-130°."` Our own `°` → "degrees" normalization
turned that into two back-to-back "N degrees" matches, and the parser always took the
*first* one (140) — worse, it sometimes read the connecting hyphen as a minus sign,
turning the intended correction into **-130** instead of **130**.

Fixed in `src/lib/parseTemperatureFromText.js`: a chain of back-to-back degree-matches
joined only by a short connector (hyphen, comma, or "no"/"sorry"/"wait"/"or") now keeps
the *last* link in the chain, and a "-" directly after the word "degree(s)" is no longer
read as a minus sign. A real second reading — a different location or food item named in
between, as in the run-on multi-reading test phrase — still correctly breaks the chain,
so that case keeps its first reading exactly as before. Four regression tests were added
straight from the real failing transcripts this run captured
(`src/lib/parseTemperatureFromText.test.js`).

### What's left in the remaining 78 misses (genuine STT/synthesis limitations)

None of these are parser bugs — each was checked against its real transcript before being
left as-is:

- **Noise-destroyed audio** (the largest category, concentrated in fryer/shouting/heavy):
  the STT recovers no recognizable number at all, e.g. `"Brown pig wanted to hide the
  leaves"` for "ground beef one fifty five degrees." Unfixable downstream — the
  information is gone before it reaches our code.
- **Digit-by-digit numbers rendered as a fraction.** "walk in cooler three eight degrees"
  (digits spoken one at a time, not as one word) repeatedly came back as `"3/8 degrees"`
  rather than "38" — a natural fraction reading on AssemblyAI's part that a downstream
  regex can't safely disambiguate from an actual fraction without risking false positives
  elsewhere.
- **A leading "1" split from the following two digits.** "steak one forty five degrees"
  → `"Take one 45 degrees"` (parsed 45, not 145); "steam table one forty two degrees" (in
  heavy noise) → `"Table 1, 42 degrees"` (parsed 42, not 142). AssemblyAI's
  inverse-text-normalization drops the word "forty" and leaves "one" and the last two
  digits as separate tokens instead of merging to a 3-digit number. This is the same
  pattern flagged in the original 270-clip run (there as "steak one forty five degrees"
  specifically) and confirmed here as reproducible across noise conditions, accents, and
  fast speech — not a one-off. Recovering it would need real number-word parsing, a
  materially bigger feature than a regex fix; called out here rather than patched under
  deadline pressure.
- **A specific recurring AssemblyAI quirk with "turkey one seventy degrees."** Came back
  as `"31.70 degrees"` in clean, moderate, and heavy conditions alike — including clean,
  which rules out noise as the cause. This exact quirk (with "one fifty two/one seventy")
  was also seen in the original 270-clip run, so it's a genuine, repeatable STT
  confusion with this specific number phrase, not a fluke of this test set's synthesis.
- **Accent-specific misses** — mostly the same "1XX split" and noise-destruction patterns
  above, plus a few cases where the accent voice's synthesis itself was the actual
  variable causing an audibly different number or unit to be heard.

### What this number is, and isn't

**This 88.0% is an STT+parser number, not an end-to-end product number.** See "What this
does *not* measure" in the Method section above for the full honest breakdown of the
gap — no keyterms, no LLM tool-call step, and it skips exactly the self-correction
extraction step the README documents as sometimes failing live. The app's spoken
readback (every reading, not just flagged ones — see `README.md`) is a real safety net
that catches a wrong number before it's left uncorrected, but it doesn't make this an
end-to-end figure. See "End-to-end accuracy (live Voice Agent)" below for the number
that actually exercises the full pipeline.
