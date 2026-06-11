import { ScannerResult, Issue, Scanner } from '../types.js';

/**
 * Zero-cost response-header hardening check against a running URL. Pure Node fetch — no external
 * binary, no API key. Complements ZAP (active DAST): this is the passive, instant tier that runs
 * even where docker/ZAP aren't available.
 */

// NOTE: deliberately NOT utils/security.isSafeUrl — that guard blocks localhost/RFC1918, but
// `http://localhost:3000` is the primary DAST target for this loopback-bound tool. We only block
// non-http(s) schemes and cloud metadata endpoints (the actual SSRF prize).
function isCheckableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === '[fd00:ec2::254]') return false;
    return true;
  } catch {
    return false;
  }
}

const SRC = 'HTTP Security Headers';

/** Pure header analysis, exported for unit tests. */
export function analyzeHeaders(headers: Headers, finalUrl: string): Issue[] {
  const issues: Issue[] = [];
  const https = finalUrl.startsWith('https:');
  const add = (id: string, severity: Issue['severity'], message: string, remediation: string) =>
    issues.push({ id, severity, message, remediation, file: finalUrl, source: SRC, category: 'security' });

  const csp = headers.get('content-security-policy');
  if (!csp) {
    add('HDR-CSP-MISSING', 'MEDIUM',
      'No Content-Security-Policy header — XSS payloads and injected scripts run unrestricted.',
      "Add a Content-Security-Policy header (start with \"default-src 'self'\" and extend as needed).");
  }
  if (https && !headers.get('strict-transport-security')) {
    add('HDR-HSTS-MISSING', 'MEDIUM',
      'No Strict-Transport-Security header — browsers may be downgraded to plain HTTP.',
      'Add: Strict-Transport-Security: max-age=31536000; includeSubDomains');
  }
  if (!https) {
    add('HDR-NOT-HTTPS', 'INFO',
      'The target serves plain HTTP, so transport-security headers (HSTS) do not apply. ' +
      'Fine for local previews; production must be HTTPS.',
      'Serve production traffic over HTTPS (terminate TLS at the load balancer or CDN).');
  }
  if (!headers.get('x-frame-options') && !(csp && /frame-ancestors/i.test(csp))) {
    add('HDR-XFO-MISSING', 'LOW',
      'No X-Frame-Options (and no CSP frame-ancestors) — the site can be framed for clickjacking.',
      'Add: X-Frame-Options: DENY (or a CSP frame-ancestors directive).');
  }
  if ((headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    add('HDR-XCTO-MISSING', 'LOW',
      'X-Content-Type-Options is not "nosniff" — browsers may MIME-sniff responses into executable types.',
      'Add: X-Content-Type-Options: nosniff');
  }
  if (!headers.get('referrer-policy')) {
    add('HDR-REFERRER-MISSING', 'LOW',
      'No Referrer-Policy header — full URLs (which can carry tokens/ids) leak to third-party sites.',
      'Add: Referrer-Policy: strict-origin-when-cross-origin');
  }
  if (!headers.get('permissions-policy')) {
    add('HDR-PERMISSIONS-MISSING', 'LOW',
      'No Permissions-Policy header — embedded content can request powerful features (camera, geolocation).',
      'Add: Permissions-Policy: camera=(), microphone=(), geolocation=()');
  }

  for (const raw of headers.getSetCookie()) {
    const name = raw.split('=')[0].trim() || 'cookie';
    const flags = raw.toLowerCase();
    if (https && !/;\s*secure/.test(flags)) {
      add('HDR-COOKIE-INSECURE', 'LOW',
        `Cookie "${name}" is set without the Secure flag — it can be sent over plain HTTP.`,
        `Append "; Secure" to the ${name} cookie.`);
    }
    if (!/;\s*httponly/.test(flags)) {
      add('HDR-COOKIE-HTTPONLY', 'LOW',
        `Cookie "${name}" is set without HttpOnly — scripts (and XSS payloads) can read it.`,
        `Append "; HttpOnly" to the ${name} cookie.`);
    }
    if (!/;\s*samesite=/.test(flags)) {
      add('HDR-COOKIE-SAMESITE', 'LOW',
        `Cookie "${name}" has no SameSite attribute — it is sent on cross-site requests (CSRF surface).`,
        `Append "; SameSite=Lax" (or Strict) to the ${name} cookie.`);
    }
  }

  if (headers.get('x-powered-by')) {
    add('HDR-XPOWEREDBY-LEAK', 'LOW',
      `X-Powered-By reveals the stack ("${headers.get('x-powered-by')}") — free recon for attackers.`,
      'Remove the X-Powered-By header (e.g. app.disable("x-powered-by") in Express).');
  }
  const server = headers.get('server');
  if (server && /\d/.test(server)) {
    add('HDR-SERVER-LEAK', 'INFO',
      `The Server header exposes a version ("${server}") — attackers match it against CVE lists.`,
      'Strip the version from the Server header at the proxy/web server.');
  }

  return issues;
}

export async function runHttpHeaders(url?: string): Promise<ScannerResult> {
  const startTime = Date.now();

  if (!url) {
    // INFO, not a HIGH coverage gap — ZAP already owns the "no DAST target" gate signal, and
    // doubling it would double-penalize the same missing input.
    return {
      scannerName: SRC, success: true, durationMs: 0,
      issues: [{
        id: 'HDR-NO-TARGET', severity: 'INFO', source: SRC,
        message: 'No target URL — response-header checks skipped. Provide --url (or --deploy) to enable them.',
      }]
    };
  }
  if (!isCheckableUrl(url)) {
    return {
      scannerName: SRC, success: false, durationMs: Date.now() - startTime, issues: [],
      error: `Target URL is not checkable (must be http/https, not a metadata endpoint): ${url}`
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const issues = analyzeHeaders(response.headers, response.url || url);
    return { scannerName: SRC, success: true, durationMs: Date.now() - startTime, issues };
  } catch (err) {
    // An unreachable *supplied* target is a real signal (matches the ZAP error convention).
    return {
      scannerName: SRC, success: false, durationMs: Date.now() - startTime, issues: [],
      error: `Could not fetch ${url}: ${(err as Error).message}`
    };
  }
}

export const httpHeadersScanner: Scanner = {
  name: SRC,
  module: 'security',
  supportedLanguages: 'all',
  // Deliberately NO expectedInputs: declaring dastTarget (critical tier) would mark every
  // URL-less standard scan "not production-safe". That gate signal belongs to ZAP/k6/Garak;
  // this check is opportunistic — it runs when a URL exists and self-skips (INFO) when not.
  async run(ctx) {
    return runHttpHeaders(ctx.url);
  }
};
