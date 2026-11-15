import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeVersion = '24.14.1';
// Published in https://nodejs.org/dist/v24.14.1/SHASUMS256.txt for win-x64/node.exe.
const nodeSha256 = '58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f';
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Portable runtime preparation currently supports Windows x64 only');
const project = await fs.realpath(fileURLToPath(new URL('..', import.meta.url)));
const buildRoot = path.join(project, '.uxproof-build');
await fs.mkdir(buildRoot, { recursive: true });
if ((await fs.lstat(buildRoot)).isSymbolicLink() || await fs.realpath(buildRoot) !== buildRoot) throw Error('Unsafe build directory');
const runtime = path.join(buildRoot, 'runtime');
const hash = async file => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
const node = path.resolve(process.env.UXPROOF_NODE_BINARY || process.execPath);
if (await hash(node) !== nodeSha256) throw Error(`Node binary does not match official Windows x64 Node ${nodeVersion} SHA-256`);
const browsers = JSON.parse(await fs.readFile(path.join(project, 'runner/node_modules/playwright-core/browsers.json'), 'utf8'));
const browser = browsers.browsers.find(item => item.name === 'chromium-headless-shell');
if (!browser || !/^\d+$/.test(browser.revision)) throw Error('Playwright Chromium revision missing');
const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
if (!browserRoot || browserRoot === '0') throw Error('Set PLAYWRIGHT_BROWSERS_PATH to the installed browser cache');
const browserDir = path.join(browserRoot, `chromium_headless_shell-${browser.revision}`);
const browserExe = path.join(browserDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
await fs.access(path.join(browserDir, 'INSTALLATION_COMPLETE'));
await fs.access(browserExe);
const manifestPath = path.join(project, 'scripts/runtime-manifests', `chromium-headless-win64-${browser.revision}.json`);
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.revision !== browser.revision || manifest.browserVersion !== browser.browserVersion ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256 || '') || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
  throw Error('Chromium verification manifest does not match Playwright');
}
const files = Object.entries(manifest.files);
if (!files.length || files.length > 1000 || !manifest.files['chrome-headless-shell-win64/chrome-headless-shell.exe'] ||
    !manifest.files['chrome-headless-shell-win64/LICENSE.headless_shell']) throw Error('Incomplete Chromium verification manifest');
const sourceRoot = await fs.realpath(browserDir);
for (const [name, expected] of files) {
  if (!/^chrome-headless-shell-win64\/[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').includes('..') ||
      path.posix.normalize(name) !== name || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Unsafe Chromium manifest entry');
  const source = path.join(browserDir, ...name.split('/'));
  const info = await fs.lstat(source), realSource = await fs.realpath(source);
  const relative = path.relative(sourceRoot, realSource);
  if (!info.isFile() || info.isSymbolicLink() || !relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) ||
      await hash(source) !== expected) throw Error(`Chromium cache does not match verified archive: ${name}`);
}
for (const source of [await fs.realpath(node), await fs.realpath(browserDir)]) {
  const relative = path.relative(runtime, source);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw Error('Runtime sources must be outside the generated runtime directory');
  }
}
try {
  const info = await fs.lstat(runtime);
  if (info.isSymbolicLink() || !info.isDirectory() || await fs.realpath(runtime) !== runtime || path.dirname(runtime) !== buildRoot) throw Error('Unsafe runtime directory');
  // The exact resolved directory above is dedicated generated output within this workspace.
  await fs.rm(runtime, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(path.join(runtime, 'playwright'), { recursive: true });
await fs.copyFile(node, path.join(runtime, 'node.exe'));
const destinationRoot = path.join(runtime, 'playwright', path.basename(browserDir));
for (const [name, expected] of files) {
  const destination = path.join(destinationRoot, ...name.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(browserDir, ...name.split('/')), destination);
  if (await hash(destination) !== expected) throw Error(`Copied Chromium file failed verification: ${name}`);
}
await fs.writeFile(path.join(destinationRoot, 'INSTALLATION_COMPLETE'), '');
const chromiumSha256 = manifest.files['chrome-headless-shell-win64/chrome-headless-shell.exe'];
await fs.writeFile(path.join(runtime, 'runtime-metadata.json'), JSON.stringify({ nodeVersion, nodeSha256, playwrightRevision: browser.revision,
  chromiumVersion: browser.browserVersion, chromiumSha256, chromiumArchiveSha256: manifest.archiveSha256 }, null, 2) + '\n');
console.log(`Prepared Node ${nodeVersion} and Chromium ${browser.browserVersion} (revision ${browser.revision}).`);
