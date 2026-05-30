/**
 * Secret redaction for logs. A security tool must never leak credentials in its own output.
 * Pure + dependency-free so it's unit-testable and reusable by the logger formatter.
 */

const REDACTED = '[REDACTED]';

// Pattern-based redaction for well-known credential shapes.
const PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replace: 'Bearer ' + REDACTED },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g, replace: REDACTED },             // GitHub PAT (classic)
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: REDACTED },     // GitHub fine-grained PAT
  { re: /\bgho_[A-Za-z0-9]{20,}\b/g, replace: REDACTED },             // GitHub OAuth token
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: REDACTED },                 // AWS access key id
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replace: REDACTED },           // Google API key
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },     // Slack token
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: REDACTED }, // PEM
  // URL-embedded credentials: scheme://user:pass@host -> scheme://[REDACTED]@host
  { re: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s:@]+@/gi, replace: `$1${REDACTED}@` },
  // Generic key=value / "key": "value" for secret-ish keys.
  { re: /\b(api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key)\b(["':=\s]+)[^\s"',}]+/gi, replace: `$1$2${REDACTED}` }
];

// Literal values of sensitive env vars, registered at startup, redacted wherever they appear.
const ENV_VALUE_KEYS = [
  'GEMINI_API_KEY', 'GITHUB_TOKEN', 'PRIVATE_KEY', 'WEBHOOK_SECRET', 'DB_PASS',
  'DEFECTDOJO_API_KEY', 'DEPENDENCY_TRACK_API_KEY', 'SONAR_TOKEN', 'VERCEL_API_TOKEN'
];
let envValues: string[] = [];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collect literal secret values from the environment so they can be scrubbed from any log line. */
export function registerEnvSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const collected = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue; // too short to redact safely (avoids over-redaction)
    if (ENV_VALUE_KEYS.includes(key) || /(_TOKEN|_SECRET|_API_KEY|_PASSWORD)$/i.test(key)) {
      collected.add(value);
    }
  }
  // Longest-first so a value that contains another is redacted fully.
  envValues = [...collected].sort((a, b) => b.length - a.length);
}

/** Redact secrets from a string (patterns + registered env values). */
export function redactString(input: string): string {
  if (!input) return input;
  let out = input;
  for (const v of envValues) {
    out = out.split(v).join(REDACTED);
  }
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

/** Recursively redact string values in an object/array (for structured log metadata). */
export function redactDeep<T>(value: T, _depth = 0): T {
  if (_depth > 6) return value; // guard against cycles / deep nesting
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => redactDeep(v, _depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, _depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

// Test seam.
export function __resetEnvSecrets(): void { envValues = []; }
