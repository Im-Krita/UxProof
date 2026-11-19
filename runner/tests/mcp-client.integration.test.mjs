import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// FR-024: connect the real MCP stdio server to a real MCP client (official SDK)
// and exercise the handshake plus every tool through the token-protected dev API.
const runnerDir = path.resolve(import.meta.dirname, '..');
const TOKEN = 'mcp-test-token';

function startDevApi(runsDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(runnerDir, 'dev-server.mjs')], {
      cwd: runnerDir,
      env: { ...process.env, UXPROOF_DEV_TOKEN: TOKEN, UXPROOF_DEV_PORT: '0', UXPROOF_RUNS_DIR: runsDir, NO_PROXY: '127.0.0.1,localhost,::1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('dev API не стартовал за 20 с')); }, 20000);
    timer.unref();
    child.stdout.on('data', chunk => {
      out += chunk.toString();
      const match = out.match(/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, base: `http://127.0.0.1:${match[1]}` });
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`dev API завершился с кодом ${code}`)); });
  });
}

async function connect(apiBase) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(runnerDir, 'mcp-server.mjs')],
    cwd: runnerDir,
    env: { ...process.env, UXPROOF_DEV_API: apiBase, UXPROOF_DEV_TOKEN: TOKEN, NO_PROXY: '127.0.0.1,localhost,::1' },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'uxproof-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('official MCP client handshakes and uses every tool of the stdio server', async () => {
  const site = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="ru"><title>MCP fixture</title><main><h1>Готово</h1></main></html>');
  });
  site.listen(0, '127.0.0.1');
  await once(site, 'listening');
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-mcp-runs-'));
  let api, client;
  try {
    const started = await startDevApi(runsDir);
    api = started.child;
    const base = started.base;
    client = await connect(base);
    const info = client.getServerVersion();
    assert.equal(info.name, 'uxproof');
    assert.ok(client.getServerCapabilities()?.tools, 'server must advertise the tools capability');

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['cancel', 'get_report', 'list_reports', 'run_audit']);
    assert.deepEqual(tools.find(tool => tool.name === 'run_audit').inputSchema.required,
      ['project', 'baseUrl', 'scenarios', 'viewports']);

    const run = await client.callTool({
      name: 'run_audit',
      arguments: {
        project: 'MCP fixture',
        baseUrl: `http://127.0.0.1:${site.address().port}/`,
        scenarios: [{ id: 's', title: 'открыть', steps: [{ type: 'expectText', name: 'Заголовок', target: 'css:h1', value: 'Готово' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }],
        options: { enableAI: false }
      }
    });
    assert.notEqual(run.isError, true, JSON.stringify(run.content));
    const summary = JSON.parse(run.content.find(item => item.type === 'text').text);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.summary.totalRuns, 1);
    assert.equal(summary.summary.passedRuns, 1);
    assert.ok(!JSON.stringify(run).includes('screenshots/'), 'MCP ответы не должны содержать скриншоты');

    const listed = await client.callTool({ name: 'list_reports', arguments: {} });
    const page = JSON.parse(listed.content.find(item => item.type === 'text').text);
    assert.ok(page.reports.some(item => item.runId === summary.runId));
    assert.equal(typeof page.skipped, 'number');

    const one = await client.callTool({ name: 'get_report', arguments: { runId: summary.runId } });
    assert.equal(JSON.parse(one.content.find(item => item.type === 'text').text).runId, summary.runId);

    const missing = await client.callTool({ name: 'get_report', arguments: { runId: 'no-such-run' } });
    assert.equal(missing.isError, true);
    assert.match(missing.content.find(item => item.type === 'text').text, /не найден/i);

    const unknown = await client.callTool({ name: 'nope', arguments: {} });
    assert.equal(unknown.isError, true);

    const cancelled = await client.callTool({ name: 'cancel', arguments: {} });
    assert.equal(cancelled.isError, true, 'cancel без активной проверки — это ошибка инструмента');
    assert.match(cancelled.content.find(item => item.type === 'text').text, /Нет выполняющейся проверки/);
  } finally {
    if (client) await client.close().catch(() => {});
    if (api) api.kill();
    await new Promise(resolve => site.close(resolve));
    await fs.rm(runsDir, { recursive: true, force: true });
  }
});

test('stdio server refuses to start without UXPROOF_DEV_TOKEN', async () => {
  const child = spawn(process.execPath, [path.join(runnerDir, 'mcp-server.mjs')], {
    cwd: runnerDir,
    env: { ...process.env, UXPROOF_DEV_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, /UXPROOF_DEV_TOKEN/);
});
