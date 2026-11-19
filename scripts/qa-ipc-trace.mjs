import { chromium } from '../runner/node_modules/playwright/index.mjs';

const browser = await chromium.connectOverCDP(process.env.UXPROOF_CDP || 'http://127.0.0.1:9333');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'))
  || browser.contexts().flatMap(c => c.pages())[0];
if (!page) throw Error('окно не найдено');
await page.waitForTimeout(1500);
if (!page.url().includes('tauri.localhost')) {
  await page.goto('http://tauri.localhost/').catch(() => {});
}
console.log('page', await page.title(), page.url());

await page.getByRole('button', { name: /^Сценарии$/ }).click().catch(() => {});
await page.locator('#project-url').fill('http://127.0.0.1:4180/');
const trace = page.locator('label.trace-toggle input[type=checkbox]');
await trace.waitFor({ state: 'visible', timeout: 15000 });
if (!(await trace.isChecked())) await trace.check();
console.log('trace on');

await page.locator('.run-button', { hasText: 'Запустить аудит' }).click();
await page.getByText('ПРОЙДЕНО СЦЕНАРИЕВ').waitFor({ state: 'visible', timeout: 300000 });
const body = await page.locator('body').innerText();
const passed = body.match(/ПРОЙДЕНО СЦЕНАРИЕВ\s*(\d+)\s*\/\s*(\d+)/);
console.log('summary', passed && passed[0].replace(/\s+/g, ' '));
const hasTraceBtn = /Открыть trace|trace-\d/i.test(body) || await page.getByText(/Открыть trace|trace-/i).count() > 0;
console.log(hasTraceBtn ? 'OK   кнопка/ссылка trace видна' : 'FAIL trace не виден в отчёте');
await page.screenshot({ path: '.uxproof-data/mono-trace.png' });
await browser.close();
process.exitCode = hasTraceBtn ? 0 : 1;
