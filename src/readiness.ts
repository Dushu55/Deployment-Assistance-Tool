import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { DatConfig, InputCategory, ProfileName, SupportedLanguage } from './types.js';
import { EnvironmentDetector } from './env.js';
import { getEnabledScanners } from './orchestrator.js';
import { missingBinaries } from './utils/preflight.js';
import { isInputPresent, inputTier, DEFAULT_REQUIRED, InputContext } from './inputs.js';

export interface InputStatus {
  label: string;
  category: InputCategory;
  tier: 'required' | 'advisory';
  present: boolean;
}
export interface ScannerReadiness {
  scanner: string;
  inputs: InputStatus[];
  missingBinaries: string[];
}
export interface ReadinessReport {
  datConfigPresent: boolean;
  datConfigRequired: boolean;
  scanners: ScannerReadiness[];
  requiredMissing: number;   // distinct required-tier inputs missing (incl. .dat.config.yaml)
  advisoryMissing: number;   // distinct advisory inputs missing
}

export interface ReadinessOptions {
  configPath: string;
  url?: string;
  deploy?: boolean;
  workspaceRoot?: string;
  profile?: ProfileName;
  detectedLanguages?: SupportedLanguage[];
}

export async function checkReadiness(config: DatConfig, opts: ReadinessOptions): Promise<ReadinessReport> {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const detectedLanguages = opts.detectedLanguages || new EnvironmentDetector(workspaceRoot).detectLanguages();
  const required = config.preflight?.required ?? DEFAULT_REQUIRED;
  const profile = opts.profile ?? config.profile;

  const ctx: InputContext = {
    workspaceRoot,
    url: opts.url,
    deploy: opts.deploy,
    deployerEnabled: config.deployer?.enabled === true,
    detectedLanguages
  };

  const enabled = getEnabledScanners(config, detectedLanguages, { profile });
  const requiredMissingCats = new Set<InputCategory>();
  const advisoryMissingCats = new Set<InputCategory>();

  const scanners: ScannerReadiness[] = [];
  for (const scanner of enabled) {
    const inputs: InputStatus[] = (scanner.expectedInputs || []).map(input => {
      const present = isInputPresent(input, ctx);
      const tier = inputTier(input.category, required);
      if (!present) (tier === 'required' ? requiredMissingCats : advisoryMissingCats).add(input.category);
      return { label: input.label, category: input.category, tier, present };
    });
    const missing = await missingBinaries(scanner.requiredBinaries);
    if (inputs.length > 0 || missing.length > 0) {
      scanners.push({ scanner: scanner.name, inputs, missingBinaries: missing });
    }
  }

  // Top-level: the target app's own .dat.config.yaml.
  const datConfigPresent = fs.existsSync(path.resolve(workspaceRoot, opts.configPath));
  const datConfigRequired = required.includes('datConfig');
  if (!datConfigPresent && datConfigRequired) requiredMissingCats.add('datConfig');

  return {
    datConfigPresent,
    datConfigRequired,
    scanners,
    requiredMissing: requiredMissingCats.size,
    advisoryMissing: advisoryMissingCats.size
  };
}

export function printReadiness(report: ReadinessReport): void {
  console.log('\n' + chalk.bold.underline('🩺 Application Readiness Preflight'));

  const cfgMark = report.datConfigPresent ? chalk.green('✅') : (report.datConfigRequired ? chalk.red('❌') : chalk.yellow('⚠️'));
  console.log(`\n${cfgMark} .dat.config.yaml ${report.datConfigPresent ? 'present' : 'missing'}${!report.datConfigPresent && report.datConfigRequired ? chalk.red(' (required)') : ''}`);

  for (const s of report.scanners) {
    console.log(chalk.bold(`\n• ${s.scanner}`));
    for (const i of s.inputs) {
      const mark = i.present ? chalk.green('✅') : (i.tier === 'required' ? chalk.red('❌') : chalk.yellow('⚠️'));
      const tag = i.present ? '' : (i.tier === 'required' ? chalk.red(' [required]') : chalk.yellow(' [advisory]'));
      console.log(`   ${mark} ${i.label}${tag}`);
    }
    if (s.missingBinaries.length > 0) {
      console.log(`   ${chalk.yellow('⚠️')} tool not on PATH: ${s.missingBinaries.join(', ')}`);
    }
  }

  console.log('\n' + chalk.bold.underline('Summary'));
  const reqColor = report.requiredMissing > 0 ? chalk.red.bold : chalk.green.bold;
  console.log(`   ${reqColor(`${report.requiredMissing} required`)} input(s) missing, ${chalk.yellow(`${report.advisoryMissing} advisory`)} missing.`);
  if (report.requiredMissing > 0) {
    console.log(chalk.gray('   Configure the ❌ items (or adjust profile/config) for a meaningful scan. Use --strict to gate CI on these.\n'));
  } else {
    console.log(chalk.green('   ✓ All required inputs are present.\n'));
  }
}
