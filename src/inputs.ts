import fs from 'fs';
import path from 'path';
import { ExpectedInput, InputCategory, Scanner, SupportedLanguage } from './types.js';
import { findFiles } from './components/fileScan.js';
import { EnvironmentDetector } from './env.js';

// Input categories that block under preflight --strict by default.
export const DEFAULT_REQUIRED: InputCategory[] = ['dockerfile', 'testSuite', 'dastTarget', 'datConfig'];

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

export function inputTier(category: InputCategory, required: InputCategory[] = DEFAULT_REQUIRED): 'required' | 'advisory' {
  return required.includes(category) ? 'required' : 'advisory';
}

/**
 * Auto-detect: a scanner is "not applicable" (and should be pruned) only when it declares inputs,
 * ALL of those inputs are advisory-tier, and NONE are present. Scanners with no declared inputs
 * are never pruned (their input is the source code, always present); and a missing REQUIRED-tier
 * input is never pruned — it must remain active so its coverage gap is surfaced, not hidden.
 */
export function isNotApplicable(scanner: Scanner, ctx: InputContext, required: InputCategory[] = DEFAULT_REQUIRED): boolean {
  const inputs = scanner.expectedInputs;
  if (!inputs || inputs.length === 0) return false;
  for (const input of inputs) {
    if (inputTier(input.category, required) === 'required') return false; // keep — surface the gap
    if (isInputPresent(input, ctx)) return false;                          // keep — input exists
  }
  return true; // all advisory and all absent → prune
}
