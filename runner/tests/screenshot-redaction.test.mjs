import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { screenshotWithRedaction } from '../screenshot.mjs';

test('screenshots hide changed form values and editable text', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
    await page.setContent('<input id="password" type="password"><input id="token"><textarea id="note"></textarea><div id="edit" contenteditable="true"></div><select id="choice"><option>A</option><option>B</option></select><iframe id="frame" srcdoc="<body>frame-one</body>"></iframe><canvas id="canvas" width="80" height="30"></canvas>');
    const setSecrets = async (suffix) => {
      await page.locator('#password').fill(`password-${suffix}`);
      await page.locator('#token').fill(`token-${suffix}`);
      await page.locator('#note').fill(`note-${suffix}`);
      await page.locator('#edit').fill(`editable-${suffix}`);
      await page.locator('#choice').selectOption({ label: suffix === 'one' ? 'A' : 'B' });
      await page.frameLocator('#frame').locator('body').evaluate((body, value) => { body.textContent = value; }, `frame-${suffix}`);
      await page.locator('#canvas').evaluate((canvas, value) => {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = value === 'one' ? 'red' : 'blue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }, suffix);
      await page.locator('#edit').blur();
    };
    await setSecrets('one');
    const rawOne = await page.screenshot({ animations: 'disabled' });
    const maskedOne = await screenshotWithRedaction(page);
    await setSecrets('two');
    const rawTwo = await page.screenshot({ animations: 'disabled' });
    const maskedTwo = await screenshotWithRedaction(page);
    assert.notDeepEqual(rawOne, rawTwo, 'fixture must visibly change');
    assert.deepEqual(maskedOne, maskedTwo, 'masked output must not change with field values');
  } finally { await browser.close(); }
});

test('screenshots also hide visible echoes of scenario values', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
    await page.setContent('<style>#echo{width:300px;height:30px}#normal{width:200px;height:30px}</style><div id="echo"></div><div id="normal">Public heading</div>');
    const capture = async value => {
      await page.locator('#echo').evaluate((element, text) => { element.textContent = `Value: ${text}`; }, value);
      return { raw: await page.screenshot(), masked: await screenshotWithRedaction(page, {}, { maskTextValues: [value] }) };
    };
    const first = await capture('private-alpha');
    const second = await capture('private-bravo');
    assert.notDeepEqual(first.raw, second.raw);
    assert.deepEqual(first.masked, second.masked);
    assert.throws(() => screenshotWithRedaction(page, {}, { maskTextValues: [null] }), /Invalid screenshot redaction/);
  } finally { await browser.close(); }
});
