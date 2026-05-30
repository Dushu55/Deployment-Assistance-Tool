import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { DatConfig } from './types.js';
import { parseConfig } from './configSchema.js';

type ScannerEntry = { enabled?: boolean } & Record<string, unknown>;

const DEFAULT_CONFIG: DatConfig = {
  // Safe by default: auto-fix mutates the working tree, so it must be opted into
  // explicitly (via the --auto-fix CLI flag or autoFix.enabled in .dat.config.yaml).
  autoFix: { enabled: false },
  scanners: {
    semgrep: { enabled: true, rules: ['p/security-audit'] },
    trivy: { enabled: true },
    hadolint: { enabled: true },
    dockle: { enabled: true },
    gitleaks: { enabled: true },
    logicTests: { enabled: true, failOnMissingTests: true }
  },
  failOn: ['CRITICAL', 'HIGH']
};

export function loadConfig(configPath: string = '.dat.config.yaml'): DatConfig {
  const fullPath = path.resolve(process.cwd(), configPath);

  // Missing config → safe defaults (unchanged behaviour).
  if (!fs.existsSync(fullPath)) {
    return DEFAULT_CONFIG;
  }

  // A present-but-broken config is a real misconfiguration → fail fast (no silent fallback).
  let parsedConfig: any;
  try {
    parsedConfig = yaml.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    throw new Error(`[Config] Failed to parse ${configPath} (invalid YAML): ${(err as Error).message}`);
  }

  // Deep-merge per-scanner config over the defaults.
  const mergedScanners: Record<string, ScannerEntry> = { ...(DEFAULT_CONFIG.scanners as Record<string, ScannerEntry>) };
  if (parsedConfig?.scanners) {
    for (const [key, value] of Object.entries(parsedConfig.scanners)) {
      mergedScanners[key] = { ...(mergedScanners[key] || {}), ...(value as ScannerEntry) };
    }
  }

  const merged = { ...DEFAULT_CONFIG, ...parsedConfig, scanners: mergedScanners };
  // Validate types/enums; throws an aggregated, readable error on any violation.
  return parseConfig(merged);
}
