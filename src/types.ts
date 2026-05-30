export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ProfileName = 'quick' | 'standard' | 'full' | 'security';

// Finding category used by the Claude fix-manifest. Defined here (not in fixManifest.ts) so an
// Issue can declare its own category without a circular import.
export type FixCategory =
  | 'security' | 'defect' | 'best-practice' | 'robustness' | 'coherence' | 'fail-safe' | 'coverage';

export interface Issue {
  id: string;          // e.g., 'rule-id' or 'CVE-2024-1234'
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  remediation?: string;
  source: string;      // e.g., 'Semgrep', 'Trivy'
  category?: FixCategory; // optional explicit category (component evaluators set this precisely)
}

export interface ScannerResult {
  scannerName: string;
  success: boolean;
  durationMs: number;
  issues: Issue[];
  error?: string;
  skipped?: boolean;        // true when preflight found the underlying tool unavailable
  skipReason?: string;      // human-readable reason a scanner was skipped
}

export interface AggregatedReport {
  timestamp: string;
  totalDurationMs: number;
  results: ScannerResult[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

// --- CONFIG TYPES ---
export interface DatConfig {
  autoFix?: { enabled?: boolean };
  scanners: {
    semgrep?: { enabled: boolean; rules?: string[]; customRulesDir?: string };
    trivy?: { enabled: boolean; generateSbom?: boolean; sbomPath?: string };
    hadolint?: { enabled: boolean; target?: string };
    dockle?: { enabled: boolean; imageName?: string };
    sonarqube?: { enabled: boolean };
    checkov?: { enabled: boolean; targetDir?: string };
    osv?: { enabled: boolean; targetDir?: string };
    zap?: { enabled: boolean; failOnMissingTarget?: boolean };
    jest?: { enabled: boolean; threshold?: number; targetDir?: string };
    coverAgent?: { enabled: boolean; sourceFilePath?: string; testFilePath?: string; testCommand?: string };
    keploy?: { enabled: boolean; appCmd?: string };
    k6?: { enabled: boolean; thresholdMs?: number; failOnMissingTarget?: boolean };
    logicTests?: { enabled: boolean; command?: string; targetDir?: string; failOnMissingTests?: boolean };
    promptfoo?: { enabled: boolean; targetDir?: string };
    garak?: { enabled: boolean };
    bandit?: { enabled: boolean; targetDir?: string };
    pipAudit?: { enabled: boolean; targetFile?: string };
    gosec?: { enabled: boolean; targetDir?: string };
    govulncheck?: { enabled: boolean; targetDir?: string };
    spotbugs?: { enabled: boolean };
    dependencyCheck?: { enabled: boolean };
    dotnetSast?: { enabled: boolean };
    dotnetSca?: { enabled: boolean };
    clippy?: { enabled: boolean };
    cargoAudit?: { enabled: boolean };
    gitleaks?: { enabled: boolean; targetDir?: string };
  };
  failOn: Severity[]; // e.g., ['CRITICAL', 'HIGH']
  profile?: ProfileName;                  // one-word scanner selection; overrides per-scanner enabled flags
  autoDetect?: boolean;                   // prune scanners whose advisory inputs are absent (default true)
  preflight?: { required?: InputCategory[]; highlyAdvised?: InputCategory[] }; // override tier membership (required == critical)
  componentEval?: { enabled?: boolean }; // per-component evaluators over the component graph (default enabled)
  deployer?: {
    enabled?: boolean;
    provider?: 'gcp' | 'vercel';
    gcp?: {
      projectId?: string;        // overrides GCP_PROJECT_ID env var
      region?: string;           // overrides GCP_REGION (default: us-central1)
      cloudSqlInstance?: string; // overrides GCP_CLOUD_SQL_INSTANCE (off by default — Cloud SQL is costly)
      // Cost controls (defaults chosen for near-zero cost on short-lived scan runs):
      cpu?: string;              // default '1'
      memory?: string;           // default '512Mi'
      maxInstances?: number;     // default 1
    };
  };
}

export interface ScannerContext {
  config: DatConfig;
  url?: string;
  authToken?: string;
  detectedLanguages: SupportedLanguage[];
}

export type SupportedLanguage = 'node' | 'python' | 'go' | 'java' | 'csharp' | 'rust';

// Categories of target-application input a scanner needs to do meaningful work.
export type InputCategory =
  | 'dockerfile' | 'testSuite' | 'dastTarget' | 'datConfig'
  | 'iac' | 'deps' | 'lockfile' | 'promptfoo' | 'apiTests' | 'image';

// Urgency tiers mapping the POC→enterprise journey:
//  - critical:       fix before production (active vuln / unverified logic / supply chain)
//  - highly-advised: enterprise-grade gaps attackers exploit (infra, container, ecosystem CVEs)
//  - best-practice:  maturity gaps for a polished production product
export type InputTier = 'critical' | 'highly-advised' | 'best-practice';

export interface ExpectedInput {
  label: string;                 // human label, e.g. "Dockerfile"
  category: InputCategory;
  anyOf?: string[];              // present if any of these root-relative files exist
  anyExtRecursive?: string[];    // present if any file with these extensions exists (e.g. ['.tf'])
  kind?: 'file' | 'url' | 'testSuite' | 'image'; // special resolution; defaults to 'file'
  consequence?: string;          // plain-English risk if this input is missing (shown in the report)
}

export interface Scanner {
  name: string;
  module: 'static' | 'security' | 'container' | 'testing' | 'llm';
  supportedLanguages: SupportedLanguage[] | 'all';
  // External executables this scanner needs on PATH. The orchestrator probes these
  // before running and marks the scanner SKIPPED (distinct from a clean pass) when any
  // are missing, so an absent tool never masquerades as "ran clean". Omit when the
  // tool is project-local (npx) or resolved conditionally at runtime.
  requiredBinaries?: string[];
  // Target-application inputs this scanner needs (e.g. a Dockerfile, a test suite, a DAST URL).
  // Powers the readiness preflight and auto-detect pruning. Omit for pure source scanners
  // (the code is always present).
  expectedInputs?: ExpectedInput[];
  run(context: ScannerContext): Promise<ScannerResult>;
}
