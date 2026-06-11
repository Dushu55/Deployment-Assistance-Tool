import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner, Severity, DatConfig } from '../types.js';
import { mapSeverity } from '../utils.js';
import fs from 'fs';
import path from 'path';

async function fetchWithAuth(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Basic ${Buffer.from(token + ':').toString('base64')}`;
  }
  return fetch(url, { headers });
}

/** True when the target ships its own SonarQube config (which we then leave untouched). */
function hasPropertiesFile(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, 'sonar-project.properties'));
}

/**
 * SonarQube needs a server to talk to. Configured = SONAR_TOKEN + a host URL (env or config), OR the
 * target ships its own sonar-project.properties. Without that, skip gracefully (advisory) rather than
 * failing the gate. NOTE: a SONAR_PROJECT_KEY alone is NOT enough — a key can't reach a server.
 */
export function isSonarConfigured(cwd: string = process.cwd(), config?: DatConfig): boolean {
  const hostUrl = process.env.SONAR_HOST_URL || config?.scanners?.sonarqube?.hostUrl;
  if (process.env.SONAR_TOKEN && hostUrl) return true;
  return hasPropertiesFile(cwd);
}

/**
 * Project key when the repo has no sonar config: explicit override → SONAR_PROJECT_KEY → a slug of the
 * app folder name. Sanitized to SonarQube's allowed key charset ([A-Za-z0-9._:-]); prefixed `dat-` when
 * empty or all-digits (SonarQube rejects all-numeric keys). A self-hosted server auto-creates it.
 */
export function deriveProjectKey(cwd: string = process.cwd(), config?: DatConfig): string {
  const explicit = config?.scanners?.sonarqube?.projectKey || process.env.SONAR_PROJECT_KEY;
  if (explicit) return explicit;
  const slug = path.basename(cwd).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (!slug || /^\d+$/.test(slug)) ? `dat-${slug || 'app'}` : slug;
}

// Dependency/build/output dirs SonarQube should never analyse — keeps a zero-config run signal-rich.
export const DEFAULT_SONAR_EXCLUSIONS = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/out/**',
  '**/coverage/**', '**/vendor/**', '**/.venv/**', '**/__pycache__/**', '**/target/**',
];

export interface SonarArgsOptions {
  cwd: string;
  config?: DatConfig;
  hasProperties: boolean;       // when true, inject nothing — the repo's own config wins
}

/**
 * Build the `sonar-scanner` CLI flags DAT injects so SonarQube runs without an in-repo config. Pure
 * (no I/O) for testing. The token is NEVER placed here — sonar-scanner reads SONAR_TOKEN from the
 * environment, so it stays out of the process argument list. Returns [] when the repo configures Sonar.
 */
export function buildSonarArgs(opts: SonarArgsOptions): string[] {
  if (opts.hasProperties) return [];
  const cfg = opts.config?.scanners?.sonarqube;
  const hostUrl = process.env.SONAR_HOST_URL || cfg?.hostUrl;
  const args = [
    `-Dsonar.projectKey=${deriveProjectKey(opts.cwd, opts.config)}`,
    `-Dsonar.projectName=${path.basename(opts.cwd)}`,
    `-Dsonar.sources=${cfg?.sources || '.'}`,
    '-Dsonar.scm.disabled=true',
  ];
  if (hostUrl) args.push(`-Dsonar.host.url=${hostUrl}`);
  // Default-exclude dependency/build dirs so a zero-config run doesn't analyse vendored code (which
  // produces junk findings, e.g. issues inside node_modules); merge the global config.exclude on top.
  const exclusions = [...DEFAULT_SONAR_EXCLUSIONS, ...(opts.config?.exclude ?? [])];
  args.push(`-Dsonar.exclusions=${exclusions.join(',')}`);
  // Only for SonarCloud — never required on self-hosted, added only when explicitly provided.
  const org = process.env.SONAR_ORGANIZATION || cfg?.organization;
  if (org) args.push(`-Dsonar.organization=${org}`);
  return args;
}

export async function runSonarQube(cwd: string = process.cwd(), config?: DatConfig): Promise<ScannerResult> {
  const startTime = Date.now();

  // SonarQube is advisory code-quality, not a security gate. With no server configured, skip
  // gracefully (like ZAP's missing-target coverage gap) rather than failing the quality gate.
  if (!isSonarConfigured(cwd, config)) {
    return {
      scannerName: 'SonarQube', success: true, skipped: true, durationMs: Date.now() - startTime,
      skipReason: 'No SonarQube server configured.',
      issues: [{
        id: 'SONARQUBE-NOT-CONFIGURED', severity: 'INFO',
        message: 'SonarQube skipped: no server configured. Set SONAR_HOST_URL + SONAR_TOKEN (operator settings) to run it on any app — no in-repo sonar-project.properties needed.',
        source: 'SonarQube',
      }],
    };
  }

  try {
    // Inject the analysis parameters ourselves (project key, host, sources, exclusions) so SonarQube
    // runs on a target with no committed config; a repo that ships sonar-project.properties wins.
    const args = buildSonarArgs({ cwd, config, hasProperties: hasPropertiesFile(cwd) });
    const result = await runCommand('sonar-scanner', args, 300000); // 5 min timeout
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      // Configured but the run failed (server unreachable / bad config). Stay advisory — skip rather
      // than fail the gate on a SonarQube infrastructure problem.
      return {
        scannerName: 'SonarQube', success: true, skipped: true, durationMs,
        skipReason: `sonar-scanner exited ${result.exitCode}`,
        issues: [{
          id: 'SONARQUBE-RUN-FAILED', severity: 'INFO',
          message: `SonarQube skipped: scanner exited ${result.exitCode} (server unreachable or misconfigured). ${(result.stderr.trim() || result.stdout.trim()).substring(0, 160)}`,
          source: 'SonarQube',
        }],
      };
    }

    const reportTaskPath = path.resolve(process.cwd(), '.scannerwork/report-task.txt');
    if (!fs.existsSync(reportTaskPath)) {
       return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: 'SonarQube report-task.txt not found. Polling skipped.' };
    }

    const taskData = fs.readFileSync(reportTaskPath, 'utf8');
    const props: Record<string, string> = {};
    taskData.split('\n').forEach(line => {
       // Split on the FIRST '=' only — values are URLs (ceTaskUrl=…/api/ce/task?id=<uuid>) that
       // contain their own '=', so a naive split('=') truncates the task id and breaks polling.
       const idx = line.indexOf('=');
       if (idx > 0) props[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });

    const ceTaskUrl = props['ceTaskUrl'];
    const serverUrl = props['serverUrl'];
    const projectKey = props['projectKey'];
    const token = process.env.SONAR_TOKEN;

    if (!ceTaskUrl || !serverUrl || !projectKey) {
        return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: 'Incomplete SonarQube task data.' };
    }

    // Poll the compute-engine task until the analysis is processed. A cold server's FIRST analysis
    // can take a couple of minutes to index, so budget generously (~4 min, within the orchestrator's
    // per-scanner timeout) and distinguish "still processing" from a real FAILED/CANCELED task.
    const POLL_MS = 3000, MAX_POLLS = 80; // ~4 minutes
    let status = 'PENDING';
    for (let attempt = 0; (status === 'PENDING' || status === 'IN_PROGRESS') && attempt < MAX_POLLS; attempt++) {
       await new Promise(r => setTimeout(r, POLL_MS));
       // Tolerate transient blips (a 5xx/429 while the server is busy, a dropped connection) by
       // continuing to poll within the budget — never abort the whole analysis on one bad response.
       try {
         const ceRes = await fetchWithAuth(ceTaskUrl, token);
         if (!ceRes.ok) continue;
         const ceJson = (await ceRes.json()) as any;
         status = ceJson?.task?.status ?? status;
       } catch { /* transient network error — keep polling */ }
    }

    // Upload succeeded but the server is still crunching, or the task didn't end SUCCESS. Stay
    // advisory (never fail the gate) but report it as SKIPPED with a real reason — NOT a clean
    // "no issues found", which would falsely imply the code is clean.
    if (status === 'PENDING' || status === 'IN_PROGRESS') {
       return {
         scannerName: 'SonarQube', success: true, skipped: true, durationMs: Date.now() - startTime,
         skipReason: 'Analysis submitted but the server was still processing after ~4 min; results not fetched. Re-run to collect them.',
         issues: [{ id: 'SONARQUBE-PENDING', severity: 'INFO', source: 'SonarQube',
           message: `SonarQube analysis was submitted but its server task was still ${status} after polling; findings were not retrieved this run.` }],
       };
    }
    if (status !== 'SUCCESS') {
       return {
         scannerName: 'SonarQube', success: true, skipped: true, durationMs: Date.now() - startTime,
         skipReason: `SonarQube compute task ended ${status}`,
         issues: [{ id: 'SONARQUBE-TASK-FAILED', severity: 'INFO', source: 'SonarQube',
           message: `SonarQube server task ended with status ${status}; no findings retrieved.` }],
       };
    }

    // Fetch issues
    const issuesUrl = `${serverUrl}/api/issues/search?componentKeys=${projectKey}&resolved=false&ps=500`;
    const issuesRes = await fetchWithAuth(issuesUrl, token);
    if (!issuesRes.ok) {
       return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: `Failed to fetch issues from SonarQube.` };
    }

    const issuesJson = (await issuesRes.json()) as any;
    const issues: Issue[] = [];

    if (issuesJson.issues && Array.isArray(issuesJson.issues)) {
       issuesJson.issues.forEach((sqIssue: any) => {
          let severityStr = sqIssue.severity || 'MEDIUM';
          if (sqIssue.impacts && sqIssue.impacts.length > 0) {
              severityStr = sqIssue.impacts[0].severity; // Use new Clean Code impact severity if available
          }
          issues.push({
             id: sqIssue.rule,
             severity: mapSeverity(severityStr),
             message: sqIssue.message,
             file: sqIssue.component ? sqIssue.component.replace(`${projectKey}:`, '') : undefined,
             line: sqIssue.line,
             source: 'SonarQube'
          });
       });
    }

    return { scannerName: 'SonarQube', success: true, durationMs: Date.now() - startTime, issues };

  } catch (err) {
    return { scannerName: 'SonarQube', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const sonarqubeScanner: Scanner = {
  name: 'SonarQube',
  module: 'static',
  supportedLanguages: 'all',
  requiredBinaries: ['sonar-scanner'],
  async run(ctx) { return runSonarQube(process.cwd(), ctx.config); }
};
