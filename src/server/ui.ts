import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { readManifest } from './library.js';
import { serveReportFile } from './serve.js';
import { renderUiHtml } from './uiHtml.js';
import { maskedOperatorEnv, writeOperatorEnv } from './operatorEnv.js';
import { startScan, getRun, type ScanEvent } from './scanRunner.js';
import { buildSecretsPlan } from './secretsPlan.js';
import { loadConfig } from '../config.js';
import { checkReadiness } from '../readiness.js';
import { getEnabledScanners } from '../orchestrator.js';
import { isBinaryAvailable } from '../utils/preflight.js';
import { EnvironmentDetector, databaseSummaryLine } from '../env.js';
import { isProfileName } from '../profiles.js';
import type { InputCategory, InputTier, ProfileName } from '../types.js';

// Copy-paste install hints for the external tools DAT shells out to.
// Python-based tools use pipx (Homebrew's Python is PEP 668 externally-managed, so plain `pip
// install` is blocked). cover-agent is NOT on PyPI — it ships as a GitHub release binary.
const INSTALL_HINTS: Record<string, string> = {
  semgrep: 'brew install semgrep', trivy: 'brew install trivy', gitleaks: 'brew install gitleaks',
  hadolint: 'brew install hadolint', dockle: 'brew install dockle', checkov: 'pipx install checkov',
  'osv-scanner': 'brew install osv-scanner', 'sonar-scanner': 'brew install sonar-scanner',
  bandit: 'pipx install bandit', 'pip-audit': 'pipx install pip-audit', gosec: 'brew install gosec',
  govulncheck: 'go install golang.org/x/vuln/cmd/govulncheck@latest', cargo: 'install Rust (rustup)',
  dotnet: 'install the .NET SDK', mvn: 'install Maven', gradle: 'install Gradle', k6: 'brew install k6',
  keploy: 'see keploy.io/docs/install', python3: 'install Python 3', docker: 'install Docker Desktop',
  gcloud: 'brew install --cask google-cloud-sdk',
  'cover-agent': 'download cover-agent-<os> from github.com/qodo-ai/qodo-cover/releases',
};

interface ToolStatus { binary: string; present: boolean; hint?: string; }
interface InputView { label: string; category: InputCategory; tier: InputTier; present: boolean; }

/** Validate a user-supplied target path: must be an existing, absolute directory. */
function resolveTarget(p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error('Provide an absolute path to the app directory.');
  const abs = path.resolve(p.trim());
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`"${p}" is not an existing directory.`);
  }
  return abs;
}

async function buildReadiness(target: string, profile: ProfileName | undefined, url: string | undefined, deploy: boolean) {
  const configPath = path.join(target, '.dat.config.yaml');
  const config = loadConfig(configPath);
  const detector = new EnvironmentDetector(target);
  const languages = detector.detectLanguages();
  const dbSummary = databaseSummaryLine(detector.detectDatabases());

  // Pass the already-detected languages so checkReadiness doesn't re-detect them.
  const report = await checkReadiness(config, {
    configPath, workspaceRoot: target, profile, url, deploy, detectedLanguages: languages,
  });

  // Dedupe app inputs by category (the same input, e.g. Dockerfile, can back several scanners).
  const byCat = new Map<InputCategory, InputView>();
  for (const s of report.scanners) {
    for (const i of s.inputs) {
      const prev = byCat.get(i.category);
      if (!prev) byCat.set(i.category, { label: i.label, category: i.category, tier: i.tier, present: i.present });
      else if (i.present) prev.present = true; // present for any scanner => satisfied
    }
  }
  const TIER_ORDER: Record<InputTier, number> = { 'critical': 0, 'highly-advised': 1, 'best-practice': 2 };
  const inputs = [...byCat.values()].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  // Union of required binaries across the enabled scanners → installed/missing matrix.
  const enabled = getEnabledScanners(config, languages, { profile });
  const bins = new Set<string>();
  for (const s of enabled) for (const b of s.requiredBinaries || []) bins.add(b);
  const tools: ToolStatus[] = (await Promise.all([...bins].sort().map(async (b) => ({
    binary: b, present: await isBinaryAvailable(b), hint: INSTALL_HINTS[b],
  }))));

  // The equivalent CLI command for the chosen options.
  const parts = ['dat', 'scan', '--path', target];
  if (profile) parts.push('--profile', profile);
  if (url) parts.push('--url', url);
  else if (deploy) parts.push('--deploy');

  return {
    target,
    languages,
    dbSummary,
    readinessLevel: report.readinessLevel,
    inputs,
    tools,
    command: parts.join(' '),
  };
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64 * 1024) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Only allow loopback Host and (when present) same-origin Origin — blocks DNS-rebinding/CSRF. */
function localOnly(req: http.IncomingMessage): boolean {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return false;
  return true;
}

function tokenMatches(provided: string, token: string): boolean {
  if (provided.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch { return false; }
}

function tokenOk(req: http.IncomingMessage, token: string): boolean {
  const provided = req.headers['x-dat-token'];
  return typeof provided === 'string' && tokenMatches(provided, token);
}

/** Stream a run's events to an SSE client; replays buffered events, then live ones until 'end'. */
function streamRun(req: http.IncomingMessage, res: http.ServerResponse, runId: string): void {
  const run = getRun(runId);
  if (!run) { json(res, 404, { error: 'Unknown run.' }); return; }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (e: ScanEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  for (const e of run.events) send(e);          // replay (synchronous — no event can interleave)
  if (run.status === 'done') { res.end(); return; }
  const onEvent = (e: ScanEvent) => send(e);
  const cleanup = () => run.emitter.off('event', onEvent);
  run.emitter.on('event', onEvent);
  run.emitter.once('end', () => { cleanup(); res.end(); });
  req.on('close', cleanup);
}

/** Pure request handler (no listener) so it can be unit-tested with mock req/res. */
export function createUiHandler(token: string) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // Loopback Host + same-origin guard on EVERY route (not just /api/*) — blocks DNS-rebinding
    // from reading the SPA or the sensitive report files, not only the JSON API.
    if (!localOnly(req)) { json(res, 403, { error: 'Forbidden (non-local origin).' }); return; }

    // Decode defensively: a malformed percent-escape must yield 400, not an unhandled throw.
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    } catch {
      json(res, 400, { error: 'Bad request (malformed URL).' });
      return;
    }

    // The SPA shell — tokenless (it carries no data; it bootstraps the token from ?t=).
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderUiHtml());
      return;
    }

    // Report viewing — tokenless, but Host/Origin-guarded above. Shared, crash-safe file server.
    if (req.method === 'GET' && pathname.startsWith('/r/')) {
      if (!serveReportFile(res, pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
      }
      return;
    }

    // SSE scan stream — EventSource can't set headers, so the token comes via ?t= (still
    // loopback-guarded above). Handled before the generic header-token gate.
    const stream = pathname.match(/^\/api\/scan\/([A-Za-z0-9]+)\/stream$/);
    if (req.method === 'GET' && stream) {
      const q = new URL(req.url || '/', 'http://localhost').searchParams;
      if (!tokenMatches(q.get('t') || '', token)) { json(res, 403, { error: 'Forbidden (bad or missing session token).' }); return; }
      streamRun(req, res, stream[1]);
      return;
    }

    // Everything else under /api/* requires the session token (header).
    if (pathname.startsWith('/api/')) {
      if (!tokenOk(req, token)) { json(res, 403, { error: 'Forbidden (bad or missing session token).' }); return; }

      try {
        if (req.method === 'POST' && pathname === '/api/target') {
          const body = (await readJsonBody(req)) as { path?: string };
          const target = resolveTarget(body.path);
          const detector = new EnvironmentDetector(target);
          json(res, 200, {
            path: target,
            languages: detector.detectLanguages(),
            dbSummary: databaseSummaryLine(detector.detectDatabases()),
          });
          return;
        }
        if (req.method === 'GET' && pathname === '/api/readiness') {
          const q = new URL(req.url || '/', 'http://localhost').searchParams;
          const target = resolveTarget(q.get('path'));
          const profRaw = q.get('profile') || undefined;
          const profile = profRaw && isProfileName(profRaw) ? (profRaw as ProfileName) : undefined;
          json(res, 200, await buildReadiness(target, profile, q.get('url') || undefined, q.get('deploy') === '1'));
          return;
        }
        if (req.method === 'GET' && pathname === '/api/reports') {
          json(res, 200, readManifest());
          return;
        }
        if (req.method === 'GET' && pathname === '/api/operator-settings') {
          json(res, 200, { settings: maskedOperatorEnv() });
          return;
        }
        if (req.method === 'POST' && pathname === '/api/operator-settings') {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          writeOperatorEnv(body);
          json(res, 200, { ok: true, settings: maskedOperatorEnv() });
          return;
        }
        if (req.method === 'GET' && pathname === '/api/secrets-plan') {
          const q = new URL(req.url || '/', 'http://localhost').searchParams;
          const target = resolveTarget(q.get('path'));
          const profRaw = q.get('profile') || undefined;
          const profile = profRaw && isProfileName(profRaw) ? profRaw : undefined;
          json(res, 200, buildSecretsPlan(target, { deploy: q.get('deploy') === '1', url: q.get('url') || undefined, profile }));
          return;
        }
        if (req.method === 'POST' && pathname === '/api/scan') {
          const body = (await readJsonBody(req)) as {
            path?: string; profile?: string; url?: string; deploy?: boolean; appSecrets?: Record<string, unknown>;
          };
          const target = resolveTarget(body.path);
          const profile = body.profile && isProfileName(body.profile) ? body.profile : undefined;
          const url = body.url || undefined;
          const deploy = body.deploy === true;

          // For a deploy run, assemble the ephemeral app env: user-entered values for the genuine
          // third-party ('required') keys, plus a freshly generated value for each auth secret.
          // The DB ('auto-db') is left to DAT's provisioner; 'config' keys to the deploy defaults.
          let appSecrets: Record<string, string> | undefined;
          if (deploy) {
            appSecrets = {};
            const provided = (body.appSecrets && typeof body.appSecrets === 'object') ? body.appSecrets : {};
            for (const k of buildSecretsPlan(target, { deploy, url, profile }).appSecrets) {
              if (k.kind === 'required') {
                const v = provided[k.key];
                if (typeof v === 'string' && v) appSecrets[k.key] = v;
              } else if (k.kind === 'auto-auth') {
                appSecrets[k.key] = crypto.randomBytes(32).toString('base64');
              }
            }
          }

          const runId = startScan({ target, profile, url, deploy, appSecrets });
          json(res, 200, { runId });
          return;
        }
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
        return;
      }
      json(res, 404, { error: 'Unknown endpoint.' });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
}

/** Start the control-panel server (loopback only) with a fresh session token. */
export function startUiServer(port: number): { server: http.Server; token: string } {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer(createUiHandler(token));
  server.listen(port, '127.0.0.1');
  return { server, token };
}
