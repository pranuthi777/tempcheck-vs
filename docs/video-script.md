# Demo video script (≤3:00, AI voiceover + captions)

Every beat below is something already verified against the real, live app —
nothing in this script describes behavior we haven't actually seen happen
(see the "Real end-to-end verification" section of the README and
`docs/accuracy.md`). Recording just needs to follow it against the live site.

Voice: calm, plain, a little fast — matches the app's own "be fast and clear,
never chatty" instruction to the agent. No hype adjectives.

---

## 0:00 – 0:12 — Cold open, the problem (cover image / static title card)

**Visual:** `assets/cover.png`, then cut to a phone/clipboard stock-style shot
or simple text card: "Most kitchens still log temperatures on paper."

**VO:** "Every restaurant in the US has to log food temperatures. Most still
do it on a clipboard, with wet gloves, after the fact. A 38 logged as 48
isn't a typo — it's a real food-safety failure."

**Caption:** *Paper HACCP logs miss the moment a reading actually happens.*

## 0:12 – 0:24 — The idea

**Visual:** Live app homepage (`tempcheck-vsh.vercel.app`), dark dashboard,
"Start Shift" button.

**VO:** "TempCheck lets a cook just say the reading out loud. It's built on
AssemblyAI's Voice Agent API — real-time speech, tool-calling, and a voice
that talks back."

**Caption:** *Built on AssemblyAI's Voice Agent API.*

## 0:24 – 0:55 — Scenario 1: a normal safe reading

**Visual:** Click "Start Shift." Speak (or play back the recorded clip):
**"Walk-in cooler, thirty-eight degrees."** Show the live transcript caption
appear, then the dashboard's status board update with a green "safe" card,
and hear/see the agent's spoken reply.

**VO (over the top, brief):** "It logs the reading, checks it against the
real FDA cold-holding limit — 41 degrees or below — and reads the number
back before saving it."

**Caption:** *"Logged: walk-in cooler, 38 degrees, safe."*

## 0:55 – 1:35 — Scenario 2: the flagged case (this is the point of the app)

**Visual:** Speak: **"Chicken, one fifty-two degrees."** Show the dashboard
flip to a red card. Let the agent's full spoken response play out.

**VO:** "Poultry has to reach 165. At 152, that's a violation — and the
agent doesn't just log it quietly. It reads the flagged number back digit by
digit, and asks what to do about it, out loud, before moving on."

**Caption:** *"Logged: chicken, 1-5-2 degrees, red. Continue cooking or
discard — which one?"*

## 1:35 – 1:55 — Scenario 3: the self-correction (why readback matters)

**Visual:** Speak: **"Chicken, one fifty — no, sorry, one sixty-five
degrees."** Show it correctly logs 165, not 150.

**VO:** "Cooks correct themselves mid-sentence all the time. TempCheck uses
only the corrected number — and because it always reads the number back,
a misheard digit gets caught in the same breath, not at the next
inspection."

**Caption:** *Self-correction handled correctly — logs 165, not 150.*

## 1:55 – 2:15 — Scenario 4: unrecognized item

**Visual:** Speak: **"Quinoa salad, sixty degrees."** Show the agent asking
a clarifying question instead of guessing.

**VO:** "If it doesn't recognize the item, it doesn't guess a safety
verdict — it asks."

**Caption:** *Unknown items get a clarifying question, never a guess.*

## 2:15 – 2:35 — The proof (this is the differentiator)

**Visual:** Cut to `docs/accuracy.md` / the accuracy-test page showing
254/270, 94.1%, and the noise-condition breakdown table.

**VO:** "Every number in this demo, and every accuracy stat, was measured —
not estimated. We built a 270-clip noisy-kitchen test set, ran it against
AssemblyAI's real transcription API, and published the real result: 94.1
percent, and exactly what we fixed to get there."

**Caption:** *254/270 correct (94.1%) — real API, real test set, method
disclosed before the result.*

## 2:35 – 2:50 — The safety architecture (quick, technical credibility)

**Visual:** Quick cut to the mermaid architecture diagram in the README, or
a simple on-screen text: "LLM extracts. A separate rule engine decides."

**VO:** "The safety verdict is never the language model's guess — it's a
plain, unit-tested rule engine underneath, checking real FDA limits."

**Caption:** *Deterministic rule engine, 25 automated tests, zero LLM
involvement in the safety verdict.*

## 2:50 – 3:00 — Close

**Visual:** Cover image again, with the live URL and repo link on screen.

**VO:** "TempCheck. Voice-logged food safety, read back and proven."

**Caption:** *tempcheck-vsh.vercel.app · github.com/pranuthi777/tempcheck-vs*

---

## Production notes

- **Screen recording:** capture the live dashboard directly (not a mock),
  driving it with either a real microphone or the four phrases above played
  through the mic input — the same four scenarios already verified end-to-end
  against the production WebSocket (see README).
- **Captions:** burn in the bolded caption line under each scene; they double
  as the literal on-screen proof that nothing here is scripted/faked audio.
- **Voiceover:** any clean TTS voice works — the app's own honesty standard
  is about the *data* (readings, accuracy numbers), not the narration voice.
- **Length check:** the timings above total exactly 3:00; trim scenario 4
  first if it runs long, since scenarios 1–3 and the accuracy proof are the
  parts judges are scored on (Application of Technology, Business Value).
