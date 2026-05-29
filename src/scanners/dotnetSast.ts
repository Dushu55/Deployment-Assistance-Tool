import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import * as fs from 'fs';
import * as path from 'path';

export async function runDotnetSast(workspaceRoot: string = process.cwd()): Promise<ScannerResult> {
  const startTime = Date.now();
  const issues: Issue[] = [];
  let durationMs = 0;

  try {
    const sarifFile = path.join(workspaceRoot, 'dotnet-sast-results.sarif');
    
    // Using native MSBuild ErrorLog generation for SARIF (Supported in .NET 5+)
    const cmd = 'dotnet';
    const args = ['build', `/p:ErrorLog=${sarifFile},version=2.1`];
    
    const result = await runCommand(cmd, args, 120000);
    durationMs = Date.now() - startTime;

    // build failure is fine, we just care about the SARIF log
    if (!fs.existsSync(sarifFile)) {
      if (result.exitCode !== 0) {
        return { scannerName: '.NET Analyzers', success: false, durationMs, issues: [], error: `dotnet build failed and no SARIF log was generated: ${result.stderr}` };
      }
      return { scannerName: '.NET Analyzers', success: true, durationMs, issues };
    }

    const sarifData = fs.readFileSync(sarifFile, 'utf-8');
    const parsed = JSON.parse(sarifData);

    if (parsed.runs && Array.isArray(parsed.runs)) {
      for (const run of parsed.runs) {
        if (run.results && Array.isArray(run.results)) {
          for (const res of run.results) {
            // SARIF levels: error -> HIGH, warning -> MEDIUM, note -> LOW
            let severityStr = 'LOW';
            if (res.level === 'error') severityStr = 'HIGH';
            if (res.level === 'warning') severityStr = 'MEDIUM';

            const loc = res.locations?.[0]?.physicalLocation;
            issues.push({
              id: res.ruleId || 'dotnet-analyzer',
              severity: mapSeverity(severityStr),
              message: res.message?.text || 'Analyzer finding',
              file: loc?.artifactLocation?.uri || 'unknown',
              line: loc?.region?.startLine || undefined,
              source: '.NET Analyzers'
            });
          }
        }
      }
    }

    // Cleanup ephemeral SARIF file
    fs.unlinkSync(sarifFile);

    return { scannerName: '.NET Analyzers', success: true, durationMs, issues };

  } catch (err: any) {
    return {
      scannerName: '.NET Analyzers',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: err.message
    };
  }
}

export const dotnetSastScanner: Scanner = {
  name: '.NET Analyzers',
  module: 'static',
  supportedLanguages: ['csharp'],
  requiredBinaries: ['dotnet'],
  async run(ctx) {
    return runDotnetSast(process.cwd());
  }
};
