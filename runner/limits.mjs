import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schemas/audit-config-limits.json');
export const LIMITS = JSON.parse(fs.readFileSync(file, 'utf8'));
