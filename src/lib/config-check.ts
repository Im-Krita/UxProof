import { baseUrlError } from '../../shared/policy-core.mjs';
import { configErrorText } from '../../shared/config-check.mjs';
import LIMITS from '@uxproof/audit-config-limits.json';
import REGISTRY from '@uxproof/rule-registry.json';

export const RULE_IDS: string[] = REGISTRY.rules.map(rule => rule.ruleId);

// Same message the runner and the Rust IPC boundary produce for this address.
export function clientUrlError(value: string) {
  return baseUrlError(value);
}

// Full project contract, not a shape-only subset.
export function projectConfigError(value: unknown) {
  return configErrorText(value, LIMITS, RULE_IDS);
}
