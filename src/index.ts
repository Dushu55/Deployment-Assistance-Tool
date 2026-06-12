#!/usr/bin/env node

// Load .env at repo root so the CLI picks up GEMINI_API_KEY and other vars (the GitHub App path
// loads it via Probot; the CLI did not). Zero-dependency, built into Node ≥20.6.
try { (process as any).loadEnvFile?.(); } catch { /* no .env present — fine */ }

import { Command } from 'commander';
// Re-register secret values now that .env is loaded (the logger registered at import, pre-.env).
import { registerEnvSecrets } from './utils/redact.js';
registerEnvSecrets();
import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { runDatPipeline } from './orchestrator.js';
import { flushLogger } from './logger.js';
import { buildComponentModel, writeComponentModel } from './components/builder.js';
import { EnvironmentDetector, databaseSummaryLine } from './env.js';
import { isProfileName, PROFILE_NAMES } from './profiles.js';
import { loadConfig } from './config.js';
import { checkReadiness, printReadiness } from './readiness.js';
import { startReportServer } from './server/serve.js';
import { startUiServer } from './server/ui.js';
import { serverPort } from './server/library.js';

const program = new Command();

program
  .name('dat')
  .description('Deployment Assist Tool - Quality and Security Scanner')
  .version('0.1.0')
  // Global targeting: by default DAT scans the current directory. These let you point it elsewhere.
  // Output paths (results/…) are written relative to the resolved target directory.
  .option('--path <dir>', 'Scan this directory instead of the current one (your application)')
  .option('--repo <url>', 'Shallow-clone this git repo to a temp dir and scan it (removed on exit)');

// Retarget the working directory BEFORE any command action runs. Config loading, language/DB
// detection, the component builder, and readiness all key off process.cwd(), so a single chdir
// cleanly retargets the whole pipeline.
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  try {
    let targetDir: string | undefined;
    if (opts.repo) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-repo-'));
      console.log(chalk.gray(`⬇️  Cloning ${opts.repo} (shallow)…`));
      // execFileSync (no shell) avoids injection from the URL argument.
      execFileSync('git', ['clone', '--depth', '1', opts.repo, tmp], { stdio: 'inherit' });
      process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });
      targetDir = tmp;
    } else if (opts.path) {
      targetDir = path.resolve(opts.path);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error(`--path "${opts.path}" is not an existing directory.`);
      }
    }
    if (targetDir) {
      process.chdir(targetDir);
      // Pick up the TARGET app's .env (the import-time load ran against the original cwd).
      try { (process as any).loadEnvFile?.(); } catch { /* no .env — fine */ }
      registerEnvSecrets();
      console.log(chalk.gray(`📂 Target application: ${targetDir}`));
    }
  } catch (error: any) {
    console.log(chalk.red.bold('\n❌ Could not prepare target directory:'), error.message);
    process.exit(1);
  }
});

program
  .command('scan')
  .description('Run configured scanners on the current repository')
  .option('-m, --module <module>', 'Specify a module to run (e.g., static, security, container, testing, llm)', 'all')
  .option('-p, --profile <name>', 'Scanner preset: quick | standard | security | full (overrides per-scanner enabled flags)')
  .option('-c, --config <path>', 'Path to config file', '.dat.config.yaml')
  .option('-u, --url <url>', 'Target URL for DAST scanning (e.g. OWASP ZAP)')
  .option('--deploy', 'Provision an ephemeral GCP Cloud Run environment (scale-to-zero, minimal cost), scan it, then tear it down. Requires gcloud CLI + GCP_PROJECT_ID (or deployer.gcp.projectId in config). Ignored if --url is set.')
  .option('--allow-unauthenticated', 'With --deploy: deploy the ephemeral preview PUBLIC (no IAM token) so the DAST scanner can reach it, then tear it down. Use when no service account is available to mint an identity token (e.g. a personal gcloud login). Default: private + IAM.')
  .option('--sarif <path>', 'Output results in SARIF format', 'results/dat-report.sarif')
  .option('--csv <path>', 'Output results in CSV format', 'results/dat-report.csv')
  .option('--pdf <path>', 'Output results in professional PDF format', 'results/dat-report.pdf')
  .option('--html <path>', 'Output a self-contained, shareable HTML report (explains scores, severities, and fixes)', 'results/dat-report.html')
  .option('--explain', 'Print the full glossary + score breakdown + gate rationale to the console')
  .option('--fix-manifest <path>', 'Output machine-consumable findings for coding agents (Claude Code)', 'results/dat-fix-manifest.json')
  .option('--component-model <path>', 'Emit the application/component graph (buttons, inputs, API calls, network) and link findings to components', 'results/dat-component-model.json')
  .option('--push-dojo', 'Push SARIF report to DefectDojo (requires env vars DEFECTDOJO_URL, DEFECTDOJO_API_KEY)')
  .option('--push-dtrack', 'Push SBOM to Dependency-Track (requires env vars DEPENDENCY_TRACK_URL, DEPENDENCY_TRACK_API_KEY)')
  .option('--only <scanners>', 'Run only specific scanners (comma-separated, e.g., semgrep,trivy)')
  .option('--skip <scanners>', 'Skip specific scanners (comma-separated, e.g., zap,dockle)')
  .option('--dry-run', 'Show which scanners would run without executing them')
  .option('--no-auto-detect', 'Do not prune scanners whose expected input is absent (run all selected scanners)')
  .option('--skip-component-eval', 'Disable per-component evaluators (fail-safe/robustness/coherence checks over the component graph)')
  .option('--llm-eval', 'Enable the LLM reasoning tier of the component evaluator (advisory; requires a Gemini backend — GEMINI_API_KEY or Vertex on a GCP project)')
  .option('--skip-preflight', 'Skip the application-readiness check at scan start')
  .option('--strict-preflight', 'Abort the scan if a required input (Dockerfile / tests / DAST target / dependency manifest) is missing')
  .option('--auto-fix', 'Apply autonomous AST auto-fixes to the working tree (mutates files; verified by your test suite and reverted on failure)')
  .option('--no-publish', 'Do not copy the HTML report into the local ~/.dat/reports library or print a hosted link')
  .action(async (options) => {
    // Flush the async file logger before exiting so the final audit lines (e.g. DB_TEARDOWN, the
    // last write in the deploy teardown) aren't truncated by process.exit.
    const finish = async (code: number): Promise<never> => { await flushLogger(); process.exit(code); };
    try {
      if (options.profile && !isProfileName(options.profile)) {
        console.log(chalk.red.bold(`\n❌ Unknown profile "${options.profile}". Valid: ${PROFILE_NAMES.join(', ')}.`));
        return finish(1);
      }
      const { report, failedGate } = await runDatPipeline({ ...options });

      // If report is null, it was a dry run or no scanners configured.
      if (!report) return finish(0);

      return finish(failedGate ? 1 : 0);
    } catch (error: any) {
      console.log(chalk.red.bold('\n❌ Pipeline execution failed:'), error.message);
      return finish(1);
    }
  });

program
  .command('preflight')
  .description('Verify the target application has the files needed for a meaningful scan (run before scan)')
  .option('-c, --config <path>', 'Path to config file', '.dat.config.yaml')
  .option('-p, --profile <name>', 'Evaluate readiness for a specific profile (quick|standard|security|full)')
  .option('-u, --url <url>', 'DAST target URL (satisfies ZAP/k6/Garak readiness)')
  .option('--deploy', 'Treat the ephemeral deploy as the DAST target source')
  .option('--strict', 'Exit non-zero if any REQUIRED input is missing')
  .action(async (options) => {
    try {
      if (options.profile && !isProfileName(options.profile)) {
        console.log(chalk.red.bold(`\n❌ Unknown profile "${options.profile}". Valid: ${PROFILE_NAMES.join(', ')}.`));
        process.exit(1);
      }
      const config = loadConfig(options.config);
      const report = await checkReadiness(config, {
        configPath: options.config,
        url: options.url,
        deploy: options.deploy,
        profile: options.profile
      });
      printReadiness(report);
      const dbLine = databaseSummaryLine(new EnvironmentDetector().detectDatabases());
      if (dbLine) console.log(chalk.gray(`🗄️  Detected database(s): ${dbLine}\n`));
      process.exit(options.strict && report.requiredMissing > 0 ? 1 : 0);
    } catch (error: any) {
      console.log(chalk.red.bold('\n❌ Preflight failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('model')
  .description('Build the application/component model (buttons, inputs, API calls, endpoints, network) without running scanners')
  .option('-o, --out <path>', 'Output path for the component model JSON', 'results/dat-component-model.json')
  .action(async (options) => {
    try {
      const detectedLanguages = new EnvironmentDetector().detectLanguages();
      const graph = buildComponentModel(process.cwd(), { timestamp: new Date().toISOString(), detectedLanguages });
      writeComponentModel(graph, options.out);

      const counts = graph.nodes.reduce((acc: Record<string, number>, n) => {
        acc[n.kind] = (acc[n.kind] || 0) + 1; return acc;
      }, {});
      console.log(chalk.blue.bold('\n🧩 Application Component Model'));
      console.log(chalk.gray(`   Ecosystem: frontend=[${graph.ecosystem.frontend}] backend=[${graph.ecosystem.backend}] iac=[${graph.ecosystem.iac}]`));
      Object.entries(counts).forEach(([kind, n]) => console.log(`   ${kind}: ${n}`));
      console.log(chalk.gray(`   Cross-stack links: ${graph.edges.filter(e => e.kind === 'calls').length}`));
      graph.coverage.forEach(c => console.log(chalk.gray(`   • ${c.extractor}: ${c.nodesFound} nodes / ${c.filesScanned} files — ${c.note}`)));
      console.log(chalk.green(`\n💾 Component model saved to ${options.out}\n`));
      process.exit(0);
    } catch (error: any) {
      console.log(chalk.red.bold('\n❌ Failed to build component model:'), error.message);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Host the local report library at http://localhost:<port> (loopback only) so scan reports are viewable in a browser')
  .option('-p, --port <port>', 'Port to listen on (default 4737, or DAT_PORT)')
  .action((options) => {
    const port = options.port ? parseInt(options.port, 10) : serverPort();
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
      console.log(chalk.red.bold(`\n❌ Invalid --port "${options.port}".`));
      process.exit(1);
    }
    const server = startReportServer(port);
    server.on('listening', () => {
      console.log(chalk.green.bold(`\n📰 DAT reports: http://localhost:${port}`) + chalk.gray('  (loopback only — Ctrl-C to stop)'));
    });
    server.on('error', (err: any) => {
      console.log(chalk.red.bold(`\n❌ Could not start report server on port ${port}: ${err.code === 'EADDRINUSE' ? 'port already in use' : err.message}`));
      process.exit(1);
    });
  });

program
  .command('ui')
  .description('Open a local web control panel (loopback only) to inspect an app\'s readiness, see what a scan needs, and view reports')
  .option('-p, --port <port>', 'Port to listen on (default 4737, or DAT_PORT)')
  .action((options) => {
    const port = options.port ? parseInt(options.port, 10) : serverPort();
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
      console.log(chalk.red.bold(`\n❌ Invalid --port "${options.port}".`));
      process.exit(1);
    }
    const { server, token } = startUiServer(port);
    server.on('listening', () => {
      console.log(chalk.green.bold(`\n🛡️  DAT control panel: http://localhost:${port}/?t=${token}`));
      console.log(chalk.gray('   Open the link above (token-gated, loopback only — Ctrl-C to stop).'));
    });
    server.on('error', (err: any) => {
      console.log(chalk.red.bold(`\n❌ Could not start UI server on port ${port}: ${err.code === 'EADDRINUSE' ? 'port already in use' : err.message}`));
      process.exit(1);
    });
  });

program.parse();
