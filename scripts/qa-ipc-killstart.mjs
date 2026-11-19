import { chromium } from '../runner/node_modules/playwright/index.mjs';
const browser = await chromium.connectOverCDP(process.env.UXPROOF_CDP || 'http://127.0.0.1:9333');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
await page.getByRole('button', { name: /^Сценарии$/ }).click();
await page.locator('#project-url').fill('http://127.0.0.1:4180/');
await page.locator('.run-button', { hasText: 'Запустить аудит' }).click();
await page.locator('.run-button', { hasText: 'Остановить' }).waitFor({ state: 'visible', timeout: 20000 });
console.log('running');
try { await browser.close(); } catch {}
