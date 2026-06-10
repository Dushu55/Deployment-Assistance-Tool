import fs from 'fs';
import path from 'path';
import { datHome } from './library.js';

/**
 * Operator-level credentials for DAT itself (set once, reused for every app it scans). Persisted to
 * `~/.dat/.env` (owner-only, 0600) and injected into the scan subprocess env by scanRunner. These are
 * NOT an app's own secrets — those stay in memory for a single run (Phase 3).
 */
export const OPERATOR_ENV_KEYS = [
  'NEON_API_KEY', 'NEON_ORG_ID', 'GCP_PROJECT_ID',
  'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'DEFECTDOJO_URL', 'DEFECTDOJO_API_KEY',
  'DEPENDENCY_TRACK_URL', 'DEPENDENCY_TRACK_API_KEY',
  'SONAR_TOKEN',
] as const;

const KNOWN = new Set<string>(OPERATOR_ENV_KEYS);

function envFile(): string {
  return path.join(datHome(), '.env');
}

/** Parse `~/.dat/.env` into a flat map (all keys, not just known ones). */
export function readOperatorEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = '';
  try { raw = fs.readFileSync(envFile(), 'utf8'); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export interface OperatorSetting { key: string; set: boolean; source: 'store' | 'env' | null }

/**
 * Which known credentials are currently set, and from where — checking BOTH `~/.dat/.env` (the
 * UI-managed store) and `process.env` (DAT loads its repo .env into process.env at import, so creds
 * an operator already configured there count). Never returns the values themselves.
 */
export function maskedOperatorEnv(): OperatorSetting[] {
  const store = readOperatorEnv();
  return OPERATOR_ENV_KEYS.map((key) => {
    if (store[key]) return { key, set: true, source: 'store' };
    if (process.env[key]) return { key, set: true, source: 'env' };
    return { key, set: false, source: null };
  });
}

/**
 * Merge updates for KNOWN keys into `~/.dat/.env` (unknown existing keys are preserved; an empty/null
 * value deletes the key). Writes owner-only.
 */
export function writeOperatorEnv(updates: Record<string, unknown>): void {
  const current = readOperatorEnv();
  for (const [key, value] of Object.entries(updates)) {
    if (!KNOWN.has(key)) continue; // never let the UI write arbitrary env keys
    if (value === '' || value === null || value === undefined) delete current[key];
    else current[key] = String(value);
  }
  const dir = datHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  const body = Object.keys(current).sort().map((k) => `${k}=${JSON.stringify(current[k])}`).join('\n') + '\n';
  fs.writeFileSync(envFile(), body, { mode: 0o600 });
  try { fs.chmodSync(envFile(), 0o600); } catch { /* best effort */ }
}
