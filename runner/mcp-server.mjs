#!/usr/bin/env node
// Minimal MCP stdio server. It talks to the local dev API instead of spawning
// Chromium itself, so the token and the single-run lock stay in one place.
// Tools never return screenshots: only run ids, summaries and issue counts.
import readline from 'node:readline';

const api = process.env.UXPROOF_DEV_API || 'http://127.0.0.1:4179';
const token = process.env.UXPROOF_DEV_TOKEN || '';
if (!token) {
  process.stderr.write('UXPROOF_DEV_TOKEN не задан: MCP-сервер не запустится.\n');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', 'X-UXProof-Client': '1', 'X-UXProof-Token': token };

async function call(path, init = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'Некорректный ответ dev API' }; }
  if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
  return body;
}

const summarize = report => ({
  runId: report.runId,
  project: report.project,
  baseUrl: report.baseUrl,
  status: report.status,
  startedAt: report.startedAt,
  summary: report.summary,
  warnings: Array.isArray(report.warnings) ? report.warnings.length : 0,
  issues: (report.issues || []).slice(0, 50).map(issue => ({
    id: issue.id, kind: issue.kind, status: issue.status, severity: issue.severity,
    ruleId: issue.ruleId, title: issue.title, scenario: issue.scenario, viewport: issue.viewport, step: issue.step
  }))
});

const tools = [
  {
    name: 'run_audit',
    description: 'Запустить проверку UXProof по конфигурации проекта. Возвращает сводку без скриншотов.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['project', 'baseUrl', 'scenarios', 'viewports'],
      properties: {
        project: { type: 'string' }, baseUrl: { type: 'string' },
        scenarios: { type: 'array' }, viewports: { type: 'array' },
        options: { type: 'object' }
      }
    }
  },
  { name: 'cancel', description: 'Остановить текущую проверку.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'list_reports', description: 'Список последних отчётов: runId, проект, статус и сводка.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  {
    name: 'get_report',
    description: 'Сводка одного отчёта по runId: статус, счётчики и первые проблемы без изображений.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: { type: 'string' } } }
  }
];

async function invoke(name, args) {
  if (name === 'run_audit') return summarize(await call('/api/run', { method: 'POST', body: JSON.stringify(args) }));
  if (name === 'cancel') return call('/api/cancel', { method: 'POST' });
  if (name === 'list_reports') {
    const page = await call('/api/history');
    return { skipped: page.skipped, reports: page.reports.map(summarize) };
  }
  if (name === 'get_report') {
    const page = await call('/api/history');
    const report = page.reports.find(item => item.runId === args?.runId);
    if (!report) throw Error('Отчёт не найден');
    return summarize(report);
  }
  throw Error(`Неизвестный инструмент: ${name}`);
}

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);

async function handle(request) {
  const { id, method, params } = request;
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'uxproof', version: '0.1.0' } } };
  }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
  if (method === 'tools/call') {
    try {
      const result = await invoke(params?.name, params?.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(error?.message || error) }] } };
    }
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Метод не поддерживается' } };
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', async line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Некорректный JSON' } }); return; }
  const response = await handle(request);
  if (response) send(response);
});
