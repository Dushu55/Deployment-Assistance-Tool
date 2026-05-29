import chalk from 'chalk';
import { loadConfig } from './config.js';
import { printReport } from './reporter.js';
import { generateSarif } from './reporters/sarif.js';
import { generateCsv } from './reporters/csv.js';
import { generatePdf } from './reporters/pdf.js';
import { pushToDefectDojo } from './reporters/defectdojo.js';
import { pushToDependencyTrack } from './reporters/dependencyTrack.js';
import { generateFixManifest } from './reporters/fixManifest.js';
import { AggregatedReport, ScannerResult } from './types.js';
import { ALL_SCANNERS } from './scanners/index.js';
import { calculateReadinessScore, deduplicateResults } from './utils.js';
import { activeProcesses } from './runner.js';
import { AstGrepAutoFixer } from './autofix/index.js';
import { logger } from './logger.js';
import { EnvironmentDetector } from './env.js';
import { emitAuditStart, emitAuditEnd, AuditContext } from './audit.js';
import { missingBinaries } from './utils/preflight.js';

export const CONFIG_KEYS: Record<string, string> = {
  'Semgrep': 'semgrep',
  'SonarQube': 'sonarqube',
  'Hadolint': 'hadolint',
  'Trivy': 'trivy',
  'Dockle': 'dockle',
  'Checkov': 'checkov',
  'OSV-Scanner': 'osv',
  'OWASP ZAP': 'zap',
  'Jest Coverage': 'jest',
  'Qodo Cover-Agent': 'coverAgent',
  'Keploy API Tests': 'keploy',
  'k6 Load Test': 'k6',
  'Promptfoo': 'promptfoo',
  'Garak (LLM DAST)': 'garak',
  'Bandit': 'bandit',
  'pip-audit': 'pipAudit',
  'gosec': 'gosec',
  'govulncheck': 'govulncheck',
  'SpotBugs': 'spotbugs',
  'OWASP Dependency-Check': 'dependencyCheck',
  '.NET Analyzers': 'dotnetSast',
  '.NET NuGet Audit': 'dotnetSca',
  'Clippy': 'clippy',
  'cargo-audit': 'cargoAudit',
  'Gitleaks (Secrets)': 'gitleaks',
  'Logic Tests': 'logicTests'
};

export interface DatRunOptions {
  config?: string;
  module?: string;
  url?: string;
  authToken?: string;
  sarif?: string;
  csv?: string;
  pdf?: string;
  fixManifest?: string; // machine-consumable findings for coding agents (Claude Code)
  pushDojo?: boolean;
  pushDtrack?: boolean;
  only?: string;
  skip?: string;
  dryRun?: boolean;
  autoFix?: boolean; // opt-in: mutate the working tree with AST auto-fixes (default off for `scan`)
  throwOnFailure?: boolean; // programmatic invocation might not want process.exit(1)
  auditContext?: AuditContext;
}

// Concurrency-limited runner with robust error catching
async function runWithConcurrencyLimit(
  scanners: any[],
  context: any,
  limit: number = 4
): Promise<ScannerResult[]> {
  const results: ScannerResult[] = [];
  const queue = [...scanners];
  
  async function worker() {
    while (queue.length > 0) {
      const scanner = queue.shift();
      if (!scanner) break;
      
      console.log(chalk.cyan(`➜ Running ${scanner.name}...`));
      try {
        const res = await scanner.run(context);
        results.push(res);
      } catch (err) {
        results.push({
          scannerName: scanner.name,
          success: false,
          durationMs: 0,
          issues: [],
          error: (err as Error).message
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, scanners.length) }, worker);
  await Promise.all(workers);
  return results;
}

let signalHandlersBound = false;

// Graceful signal handlers for active child processes
function bindSignalHandlers() {
  if (signalHandlersBound) return;
  signalHandlersBound = true;

  const handleSignal = (signal: string) => {
    console.log(chalk.yellow(`\n⚠️  Received ${signal}. Gracefully terminating all active scanner processes...`));
    for (const child of activeProcesses) {
      try {
        child.kill('SIGKILL');
      } catch (e) {
        // ignore
      }
    }
    process.exit(130);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

export async function runDatPipeline(options: DatRunOptions): Promise<{ report: AggregatedReport, failedGate: boolean }> {
  bindSignalHandlers();
  
  const configPath = options.config || '.dat.config.yaml';
  
  // Create default audit context if running locally via CLI
  const auditCtx = options.auditContext || {
    actor: process.env.USER || 'local-developer',
    source: process.env.CI ? 'CI' : 'CLI'
  };
  const executionId = emitAuditStart(auditCtx, configPath);

  console.log(chalk.blue.bold('\n🚀 Starting Deployment Assist Tool...'));

  const envDetector = new EnvironmentDetector();
  const detectedLanguages = envDetector.detectLanguages();
  
  // 1. Load config
  const config = loadConfig(configPath);
  
  // 2. Identify enabled scanners from config and support for current languages
  let scannersToRun = ALL_SCANNERS.filter(scanner => {
    const key = CONFIG_KEYS[scanner.name];
    if (!key) return false;
    const scannerConfig = (config.scanners as any)[key];
    if (scannerConfig?.enabled !== true) return false;

    if (scanner.supportedLanguages === 'all') return true;
    return scanner.supportedLanguages.some(lang => detectedLanguages.includes(lang));
  });

  // 3. Apply CLI/Options filter overrides
  if (options.module && options.module !== 'all') {
    const allowedModules = options.module.toLowerCase().split(',').map((s: string) => s.trim());
    scannersToRun = scannersToRun.filter(s => allowedModules.includes(s.module.toLowerCase()));
  }

  if (options.only) {
    const onlyKeys = options.only.toLowerCase().split(',').map((s: string) => s.trim());
    scannersToRun = scannersToRun.filter(s => {
      const key = CONFIG_KEYS[s.name];
      return onlyKeys.includes(key.toLowerCase()) || onlyKeys.includes(s.name.toLowerCase());
    });
  }

  if (options.skip) {
    const skipKeys = options.skip.toLowerCase().split(',').map((s: string) => s.trim());
    scannersToRun = scannersToRun.filter(s => {
      const key = CONFIG_KEYS[s.name];
      return !skipKeys.includes(key.toLowerCase()) && !skipKeys.includes(s.name.toLowerCase());
    });
  }

  // 4. Dry Run check
  if (options.dryRun) {
    console.log(chalk.yellow.bold('\n🔍 DRY RUN - Scanners that would be executed:'));
    scannersToRun.forEach(s => {
      console.log(chalk.yellow(`  ➜  ${s.name} (Module: ${s.module})`));
    });
    console.log(chalk.gray(`\nTotal: ${scannersToRun.length} scanners configured to run.\n`));
    return { report: null as any, failedGate: false }; // caller should handle early exit
  }

  if (scannersToRun.length === 0) {
    console.log(chalk.yellow('⚠️  No scanners configured to run. Exiting.'));
    return { report: null as any, failedGate: false };
  }

  const activeScannersNames = scannersToRun.map(s => s.name);
  console.log(chalk.gray(`Loaded configuration. Active scanners: ${activeScannersNames.join(', ')}\n`));

  const totalStartTime = Date.now();

  // 4.5 Preflight: probe each scanner's required external tools. Missing tools yield an
  // explicit SKIPPED result (distinct from "ran clean") so absent scanners never silently
  // inflate the readiness score or hide coverage gaps.
  const skippedResults: ScannerResult[] = [];
  const runnableScanners: typeof scannersToRun = [];
  for (const scanner of scannersToRun) {
    const missing = await missingBinaries(scanner.requiredBinaries);
    if (missing.length > 0) {
      const reason = `Required tool(s) not found on PATH: ${missing.join(', ')}`;
      console.log(chalk.yellow(`⤼ Skipping ${scanner.name} — ${reason}`));
      skippedResults.push({
        scannerName: scanner.name,
        success: true,
        skipped: true,
        skipReason: reason,
        durationMs: 0,
        issues: []
      });
    } else {
      runnableScanners.push(scanner);
    }
  }

  console.log(chalk.gray('\nExecuting scanners with a concurrency limit of 4...'));
  const runResults = await runWithConcurrencyLimit(runnableScanners, { config, url: options.url, authToken: options.authToken, detectedLanguages }, 4);
  const results = [...skippedResults, ...runResults];

  // 5.5 Trigger AST Auto-Fixer ONLY when explicitly enabled.
  // Auto-fix mutates the working tree, so it is OFF by default for `scan`. Enable it via
  // the --auto-fix CLI flag or `autoFix.enabled: true` in config (the PR-bot path passes it explicitly).
  const autoFixEnabled = options.autoFix ?? config.autoFix?.enabled ?? false;
  if (autoFixEnabled) {
    const autoFixer = new AstGrepAutoFixer();
    console.log(chalk.cyan(`\n🛠️  Running Autonomous Remediation (AST Auto-Fixer)...`));
    // Default to env detector verify command if not set in config
    const verifyCmd = (config as any).verifyCommand || envDetector.getVerifyCommand(detectedLanguages);
    const fixResults = await autoFixer.applyAllFixes(verifyCmd, detectedLanguages);
    let totalFilesFixed = 0;

    fixResults.forEach(res => {
      if (res.success && res.filesFixed.length > 0) {
        totalFilesFixed += res.filesFixed.length;
        console.log(chalk.green(`   ✔ Applied fix [${res.ruleId}] to ${res.filesFixed.length} file(s).`));
      } else if (res.reverted) {
        console.log(chalk.yellow(`   ⚠️  Reverted fix [${res.ruleId}] in ${res.filesFixed.length} file(s) due to failing verification tests.`));
      }
    });

    if (totalFilesFixed > 0) {
      console.log(chalk.green.bold(`\n✨ Auto-remediated ${totalFilesFixed} vulnerable patterns in the codebase!`));
    } else {
      console.log(chalk.gray(`   No safe auto-fixable patterns were retained.`));
    }
  } else {
    console.log(chalk.gray(`\n🛠️  Auto-fix disabled (pass --auto-fix or set autoFix.enabled to remediate).`));
  }

  // 6. Aggregate and Deduplicate Results (global fingerprint dedup across all scanners)
  const deduplicatedResults = deduplicateResults(results);

  const report: AggregatedReport = {
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - totalStartTime,
    results: deduplicatedResults,
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  };

  deduplicatedResults.forEach(res => {
    res.issues.forEach(issue => {
      const lowerSeverity = issue.severity.toLowerCase() as keyof typeof report.summary;
      if (report.summary[lowerSeverity] !== undefined) {
        report.summary[lowerSeverity]++;
      }
    });
  });

  const totalIssuesFound = Object.values(report.summary).reduce((a, b) => a + b, 0);

  // 7. Print Report
  printReport(report);

  // 8. Readiness Score
  const score = calculateReadinessScore(report.summary);
  const scoreColor = score >= 80 ? chalk.green.bold : (score >= 50 ? chalk.yellow.bold : chalk.red.bold);
  console.log(`   ${chalk.bold('Deployment Readiness Score:')} ${scoreColor(`${score}/100`)}\n`);

  // 9. Generate Exports
  if (options.sarif) {
    generateSarif(report, options.sarif);
    console.log(chalk.gray(`💾 SARIF report saved to ${options.sarif}`));
  }
  
  if (options.csv) {
    generateCsv(report, options.csv);
    console.log(chalk.gray(`📄 CSV report saved to ${options.csv}`));
  }

  if (options.pdf) {
    console.log(chalk.cyan(`\n📑 Generating Professional PDF Report (This may take a moment)...`));
    await generatePdf(report, options.pdf);
    console.log(chalk.gray(`📑 PDF report saved to ${options.pdf}`));
  }

  // 10. Push to DefectDojo
  if (options.pushDojo && options.sarif) {
      const dojoUrl = process.env.DEFECTDOJO_URL;
      const dojoKey = process.env.DEFECTDOJO_API_KEY;
      const dojoProduct = process.env.DEFECTDOJO_PRODUCT || 'DAT Project';
      
      if (dojoUrl && dojoKey) {
          console.log(chalk.cyan(`📤 Pushing results to DefectDojo at ${dojoUrl}...`));
          const success = await pushToDefectDojo(options.sarif, dojoUrl, dojoKey, dojoProduct);
          if (success) console.log(chalk.green('✅ Successfully imported scan to DefectDojo.'));
      } else {
          console.log(chalk.yellow('⚠️  Skipping DefectDojo push: Missing DEFECTDOJO_URL or DEFECTDOJO_API_KEY environment variables.'));
      }
  }

  // 10.5 Push to Dependency-Track
  if (options.pushDtrack) {
      const dtrackUrl = process.env.DEPENDENCY_TRACK_URL;
      const dtrackKey = process.env.DEPENDENCY_TRACK_API_KEY;
      const dtrackProject = process.env.DEPENDENCY_TRACK_PRODUCT || 'DAT Project';
      // The SBOM is generated by Trivy if config.scanners.trivy.generateSbom is true.
      const sbomPath = config.scanners.trivy?.sbomPath || 'results/bom.json';
      
      if (dtrackUrl && dtrackKey) {
          console.log(chalk.cyan(`📤 Pushing SBOM to Dependency-Track at ${dtrackUrl}...`));
          const success = await pushToDependencyTrack(sbomPath, dtrackUrl, dtrackKey, dtrackProject);
          if (success) console.log(chalk.green('✅ Successfully imported SBOM to Dependency-Track.'));
      } else {
          console.log(chalk.yellow('⚠️  Skipping Dependency-Track push: Missing DEPENDENCY_TRACK_URL or DEPENDENCY_TRACK_API_KEY environment variables.'));
      }
  }
  
  // 11. Evaluate Quality Gate Failure Conditions
  const hasFailures = deduplicatedResults.some(r => !r.success);
  
  let failedGate = hasFailures;
  config.failOn.forEach(severity => {
    const lower = severity.toLowerCase() as keyof typeof report.summary;
    if (report.summary[lower] > 0) {
      failedGate = true;
    }
  });

  if (failedGate) {
      console.log(chalk.red.bold('\n❌ Quality Gate Failed.'));
  } else {
      console.log(chalk.green.bold('\n✅ Quality Gate Passed.\n'));
  }

  // 11.5 Emit the machine-consumable fix manifest for coding agents (Claude Code).
  // Generated after the gate so it records the final score and gate state.
  if (options.fixManifest) {
    const verifyCmd = (config as any).verifyCommand || envDetector.getVerifyCommand(detectedLanguages);
    generateFixManifest(report, options.fixManifest, {
      verifyCommand: verifyCmd,
      failOn: config.failOn,
      readinessScore: score,
      gatePassed: !failedGate
    });
    console.log(chalk.gray(`🤖 Fix manifest saved to ${options.fixManifest} (consumable by Claude Code)`));
  }

  emitAuditEnd(executionId, !failedGate, score, totalIssuesFound);

  if (options.throwOnFailure && failedGate) {
    throw new Error('Quality Gate Failed');
  }

  return { report, failedGate };
}
