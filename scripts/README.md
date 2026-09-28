# scripts/

Dev-only tooling, not part of the deployed app (kept out of `dependencies`/
`devDependencies` so Vercel builds stay lean).

- **`generate_test_audio.py`** — regenerates `public/test-audio/` (currently
  648 clips across 4 test groups — baseline noise/voice matrix, accents,
  fast speech, and extra real-kitchen noise types — see `docs/accuracy.md`).
  Requires `espeak-ng` (`apt-get install espeak-ng`) and `numpy`/`scipy` for
  the baseline voices and noise synthesis. The accent matrix's non-native
  (German-accented English) voice additionally needs the `mbrola` engine and
  its `de2` voice data: `apt-get install -y mbrola mbrola-de2` (this is a
  separate download from `espeak-ng` itself — the plain `en-gb`/`en-029`/
  `en-gb-scotland` accent voices used for British/Caribbean/Scottish don't
  need it, only the mbrola-based one does).
- **`cover.html`** + rendering the cover image — requires `playwright`
  installed ad hoc (`npm install --no-save playwright`), then:

  ```bash
  node -e "
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto('file://' + process.cwd() + '/scripts/cover.html');
    await page.screenshot({ path: 'assets/cover.png' });
    await browser.close();
  })();
  "
  ```

- **`slides.html`** — the 12-slide submission deck (`docs/slides-outline.md` as
  HTML/CSS, real numbers filled in from `docs/accuracy.md`). Rendered to
  `assets/slides.pdf` the same ad-hoc way, using `page.pdf()` instead of
  `page.screenshot()` at a 1280x720 (16:9) page size:

  ```bash
  node -e "
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('file://' + process.cwd() + '/scripts/slides.html', { waitUntil: 'networkidle' });
    await page.pdf({ path: 'assets/slides.pdf', width: '1280px', height: '720px', printBackground: true, margin: { top:0, bottom:0, left:0, right:0 } });
    await browser.close();
  })();
  "
  ```
