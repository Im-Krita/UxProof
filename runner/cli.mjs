#!/usr/bin/env node
import fs from 'node:fs/promises';
import { runAudit } from './audit.mjs';

try {
  if (!process.argv[2]) throw Error('Usage: node runner/cli.mjs path/to/config.json');
  const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const report = await runAudit(input);
  process.stdout.write(JSON.stringify(report));
} catch (error) {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
}
