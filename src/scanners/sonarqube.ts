import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner, Severity } from '../types.js';
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

export async function runSonarQube(): Promise<ScannerResult> {
  const startTime = Date.now();
  try {
    const result = await runCommand('sonar-scanner', [], 300000); // 5 min timeout
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
      return {
        scannerName: 'SonarQube',
        success: false,
        durationMs,
        issues: [],
        error: `Scanner failed with code ${result.exitCode}. Ensure sonar-scanner is installed. Details: ${result.stderr.trim() || result.stdout.trim().substring(0, 100)}`
      };
    }

    const reportTaskPath = path.resolve(process.cwd(), '.scannerwork/report-task.txt');
    if (!fs.existsSync(reportTaskPath)) {
       return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: 'SonarQube report-task.txt not found. Polling skipped.' };
    }

    const taskData = fs.readFileSync(reportTaskPath, 'utf8');
    const props: Record<string, string> = {};
    taskData.split('\n').forEach(line => {
       const [k, v] = line.split('=');
       if (k && v) props[k.trim()] = v.trim();
    });

    const ceTaskUrl = props['ceTaskUrl'];
    const serverUrl = props['serverUrl'];
    const projectKey = props['projectKey'];
    const token = process.env.SONAR_TOKEN;

    if (!ceTaskUrl || !serverUrl || !projectKey) {
        return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: 'Incomplete SonarQube task data.' };
    }

    // Polling logic
    let status = 'PENDING';
    let attempts = 0;
    while ((status === 'PENDING' || status === 'IN_PROGRESS') && attempts < 30) {
       await new Promise(r => setTimeout(r, 2000));
       attempts++;
       const ceRes = await fetchWithAuth(ceTaskUrl, token);
       if (!ceRes.ok) break;
       const ceJson = (await ceRes.json()) as any;
       status = ceJson.task.status;
    }

    if (status !== 'SUCCESS') {
       return { scannerName: 'SonarQube', success: true, durationMs, issues: [], error: `SonarQube analysis failed or timed out. Status: ${status}` };
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
  async run(ctx) { return runSonarQube(); }
};
