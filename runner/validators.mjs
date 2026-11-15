import { assertBaseUrlShape, decideRequest } from './policy.mjs';

export const STEP_TYPES = new Set(['click','fill','select','check','navigate','expectVisible','expectHidden','expectText','expectValue','wait']);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

const fail = message => { throw new InputError(message); };

export function validateConfig(config) {
  if (!config || typeof config !== 'object') fail('Не задана конфигурация');
  const parsed = (() => { try { return assertBaseUrlShape(config.baseUrl); } catch (error) { fail(error.message); } })();
  if (typeof config.project === 'string' && config.project.length > 200) fail('Слишком длинное название проекта');
  if (!Array.isArray(config.scenarios) || config.scenarios.length < 1 || config.scenarios.length > 10) fail('Нужно от 1 до 10 сценариев');
  if (!Array.isArray(config.viewports) || config.viewports.length < 1 || config.viewports.length > 4) fail('Нужно от 1 до 4 разрешений экрана');
  for (const vp of config.viewports) {
    if (!Number.isInteger(vp.width) || !Number.isInteger(vp.height) || vp.width < 320 || vp.width > 3840 || vp.height < 400 || vp.height > 2160) fail('Недопустимые размеры экрана');
  }
  for (const scenario of config.scenarios) {
    if (typeof scenario.title !== 'string' || scenario.title.length > 200 || !Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > 30) fail('Некорректный сценарий');
    for (const step of scenario.steps) {
      if (!STEP_TYPES.has(step.type)) fail(`Неизвестный шаг: ${step.type}`);
      if (typeof step.name === 'string' && step.name.length > 200) fail('Слишком длинное название шага');
      if (typeof step.target === 'string' && step.target.length > 500) fail('Слишком длинный селектор');
      if (typeof step.value === 'string' && step.value.length > 2000) fail('Слишком длинное значение шага');
      if (step.type !== 'wait' && step.type !== 'navigate' && !String(step.target || '').trim()) fail('У шага отсутствует селектор');
      if (['expectText', 'expectValue', 'select'].includes(step.type) && !String(step.value ?? '').trim()) fail('У шага отсутствует ожидаемое значение');
      if (step.type === 'navigate' && step.value) {
        const raw = String(step.value).trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) fail('Переход разрешён только по http(s)');
        if (raw.includes('://') || raw.startsWith('//')) {
          let target;
          try { target = new URL(raw, parsed); } catch { fail('Некорректный адрес перехода'); }
          if (target.origin !== parsed.origin) fail('Переход за пределы адреса проекта запрещён');
          const decision = decideRequest(target.href, parsed.href, false);
          if (!decision.allow) fail(decision.reason || 'Переход запрещён');
        }
      }
    }
  }
  return config;
}

export function safeName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'item';
}

export function evidenceType(kind) {
  if (kind === 'ai-ux') return 'recommendation';
  if (kind === 'functional' || kind === 'javascript' || kind === 'accessibility' || kind === 'overflow') return 'confirmed';
  return 'observation';
}

export function locatorFor(page, query) {
  const text = String(query || '');
  if (text.startsWith('css:')) return page.locator(text.slice(4));
  if (text.startsWith('text:')) return page.getByText(text.slice(5), { exact: true });
  if (text.startsWith('label:')) return page.getByLabel(text.slice(6), { exact: true });
  if (text.startsWith('placeholder:')) return page.getByPlaceholder(text.slice(12), { exact: true });
  if (text.startsWith('testid:')) return page.getByTestId(text.slice(7));
  if (text.startsWith('role:')) {
    const [role, ...name] = text.slice(5).split('|');
    return page.getByRole(role, name.length ? { name: name.join('|'), exact: true } : {});
  }
  return page.locator(text);
}

export async function executeStep(page, step, baseUrl, timeoutMs = 5500) {
  const value = String(step.value ?? '');
  const loc = step.target ? locatorFor(page, step.target) : null;
  switch (step.type) {
    case 'navigate': {
      const target = new URL(value || '/', baseUrl);
      const base = new URL(baseUrl);
      if (target.origin !== base.origin) throw Error('Переход разрешён только в пределах адреса проекта');
      const decision = decideRequest(target.href, base.href, false);
      if (!decision.allow) throw Error(decision.reason || 'Переход запрещён');
      return page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs + 5000 });
    }
    case 'click': return loc.click({ timeout: timeoutMs });
    case 'fill': return loc.fill(value, { timeout: timeoutMs });
    case 'select': return loc.selectOption(value, { timeout: timeoutMs });
    case 'check': return loc.check({ timeout: timeoutMs });
    case 'expectVisible': return loc.waitFor({ state: 'visible', timeout: timeoutMs });
    case 'expectHidden': return loc.waitFor({ state: 'hidden', timeout: timeoutMs });
    case 'expectText': {
      if (!value.trim()) throw Error('Не задан ожидаемый текст');
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      const actual = (await loc.textContent()) || '';
      if (!actual.includes(value)) throw Error('Текст элемента не соответствует ожидаемому');
      return;
    }
    case 'expectValue': {
      if (!value.trim()) throw Error('Не задано ожидаемое значение');
      const actual = await loc.inputValue({ timeout: timeoutMs });
      if (actual !== value) throw Error('Значение поля не соответствует ожидаемому');
      return;
    }
    case 'wait': return page.waitForTimeout(Math.min(2000, Math.max(0, Number(value) || 400)));
    default: throw Error('Неизвестная операция');
  }
}
