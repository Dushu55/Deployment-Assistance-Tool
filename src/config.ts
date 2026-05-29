import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { DatConfig } from './types.js';

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
  
  if (fs.existsSync(fullPath)) {
    try {
      const fileContents = fs.readFileSync(fullPath, 'utf8');
      const parsedConfig = yaml.parse(fileContents);
      // Deep merge defaults with user configuration
      const mergedScanners = { ...DEFAULT_CONFIG.scanners };
      
      if (parsedConfig.scanners) {
        for (const [key, value] of Object.entries(parsedConfig.scanners)) {
          (mergedScanners as any)[key] = {
            ...((mergedScanners as any)[key] || {}),
            ...(value as object)
          };
        }
      }

      return { 
        ...DEFAULT_CONFIG, 
        ...parsedConfig,
        scanners: mergedScanners
      };
    } catch (err) {
      console.warn(`[Config] Failed to parse ${configPath}. Using defaults. Error: ${(err as Error).message}`);
    }
  }
  
  return DEFAULT_CONFIG;
}
