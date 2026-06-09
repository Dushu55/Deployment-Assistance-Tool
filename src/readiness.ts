import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { DatConfig, InputCategory, InputTier, ProfileName, SupportedLanguage } from './types.js';
import { EnvironmentDetector } from './env.js';
import { getEnabledScanners } from './orchestrator.js';
import { missingBinaries } from './utils/preflight.js';
import { isInputPresent, inputTier, DEFAULT_CRITICAL, DEFAULT_HIGHLY_ADVISED, InputContext } from './inputs.js';

export type ReadinessLevel = 'not-production-safe' | 'production-safe' | 'enterprise-grade';

export interface InputStatus {
  label: string;
  category: InputCategory;
  tier: InputTier;
  present: boolean;
  consequence?: string;
}
export interface ScannerReadiness {
  scanner: string;
  inputs: InputStatus[];
  missingBinaries: string[];
}
export interface ReadinessReport {
  datConfigPresent: boolean;
  datConfigRequired: boolean;    // back-compat: true iff datConfigTier === 'critical'
  datConfigTier: InputTier;      // the resolved tier of .dat.config.yaml (best-practice by default)
  scanners: ScannerReadiness[];
  criticalMissing: number;       // distinct critical-tier categories missing
  highlyAdvisedMissing: number;  // distinct highly-advised categories missing
  bestPracticeMissing: number;   // distinct best-practice categories missing
  requiredMissing: number;       // alias of criticalMissing (back-compat: --strict gate)
  advisoryMissing: number;       // alias: highlyAdvisedMissing + bestPracticeMissing
  readinessLevel: ReadinessLevel;
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
  const critical = config.preflight?.required ?? DEFAULT_CRITICAL;
  const highlyAdvised = config.preflight?.highlyAdvised ?? DEFAULT_HIGHLY_ADVISED;
  const profile = opts.profile ?? config.profile;

  const ctx: InputContext = {
    workspaceRoot,
    url: opts.url,
    deploy: opts.deploy,
    deployerEnabled: config.deployer?.enabled === true,
    detectedLanguages
  };

  const enabled = getEnabledScanners(config, detectedLanguages, { profile });
  // Track distinct missing categories per tier so the same input across scanners counts once.
  const missingByTier: Record<InputTier, Set<InputCategory>> = {
    'critical': new Set(), 'highly-advised': new Set(), 'best-practice': new Set()
  };

  const scanners: ScannerReadiness[] = [];
  for (const scanner of enabled) {
    const inputs: InputStatus[] = (scanner.expectedInputs || []).map(input => {
      const present = isInputPresent(input, ctx);
      const tier = inputTier(input.category, critical, highlyAdvised);
      if (!present) missingByTier[tier].add(input.category);
      return { label: input.label, category: input.category, tier, present, consequence: input.consequence };
    });
    const missing = await missingBinaries(scanner.requiredBinaries);
    if (inputs.length > 0 || missing.length > 0) {
      scanners.push({ scanner: scanner.name, inputs, missingBinaries: missing });
    }
  }

  // Top-level: the target app's own .dat.config.yaml (best-practice tier by default — it customizes
  // DAT's policy but its absence is not a production-safety gap; defaults apply. An operator can
  // re-elevate it via `preflight.required` in config).
  const datConfigPresent = fs.existsSync(path.resolve(workspaceRoot, opts.configPath));
  const datConfigTier = inputTier('datConfig', critical, highlyAdvised);
  const datConfigRequired = datConfigTier === 'critical';
  if (!datConfigPresent) missingByTier[datConfigTier].add('datConfig');

  const criticalMissing = missingByTier['critical'].size;
  const highlyAdvisedMissing = missingByTier['highly-advised'].size;
  const bestPracticeMissing = missingByTier['best-practice'].size;

  const readinessLevel: ReadinessLevel =
    criticalMissing > 0 ? 'not-production-safe'
    : highlyAdvisedMissing > 0 ? 'production-safe'
    : 'enterprise-grade';

  return {
    datConfigPresent,
    datConfigRequired,
    datConfigTier,
    scanners,
    criticalMissing,
    highlyAdvisedMissing,
    bestPracticeMissing,
    requiredMissing: criticalMissing,
    advisoryMissing: highlyAdvisedMissing + bestPracticeMissing,
    readinessLevel
  };
}

interface MissingItem {
  tier: InputTier;
  label: string;
  consequence?: string;
  scanners: string[];
}

const TIER_META: Record<InputTier, { mark: string; color: (s: string) => string; header: string }> = {
  'critical':       { mark: '⛔', color: chalk.red.bold,    header: 'CRITICAL — Fix before deploying to production' },
  'highly-advised': { mark: '⚠️', color: chalk.yellow.bold, header: 'HIGHLY ADVISED — Gaps attackers exploit in enterprise targets' },
  'best-practice':  { mark: '💡', color: chalk.cyan.bold,   header: 'BEST PRACTICE — For mature production deployments' }
};

export function printReadiness(report: ReadinessReport): void {
  console.log('\n' + chalk.bold.underline('🩺 Application Readiness: POC → Enterprise Assessment'));

  // Aggregate missing inputs by category across scanners (same gap counts once, lists all scanners).
  const missing = new Map<InputCategory, MissingItem>();
  let presentCount = 0;
  for (const s of report.scanners) {
    for (const i of s.inputs) {
      if (i.present) { presentCount++; continue; }
      const entry = missing.get(i.category) || { tier: i.tier, label: i.label, consequence: i.consequence, scanners: [] };
      entry.scanners.push(s.scanner);
      if (!entry.consequence && i.consequence) entry.consequence = i.consequence;
      missing.set(i.category, entry);
    }
  }
  if (!report.datConfigPresent) {
    // Use the resolved tier (best-practice by default; an operator can re-elevate it via
    // preflight.required / preflight.highlyAdvised) so the printed line matches the readiness counts.
    const tier = report.datConfigTier;
    const consequence = tier === 'best-practice'
      ? 'Optional: add one to customize org policy, severity thresholds and scanner selection; safe defaults apply without it.'
      : 'Your policy marks this required — add one to pin org policy, severity thresholds and scanner selection (defaults apply until then).';
    missing.set('datConfig', {
      tier, label: '.dat.config.yaml', scanners: ['DAT config'], consequence
    });
  }

  const tiers: InputTier[] = ['critical', 'highly-advised', 'best-practice'];
  for (const tier of tiers) {
    const items = [...missing.values()].filter(m => m.tier === tier);
    if (items.length === 0) continue;
    const meta = TIER_META[tier];
    console.log('\n' + meta.color(`${meta.mark} ${meta.header}`));
    for (const item of items) {
      console.log(`  ${meta.color('✗')} ${chalk.bold(item.scanners.join(' / '))}: ${item.label}`);
      if (item.consequence) console.log(chalk.gray(`        ${item.consequence}`));
    }
  }

  // Tooling note (advisory): scanners whose CLI tool is not installed.
  const toolGaps = report.scanners.filter(s => s.missingBinaries.length > 0);
  if (toolGaps.length > 0) {
    console.log('\n' + chalk.gray('🔧 Tools not on PATH (install to enable these scanners):'));
    for (const s of toolGaps) console.log(chalk.gray(`     ${s.scanner}: ${s.missingBinaries.join(', ')}`));
  }

  // Readiness level summary.
  const levelLine: Record<ReadinessLevel, string> = {
    'not-production-safe': chalk.red.bold('⛔ NOT PRODUCTION-SAFE'),
    'production-safe':     chalk.yellow.bold('🟡 PRODUCTION-SAFE (not yet enterprise-grade)'),
    'enterprise-grade':    chalk.green.bold('✅ ENTERPRISE-GRADE')
  };
  const guidance: Record<ReadinessLevel, string> = {
    'not-production-safe': 'Your app is at POC level. Fix the ⛔ CRITICAL items to reach Production-Safe.',
    'production-safe':     'Secure for production. Close the ⚠️ HIGHLY ADVISED gaps to reach Enterprise-Grade.',
    'enterprise-grade':    'All required and recommended inputs configured. Ready for enterprise deployment.'
  };
  const bar = '─'.repeat(62);
  console.log('\n' + chalk.gray(bar));
  console.log(`Readiness Level: ${levelLine[report.readinessLevel]}`);
  console.log(chalk.gray(
    `  ${report.criticalMissing} critical, ${report.highlyAdvisedMissing} highly-advised, ` +
    `${report.bestPracticeMissing} best-practice gap(s) · ${presentCount} input(s) configured`
  ));
  console.log(chalk.gray(`  ${guidance[report.readinessLevel]}`));
  console.log(chalk.gray(bar) + '\n');
}
