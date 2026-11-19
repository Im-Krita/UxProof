const { chromium } = require('D:/projests/UXProof/runner/node_modules/playwright');
const path = require('path');

const dir = path.join(__dirname, 'assets');

(async () => {
  const browser = await chromium.launch({ headless: true });
  async function shot(url, file, size, extra) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    if (extra) await extra(page);
    await page.screenshot({ path: path.join(dir, file), type: 'png' });
    await page.close();
  }
  await shot('http://127.0.0.1:4180/settings', 'live-settings-desktop.png', { width: 1280, height: 800 });
  await shot('http://127.0.0.1:4180/settings', 'live-settings-mobile.png', { width: 390, height: 844 });
  await shot('http://127.0.0.1:4180/fixed/settings', 'live-fixed-settings-mobile.png', { width: 390, height: 844 });
  await shot('http://127.0.0.1:4180/', 'live-home-desktop.png', { width: 1280, height: 800 });
  await shot('http://127.0.0.1:1420/', 'ui-editor.png', { width: 1440, height: 900 }, async (page) => {
    await page.waitForSelector('text=Запустить аудит', { timeout: 15000 });
    await page.waitForTimeout(400);
  });
  await shot('http://127.0.0.1:1420/', 'ui-history.png', { width: 1440, height: 900 }, async (page) => {
    await page.waitForSelector('text=Запустить аудит', { timeout: 15000 });
    const hist = page.getByRole('button', { name: /История/i });
    if (await hist.count()) await hist.first().click();
    await page.waitForTimeout(600);
  });
  console.log('ok');
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
