import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx } from '../xlsx.mjs';

// Minimal reader for the subset we produce: walk local headers, inflate payloads.
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const payload = buffer.subarray(start, start + size);
    files.set(name, { crc, data: method === 8 ? inflateRawSync(payload) : payload });
    offset = start + size;
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

test('xlsx archive contains the required parts with valid checksums', () => {
  const archive = unzip(buildXlsx([{ name: 'Сводка', rows: [['Проект', 'Relay'], ['Прогонов', 3]] }]));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(archive.has(part), `missing ${part}`);
    assert.equal(archive.get(part).crc, crc32(archive.get(part).data), `crc mismatch for ${part}`);
  }
  const sheet = archive.get('xl/worksheets/sheet1.xml').data.toString('utf8');
  assert.match(sheet, /<t xml:space="preserve">Relay<\/t>/);
  assert.match(sheet, /<c r="B2"><v>3<\/v><\/c>/);
  const workbook = archive.get('xl/workbook.xml').data.toString('utf8');
  assert.match(workbook, /name="Сводка"/);
});

test('cell values are escaped and unsafe XML characters are stripped', () => {
  const archive = unzip(buildXlsx([{ name: 'A', rows: [['<script>&"'], ['tab\u0001char']] }]));
  const sheet = archive.get('xl/worksheets/sheet1.xml').data.toString('utf8');
  assert.match(sheet, /&lt;script&gt;&amp;&quot;/);
  assert.ok(!sheet.includes('\u0001'));
});

test('multiple sheets are numbered and named deterministically', () => {
  const archive = unzip(buildXlsx([{ name: 'One', rows: [] }, { name: 'Two', rows: [] }]));
  assert.ok(archive.has('xl/worksheets/sheet2.xml'));
  const rels = archive.get('xl/_rels/workbook.xml.rels').data.toString('utf8');
  assert.match(rels, /worksheets\/sheet2\.xml/);
  assert.throws(() => buildXlsx([]), TypeError);
});
