import chalk from 'chalk';
import { loadConfig } from './config.js';
import { printReport } from './reporter.js';
import { generateSarif } from './reporters/sarif.js';
import { generateCsv } from './reporters/csv.js';
import { generatePdf } from './reporters/pdf.js';
import { generateHtml, ReportContext } from './reporters/html.js';
import { explainReadinessScore } from './utils.js';
import { explainGate } from './explain.js';
import type { ReadinessLevel } from './readiness.js';
import { pushToDefectDojo } from './reporters/defectdojo.js';
import { pushToDependencyTrack } from './reporters/dependencyTrack.js';
import { generateFixManifest } from './reporters/fixManifest.js';
import { buildComponentModel, writeComponentModel } from './components/builder.js';
import { ComponentGraph } from './components/types.js';
import { evaluateComponentGraph } from './evaluators/component/index.js';
import { evaluateComponentGraphLLM } from './evaluators/component/llm.js';
import { llmProvider } from './llm/index.js';
import { AggregatedReport, ScannerResult, DatConfig, Scanner, SupportedLanguage, ProfileName } from './types.js';
import { PROFILES } from './profiles.js';
import { isNotApplicable, DEFAULT_CRITICAL, DEFAULT_HIGHLY_ADVISED } from './inputs.js';
import { checkReadiness, printReadiness } from './readiness.js';
import { ALL_SCANNERS } from './scanners/index.js';
import { calculateReadinessScore, deduplicateResults, resolveExcludes, applyExcludes } from './utils.js';
import { activeProcesses } from './runner.js';
import { AstGrepAutoFixer } from './autofix/index.js';
import { logger } from './logger.js';
import { EnvironmentDetector, databaseSummaryLine } from './env.js';
import { emitAuditStart, emitAuditEnd, summarizeScannerMetrics, AuditContext } from './audit.js';
import { missingBinaries, isBinaryAvailable } from './utils/preflight.js';
import { publishReport } from './server/library.js';
import fs from 'fs';
import path from 'path';
import { GcpCloudRunDeployer } from './deployers/gcp.js';
import { EphemeralDeployment } from './deployers/index.js';
import { createProvisioner, DbProvisioner, ProvisionedDb } from './deployers/db/provisioner.js';
import { runMigrations } from './deployers/db/migrate.js';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

/** Resolve the current git branch/sha for naming the ephemeral deployment; falls back when git is absent. */
async function resolveGitRef(): Promise<{ branch: string; sha?: string }> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    let sha: string | undefined;
    try { sha = (await execFileAsync('git', ['rev-parse', 'HEAD'])).stdout.trim(); } catch { /* no sha */ }
    return { branch: branch.trim() || 'local', sha };
  } catch {
    return { branch: 'local' };
  }
}

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

/**
 * Single source of truth for "which scanners are active" — used by the orchestrator, the
 * readiness preflight, and profile selection. A scanner is active when it is selected
 * (by profile, or by per-scanner config.enabled when no profile is set) AND supports a detected
 * language (or is language-agnostic).
 *
 * Selection precedence: an explicit `opts.profile` wins over `config.profile`; when a profile is
 * active it defines the enabled set (per-scanner enabled flags are ignored); `full` enables every
 * scanner. With no profile, the per-scanner `enabled` flags apply (backward compatible).
 */
export function getEnabledScanners(
  config: DatConfig,
  detectedLanguages: SupportedLanguage[],
  opts: { profile?: ProfileName } = {}
): Scanner[] {
  const profile = opts.profile ?? config.profile;
  const enableAll = profile === 'full';
  const profileKeys = profile && profile !== 'full' ? new Set(PROFILES[profile]) : null;

  return ALL_SCANNERS.filter(scanner => {
    const key = CONFIG_KEYS[scanner.name];
    if (!key) return false;

    if (enableAll) {
      // every scanner is in scope
    } else if (profileKeys) {
      if (!profileKeys.has(key)) return false;
    } else {
      const scannerConfig = (config.scanners as Record<string, { enabled?: boolean } | undefined>)[key];
      if (scannerConfig?.enabled !== true) return false;
    }

    if (scanner.supportedLanguages === 'all') return true;
    return scanner.supportedLanguages.some(lang => detectedLanguages.includes(lang));
  });
}

export interface DatRunOptions {
  config?: string;
  module?: string;
  profile?: ProfileName; // one-word scanner selection (quick|standard|security|full)
  url?: string;
  authToken?: string;
  sarif?: string;
  csv?: string;
  pdf?: string;
  html?: string; // self-contained, shareable HTML report
  explain?: boolean; // verbose console explanations (glossary, score breakdown, gate rationale)
  fixManifest?: string; // machine-consumable findings for coding agents (Claude Code)
  componentModel?: string; // emit the application/component graph (Phase 2)
  skipComponentEval?: boolean; // disable Phase 3 per-component evaluators
  llmEval?: boolean; // opt-in: run the LLM reasoning tier of the component evaluator
  pushDojo?: boolean;
  pushDtrack?: boolean;
  only?: string;
  skip?: string;
  dryRun?: boolean;
  skipPreflight?: boolean;   // bypass the automatic application-readiness check at scan start
  strictPreflight?: boolean; // abort the scan if a required input is missing
  autoDetect?: boolean; // prune scanners whose advisory input is absent (default true; --no-auto-detect)
  deploy?: boolean; // provision + teardown an ephemeral GCP environment around the scan
  autoFix?: boolean; // opt-in: mutate the working tree with AST auto-fixes (default off for `scan`)
  throwOnFailure?: boolean; // programmatic invocation might not want process.exit(1)
  publish?: boolean; // copy the HTML report into ~/.dat/reports and print a hosted link (CLI default on)
  auditContext?: AuditContext;
}

/**
 * Run a single scanner with a hard wall-clock bound. A scanner that hangs *outside* runCommand
 * (e.g. an infinite loop in parsing, or an SDK call with no timeout) would otherwise stall the whole
 * pipeline; here it resolves to a clear failed result and the run continues. Always resolves.
 */
export function runScannerWithTimeout(scanner: any, context: any, timeoutMs: number): Promise<ScannerResult> {
  return new Promise<ScannerResult>((resolve) => {
    let settled = false;
    const finish = (res: ScannerResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => finish({
      scannerName: scanner.name, success: false, durationMs: timeoutMs, issues: [],
      error: `Scanner timed out after ${timeoutMs}ms (wall-clock limit). Increase runner.scannerTimeoutMs if legitimate.`
    }), timeoutMs);
    // NB: do NOT unref() — the timeout IS the resolution path for a hung scanner, so it must keep
    // the event loop alive until it fires. (unref made the promise hang on Node 20.)

    Promise.resolve()
      .then(() => scanner.run(context))
      .then((res: ScannerResult) => finish(res))
      .catch((err: any) => finish({
        scannerName: scanner.name, success: false, durationMs: 0, issues: [], error: (err as Error).message
      }));
  });
}

// Concurrency-limited runner with per-scanner wall-clock timeout + robust error catching.
async function runWithConcurrencyLimit(
  scanners: any[],
  context: any,
  limit: number = 4,
  scannerTimeoutMs: number = 600000
): Promise<ScannerResult[]> {
  const results: ScannerResult[] = [];
  const queue = [...scanners];

  async function worker() {
    while (queue.length > 0) {
      const scanner = queue.shift();
      if (!scanner) break;
      console.log(chalk.cyan(`➜ Running ${scanner.name}...`));
      results.push(await runScannerWithTimeout(scanner, context, scannerTimeoutMs));
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, limit), scanners.length) }, worker);
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
  const detectedDatabases = envDetector.detectDatabases();
  
  // 1. Load config
  const config = loadConfig(configPath);

  // Configure the LLM backend once (Vertex on the GCP project when set, else GEMINI_API_KEY).
  llmProvider.configure({ ...config.llm, project: config.llm?.project ?? config.deployer?.gcp?.projectId });

  // 1.5 Application-readiness preflight (warn by default). Verifies the target app has the
  // expected input files BEFORE scanning, so missing inputs aren't discovered mid-scan (or hidden
  // by silent-pass scanners). Bypass with --skip-preflight; abort with --strict-preflight.
  let readinessLevel: ReadinessLevel | undefined;
  if (!options.skipPreflight) {
    const readiness = await checkReadiness(config, {
      configPath,
      url: options.url,
      deploy: options.deploy,
      profile: options.profile ?? config.profile,
      detectedLanguages
    });
    readinessLevel = readiness.readinessLevel;
    printReadiness(readiness);
    const dbLine = databaseSummaryLine(detectedDatabases);
    if (dbLine) console.log(chalk.gray(`🗄️  Detected database(s): ${dbLine}`));
    if (options.strictPreflight && readiness.requiredMissing > 0) {
      throw new Error(`Preflight failed: ${readiness.requiredMissing} required input(s) missing. Configure them or run without --strict-preflight.`);
    }
  }

  // 2. Identify enabled scanners from config/profile and support for current languages
  const activeProfile = options.profile ?? config.profile;
  if (activeProfile) {
    console.log(chalk.gray(`Using profile: ${activeProfile}`));
  }
  let scannersToRun = getEnabledScanners(config, detectedLanguages, { profile: activeProfile });

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

  // 3.5 Auto-detect: prune scanners whose (advisory) expected input is absent — e.g. Checkov with
  // no IaC, Promptfoo with no config. Required-tier gaps (Dockerfile/tests/DAST) are NOT pruned so
  // they still surface. Disabled by --no-auto-detect / autoDetect:false, and bypassed under --only.
  const autoDetect = (options.autoDetect ?? config.autoDetect ?? true) && !options.only;
  if (autoDetect) {
    const inputCtx = {
      workspaceRoot: process.cwd(),
      url: options.url,
      deploy: options.deploy,
      deployerEnabled: config.deployer?.enabled === true,
      detectedLanguages
    };
    const critical = config.preflight?.required ?? DEFAULT_CRITICAL;
    const highlyAdvised = config.preflight?.highlyAdvised ?? DEFAULT_HIGHLY_ADVISED;
    scannersToRun = scannersToRun.filter(s => {
      if (isNotApplicable(s, inputCtx, critical, highlyAdvised)) {
        const inputLabels = (s.expectedInputs || []).map(i => i.label).join(', ');
        console.log(chalk.gray(`↷ Skipping ${s.name} (no ${inputLabels} found — not applicable)`));
        return false;
      }
      return true;
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

  // 4.4 Ephemeral deployment (optional, --deploy): provision a live preview to scan against.
  // Teardown is guaranteed in the `finally` below so we never leak a paid environment.
  // A manually-supplied --url always wins and short-circuits provisioning.
  let ephemeralDeployment: EphemeralDeployment | undefined;
  let deployer: GcpCloudRunDeployer | undefined;
  let provisioner: DbProvisioner | null = null;
  let provisionedDb: ProvisionedDb | undefined;
  const deployRequested = options.deploy || config.deployer?.enabled === true;
  if (deployRequested && !options.url) {
    if (!(await isBinaryAvailable('gcloud'))) {
      throw new Error('--deploy requires the gcloud CLI to be installed and authenticated (run `gcloud auth login`).');
    }

    // Auto-provision an ephemeral database when configured and the app uses one, so a DB-backed
    // app boots for DAST with zero manual DB setup. Migrate it, then hand the URL to the deployer
    // (injected at build + runtime). Best-effort: a failure degrades to deploying without a DB.
    provisioner = createProvisioner(config.deployer?.database, { projectId: config.deployer?.gcp?.projectId });
    if (provisioner && detectedDatabases.length > 0) {
      const engine = detectedDatabases[0].engine;
      try {
        console.log(chalk.cyan(`\n🗄️  Auto-provisioning an ephemeral ${engine} database (${provisioner.name})...`));
        provisionedDb = await provisioner.provision(engine);
        const migrated = await runMigrations({
          workspaceRoot: process.cwd(),
          databaseUrl: provisionedDb.databaseUrl,
          migrateCommand: config.deployer?.database?.migrateCommand,
          seedCommand: config.deployer?.database?.seedCommand
        });
        console.log(chalk.gray(migrated ? '🗄️  Database provisioned and migrated.' : '🗄️  Database provisioned (migrations skipped/failed — see logs).'));
      } catch (err: any) {
        console.log(chalk.yellow(`⚠️  Database auto-provisioning failed: ${err.message}. Continuing without an auto-provisioned DB.`));
        provisionedDb = undefined;
      }
    }

    deployer = new GcpCloudRunDeployer({
      ...config.deployer?.gcp,
      databaseUrl: provisionedDb?.databaseUrl ?? config.deployer?.gcp?.databaseUrl,
      cloudSqlInstance: provisionedDb?.cloudSqlInstance ?? config.deployer?.gcp?.cloudSqlInstance
    });
    const { branch, sha } = await resolveGitRef();
    try {
      console.log(chalk.cyan(`\n☁️  Provisioning ephemeral GCP Cloud Run environment (branch: ${branch})...`));
      ephemeralDeployment = await deployer.deployBranch(branch, sha);
      options.url = ephemeralDeployment.url;
      options.authToken = ephemeralDeployment.authToken;
      console.log(chalk.green(`☁️  Ephemeral deployment ready: ${options.url}`));
    } catch (err: any) {
      console.log(chalk.yellow(`⚠️  Ephemeral deployment failed: ${err.message}. Continuing without a DAST target.`));
      ephemeralDeployment = undefined;
    }
  } else if (deployRequested && options.url) {
    console.log(chalk.gray('ℹ️  Ephemeral deploy skipped because --url was provided (manual target wins).'));
  }

  const totalStartTime = Date.now();

  try {

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

  const maxConcurrency = config.runner?.maxConcurrency ?? 4;
  const scannerTimeoutMs = config.runner?.scannerTimeoutMs ?? 600000;
  console.log(chalk.gray(`\nExecuting scanners (concurrency ${maxConcurrency}, per-scanner timeout ${Math.round(scannerTimeoutMs / 1000)}s)...`));
  const runResults = await runWithConcurrencyLimit(runnableScanners, { config, url: options.url, authToken: options.authToken, detectedLanguages, detectedDatabases }, maxConcurrency, scannerTimeoutMs);
  const results = [...skippedResults, ...runResults];

  // 5.5 Trigger AST Auto-Fixer ONLY when explicitly enabled.
  // Auto-fix mutates the working tree, so it is OFF by default for `scan`. Enable it via
  // the --auto-fix CLI flag or `autoFix.enabled: true` in config (the PR-bot path passes it explicitly).
  const autoFixEnabled = options.autoFix ?? config.autoFix?.enabled ?? false;
  if (autoFixEnabled) {
    const autoFixer = new AstGrepAutoFixer();
    console.log(chalk.cyan(`\n🛠️  Running Autonomous Remediation (AST Auto-Fixer)...`));
    // Default to env detector verify command if not set in config
    const verifyCmd = config.verifyCommand || envDetector.getVerifyCommand(detectedLanguages) || undefined;
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

  // 5.7 Build the component model and run Phase 3 evaluators BEFORE aggregation, so per-component
  // findings (unauth endpoints, no-timeout API calls, world-open ports, cross-stack auth mismatch)
  // flow through dedup → score → gate → fix-manifest just like scanner findings. The graph is built
  // once here and reused for persistence and the manifest below.
  let componentGraph: ComponentGraph | undefined;
  const componentEvalEnabled = config.componentEval?.enabled !== false && !options.skipComponentEval;
  if (componentEvalEnabled || options.componentModel || options.fixManifest) {
    componentGraph = buildComponentModel(process.cwd(), { timestamp: new Date().toISOString(), detectedLanguages });
  }
  if (componentGraph && componentEvalEnabled) {
    const evalResult = evaluateComponentGraph(componentGraph);
    const affected = new Set(evalResult.issues.map(i => `${i.file}:${i.line}`)).size;
    console.log(chalk.cyan(`\n🧩 Component Evaluator: ${evalResult.issues.length} finding(s) across ${affected} component(s).`));
    results.push(evalResult);

    // 5.7b LLM reasoning tier (opt-in). Advisory by default; never throws into the pipeline.
    const llmEnabled = (options.llmEval || config.componentEval?.llm?.enabled === true);
    if (llmEnabled && llmProvider.isAvailable()) {
      const llmStart = Date.now();
      try {
        const llmIssues = await evaluateComponentGraphLLM(componentGraph, evalResult.issues, {
          maxComponents: config.componentEval?.llm?.maxComponents,
          allowBlocking: config.componentEval?.llm?.allowBlocking,
          model: config.componentEval?.llm?.model
        });
        console.log(chalk.magenta(`🧠 Component Evaluator (LLM): ${llmIssues.length} advisory finding(s).`));
        if (llmIssues.length > 0) {
          results.push({ scannerName: 'Component Evaluator (LLM)', success: true, durationMs: Date.now() - llmStart, issues: llmIssues });
        }
      } catch (e: any) {
        logger.warn(`LLM evaluator skipped: ${e.message}`);
      }
    } else if (llmEnabled) {
      console.log(chalk.gray('🧠 LLM evaluator requested but no Gemini backend configured (set GEMINI_API_KEY or a GCP project). Skipping.'));
    }
  }

  // 6. Apply config `exclude` path globs uniformly (drops findings under excluded paths from
  // every scanner + the component evaluator in one place), then dedup across all scanners.
  const excludes = resolveExcludes(config);
  const deduplicatedResults = deduplicateResults(applyExcludes(results, excludes));

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

  // 7. Print Report (with an always-on severity legend; full glossary under --explain)
  printReport(report, { explain: options.explain });

  // 8. Readiness Score
  const score = calculateReadinessScore(report.summary);
  const scoreColor = score >= 80 ? chalk.green.bold : (score >= 50 ? chalk.yellow.bold : chalk.red.bold);
  console.log(`   ${chalk.bold('Deployment Readiness Score:')} ${scoreColor(`${score}/100`)}\n`);

  // 8.5 Under --explain, show HOW the score was derived and WHY the gate will pass/fail.
  if (options.explain) {
    const si = explainReadinessScore(report.summary);
    console.log(chalk.bold('   How the score was calculated:') + chalk.gray(`  (${si.formula})`));
    si.breakdown.forEach(r => console.log(chalk.gray(`     ${r.severity}: ${r.count} × weight ${r.weight} → −${r.penalty}`)));
    console.log(chalk.gray(`     Total penalty −${si.totalPenalty} → ${si.score}/100 (${si.bandMeaning})`));
    const g = explainGate(config.failOn, report.summary);
    console.log(chalk.bold('   Quality gate:') + chalk.gray(` ${g.rationale}`));
  }

  // Report context shared by the HTML and PDF reporters.
  const reportContext: ReportContext = { report, score, failOn: config.failOn, readinessLevel };

  // 9. Generate Exports
  if (options.sarif) {
    generateSarif(report, options.sarif);
    console.log(chalk.gray(`💾 SARIF report saved to ${options.sarif}`));
  }

  if (options.csv) {
    generateCsv(report, options.csv);
    console.log(chalk.gray(`📄 CSV report saved to ${options.csv}`));
  }

  if (options.html) {
    generateHtml(reportContext, options.html);
    console.log(chalk.gray(`🌐 HTML report saved to ${options.html} (shareable, self-explaining)`));
  }

  if (options.pdf) {
    console.log(chalk.cyan(`\n📑 Generating Professional PDF Report (This may take a moment)...`));
    await generatePdf(reportContext, options.pdf);
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

  // 11.4 Persist the application/component model (built in step 5.7) when requested. The fix
  // manifest below uses it to attribute findings to the component they belong to (componentRef).
  if (options.componentModel && componentGraph) {
    writeComponentModel(componentGraph, options.componentModel);
    console.log(chalk.gray(`🧩 Component model saved to ${options.componentModel} (${componentGraph.nodes.length} components, ${componentGraph.edges.length} links)`));
  }

  // 11.5 Emit the machine-consumable fix manifest for coding agents (Claude Code).
  // Generated after the gate so it records the final score and gate state.
  if (options.fixManifest) {
    const verifyCmd = config.verifyCommand || envDetector.getVerifyCommand(detectedLanguages) || undefined;
    generateFixManifest(report, options.fixManifest, {
      verifyCommand: verifyCmd,
      failOn: config.failOn,
      readinessScore: score,
      gatePassed: !failedGate,
      componentGraph
    });
    console.log(chalk.gray(`🤖 Fix manifest saved to ${options.fixManifest} (consumable by Claude Code)`));
  }

  // 11.6 Publish the HTML report to the local ~/.dat/reports library + print a hosted link (CLI
  // default; `dat serve` hosts it). Off for the GitHub-App path (options.publish unset).
  if (options.publish === true && options.html && fs.existsSync(options.html)) {
    try {
      const url = publishReport({
        htmlPath: options.html,
        appName: path.basename(process.cwd()),
        score,
        gate: failedGate ? 'fail' : 'pass',
        summary: report.summary,
        timestamp: report.timestamp
      });
      console.log(chalk.gray(`📰 Report published: ${url}  (run \`dat serve\` to view)`));
    } catch (e: any) {
      logger.warn(`Could not publish report to the local library: ${e.message}`);
    }
  }

  emitAuditEnd(executionId, !failedGate, score, totalIssuesFound, summarizeScannerMetrics(deduplicatedResults));

  if (options.throwOnFailure && failedGate) {
    throw new Error('Quality Gate Failed');
  }

  return { report, failedGate };
  } finally {
    // Guarantee teardown of the ephemeral environment on every exit path (success, gate
    // failure, or unexpected error) so a paid Cloud Run service is never left running.
    if (ephemeralDeployment && deployer) {
      try {
        await deployer.teardown(ephemeralDeployment.id);
        console.log(chalk.gray('☁️  Ephemeral environment torn down.'));
      } catch (e: any) {
        logger.error(`Teardown failed for ${ephemeralDeployment.id}: ${e.message}`);
      }
    }
    // Destroy the auto-provisioned database too (even if the deploy itself failed).
    if (provisionedDb && provisioner) {
      await provisioner.teardown(provisionedDb.handle); // never throws
      console.log(chalk.gray('🗄️  Ephemeral database torn down.'));
    }
  }
}
