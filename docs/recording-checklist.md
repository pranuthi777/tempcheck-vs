# Recording checklist — read this right before hitting record

Quick reference so the real-mic recording session is fast. Full scene-by-scene
script with VO/captions is in `docs/video-script.md` — this file is just the
"what do I actually say, in what order" cheat sheet plus setup.

## Before you start

- [ ] Open **`https://tempcheck-vsh.vercel.app/`** in a real browser tab (not
      the built-in preview) — full screen or a clean, uncluttered window.
- [ ] Quiet-ish room is fine — you don't need silence, a little real
      background noise actually helps sell "this works in a real kitchen."
- [ ] Have this file open on a second screen/phone so you can read the
      phrases without looking at the camera/screen recorder.
- [ ] Click **Start Shift** once before recording starts, say one throwaway
      test phrase, confirm you see the caption and a dashboard card update —
      then click **End Shift** (or just refresh) and start the real take.
- [ ] Screen recording area: the full browser window is fine. If your
      recorder supports it, a 16:9 crop matches the slide deck.

## Say these phrases, in this exact order, with a normal pause after each
## (wait for the dashboard card + spoken reply to finish before the next one)

1. **"Walk-in cooler, thirty-eight degrees."**
   → expect a **green/safe** card, spoken reply: *"Logged: walk-in cooler,
   38 degrees, safe."*

2. **"Chicken, one fifty-two degrees."**
   → expect a **red** card, spoken reply reads the number back digit-by-digit
   and asks a corrective-action question (continue cooking or discard).
   Answer it out loud, e.g. **"Continue cooking."**

3. **"Chicken, one fifty — no, sorry, one sixty-five degrees."**
   → expect it to log **165**, not 150, as **safe**.

4. **"Quinoa salad, sixty degrees."**
   → expect an **"unknown"** card and a clarifying question back (e.g. "cold
   holding or hot holding?"). You can answer **"cold holding"** or just move
   on — either is fine for the video.

That's the whole spoken part — about 45–60 seconds of talking, with agent
replies it's roughly 90 seconds to 2 minutes of screen time. The rest of the
3-minute video (cold open, the accuracy proof, the architecture beat, the
close) uses the dashboard/docs, not more speech from you.

## After recording

- [ ] Click **Export HACCP PDF** once so the exported PDF is on screen for a
      couple of seconds near the end (matches the "inspector-ready output"
      beat in the script).
- [ ] Save the raw footage and tell me — I'll cut it to the script's timing,
      add captions/VO for the non-speaking segments, and mux the final file.
- [ ] If anything on screen looks off during recording (a card doesn't
      update, an error shows), keep rolling anyway and flag the timestamp —
      that's useful bug info either way, and we can re-take just that part.

## If you want to just wing it instead

Any natural phrasing that includes a location or item name and a number
works — the four beats above are chosen because they're the four scenarios
already verified end-to-end against the live app (see the README's "Real
end-to-end verification" section), not because they're the only ones that
work.
