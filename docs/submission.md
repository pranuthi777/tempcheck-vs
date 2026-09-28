# lablab.ai submission text (draft — copy/paste, edit to taste)

## Title
TempCheck — Voice-Logged Food Safety, Read Back and Proven

## Short description (~1–2 sentences)
Hands-free HACCP temperature logging for restaurant kitchens: cooks call out
readings mid-task, TempCheck checks them against real FDA Food Code limits,
reads back every flagged number out loud before saving it, and exports an
inspector-ready log — built on AssemblyAI's Voice Agent API.

## Tags
`voice-agent` `assemblyai` `food-safety` `haccp` `compliance` `foodtech`
`restaurant-tech` `nextjs` `real-time-stt` `accessibility`

## Long description

**The problem.** Health-code temperature logs are still mostly clipboards and
paper, checked with wet, gloved hands. A misheard or mis-copied number isn't
a UX nitpick here — a 38°F reading logged as 48°F is a real food-safety
failure, and it's invisible until an inspector (or an outbreak) finds it.

**What TempCheck does.** A cook calls out a reading while working —
"walk-in cooler, thirty-eight," "chicken breast, one fifty-two" — and
TempCheck:
1. Logs it via AssemblyAI's Voice Agent API (STT → LLM extracts the
   location/item and number → TTS speaks back).
2. Checks it against a **deterministic FDA Food Code rule engine** — cold
   holding ≤41°F, hot holding ≥135°F, poultry ≥165°F, ground meat ≥155°F,
   whole-muscle meat and fish/seafood/eggs ≥145°F, reheating ≥165°F. This
   rule engine has zero LLM involvement — it's a plain, unit-tested numeric
   comparison, because the safety verdict should never be a language model's
   guess.
3. **Reads the exact number back out loud** and asks for the corrective
   action on anything out of range, so a misheard digit gets caught in the
   same breath, not at the next inspection.
4. Shows a live green/amber/red dashboard and exports an inspector-ready
   HACCP PDF log — timestamped, with the cook's exact words next to every
   reading.

**Why this is a good fit for AssemblyAI specifically.** The whole safety
case rests on how well the Voice Agent API's turn detection, tool-calling,
and STT accuracy hold up in a noisy, hands-busy environment — which is
exactly what Universal-Streaming's low-latency, semantic+acoustic
endpointing and keyterm biasing are built for. We didn't just call the API;
we built a 270-clip noisy-kitchen test harness that runs real audio through
AssemblyAI's real transcription API and measures actual number-capture
accuracy (see `docs/accuracy.md` — method disclosed before the result, no
invented numbers).

**Business value.** Every restaurant with a health inspection is required to
keep temperature logs; most do it on paper, after the fact, from memory.
TempCheck turns that into a hands-free, real-time, provably-checked habit —
and the exported PDF is what an inspector already expects to see.

**Originality.** Of ~280 hackathon submissions, none target food safety —
most build general-purpose copilots, dispatch/fraud agents, or interview
coaches. TempCheck is narrow on purpose: one workflow, done with enough
rigor (deterministic rules, mandatory readback, measured accuracy) that it
could plausibly go into a real kitchen.

## Submission checklist
- [ ] Title, short/long description, tags (above)
- [ ] Cover image: `assets/cover.png`
- [ ] Demo video (≤3 min, AI voiceover + captions)
- [ ] Slide deck (PDF)
- [ ] Public GitHub repo: https://github.com/pranuthi777/tempcheck-vs
- [ ] Live demo URL: _pending Vercel fix_
- [ ] Demo platform: Web (Next.js on Vercel)
