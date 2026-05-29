import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { isSafeUrl } from '../utils/security.js';
import fs from 'fs';
import path from 'path';

export async function runGarak(targetUrl?: string): Promise<ScannerResult> {
  const startTime = Date.now();
  
  if (!targetUrl) {
    return {
      scannerName: 'Garak (LLM DAST)',
      success: true,
      durationMs: 0,
      issues: [{ id: 'NO-URL', severity: 'INFO', message: 'No target URL provided for LLM DAST scanning. Use --url to enable.', source: 'Garak' }]
    };
  }

  // Validate URL to prevent parameter/command injection or SSRF
  if (!isSafeUrl(targetUrl)) {
    return {
      scannerName: 'Garak (LLM DAST)',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: `Invalid or restricted Garak target URL. SSRF protection blocked access to: ${targetUrl}`
    };
  }

  const reportName = `garak-report-${Date.now()}.jsonl`;
  const reportPath = path.resolve(process.cwd(), reportName);

  try {
    // Run Garak against a REST endpoint
    const args = ['-m', 'garak', '--model_type', 'rest', '--model_name', targetUrl, '--probes', 'promptinject', '--report_location', reportPath];
    const result = await runCommand('python3', args, 600000); 
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
       return {
          scannerName: 'Garak (LLM DAST)', success: false, durationMs, issues: [],
          error: `Garak failed to run. Is garak installed via pip? Details: ${result.stderr.trim().substring(0, 100) || result.stdout.trim().substring(0, 100)}`
       };
    }

    if (!fs.existsSync(reportPath)) {
       return { scannerName: 'Garak (LLM DAST)', success: false, durationMs, issues: [], error: `Garak report JSONL was not generated.` };
    }

    const fileContents = fs.readFileSync(reportPath, 'utf8');
    const lines = fileContents.split('\n').filter(l => l.trim() !== '');
    const issues: Issue[] = [];
    
    lines.forEach(line => {
        try {
            const record = JSON.parse(line);
            // Garak outputs various entries. 'eval' denotes an evaluation of a probe.
            if (record.entry_type === 'eval' && record.status === 'fail') {
                issues.push({
                    id: `GARAK-${record.probe}`,
                    severity: 'CRITICAL',
                    message: `LLM Endpoint vulnerable to ${record.probe}. Attack prompt: "${record.prompt.substring(0, 50)}..."`,
                    file: targetUrl,
                    remediation: `Implement robust input sanitization or system prompt guardrails against ${record.probe}.`,
                    source: 'Garak'
                });
            }
        } catch(e) {
            // Ignore lines that aren't valid JSON
        }
    });

    fs.unlinkSync(reportPath);

    return { scannerName: 'Garak (LLM DAST)', success: true, durationMs, issues };
  } catch (err) {
     if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
     return { scannerName: 'Garak (LLM DAST)', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const garakScanner: Scanner = {
  name: 'Garak (LLM DAST)',
  module: 'llm',
  supportedLanguages: 'all',
  requiredBinaries: ['python3'],
  expectedInputs: [{ label: 'DAST target URL (LLM endpoint)', category: 'dastTarget', kind: 'url' }],
  async run(ctx) {
    return runGarak(ctx.url);
  }
};
