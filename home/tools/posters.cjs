// Stills for the highlights cards (assets/hl_<scene>.jpg): each card's first frame, the camera where its slow move
// starts, rendered at 2x with nothing over it (the card draws its caption, shade and controls itself). Needs the page
// served (launch config website-home, port 8802).   node tools/posters.cjs
const path = require('path'), os = require('os');
const { chromium } = require(path.join(__dirname, '../../../video/flythrough/node_modules/playwright-core'));
const exe = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto('http://127.0.0.1:8802/?assist=0');
  await page.addStyleTag({ content: '.hl-live, .hlc-cap, .hlc::after, .hlc-poster { display: none !important; }' });
  await page.waitForFunction(() => window.__viewer?.().cards?.length === 3 && window.__viewer().cards.every((c) => c.rec), null, { timeout: 180000 });
  await page.evaluate(() => scrollTo(0, document.querySelector('#viewer').offsetTop));
  for (let i = 0; i < 3; i++) {
    await page.evaluate((i) => window.__viewer().goCard(i), i);
    await page.waitForFunction((i) => window.__viewer().ci === i, i, { timeout: 20000 });
    await page.evaluate(() => { const V = window.__viewer(); V.pause(); V.seek(0); });
    await page.waitForTimeout(2600);
    const scene = await page.evaluate(() => window.__viewer().cards[window.__viewer().ci].scene);
    await page.locator(`.hlc[data-i="${i}"] .gl-slot`).screenshot({ path: path.join(__dirname, `../assets/hl_${scene}.jpg`), type: 'jpeg', quality: 80 });
    console.log('poster', scene);
  }
  await browser.close();
})();
