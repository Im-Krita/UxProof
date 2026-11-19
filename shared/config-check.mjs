import { assertBaseUrlShape, navigateDecision } from './policy-core.mjs';

// Same messages and ordering as the runner validator, but without Node built-ins.
// `limits` and `ruleIds` are injected so the browser bundle can share this code.
export function configError(config, limits, ruleIds) {
  const fail = message => { throw Error(message); };
  if (!config || typeof config !== 'object') fail('Не задана конфигурация');
  const disabled = config.options?.disabledRules;
  if (disabled !== undefined) {
    const valid = Array.isArray(disabled) && disabled.length <= ruleIds.length &&
      disabled.every(id => typeof id === 'string' && Boolean(id.trim())) && new Set(disabled).size === disabled.length &&
      disabled.every(id => ruleIds.includes(id));
    if (!valid) fail('Некорректный список отключённых правил');
  }
  if (config.options?.trace !== undefined && !['off', 'on-failure'].includes(config.options.trace)) fail('Некорректный режим trace');
  const parsed = (() => { try { return assertBaseUrlShape(config.baseUrl); } catch (error) { fail(error.message); } })();
  if (typeof config.project === 'string' && config.project.length > limits.maxProjectLen) fail('Слишком длинное название проекта');
  if (!Array.isArray(config.scenarios) || config.scenarios.length < limits.minScenarios || config.scenarios.length > limits.maxScenarios) fail('Нужно от 1 до 10 сценариев');
  if (!Array.isArray(config.viewports) || config.viewports.length < limits.minViewports || config.viewports.length > limits.maxViewports) fail('Нужно от 1 до 4 разрешений экрана');
  for (const vp of config.viewports) {
    if (!Number.isInteger(vp?.width) || !Number.isInteger(vp?.height) || vp.width < limits.minWidth || vp.width > limits.maxWidth || vp.height < limits.minHeight || vp.height > limits.maxHeight) fail('Недопустимые размеры экрана');
  }
  for (const scenario of config.scenarios) {
    if (typeof scenario?.title !== 'string' || scenario.title.length > limits.maxScenarioTitle || !Array.isArray(scenario.steps) || scenario.steps.length < limits.minSteps || scenario.steps.length > limits.maxSteps) fail('Некорректный сценарий');
    for (const step of scenario.steps) {
      if (!limits.stepTypes.includes(step?.type)) fail(`Неизвестный шаг: ${step?.type}`);
      if (typeof step.name === 'string' && step.name.length > limits.maxStepName) fail('Слишком длинное название шага');
      if (typeof step.target === 'string' && step.target.length > limits.maxTarget) fail('Слишком длинный селектор');
      if (typeof step.value === 'string' && step.value.length > limits.maxValue) fail('Слишком длинное значение шага');
      if (step.type !== 'wait' && step.type !== 'navigate' && !String(step.target || '').trim()) fail('У шага отсутствует селектор');
      if (['expectText', 'expectValue', 'select'].includes(step.type) && !String(step.value ?? '').trim()) fail('У шага отсутствует ожидаемое значение');
      if (step.type === 'navigate' && step.value) {
        const decision = navigateDecision(config.baseUrl, step.value);
        if (!decision.allow) fail(decision.reason || 'Переход запрещён');
      }
    }
  }
  return config;
}

export function configErrorText(config, limits, ruleIds) {
  try { configError(config, limits, ruleIds); return ''; } catch (error) { return String(error?.message || error); }
}
