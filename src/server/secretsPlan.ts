import fs from 'fs';
import path from 'path';
import { EnvironmentDetector } from '../env.js';
import { maskedOperatorEnv } from './operatorEnv.js';
import { gcloudStatus } from './gcloud.js';

/**
 * Works out exactly which secrets a scan needs, split into the two classes the UI presents:
 *   - operator credentials (DAT-host, persisted in ~/.dat/.env) needed for the chosen run, and
 *   - the target app's OWN runtime env (from its .env.example) needed to BOOT it for a --deploy DAST,
 *     classified so the UI only asks for genuine third-party secrets — the DB is auto-provisioned and
 *     an auth secret is auto-generated.
 */
const DB_RE = /^(DATABASE_URL|DATABASE|DB_URL|DB_HOST|DB_NAME|POSTGRES|POSTGRESQL|PG|PGHOST|MYSQL|MONGO|MONGODB|REDIS)/i;
// Full-match only: an app's own session/auth secret (auto-generated). A third-party key like
// STRIPE_SECRET_KEY must NOT match here — those stay 'required' (the safe default is to ask).
const AUTH_SECRET_RE = /^(NEXTAUTH_SECRET|AUTH_SECRET|SESSION_SECRET|JWT_SECRET|COOKIE_SECRET|TOKEN_SECRET|SECRET_KEY|APP_SECRET|DJANGO_SECRET_KEY|FLASK_SECRET_KEY)$/i;
const CONFIG_RE = /^(NODE_ENV|PORT|HOST|HOSTNAME|NEXT_PUBLIC_|VITE_|PUBLIC_|LOG_LEVEL|TZ|NEXTAUTH_URL)/i;

export type AppKeyKind = 'required' | 'auto-db' | 'auto-auth' | 'config';
export interface AppSecretKey { key: string; kind: AppKeyKind; defaultValue?: string; note: string; }
export interface OperatorNeed { key: string; required: boolean; set: boolean; detail?: string }
export interface SecretsPlan {
  hasEnvExample: boolean;
  appSecrets: AppSecretKey[];
  operator: OperatorNeed[];
  gcloud?: { account: string | null; project: string | null };
  needsDocker: boolean;
  notes: string[];
}

export interface SecretsPlanOptions { deploy?: boolean; url?: string; profile?: string }

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

/** Parse a target's .env.example (or .sample/.template); null when none exists. */
function parseEnvExample(target: string): Array<{ key: string; value: string }> | null {
  for (const name of ['.env.example', '.env.sample', '.env.template']) {
    let raw: string;
    try { raw = fs.readFileSync(path.join(target, name), 'utf8'); } catch { continue; }
    const out: Array<{ key: string; value: string }> = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out.push({ key: m[1], value: stripQuotes(m[2]) });
    }
    return out;
  }
  return null;
}

function classify(key: string, dbDetected: boolean): { kind: AppKeyKind; note: string } {
  if (CONFIG_RE.test(key)) return { kind: 'config', note: 'Non-secret config — the deploy sets a sensible default.' };
  if (AUTH_SECRET_RE.test(key)) return { kind: 'auto-auth', note: 'Auto-generated per run (a fresh random secret); you don\'t enter it.' };
  if (DB_RE.test(key)) {
    return dbDetected
      ? { kind: 'auto-db', note: 'Auto-provisioned: DAT spins an ephemeral DB and injects this.' }
      : { kind: 'required', note: 'Database URL — no engine auto-detected, so provide one.' };
  }
  return { kind: 'required', note: 'Third-party secret the app needs at startup — enter it for the run.' };
}

export function buildSecretsPlan(target: string, opts: SecretsPlanOptions): SecretsPlan {
  const dbDetected = new EnvironmentDetector(target).detectDatabases().length > 0;
  const entries = parseEnvExample(target);
  const appSecrets: AppSecretKey[] = (entries ?? []).map(({ key, value }) => {
    const { kind, note } = classify(key, dbDetected);
    return { key, kind, note, defaultValue: kind === 'required' && value ? value : undefined };
  });

  // Operator credentials this run needs. A cred counts as "set" from ~/.dat/.env OR process.env
  // (DAT loads its repo .env there); GCP additionally counts when gcloud is authed with a project.
  const masked = maskedOperatorEnv();
  const find = (k: string) => masked.find((m) => m.key === k);
  const operator: OperatorNeed[] = [];
  let gcloud: { account: string | null; project: string | null } | undefined;
  if (opts.deploy) {
    gcloud = gcloudStatus();
    const gcpEnv = find('GCP_PROJECT_ID');
    const gcpFromGcloud = Boolean(gcloud.project && gcloud.account);
    operator.push({
      key: 'GCP_PROJECT_ID',
      required: true,
      set: Boolean(gcpEnv?.set) || gcpFromGcloud,
      detail: gcpEnv?.set ? `from ${gcpEnv.source}` : (gcloud.project ? `gcloud: ${gcloud.project}` : undefined),
    });
    for (const key of ['NEON_API_KEY', 'NEON_ORG_ID'] as const) {
      const m = find(key);
      operator.push({ key, required: key === 'NEON_API_KEY', set: Boolean(m?.set), detail: m?.set ? `from ${m.source}` : undefined });
    }
  }

  const needsDocker = Boolean(opts.url || opts.deploy); // ZAP (DAST) runs in Docker
  const notes: string[] = [];
  if (opts.deploy) notes.push('Deploy provisions an ephemeral GCP Cloud Run + Neon DB, scans it, and tears both down.');
  if (opts.deploy && gcloud?.project) notes.push(`Using gcloud project "${gcloud.project}" (account: ${gcloud.account ?? 'none'}).`);
  if (needsDocker) notes.push('Dynamic scanning (OWASP ZAP) requires the Docker daemon to be running.');
  if (opts.url) notes.push('The target app must already be running and reachable at the URL.');

  return { hasEnvExample: entries !== null, appSecrets, operator, gcloud, needsDocker, notes };
}
