// load-env.mjs — zero-dependency .env loader.
// Import this at the top of any script that needs repo-root .env values
// (e.g. CENSUS_API_KEY). Reads <repo-root>/.env once, sets process.env for any
// key not already present (real environment variables always win). No-ops
// silently if .env is absent, so CI — which has no .env — is unaffected.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env'); // scripts/lib -> repo root

try {
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip surrounding single or double quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err; // missing .env is fine; other errors are not
}
