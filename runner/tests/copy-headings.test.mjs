import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectDuplicateHeadings } from '../copy-headings.mjs';
import { enabledRule } from '../rules.mjs';

test('finds visible duplicates without returning text or counting hidden and offscreen headings', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 400 } });
    await page.setContent('<h1>secret-example-421</h1><h2>  SECRET-example-421 </h2><h2>Another title</h2><h2 style="display:none">Another title</h2><h2 style="position:absolute;top:2000px">Another title</h2><div style="opacity:0"><h2>Invisible heading</h2><h2>Invisible heading</h2></div>');
    const result = await collectDuplicateHeadings(page);
    assert.equal(result.duplicateGroups, 1);
    assert.equal(result.duplicateHeadings, 2);
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal((await collectDuplicateHeadings(page, { maxElements: 2 })).truncated, true);
    assert.equal(enabledRule('copy:duplicate-heading'), true);
    assert.equal(enabledRule('copy:duplicate-heading', ['copy:duplicate-heading']), false);
    await page.setContent('<h1>First heading</h1><h2>Second heading</h2><h2 hidden>Second heading</h2>');
    assert.equal((await collectDuplicateHeadings(page)).duplicateGroups, 0);
  } finally { await browser.close(); }
});

test('copy collector is time bounded and rejects malformed page data', async () => {
  await assert.rejects(() => collectDuplicateHeadings({ evaluate: () => new Promise(() => {}) }, { timeoutMs: 20 }), /timeout/i);
  await assert.rejects(() => collectDuplicateHeadings({ evaluate: async () => ({ duplicateGroups: 1, duplicateHeadings: 1, elementsSeen: 1, truncated: false }) }), /Invalid copy audit result/);
});
