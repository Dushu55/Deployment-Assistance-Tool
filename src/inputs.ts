import fs from 'fs';
import path from 'path';
import { ExpectedInput, InputCategory, InputTier, Scanner, SupportedLanguage } from './types.js';
import { findFiles } from './components/fileScan.js';
import { EnvironmentDetector } from './env.js';

// Default tier membership, mapping the POC→enterprise journey.
//  - critical:       fix before production (active vuln / unverified logic / supply chain)
//  - highly-advised: enterprise-grade gaps attackers exploit (infra, ecosystem CVEs, container CIS)
//  - best-practice:  maturity gaps (everything not listed below falls here)
export const DEFAULT_CRITICAL: InputCategory[] = ['dockerfile', 'testSuite', 'dastTarget', 'datConfig', 'deps'];
export const DEFAULT_HIGHLY_ADVISED: InputCategory[] = ['iac', 'lockfile', 'image'];
export const DEFAULT_BEST_PRACTICE: InputCategory[] = ['promptfoo', 'apiTests'];

// Backward-compatible alias: the "required" tier == critical (gates preflight --strict).
export const DEFAULT_REQUIRED: InputCategory[] = DEFAULT_CRITICAL;

export interface InputContext {
  workspaceRoot: string;
  url?: string;
  deploy?: boolean;
  deployerEnabled?: boolean;
  detectedLanguages: SupportedLanguage[];
}

/** Resolve whether an expected target-app input is present in the workspace / run context. */
export function isInputPresent(input: ExpectedInput, ctx: InputContext): boolean {
  switch (input.kind) {
    case 'url':
      // A DAST target is "present" if a URL was supplied or an ephemeral deploy will provide one.
      return Boolean(ctx.url || ctx.deploy || ctx.deployerEnabled);
    case 'testSuite':
      return new EnvironmentDetector(ctx.workspaceRoot).getVerifyCommand(ctx.detectedLanguages) !== null;
    case 'image':
      // A built image can't be confirmed without a docker inspect; treat as absent (advisory).
      return false;
    case 'file':
    default:
      if (input.anyOf?.some(f => fs.existsSync(path.join(ctx.workspaceRoot, f)))) return true;
      if (input.anyExtRecursive && findFiles(ctx.workspaceRoot, input.anyExtRecursive).length > 0) return true;
      return false;
  }
}

export function inputTier(
  category: InputCategory,
  critical: InputCategory[] = DEFAULT_CRITICAL,
  highlyAdvised: InputCategory[] = DEFAULT_HIGHLY_ADVISED
): InputTier {
  if (critical.includes(category)) return 'critical';
  if (highlyAdvised.includes(category)) return 'highly-advised';
  return 'best-practice';
}

/**
 * Auto-detect: a scanner is "not applicable" (and should be pruned) only when it declares inputs,
 * ALL of those inputs are BEST-PRACTICE tier, and NONE are present. Scanners with no declared
 * inputs are never pruned (their input is the source code, always present); and a missing
 * critical- or highly-advised-tier input is never pruned — it must remain active so its coverage
 * gap is surfaced, not hidden.
 */
export function isNotApplicable(
  scanner: Scanner,
  ctx: InputContext,
  critical: InputCategory[] = DEFAULT_CRITICAL,
  highlyAdvised: InputCategory[] = DEFAULT_HIGHLY_ADVISED
): boolean {
  const inputs = scanner.expectedInputs;
  if (!inputs || inputs.length === 0) return false;
  for (const input of inputs) {
    if (inputTier(input.category, critical, highlyAdvised) !== 'best-practice') return false; // keep — surface the gap
    if (isInputPresent(input, ctx)) return false;                                              // keep — input exists
  }
  return true; // all best-practice and all absent → prune
}
