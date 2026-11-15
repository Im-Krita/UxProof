import { createHash } from 'node:crypto';

// Identity is based only on explicit rule and anchor evidence, never on run metadata.
export function findingId({ ruleId, anchor }) {
  if (typeof ruleId !== 'string' || !ruleId.trim() || !Array.isArray(anchor) ||
      !anchor.length || anchor.some(part => typeof part !== 'string' || !part.trim())) {
    throw new TypeError('A rule ID and a non-empty anchor are required');
  }
  const identity = JSON.stringify([ruleId, anchor]);
  return `finding-${createHash('sha256').update(identity).digest('hex')}`;
}
