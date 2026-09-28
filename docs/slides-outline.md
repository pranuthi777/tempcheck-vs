# Slide deck outline (→ PDF)

1. **Title** — TempCheck: Voice-Logged Food Safety, Read Back and Proven.
   AssemblyAI Voice Agent Hackathon. Cover image.
2. **The problem** — paper HACCP logs, wet gloves, a misheard 38→48 is a
   real safety failure, not a UX nitpick. One stat: FDA requires temp
   logging at every US food establishment; most is still paper/after-the-fact.
3. **The idea** — hands-free, real-time, voice-native logging with a
   mandatory spoken readback for anything flagged.
4. **How it works** — the mermaid sequence diagram from the README
   (cook → browser → AssemblyAI Voice Agent → rule engine → readback →
   dashboard/PDF).
5. **Why the rule engine is separate from the LLM** — safety verdicts are
   deterministic, unit-tested, zero hallucination risk. Show one test case
   (38 vs 48).
6. **Deep AssemblyAI usage** — Voice Agent API (STT+LLM+TTS+tool-calling)
   for the live app; Universal-Streaming/transcription API for the
   270-clip accuracy harness. Not a thin wrapper — two integrations.
7. **Measured accuracy** — the real number from docs/accuracy.md, method
   disclosed, by noise condition. (Fill in after the harness runs.)
8. **Live demo** — screenshot of the dashboard mid-shift (green/amber/red)
   + the exported HACCP PDF.
9. **Business value** — every restaurant needs this log; turns a paper
   chore into a real-time, provable habit.
10. **Originality** — one of ~280 submissions, none targeting food safety.
11. **What's next** — cooling-curve time tracking, persistent multi-shift
    storage, phone/SIP deployment for kitchens without a browser open.
12. **Links** — GitHub, live demo, video.
