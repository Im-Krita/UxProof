// FR-019 acceptance: drive the real Tauri window over WebView2 remote debugging.
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
// (see docs/VM-ACCEPTANCE.md) and the Relay on 4180, then: node scripts/qa-ipc.mjs
import { chromium } from '../runner/node_modules/playwright/index.mjs';

const CDP = process.env.UXPROOF_CDP || 'http://127.0.0.1:9333';
const TARGET = process.env.UXPROOF_TARGET || 'http://127.0.0.1:4180/fixed';

const browser = await chromium.connectOverCDP(CDP);
const contexts = browser.contexts();
const page = contexts.flatMap(context => context.pages()).find(item => item.url().includes('tauri.localhost'));
if (!page) throw Error('Окно Tauri не найдено через CDP');
const log = message => console.log(message);
log(`Окно: ${await page.title()} (${page.url()})`);

// The window may open on the results/history panel after a previous run.
await page.getByRole('button', { name: /^Сценарии$/ }).click({ timeout: 15000 }).catch(() => {});

const setField = async (selector, value) => {
  const field = page.locator(selector);
  await field.waitFor({ state: 'visible', timeout: 15000 });
  await field.fill(value);
  return field.inputValue();
};
log(`Адрес: ${await setField('#project-url', TARGET)}`);
log(`Проект: ${await setField('#project-name', 'Relay — IPC (приёмка)')}`);

const errorsBefore = await page.locator('.alert.error').count();
await page.locator('.run-button', { hasText: 'Запустить аудит' }).click();
log('Кнопка «Запустить аудит» нажата');
await page.locator('.run-button', { hasText: 'Остановить' }).waitFor({ state: 'visible', timeout: 30000 });
log('Прогон стартовал (кнопка стала «Остановить»)');

// Completion is visible as the results panel; the run button stays, so waiting for
// it would hang. The panel carries the pass counter.
await page.getByText('ПРОЙДЕНО СЦЕНАРИЕВ').waitFor({ state: 'visible', timeout: 300000 });
await page.locator('.run-button', { hasText: 'Остановить' }).waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
log('Окно показало результаты прогона');

const errorsAfter = await page.locator('.alert.error').count();
if (errorsAfter > errorsBefore) {
  throw Error(`Ошибка в окне: ${(await page.locator('.alert.error').first().innerText()).slice(0, 400)}`);
}

const body = await page.locator('body').innerText();
const passed = body.match(/ПРОЙДЕНО СЦЕНАРИЕВ\s*(\d+)\s*\/\s*(\d+)/);
const confirmed = body.match(/ПОДТВЕРЖДЁННЫЕ ДЕФЕКТЫ\s*(\d+)/);
const a11y = body.match(/ЗАМЕЧАНИЯ ДОСТУПНОСТИ\s*(\d+)/);
const ai = body.match(/РЕКОМЕНДАЦИИ ИИ\s*(\d+)/);
const shot = '.uxproof-data/ipc-window.png';
await page.screenshot({ path: shot });

let failed = false;
const expect = (condition, message) => { if (!condition) { failed = true; console.error(`FAIL ${message}`); } else log(`OK   ${message}`); };
expect(Boolean(passed), 'окно показало счётчик пройденных сценариев');
expect(passed?.[1] === passed?.[2] && passed?.[2] === '9', `пройдено ${passed?.[1]}/${passed?.[2]} вместо 9/9`);
expect(Boolean(confirmed) && Boolean(a11y) && Boolean(ai), 'все сводные счётчики отрисованы');
expect(body.includes('Сохранение настроек'), 'список прогонов содержит сценарии проекта');
expect(/JSON/.test(body) && /Excel/.test(body) && /HTML-отчёт/.test(body), 'доступны JSON, Excel и HTML-отчёт');
log(`Сводка окна: ${passed?.[0].replace(/\s+/g, ' ')} · дефекты ${confirmed?.[1]} · доступность ${a11y?.[1]} · ИИ ${ai?.[1]}`);
log(`Скриншот окна: ${shot}`);

await browser.close();
process.exitCode = failed ? 1 : 0;
