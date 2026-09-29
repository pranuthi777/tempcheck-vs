# Slide deck outline (→ PDF, rendered from scripts/slides.html)

1. **Title** — TempCheck: Voice-Logged Food Safety, Read Back and Proven.
   AssemblyAI Voice Agent Hackathon.
2. **The problem** — paper HACCP logs, wet gloves, a misheard 38→48 is a
   real safety failure, not a UX nitpick.
3. **The idea** — hands-free, real-time, voice-native logging with a
   mandatory spoken readback and mid-sentence self-correction handling.
4. **How it works** — the mermaid sequence diagram from the README
   (cook → browser → AssemblyAI Voice Agent → rule engine → readback →
   dashboard/PDF).
5. **Why the rule engine is separate from the LLM** — safety verdicts are
   deterministic, unit-tested (39 tests), zero hallucination risk, plus the
   two-stage cooling curve (FDA 3-501.14(A)).
6. **Deep AssemblyAI usage** — Voice Agent API (STT+LLM+TTS+tool-calling)
   for the live app and the no-mic demo mode; async transcription API for
   the 648-clip accuracy harness. Not a thin wrapper — two integrations.
7. **Measured accuracy** — 570/648 (88.0%), method disclosed in
   docs/accuracy.md, by test group and by noise condition, with the
   fryer/shouting-coworker finding as the headline.
8. **Real-kitchen hands-free stack** — push-to-talk, big display mode,
   audio cues, more FDA categories, cooling curve, FDA citations on every
   verdict.
9. **Inspector-ready output + manager view** — PDF violations section with
   spoken evidence, date/station filters, manager summary + missed-check
   reminder + mark-resolved workflow.
10. **Live demo** — screenshot of the dashboard mid-shift (green/amber/red),
    figures taken from a real live-verified run.
11. **First 60 seconds for a judge** — the "Try Demo" no-mic mode, playing
    a sample clip through the real pipeline end to end.
12. **Business value & originality** — every restaurant needs this log,
    and it's a narrow angle vs. the gallery's mostly general-purpose
    copilots and dispatch/interview agents.
13. **Known limitations** — stated plainly: synthesized test set, harder
    STT accuracy on transient noise, cooling-curve pairing simplification,
    single-device shift storage.
14. **Links** — GitHub, live demo (with a pointer to the Try Demo button),
    docs/accuracy.md.
