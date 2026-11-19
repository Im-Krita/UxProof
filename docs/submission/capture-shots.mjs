import { chromium } from 'file:///D:/projests/UXProof/runner/node_modules/playwright/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
const browser = await chromium.launch({ headless: true });

async function shot(url, file, size, extra) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  if (extra) await extra(page);
  await page.screenshot({ path: path.join(dir, file), type: 'png' });
  await page.close();
}

await shot('http://127.0.0.1:4180/settings', 'live-settings-desktop.png', { width: 1280, height: 800 });
await shot('http://127.0.0.1:4180/settings', 'live-settings-mobile.png', { width: 390, height: 844 });
await shot('http://127.0.0.1:4180/fixed/settings', 'live-fixed-settings-mobile.png', { width: 390, height: 844 });
await shot('http://127.0.0.1:4180/', 'live-home-desktop.png', { width: 1280, height: 800 });

await shot('http://127.0.0.1:1420/', 'ui-editor.png', { width: 1440, height: 900 });
await shot('http://127.0.0.1:1420/', 'ui-editor-narrow.png', { width: 1440, height: 900 }, async (page) => {
  await page.waitForTimeout(800);
});

console.log('ok');
await browser.close();
