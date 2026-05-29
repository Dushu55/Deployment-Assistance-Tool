export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface Issue {
  id: string;          // e.g., 'rule-id' or 'CVE-2024-1234'
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  remediation?: string;
  source: string;      // e.g., 'Semgrep', 'Trivy'
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
}

export interface ScannerContext {
  config: DatConfig;
  url?: string;
  authToken?: string;
  detectedLanguages: SupportedLanguage[];
}

export type SupportedLanguage = 'node' | 'python' | 'go' | 'java' | 'csharp' | 'rust';

export interface Scanner {
  name: string;
  module: 'static' | 'security' | 'container' | 'testing' | 'llm';
  supportedLanguages: SupportedLanguage[] | 'all';
  // External executables this scanner needs on PATH. The orchestrator probes these
  // before running and marks the scanner SKIPPED (distinct from a clean pass) when any
  // are missing, so an absent tool never masquerades as "ran clean". Omit when the
  // tool is project-local (npx) or resolved conditionally at runtime.
  requiredBinaries?: string[];
  run(context: ScannerContext): Promise<ScannerResult>;
}
