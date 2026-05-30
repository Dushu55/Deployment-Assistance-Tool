import chalk from 'chalk';
import { AggregatedReport, Severity, Issue } from './types.js';
import { SEVERITY_EXPLANATIONS, CATEGORY_EXPLANATIONS, PIPELINE_OVERVIEW } from './explain.js';

const SEVERITY_COLORS: Record<Severity, any> = {
  CRITICAL: chalk.bgRed.white.bold,
  HIGH: chalk.red.bold,
  MEDIUM: chalk.yellow.bold,
  LOW: chalk.blue,
  INFO: chalk.gray
};

export function printReport(report: AggregatedReport, opts: { explain?: boolean } = {}): void {
  console.log('\n' + chalk.bold.underline('📊 Deployment Assist Tool - Scan Report'));
  console.log(`⏱️  Total Duration: ${(report.totalDurationMs / 1000).toFixed(2)}s\n`);

  let totalIssues = 0;

  let skippedCount = 0;

  report.results.forEach((res) => {
    if (res.skipped) {
      skippedCount++;
      console.log(chalk.bold(`\n🛠️  Scanner: ${res.scannerName} ${chalk.yellow('[SKIPPED]')}`));
      console.log(chalk.yellow(`   ⤼ ${res.skipReason || 'Tool unavailable.'}`));
      return;
    }
    console.log(chalk.bold(`\n🛠️  Scanner: ${res.scannerName} ${res.success ? chalk.green('[SUCCESS]') : chalk.red('[FAILED]')}`));
    if (res.error) {
      console.log(chalk.red(`   Error: ${res.error}`));
    }

    if (res.issues.length === 0) {
      console.log(chalk.green('   ✅ No issues found.'));
    } else {
      res.issues.forEach(issue => {
        totalIssues++;
        const color = SEVERITY_COLORS[issue.severity] || chalk.white;
        const loc = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
        console.log(`   ${color(`[${issue.severity}]`)} ${issue.id} - ${issue.message}${chalk.gray(loc)}`);
        if (issue.remediation) {
          console.log(`      ${chalk.cyan('💡 Remediation:')} ${issue.remediation}`);
        }
      });
    }
  });

  console.log('\n' + chalk.bold.underline('📈 Summary'));
  console.log(`   CRITICAL: ${SEVERITY_COLORS.CRITICAL(` ${report.summary.critical} `)}`);
  console.log(`   HIGH:     ${SEVERITY_COLORS.HIGH(` ${report.summary.high} `)}`);
  console.log(`   MEDIUM:   ${SEVERITY_COLORS.MEDIUM(` ${report.summary.medium} `)}`);
  console.log(`   LOW:      ${SEVERITY_COLORS.LOW(` ${report.summary.low} `)}`);
  console.log(`   INFO:     ${SEVERITY_COLORS.INFO(` ${report.summary.info} `)}`);
  console.log(`\n   Total Issues: ${totalIssues}`);
  if (skippedCount > 0) {
    console.log(chalk.yellow(`   ⚠️  ${skippedCount} scanner(s) SKIPPED (tool unavailable) — coverage is incomplete.`));
  }

  // Always-on compact legend so a reader knows what the severities mean at a glance.
  console.log('\n' + chalk.bold('Severity legend:'));
  (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).forEach(sev => {
    console.log(`   ${SEVERITY_COLORS[sev](`[${sev}]`)} ${chalk.gray(SEVERITY_EXPLANATIONS[sev].meaning)}`);
  });
  if (!opts.explain) {
    console.log(chalk.gray('   (run with --explain for the full glossary: categories, scoring, and how DAT works)'));
  }

  if (opts.explain) {
    console.log('\n' + chalk.bold.underline('📖 How DAT works'));
    PIPELINE_OVERVIEW.forEach((step, i) => console.log(chalk.gray(`   ${i + 1}. ${step}`)));
    console.log('\n' + chalk.bold.underline('🏷️  Finding categories'));
    for (const [key, c] of Object.entries(CATEGORY_EXPLANATIONS)) {
      console.log(`   ${chalk.bold(c.label)} ${chalk.gray(`(${key})`)}: ${chalk.gray(c.whyItMatters)}`);
    }
  }
  console.log('');
}
