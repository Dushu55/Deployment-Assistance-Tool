import chalk from 'chalk';

console.log(chalk.bold.blue('\n🧠 LLM Feedback Loop Analytics (Telemetry Mock)'));
console.log(chalk.gray('Aggregating PR-Agent and Code-Fix telemetry across GitHub repositories...\n'));

const metrics = {
    totalSuggestions: 1042,
    accepted: 890,
    rejected: 152,
    modificationRate: 12.5, // 12.5% of accepted suggestions were modified by devs before committing
};

const falsePositiveRate = ((metrics.rejected / metrics.totalSuggestions) * 100).toFixed(1);

console.log(chalk.bold('📊 Global Adoption Metrics'));
console.log(`  Total AI Suggestions: ${chalk.cyan(metrics.totalSuggestions)}`);
console.log(`  Accepted by Devs:     ${chalk.green(metrics.accepted)}`);
console.log(`  Rejected by Devs:     ${chalk.red(metrics.rejected)}`);
console.log(`  False Positive Rate:  ${chalk.yellow(falsePositiveRate + '%')}\n`);

console.log(chalk.bold('🏆 Top Rejected Suggestions (Needs LLM Prompt Tuning)'));
console.log(`  1. ${chalk.red('dat-no-console-log')} (68 rejections) - Reason: "Used in local debug scripts"`);
console.log(`  2. ${chalk.red('CKV_AWS_41')}         (45 rejections) - Reason: "Test environment credentials"`);
console.log(`  3. ${chalk.red('DL3008')}             (22 rejections) - Reason: "Apt packages not pinned in dev containers"\n`);

console.log(chalk.bold('💡 Recommended Action for Intelligence Layer Tuning'));
console.log(chalk.italic('  -> Inject repository context into PR-Agent system prompt to dynamically suppress "console.log" rules for files located within /scripts or *.test.js paths to reduce developer fatigue.'));
console.log('\n');
