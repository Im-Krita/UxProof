import { decideRequest } from './policy.mjs';
import { ruleIds } from './rules.mjs';
import { LIMITS } from './limits.mjs';
import { configError } from '../shared/config-check.mjs';

export const STEP_TYPES = new Set(LIMITS.stepTypes);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

export function validateConfig(config) {
  try {
    configError(config, LIMITS, ruleIds);
  } catch (error) {
    throw new InputError(String(error?.message || error));
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

export function humanStepError(step, message) {
  const text = String(message || '');
  const name = step?.name || 'шаг';
  const target = String(step?.target || '').trim();
  const where = target ? ` «${target}»` : '';
  if (/timeout/i.test(text) || /exceeded/i.test(text)) return `Не найден элемент${where} за 5,5 с (${name}).`;
  if (/strict mode/i.test(text) || /resolved to \d+ elements/i.test(text)) return `Селектор${where} указывает на несколько элементов (${name}).`;
  if (/not visible|hidden/i.test(text)) return `Элемент${where} не виден (${name}).`;
  if (/not enabled|disabled/i.test(text)) return `Элемент${where} недоступен для действия (${name}).`;
  return `Шаг «${name}» не выполнен.`;
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
