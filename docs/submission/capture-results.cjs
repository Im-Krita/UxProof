const { chromium } = require('D:/projests/UXProof/runner/node_modules/playwright');
const path = require('path');
const dir = path.join(__dirname, 'assets');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 25000 });
  await page.getByRole('button', { name: /История/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator('text=5/9').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(dir, 'ui-results.png'), type: 'png' });
  const defect = page.locator('text=Увидеть подтверждение сохранения').first();
  if (await defect.count()) {
    await defect.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(dir, 'ui-issue-modal.png'), type: 'png' });
  }
  await browser.close();
  console.log('results ok');
})().catch((e) => { console.error(e); process.exit(1); });
