#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runDatPipeline } from './orchestrator.js';

const program = new Command();

program
  .name('dat')
  .description('Deployment Assist Tool - Quality and Security Scanner')
  .version('0.1.0');

program
  .command('scan')
  .description('Run configured scanners on the current repository')
  .option('-m, --module <module>', 'Specify a module to run (e.g., static, security, container, testing, llm)', 'all')
  .option('-c, --config <path>', 'Path to config file', '.dat.config.yaml')
  .option('-u, --url <url>', 'Target URL for DAST scanning (e.g. OWASP ZAP)')
  .option('--sarif <path>', 'Output results in SARIF format', 'results/dat-report.sarif')
  .option('--csv <path>', 'Output results in CSV format', 'results/dat-report.csv')
  .option('--pdf <path>', 'Output results in professional PDF format', 'results/dat-report.pdf')
  .option('--push-dojo', 'Push SARIF report to DefectDojo (requires env vars DEFECTDOJO_URL, DEFECTDOJO_API_KEY)')
  .option('--push-dtrack', 'Push SBOM to Dependency-Track (requires env vars DEPENDENCY_TRACK_URL, DEPENDENCY_TRACK_API_KEY)')
  .option('--only <scanners>', 'Run only specific scanners (comma-separated, e.g., semgrep,trivy)')
  .option('--skip <scanners>', 'Skip specific scanners (comma-separated, e.g., zap,dockle)')
  .option('--dry-run', 'Show which scanners would run without executing them')
  .option('--auto-fix', 'Apply autonomous AST auto-fixes to the working tree (mutates files; verified by your test suite and reverted on failure)')
  .action(async (options) => {
    try {
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

program.parse();
