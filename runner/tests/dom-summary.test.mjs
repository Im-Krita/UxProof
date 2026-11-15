import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectDomSummary, validateDomSummary } from '../dom-summary.mjs';

test('DOM summary records bounded structure without text or field values', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><html><body><h1>visible-private-text</h1><input value="field-private-value"><button>Action</button><div style="display:none"><button>Hidden</button></div><iframe srcdoc="<p>frame-private-text</p>"></iframe><canvas></canvas></body></html>');
    await page.evaluate(() => { const host = document.createElement('div'); host.attachShadow({ mode: 'open' }).textContent = 'shadow-private-text'; document.body.append(host); });
    const summary = await collectDomSummary(page);
    assert.equal(summary.viewport.width, 600);
    assert.equal(summary.viewport.height, 400);
    assert.equal(summary.viewport.deviceScaleFactor, 2);
    assert.ok(summary.visible.interactive >= 2);
    assert.ok(summary.visible.headings >= 1);
    assert.ok(summary.coverage.iframes >= 1);
    assert.ok(summary.coverage.canvases >= 1);
    assert.ok(summary.coverage.openShadowRoots >= 1);
    assert.equal(summary.coverage.status, 'partial');
    assert.ok(!JSON.stringify(summary).includes('visible-private-text'));
    assert.ok(!JSON.stringify(summary).includes('field-private-value'));
    assert.ok(!JSON.stringify(summary).includes('frame-private-text'));
    assert.ok(!JSON.stringify(summary).includes('shadow-private-text'));
    assert.throws(() => validateDomSummary({ ...summary, leakedText: 'private' }));
    assert.throws(() => validateDomSummary({ ...summary, visible: { ...summary.visible, elements: 5001 } }));
    const limited = await collectDomSummary(page, { maxElements: 2 });
    assert.equal(limited.coverage.truncated, true);
    assert.equal(limited.coverage.status, 'partial');
  } finally { await browser.close(); }
});

test('DOM collection is time-bounded and refuses non-numeric page data', async () => {
  await assert.rejects(() => collectDomSummary({ evaluate: () => new Promise(() => {}) }, { timeoutMs: 20 }), /timeout/i);
  const poisoned = { viewport: { width: 'secret', height: 400, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 },
    visible: { elements: 1, interactive: 0, headings: 0, dialogs: 0, forms: 0 },
    coverage: { truncated: false, elementsSeen: 1, iframes: 0, canvases: 0, openShadowRoots: 0 } };
  await assert.rejects(() => collectDomSummary({ evaluate: async () => poisoned }), /Invalid DOM summary/);
});
