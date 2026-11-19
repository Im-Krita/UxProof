#!/usr/bin/env node
// Bridge for the desktop app: reads {goal, baseUrl, provider} from stdin and
// prints the validated steps as JSON.
import { planScenario } from './planner.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const steps = await planScenario({ goal: input?.goal, baseUrl: input?.baseUrl,
    provider: input?.provider === 'ollama' ? 'ollama' : 'openai' });
  process.stdout.write(JSON.stringify({ steps }));
} catch (error) {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
