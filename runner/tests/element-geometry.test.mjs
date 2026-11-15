import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectElementGeometry, sameElementGeometry } from '../element-geometry.mjs';

test('element geometry uses viewport CSS coordinates across scroll and pixel densities', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height, dpr] of [[390, 400, 1], [390, 400, 2], [1440, 900, 1], [1440, 900, 2]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
      try {
        const page = await context.newPage();
        await page.setContent('<style>body{margin:0;height:2000px}#target{position:absolute;left:20px;top:750px;width:80px;height:40px;background:red}</style><div id="target">private-text</div>');
        await page.evaluate(() => scrollTo(0, 700));
        const geometry = await collectElementGeometry(page, 'css:#target');
        assert.deepEqual(geometry, { x: 20, y: 50, width: 80, height: 40, viewportWidth: width, viewportHeight: height, deviceScaleFactor: dpr, scrollX: 0, scrollY: 700 });
        const png = await page.screenshot();
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        const pixels = await page.evaluate(async ({ data, x, y, scale }) => {
          const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return [[x - 1, y + 35], [x, y + 35], [x + 79, y + 35], [x + 80, y + 35]].map(([px, py]) =>
            Array.from(ctx.getImageData(px * scale, py * scale, 1, 1).data));
        }, { data: png.toString('base64'), x: geometry.x, y: geometry.y, scale: dpr });
        assert.deepEqual(pixels, [[255, 255, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255], [255, 255, 255, 255]]);
        assert.equal(sameElementGeometry(geometry, { ...geometry }), true);
        assert.equal(sameElementGeometry(geometry, { ...geometry, x: geometry.x + 1 }), false);
        assert.equal(sameElementGeometry(geometry, null), false);
        assert.ok(!JSON.stringify(geometry).includes('private-text'));
        assert.equal(await collectElementGeometry(page, 'css:#missing', { timeoutMs: 20 }), null);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
