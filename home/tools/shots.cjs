// Screenshots of the homepage at given scroll points, in headless Chrome with the GPU (the film's playwright-core and
// Chrome for Testing). Needs the page served (launch config website-home, port 8802).
// env: DPR (device pixel ratio, default 1), FULL=1 (wait for the full 4.09 M-splat scan), Q (query string)
//   node tools/shots.cjs out_dir WxH story:0.2 story:0.5 hero:0.99 ...
// A mark may carry a name and a script to run first: story:0.97:2500:name=js (the script sees `E`, `m` = engine.js).
// The scene viewer: viewer:<scene|body|ego|captions>:wait scrolls to it and clicks that view (viewer:0 only scrolls);
// its script also sees `V` = window.__viewer(). A position @N is N px below the section's top (@-450: the story's
// end and the viewer both on screen, mid hand-over).
const path = require('path'), os = require('os'), fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../../video/flythrough/node_modules/playwright-core'));
const exe = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const [out, size, ...marks] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: Number(process.env.DPR || 1) });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`http://127.0.0.1:8802/${process.env.Q || ''}`);
  await page.waitForFunction(() => window.__story?.().E?.splat, null, { timeout: 60000 });
  if (process.env.FULL) await page.waitForFunction(() => window.__story().E.full, null, { timeout: 120000 });   // the full scan is in
  await page.waitForTimeout(1500);
  for (const m of marks) {
    const [sec, v, wait, ...rest] = m.split(':');
    const [name, js] = rest.length ? rest.join(':').split(/=(.*)/s) : [null, null];
    if (js) await page.evaluate(async (js) => { const E = window.__story().E, V = window.__viewer?.(), m = await import('./engine.js'); eval(js); }, js);
    const pick = isNaN(Number(v)) && !v.startsWith('@') ? v : null;
    await page.evaluate(([sec, v]) => {
      const el = document.querySelector(`#${sec}`), top = el.getBoundingClientRect().top + scrollY;
      scrollTo({ top: v.startsWith('@') ? top + Number(v.slice(1)) : top + (Number(v) || 0) * (el.offsetHeight - innerHeight), behavior: 'instant' });
      dispatchEvent(new Event('scroll'));
    }, [sec, v]);
    if (pick) { await page.waitForTimeout(400); await page.evaluate((v) => document.querySelector(`#viewer [data-v="${v}"]`).click(), pick); }
    await page.waitForTimeout(Number(wait || 1400));
    await page.screenshot({ path: path.join(out, `${name || `${sec}_${v}`}.jpg`), type: 'jpeg', quality: 82 });
    console.log('shot', sec, v);
  }
  await browser.close();
})();
