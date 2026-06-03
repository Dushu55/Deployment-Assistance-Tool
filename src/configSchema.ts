import { z } from 'zod';
import { DatConfig } from './types.js';

/**
 * Runtime schema for .dat.config.yaml. The codebase trusted the YAML and used `as any` casts;
 * this validates types and enum values at load time and fails fast with readable messages, so a
 * typo in `failOn` or `provider` is caught immediately instead of silently mis-running the gate.
 */

const SEVERITY = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const INPUT_CATEGORY = z.enum([
  'dockerfile', 'testSuite', 'dastTarget', 'datConfig', 'iac', 'deps', 'lockfile', 'promptfoo', 'apiTests', 'image'
]);

// Each scanner entry must declare a boolean `enabled`; tool-specific extras (rules, targetDir, …)
// are allowed through without enumerating every variant.
const scannerEntry = z.looseObject({ enabled: z.boolean() });

export const DatConfigSchema = z.object({
  autoFix: z.object({ enabled: z.boolean().optional() }).optional(),
  verifyCommand: z.string().optional(),
  runner: z.object({
    maxConcurrency: z.number().int().positive().optional(),
    scannerTimeoutMs: z.number().int().positive().optional()
  }).optional(),
  scanners: z.record(z.string(), scannerEntry),
  failOn: z.array(SEVERITY),
  profile: z.enum(['quick', 'standard', 'full', 'security']).optional(),
  exclude: z.array(z.string()).optional(),
  deployer: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(['gcp', 'vercel']).optional(),
    database: z.object({
      provider: z.enum(['neon', 'cloudsql', 'manual']).optional(),
      autoProvision: z.boolean().optional(),
      migrateCommand: z.string().optional(),
      seedCommand: z.string().optional(),
      neon: z.object({ regionId: z.string().optional() }).optional(),
      cloudsql: z.object({ tier: z.string().optional(), region: z.string().optional() }).optional()
    }).optional(),
    gcp: z.object({
      projectId: z.string().optional(),
      region: z.string().optional(),
      cloudSqlInstance: z.string().optional(),
      databaseUrl: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      cpu: z.string().optional(),
      memory: z.string().optional(),
      maxInstances: z.number().int().positive().optional()
    }).optional()
  }).optional(),
  preflight: z.object({
    required: z.array(INPUT_CATEGORY).optional(),
    highlyAdvised: z.array(INPUT_CATEGORY).optional()
  }).optional(),
  componentEval: z.object({
    enabled: z.boolean().optional(),
    llm: z.object({
      enabled: z.boolean().optional(),
      maxComponents: z.number().int().positive().optional(),
      allowBlocking: z.boolean().optional(),
      model: z.string().optional()
    }).optional()
  }).optional(),
  llm: z.object({
    provider: z.enum(['vertex', 'apikey']).optional(),
    project: z.string().optional(),
    location: z.string().optional(),
    model: z.string().optional()
  }).optional()
});

/**
 * Validate a parsed config object. Throws a single aggregated error listing every problem
 * (path: message), or returns the typed config.
 */
export function parseConfig(raw: unknown): DatConfig {
  const result = DatConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid .dat.config.yaml:\n${issues}`);
  }
  return result.data as unknown as DatConfig;
}
