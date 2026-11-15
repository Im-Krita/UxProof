import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectElementGeometry } from '../element-geometry.mjs';

test('element geometry uses viewport CSS coordinates across scroll and pixel densities', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 400 }, deviceScaleFactor: dpr });
      try {
        const page = await context.newPage();
        await page.setContent('<style>body{margin:0;height:2000px}#target{position:absolute;left:20px;top:750px;width:80px;height:40px;background:red}</style><div id="target">private-text</div>');
        await page.evaluate(() => scrollTo(0, 700));
        const geometry = await collectElementGeometry(page, 'css:#target');
        assert.deepEqual(geometry, { x: 20, y: 50, width: 80, height: 40, viewportWidth: 390, viewportHeight: 400, deviceScaleFactor: dpr, scrollX: 0, scrollY: 700 });
        const png = await page.screenshot();
        assert.equal(png.readUInt32BE(16), 390 * dpr);
        assert.equal(png.readUInt32BE(20), 400 * dpr);
        assert.ok(!JSON.stringify(geometry).includes('private-text'));
        assert.equal(await collectElementGeometry(page, 'css:#missing', { timeoutMs: 20 }), null);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
