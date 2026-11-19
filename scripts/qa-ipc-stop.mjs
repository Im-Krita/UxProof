import { chromium } from '../runner/node_modules/playwright/index.mjs';

const browser = await chromium.connectOverCDP(process.env.UXPROOF_CDP || 'http://127.0.0.1:9333');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
if (!page) throw Error('окно не найдено');
const log = m => console.log(m);
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL ' + m); } else log('OK   ' + m); };

await page.getByRole('button', { name: /^Сценарии$/ }).click();
await page.locator('#project-url').fill('http://127.0.0.1:4180/');
await page.locator('.run-button', { hasText: 'Запустить аудит' }).click();
await page.locator('.run-button', { hasText: 'Остановить' }).waitFor({ state: 'visible', timeout: 20000 });
log('run started');
await page.locator('.run-button', { hasText: 'Остановить' }).click();
log('stop clicked');
await page.locator('.run-button', { hasText: 'Запустить аудит' }).waitFor({ state: 'visible', timeout: 60000 });
const body = await page.locator('body').innerText();
ok(/Запустить аудит/.test(body), 'окно живо после остановки, кнопка запуска вернулась');
ok(!/Остановить/.test(body), 'кнопки «Остановить» нет');
log('after-stop: ' + body.split('\n').filter(Boolean).slice(0, 12).join(' | '));

// 9. immediately start again
await page.locator('.run-button', { hasText: 'Запустить аудит' }).click();
await page.locator('.run-button', { hasText: 'Остановить' }).waitFor({ state: 'visible', timeout: 20000 });
ok(true, 'повторный запуск сразу после остановки стартовал (нет вечного 409)');
await page.locator('.run-button', { hasText: 'Остановить' }).click();
await page.locator('.run-button', { hasText: 'Запустить аудит' }).waitFor({ state: 'visible', timeout: 60000 });
ok(true, 'второй прогон тоже остановился');

await page.screenshot({ path: '.uxproof-data/mono-stop.png' });
await browser.close();
process.exitCode = failed ? 1 : 0;
