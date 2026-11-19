import pw from 'file:///D:/projests/UXProof/runner/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);
console.log('title', await page.title());
const navText = await page.locator('nav.side-nav').innerText();
console.log('nav:', JSON.stringify(navText));
await page.getByRole('button', { name: /История/ }).first().click();
await page.waitForTimeout(2500);
const entries = await page.locator('.history-entry').count();
console.log('history entries:', entries);
const list = await page.locator('.history-entry').allInnerTexts();
console.log(JSON.stringify(list.slice(0, 6), null, 1));
await page.screenshot({ path: 'D:/tmp/probe-history.png' });
await browser.close();
