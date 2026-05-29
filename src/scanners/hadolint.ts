import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';
import fs from 'fs';
import { refactorToDistroless } from '../autofix/docker.js';
import { logger } from '../logger.js';

export async function runHadolint(target: string = 'testing_data/Dockerfile', enableAutoFix: boolean = false): Promise<ScannerResult> {
  const startTime = Date.now();
  try {
    if (!fs.existsSync(target)) {
       return {
          scannerName: 'Hadolint',
          success: true, 
          durationMs: Date.now() - startTime,
          issues: [{ id: 'NO-DOCKERFILE', severity: 'INFO', message: `No ${target} found to scan.`, source: 'Hadolint' }]
       };
    }

    const result = await runCommand('hadolint', ['-f', 'json', target], 60000);
    let durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
            scannerName: 'Hadolint',
            success: false,
            durationMs,
            issues: [],
            error: `Hadolint exited with code ${result.exitCode}. Details: ${result.stderr.trim()}`
        };
    }

    let parsedOutput = JSON.parse(result.stdout || '[]');
    let issues: Issue[] = parsedOutput.map((r: any) => ({
      id: r.code,
      severity: mapSeverity(r.level),
      message: r.message,
      file: r.file,
      line: r.line,
      source: 'Hadolint'
    }));

    // Detect if we have high/critical structural issues or specific base image rules
    const hasCriticalLinting = issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    
    if (hasCriticalLinting && enableAutoFix) {
      logger.info(`Hadolint detected High/Critical issues in ${target}. Triggering LLM Auto-Distroless Refactoring...`);
      const refactorSuccess = await refactorToDistroless(target);
      
      if (refactorSuccess) {
         // Optionally, re-run hadolint to verify the fix
         const verifyResult = await runCommand('hadolint', ['-f', 'json', target], 60000);
         if (verifyResult.exitCode === 0) {
             logger.info(`LLM successfully fixed ${target}.`);
             issues = [{
                 id: 'AUTO-REMEDIATED',
                 severity: 'INFO',
                 message: `[AUTO-REMEDIATED] Dockerfile ${target} was successfully refactored to Distroless via LLM.`,
                 file: target,
                 source: 'Hadolint'
             }];
         } else {
             logger.warn(`LLM refactor for ${target} did not clear all linting errors. Keeping original findings.`);
             // The file is modified on disk, but we still report the remaining errors
             parsedOutput = JSON.parse(verifyResult.stdout || '[]');
             issues = parsedOutput.map((r: any) => ({
                id: r.code,
                severity: mapSeverity(r.level),
                message: r.message,
                file: r.file,
                line: r.line,
                source: 'Hadolint'
             }));
             issues.push({
                 id: 'LLM-REFACTOR-ATTEMPTED',
                 severity: 'INFO',
                 message: `Attempted LLM Distroless refactor, but some errors remain.`,
                 file: target,
                 source: 'Hadolint'
             });
         }
      }
    }

    return {
      scannerName: 'Hadolint',
      success: true,
      durationMs,
      issues
    };
  } catch (err) {
    return {
      scannerName: 'Hadolint',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: (err as Error).message
    };
  }
}

export const hadolintScanner: Scanner = {
  name: 'Hadolint',
  module: 'container',
  supportedLanguages: 'all',
  requiredBinaries: ['hadolint'],
  async run(ctx) {
    const target = ctx.config.scanners.hadolint?.target || 'testing_data/Dockerfile';
    const enableAutoFix = ctx.config.autoFix?.enabled ?? true;
    return runHadolint(target, enableAutoFix);
  }
};

