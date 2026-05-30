#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runDatPipeline } from './orchestrator.js';
import { buildComponentModel, writeComponentModel } from './components/builder.js';
import { EnvironmentDetector } from './env.js';
import { isProfileName, PROFILE_NAMES } from './profiles.js';
import { loadConfig } from './config.js';
import { checkReadiness, printReadiness } from './readiness.js';

const program = new Command();

program
  .name('dat')
  .description('Deployment Assist Tool - Quality and Security Scanner')
  .version('0.1.0');

program
  .command('scan')
  .description('Run configured scanners on the current repository')
  .option('-m, --module <module>', 'Specify a module to run (e.g., static, security, container, testing, llm)', 'all')
  .option('-p, --profile <name>', 'Scanner preset: quick | standard | security | full (overrides per-scanner enabled flags)')
  .option('-c, --config <path>', 'Path to config file', '.dat.config.yaml')
  .option('-u, --url <url>', 'Target URL for DAST scanning (e.g. OWASP ZAP)')
  .option('--deploy', 'Provision an ephemeral GCP Cloud Run environment (scale-to-zero, minimal cost), scan it, then tear it down. Requires gcloud CLI + GCP_PROJECT_ID (or deployer.gcp.projectId in config). Ignored if --url is set.')
  .option('--sarif <path>', 'Output results in SARIF format', 'results/dat-report.sarif')
  .option('--csv <path>', 'Output results in CSV format', 'results/dat-report.csv')
  .option('--pdf <path>', 'Output results in professional PDF format', 'results/dat-report.pdf')
  .option('--fix-manifest <path>', 'Output machine-consumable findings for coding agents (Claude Code)', 'results/dat-fix-manifest.json')
  .option('--component-model <path>', 'Emit the application/component graph (buttons, inputs, API calls, network) and link findings to components', 'results/dat-component-model.json')
  .option('--push-dojo', 'Push SARIF report to DefectDojo (requires env vars DEFECTDOJO_URL, DEFECTDOJO_API_KEY)')
  .option('--push-dtrack', 'Push SBOM to Dependency-Track (requires env vars DEPENDENCY_TRACK_URL, DEPENDENCY_TRACK_API_KEY)')
  .option('--only <scanners>', 'Run only specific scanners (comma-separated, e.g., semgrep,trivy)')
  .option('--skip <scanners>', 'Skip specific scanners (comma-separated, e.g., zap,dockle)')
  .option('--dry-run', 'Show which scanners would run without executing them')
  .option('--no-auto-detect', 'Do not prune scanners whose expected input is absent (run all selected scanners)')
  .option('--skip-component-eval', 'Disable per-component evaluators (fail-safe/robustness/coherence checks over the component graph)')
  .option('--skip-preflight', 'Skip the application-readiness check at scan start')
  .option('--strict-preflight', 'Abort the scan if a required input (Dockerfile / tests / DAST target / config) is missing')
  .option('--auto-fix', 'Apply autonomous AST auto-fixes to the working tree (mutates files; verified by your test suite and reverted on failure)')
  .action(async (options) => {
    try {
      if (options.profile && !isProfileName(options.profile)) {
        console.log(chalk.red.bold(`\n❌ Unknown profile "${options.profile}". Valid: ${PROFILE_NAMES.join(', ')}.`));
        process.exit(1);
      }
      const { report, failedGate } = await runDatPipeline({ ...options });
      
      // If report is null, it was a dry run or no scanners configured.
      if (!report) {
        process.exit(0);
      }
      
      if (failedGate) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    } catch (error: any) {
      console.log(chalk.red.bold('\n❌ Pipeline execution failed:'), error.message);
      process.exit(1);
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

program.parse();
