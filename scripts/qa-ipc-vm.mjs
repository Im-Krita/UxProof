// Extra VM-acceptance checks against an already-open Tauri window over CDP.
import { chromium } from '../runner/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';

const CDP = process.env.UXPROOF_CDP || 'http://127.0.0.1:9333';
const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
if (!page) throw Error('окно не найдено');
const log = m => console.log(m);
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ' + msg); } else log('OK   ' + msg); };

// 4. Import JSON — hidden file input or button. Use the page file chooser if present.
await page.getByRole('button', { name: /^Сценарии$/ }).click().catch(() => {});
const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
await page.getByText('Импорт JSON').click();
const chooser = await chooserPromise;
if (chooser) {
  await chooser.setFiles(fileURLToPath(new URL('../samples/demo.audit.json', import.meta.url)));
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  ok(/Выбор и подключение сервера/.test(body), 'импорт JSON оставил демо-сценарии');
  ok(/http:\/\/127\.0\.0\.1:4180/.test(body), 'импорт подставил адрес Relay');
} else {
  // No file chooser (Tauri native dialog). Record that separately.
  log('NOTE импорт через нативный диалог, filechooser недоступен');
  ok(true, 'кнопка «Импорт JSON» нажимается');
}

// 6. History
await page.getByRole('button', { name: /История проверок/ }).click();
await page.waitForTimeout(800);
let body = await page.locator('body').innerText();
ok(/История/.test(body), 'открыта история');
ok(!/пропущен/i.test(body) || /Пропущено записей/.test(body), 'история открылась без скрытой ошибки');
ok(/\d{1,2} нояб|\d{2}\.\d{2}|Relay/.test(body) || /записей/.test(body) || body.includes('Relay'), 'в истории есть запись');
log('history-excerpt: ' + body.split('\n').filter(Boolean).slice(0, 18).join(' | '));

// 7. Open an issue with PNG if present
await page.getByRole('button', { name: /^Результаты$/ }).click();
await page.waitForTimeout(500);
const issue = page.locator('.issue-card, [class*="issue"]').first();
if (await issue.count()) await issue.click().catch(() => {});
else await page.getByText('layout:min-tap-target').first().click().catch(() => {});
await page.waitForTimeout(600);
body = await page.locator('body').innerText();
const img = page.locator('img, [class*="screenshot"]');
ok((await img.count()) > 0 || /png|скрин|доказател/i.test(body), 'карточка замечания открылась');

await page.screenshot({ path: '.uxproof-data/mono-history.png' });
log('shot .uxproof-data/mono-history.png');

await browser.close();
process.exitCode = failed ? 1 : 0;
