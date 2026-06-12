import { ProfileName } from './types.js';

/**
 * Named scanner presets — the simple, one-word selection interface.
 *
 * Each profile is a set of config keys (the values in orchestrator CONFIG_KEYS) to enable.
 * Language-specific scanners (bandit, gosec, cargoAudit, …) are safe to list everywhere: they
 * only activate when their language is actually detected, so they're pruned automatically.
 *
 * `full` is handled specially in getEnabledScanners (enables every scanner), so it is not listed here.
 */
export const PROFILES: Record<Exclude<ProfileName, 'full'>, string[]> = {
  // Fast PR gate: static analysis + secrets + functional tests only.
  quick: ['semgrep', 'gitleaks', 'logicTests'],

  // Balanced default: quick + SCA + IaC + container + coverage + language SAST/SCA
  // + the zero-cost checks (headers, npm advisories, dependency freshness).
  standard: [
    'semgrep', 'gitleaks', 'logicTests',
    'trivy', 'osv', 'checkov', 'hadolint', 'dockle', 'jest', 'sonarqube',
    'bandit', 'pipAudit', 'gosec', 'govulncheck', 'spotbugs',
    'dependencyCheck', 'dotnetSast', 'dotnetSca', 'clippy', 'cargoAudit',
    'httpHeaders', 'npmAudit', 'depFreshness'
  ],

  // Security-focused: SAST + SCA + IaC + secrets + DAST + LLM red-teaming.
  security: [
    'semgrep', 'gitleaks', 'trivy', 'osv', 'checkov', 'zap', 'garak',
    'bandit', 'pipAudit', 'gosec', 'govulncheck', 'spotbugs',
    'dependencyCheck', 'dotnetSast', 'dotnetSca', 'clippy', 'cargoAudit',
    'httpHeaders', 'npmAudit'
  ]
};

export const PROFILE_NAMES: ProfileName[] = ['quick', 'standard', 'security', 'full'];

export function isProfileName(value: string): value is ProfileName {
  return (PROFILE_NAMES as string[]).includes(value);
}
