import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isResolvedInside } from './policy.mjs';

const validPath = value => value === 'report.json' || value === 'report.html' ||
  (typeof value === 'string' && (/^screenshots\/[a-zA-Z0-9_-]{1,160}\.png$/.test(value) || /^traces\/trace-[1-9]\d*-[1-9]\d*\.zip$/.test(value)));

export async function writeArtifactManifest(outputDir, runId, relativePaths) {
  if (typeof runId !== 'string' || !runId || !Array.isArray(relativePaths) || relativePaths.some(value => !validPath(value))) {
    throw new TypeError('Invalid artifact manifest input');
  }
  const root = await fs.realpath(outputDir);
  const artifacts = [];
  for (const relative of [...new Set(relativePaths)].sort()) {
    const target = path.join(root, ...relative.split('/'));
    const info = await fs.lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Артефакт не является обычным файлом');
    const resolved = await fs.realpath(target);
    if (!isResolvedInside(root, resolved)) throw Error('Артефакт выходит за каталог отчёта');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(resolved)) { hash.update(chunk); bytes += chunk.length; }
    artifacts.push({ path: relative, sha256: hash.digest('hex'), bytes });
  }
  const manifest = { schemaVersion: '1.0', runId, artifacts };
  const temporary = path.join(root, `artifacts-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, path.join(root, 'artifacts.json'));
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return manifest;
}
