import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAudit } from '../runner/audit.mjs';

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const ping = await fetch('http://127.0.0.1:4180/').catch(() => null);
if (!ping?.ok) {
  console.error('Relay не запущен на http://127.0.0.1:4180.');
  process.exit(1);
}

const base = JSON.parse(await fs.readFile(new URL('../samples/demo.audit.json', import.meta.url), 'utf8'));
const tiny = (patch = {}) => ({
  ...base,
  project: 'edge',
  scenarios: [base.scenarios[0]],
  viewports: [base.viewports[0]],
  options: { enableAI: false, aiProvider: 'openai' },
  runId: crypto.randomUUID(),
  outputDir: path.resolve('.uxproof-data/runs', crypto.randomUUID()),
  ...patch
});

await runAudit({ ...tiny(), baseUrl: 'file:///C:/Windows/win.ini' }).then(() => failures.push('file URL не отклонён'), error => check(/http\(s\)|корректный URL/i.test(String(error.message)), `file URL: ${error.message}`));
await runAudit({ ...tiny(), scenarios: [{ title: 'eval', steps: [{ type: 'eval', target: 'css:#x', value: '' }] }] }).then(() => failures.push('eval не отклонён'), error => check(/Неизвестный шаг/.test(String(error.message)), `eval: ${error.message}`));

const running = runAudit(tiny());
await runAudit(tiny()).then(() => failures.push('параллельный запуск не отклонён'), error => check(/другая проверка/.test(String(error.message)), `lock: ${error.message}`));
const first = await running;
check(first.summary.passedRuns === 1, 'контрольный сценарий сервера не прошёл');

const broken = await runAudit(tiny({
  scenarios: [{ id: 'bad', title: 'Битый селектор', steps: [
    { type: 'click', name: 'Нет кнопки', target: 'css:#missing-control', value: '' },
    { type: 'click', name: 'Не должен выполниться', target: 'role:button|Серверы', value: '' }
  ]}]
}));
check(broken.results[0].steps.length === 1 && broken.results[0].steps[0].status === 'failed', 'после битого селектора выполнился следующий шаг');

delete process.env.OPENAI_API_KEY;
const ai = await runAudit(tiny({ options: { enableAI: true, aiProvider: 'openai' } }));
check(ai.summary.passedRuns === 1, 'проверка без ключа ИИ не сохранила технический результат');
check(ai.warnings.some(item => item.includes('OPENAI_API_KEY')), `нет предупреждения об отсутствии ключа: ${ai.warnings.join(' | ')}`);
check(ai.issues.every(item => item.status !== 'recommendation'), 'рекомендация появилась без модели');
check(!JSON.stringify(ai).includes('sk-'), 'в отчёте есть похожий на ключ фрагмент');

const server = spawn(process.execPath, ['runner/dev-server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('dev API не поднялся')), 8000);
    const onData = chunk => { if (String(chunk).includes('4179')) { clearTimeout(timer); resolve(); } };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', code => reject(Error(`dev API завершился: ${code}`)));
  });
  const blocked = await fetch('http://127.0.0.1:4179/api/image?runId=..&file=secret.png');
  check(blocked.status === 400, `path traversal вернул ${blocked.status}`);
  const header = await fetch('http://127.0.0.1:4179/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check(header.status === 403, `запрос без заголовка вернул ${header.status}`);
  const fileUrl = await fetch('http://127.0.0.1:4179/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uxproof-client': '1' },
    body: JSON.stringify({ baseUrl: 'javascript:alert(1)', scenarios: [{ title: 'x', steps: [{ type: 'click', target: 'css:#a', value: '' }] }], viewports: [{ width: 800, height: 600 }] })
  });
  check(fileUrl.status === 400, `javascript URL вернул ${fileUrl.status}`);
} finally {
  if (server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('edge cases: ok');
}
