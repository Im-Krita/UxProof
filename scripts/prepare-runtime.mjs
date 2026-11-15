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
const browserRootFiles = new Set(['ABOUT', 'chrome-headless-shell.exe', 'headless_command_resources.pak', 'headless_lib_data.pak',
  'headless_lib_strings.pak', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE.headless_shell', 'v8_context_snapshot.bin',
  'vk_swiftshader_icd.json', 'vk_swiftshader.dll', 'vulkan-1.dll']);
const allowedDirs = new Set(['', 'chrome-headless-shell-win64', 'chrome-headless-shell-win64/hyphen-data', 'chrome-headless-shell-win64/locales',
  'chrome-headless-shell-win64/resources', 'chrome-headless-shell-win64/resources/accessibility',
  'chrome-headless-shell-win64/resources/accessibility/reading_mode_gdocs_helper']);
const allowedFile = relative => {
  if (['INSTALLATION_COMPLETE', 'DEPENDENCIES_VALIDATED'].includes(relative)) return true;
  const prefix = 'chrome-headless-shell-win64/';
  if (!relative.startsWith(prefix)) return false;
  const item = relative.slice(prefix.length);
  return browserRootFiles.has(item) || /^(locales\/[a-zA-Z0-9_-]+\.pak|hyphen-data\/[a-zA-Z0-9_-]+\.hyb)$/.test(item) ||
    ['resources/accessibility/reading_mode_gdocs_helper_manifest.json', 'resources/accessibility/reading_mode_gdocs_helper/content.js',
      'resources/accessibility/reading_mode_gdocs_helper/gdocs_script.js'].includes(item);
};
await fs.cp(browserDir, path.join(runtime, 'playwright', path.basename(browserDir)), { recursive: true, filter: async source => {
  const info = await fs.lstat(source);
  if (info.isSymbolicLink()) throw Error('Browser distribution contains a symbolic link');
  const relative = path.relative(browserDir, source).split(path.sep).join('/');
  return info.isDirectory() ? allowedDirs.has(relative) : info.isFile() && allowedFile(relative);
} });
const chromiumSha256 = await hash(browserExe);
await fs.writeFile(path.join(runtime, 'runtime-metadata.json'), JSON.stringify({ nodeVersion, nodeSha256, playwrightRevision: browser.revision,
  chromiumVersion: browser.browserVersion, chromiumSha256 }, null, 2) + '\n');
console.log(`Prepared Node ${nodeVersion} and Chromium ${browser.browserVersion} (revision ${browser.revision}).`);
