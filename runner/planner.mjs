// LLM → validated AuditStep[]. The planner never runs the audit and never
// produces findings: the user reviews the generated steps in the UI first.
import { validateConfig } from './validators.mjs';

const STEP_TYPES = ['click', 'fill', 'select', 'check', 'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'wait', 'navigate'];
// Must match locatorFor() in validators.mjs — anything else is a raw CSS selector,
// and the planner is not allowed to guess.
const TARGET_PREFIXES = /^(css|text|label|placeholder|testid|role):/;

const PLANNER_SYSTEM = `Ты планировщик сценария UI-проверки. Пиши по-русски.
Верни только JSON: {"steps":[{"type":"...","name":"...","target":"...","value":"..."}]}.
Допустимые type: click, fill, select, check, expectVisible, expectHidden, expectText, expectValue, wait, navigate.
target — селектор с префиксом через двоеточие: css:, text:, label:, placeholder:, testid:, role: (для role: имя через |, например role:button|Сохранить).
navigate допускается только на тот же origin, что и адрес проекта; иначе шаг не нужен.
Максимум 12 шагов. Не придумывай элементы, которых нет в описании.`;

export function parsePlan(raw) {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('Модель вернула не JSON');
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps)) throw Error('Модель вернула не план шагов');
  return parsed.steps.slice(0, 12);
}

// Drops unknown types, off-origin navigation, empty targets and dangerous values.
export function sanitizePlan(steps, baseUrl) {
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { throw Error('Некорректный адрес проекта'); }
  const clean = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || !STEP_TYPES.includes(step.type)) continue;
    const target = typeof step.target === 'string' ? step.target.trim().slice(0, 300) : '';
    const value = typeof step.value === 'string' ? step.value.slice(0, 500) : '';
    const name = (typeof step.name === 'string' && step.name.trim() ? step.name : step.type).slice(0, 120);
    if (step.type === 'navigate') {
      let next;
      try { next = new URL(value, baseUrl); } catch { continue; }
      if (next.origin !== origin || !['http:', 'https:'].includes(next.protocol)) continue;
      clean.push({ type: 'navigate', name, target: '', value: next.pathname + next.search });
      continue;
    }
    if (step.type === 'wait') {
      clean.push({ type: 'wait', name, target: '', value });
      continue;
    }
    if (!target || !TARGET_PREFIXES.test(target)) continue;
    if (['expectText', 'expectValue', 'select'].includes(step.type) && !value.trim()) continue;
    clean.push({ type: step.type, name, target, value });
  }
  return clean;
}

async function askProvider({ goal, baseUrl, provider, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = `Адрес проекта: ${baseUrl}\nЦель проверки: ${String(goal).slice(0, 1000)}`;
  try {
    if (provider === 'ollama') {
      const url = new URL(process.env.UXPROOF_OLLAMA_URL || 'http://127.0.0.1:11434');
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
          !(host === 'localhost' || host === '::1' || host.startsWith('127.'))) throw Error('Для MVP Ollama допускается только на localhost');
      const response = await fetch(new URL('/api/chat', url), {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.UXPROOF_OLLAMA_MODEL || 'llama3.1', format: 'json', stream: false,
          messages: [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: prompt }] })
      });
      if (!response.ok) throw Error(`Ollama HTTP ${response.status}`);
      return (await response.json()).message?.content || '';
    }
    if (provider !== 'openai') throw Error(`Неизвестный провайдер: ${provider}`);
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw Error('OPENAI_API_KEY не задан; генерация шагов недоступна');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.UXPROOF_PLANNER_MODEL || 'gpt-4.1-mini', store: false, max_output_tokens: 700,
        input: [{ role: 'system', content: [{ type: 'input_text', text: PLANNER_SYSTEM }] },
          { role: 'user', content: [{ type: 'input_text', text: prompt }] }] })
    });
    if (!response.ok) throw Error(`LLM HTTP ${response.status}`);
    const data = await response.json();
    return (data.output || []).flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text || '')).join('\n');
  } finally { clearTimeout(timer); }
}

// Returns steps that already pass the same validator used by runAudit.
export async function planScenario({ goal, baseUrl, provider = 'openai', timeoutMs = 30000 }) {
  if (typeof goal !== 'string' || !goal.trim()) throw Error('Опишите цель проверки');
  const raw = await askProvider({ goal, baseUrl, provider, timeoutMs: Math.min(60000, Math.max(1000, Number(timeoutMs) || 30000)) });
  const steps = sanitizePlan(parsePlan(raw), baseUrl);
  if (!steps.length) throw Error('Модель не вернула ни одного допустимого шага');
  // The same contract as the editor and the runner: a plan cannot bypass validation.
  validateConfig({
    project: 'План', baseUrl,
    scenarios: [{ id: 'planned', title: 'Сгенерированный сценарий', steps }],
    viewports: [{ id: 'mobile', label: 'Mobile', width: 390, height: 844 }],
    options: { enableAI: false }
  });
  return steps;
}
