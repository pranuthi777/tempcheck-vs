# scripts/

Dev-only tooling, not part of the deployed app (kept out of `dependencies`/
`devDependencies` so Vercel builds stay lean).

- **`generate_test_audio.py`** — regenerates `public/test-audio/`. Requires
  `espeak-ng` (`apt-get install espeak-ng`) and `numpy`/`scipy`.
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
