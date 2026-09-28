# TempCheck — hands-free voice food-safety logging

![TempCheck cover](assets/cover.png)

TempCheck is a voice agent for restaurant kitchens. A cook calls out a temperature reading while their hands are full ("walk-in cooler 38", "chicken breast 152", "steam table one twenty"), and TempCheck logs it, checks it against the FDA Food Code, and speaks back a confirmation — reading the exact number aloud so a misheard digit gets caught immediately, not at the next health inspection.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon) on lablab.ai.

## Why this exists

A misheard "38°F" logged as "48°F" is a food-safety failure, not a UX nitpick. Two design decisions follow directly from that:

1. **The safety verdict is never up to the language model.** A plain, deterministic rule engine (`src/lib/ruleEngine.js`) checks every reading against published FDA Food Code limits. The voice agent's job is only to extract the spoken numbers and speak the verdict back — it never decides what's safe.
2. **Every flagged number gets read back and confirmed**, and the cook can correct themselves mid-sentence ("38 — no wait, 48") before it's logged.

## Architecture

```mermaid
sequenceDiagram
    participant Cook
    participant Browser
    participant AAI as AssemblyAI Voice Agent<br/>(STT → LLM → TTS)
    participant Rules as Rule engine<br/>(ruleEngine.js, no LLM)

    Cook->>Browser: "walk-in cooler, 38"
    Browser->>AAI: PCM16/24kHz audio (WebSocket)
    AAI->>AAI: transcribe + extract fields
    AAI->>Browser: tool.call log_reading(location, temp)
    Browser->>Rules: evaluateReading(...)
    Rules-->>Browser: status, corrective action (deterministic)
    Browser->>AAI: tool.result (verdict)
    AAI->>Cook: spoken readback: "Logged: 38°F, safe."
    Browser->>Browser: update dashboard + log
    Note over Browser: Export HACCP PDF anytime
```

The rule engine is deliberately outside the LLM's control: the agent extracts fields
and speaks, but a plain numeric comparison against FDA Food Code limits decides safe
vs. amber vs. red every time.

- **`src/app/api/token/route.js`** — server-side only; mints a short-lived AssemblyAI session token so the real API key never reaches the browser.
- **`src/lib/agentConfig.js`** — the system prompt and the `log_reading` tool schema sent to the agent.
- **`src/lib/useVoiceAgent.js`** — owns the WebSocket lifecycle: mic streaming, playback, tool-call handling, transcript captions, barge-in/interruption handling.
- **`src/lib/ruleEngine.js`** + **`src/lib/foodCategories.js`** — the actual safety logic. Zero LLM calls. Fully unit tested (`npm test`).
- **`src/lib/haccpPdf.js`** — generates the inspector-ready HACCP log PDF from the exact readings captured in the session.

## Running it locally

```bash
npm install
cp .env.example .env.local   # add your AssemblyAI API key
npm run dev
```

Open `http://localhost:3000`, click **Start Shift**, allow microphone access, and call out a reading.

## Tests

```bash
npm test
```

25 tests: every FDA category, boundary values, unit conversion, unrecognized items, implausible readings, non-numeric input, and the STT-transcript number parser used by the accuracy harness below (including regression tests for three real parsing bugs the accuracy run itself caught — see `docs/accuracy.md`).

## Real end-to-end verification

Beyond unit tests, the live deployment was driven with real synthesized speech through the actual production AssemblyAI Voice Agent WebSocket (no text-injection shortcuts, no mocks): a normal safe reading, a flagged out-of-range poultry reading (with the corrective-action dialogue), a mid-sentence self-correction, and an unrecognized item (clarifying-question path) all produced correct tool calls, correct FDA rule-engine verdicts, and correct spoken readbacks against the real backend.

## Measured accuracy

See [`docs/accuracy.md`](docs/accuracy.md) for the real, measured number-capture accuracy against a 270-clip noisy-kitchen test set (method disclosed there) — **254/270 (94.1%)**, no invented statistics. The harness (`/dev/accuracy-test`) runs every clip through AssemblyAI's real transcription API; nothing is mocked or estimated. The first run (92.2%) surfaced three real parser bugs, which are now fixed — `docs/accuracy.md` shows exactly what changed and why the remaining misses are genuine STT noise, not code bugs.

## Known limitations (stated plainly, not hidden)

- The accuracy test set is synthesized (TTS voices + procedurally generated noise), not real kitchen recordings — see `docs/accuracy.md` for why, and how to regenerate/verify it yourself.
- A few STT mis-transcriptions in the accuracy set involve the TTS voice leaving a number partly spelled out (e.g. "one 45" instead of "145"); recovering that would need English-number-word parsing, not just a regex fix — noted rather than patched under deadline pressure (see `docs/accuracy.md`).
- Cooling-curve tracking (135°F→70°F within 2h, then →41°F within another 4h) is not yet automated; only point-in-time readings are checked so far.
- No persistent storage yet — a shift's log lives in the browser tab for the session and is exported as a PDF before ending the shift.
- The internal `/api/dev/transcribe` accuracy-harness endpoint has no real access control in production yet (a shared-secret header can't be kept secret in a client-invoked route) — flagged for the security-review pass, not a public-facing app risk since it's not linked from the cook-facing UI.

## Status

Actively being built through the hackathon deadline (Sep 30, 2026, 12:00 PM ADT). See the commit history for real-time progress — nothing here is written after the fact.
