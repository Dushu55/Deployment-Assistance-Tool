import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import fs from 'fs';
import path from 'path';

export async function runPromptfoo(targetDir: string = '.'): Promise<ScannerResult> {
  const startTime = Date.now();
  const configPath = path.resolve(process.cwd(), targetDir, 'promptfooconfig.yaml');
  const reportPath = path.resolve(process.cwd(), targetDir, `promptfoo-report-${Date.now()}.json`);
  
  if (!fs.existsSync(configPath)) {
    return {
      scannerName: 'Promptfoo', success: true, durationMs: Date.now() - startTime,
      issues: [{ id: 'NO-CONFIG', severity: 'INFO', message: 'No promptfooconfig.yaml found. Skipping.', source: 'Promptfoo' }]
    };
  }

  try {
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return {
         scannerName: 'Promptfoo', success: true, durationMs: Date.now() - startTime,
         issues: [{ id: 'NO-API-KEY', severity: 'INFO', message: 'Skipping Promptfoo: No LLM API key provided.', source: 'Promptfoo' }]
      };
    }

    const result = await runCommand('npx', ['promptfoo', 'eval', '-c', configPath, '-o', reportPath], 300000, targetDir);
    const durationMs = Date.now() - startTime;

    if (!fs.existsSync(reportPath)) {
       return { scannerName: 'Promptfoo', success: false, durationMs, issues: [], error: `Promptfoo report not generated. Details: ${result.stderr.trim() || result.stdout.substring(0, 150)}` };
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const issues: Issue[] = [];

    if (report.results && report.results.results) {
       report.results.results.forEach((res: any) => {
          if (!res.success) {
              res.gradingResult?.componentResults?.forEach((failure: any) => {
                  if (!failure.pass) {
                      issues.push({
                          id: 'PROMPT-ASSERTION-FAILED',
                          severity: 'HIGH',
                          message: `Prompt failed assertion (${failure.assertion?.type || 'semantic'}): ${failure.reason}`,
                          file: configPath,
                          source: 'Promptfoo'
                      });
                  }
              });
          }
       });
    }

    fs.unlinkSync(reportPath);

    return { scannerName: 'Promptfoo', success: true, durationMs, issues };
  } catch (err) {
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    return { scannerName: 'Promptfoo', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const promptfooScanner: Scanner = {
  name: 'Promptfoo',
  module: 'llm',
  supportedLanguages: 'all',
  async run(ctx) {
    const dir = ctx.config.scanners.promptfoo?.targetDir || '.';
    return runPromptfoo(dir);
  }
};
