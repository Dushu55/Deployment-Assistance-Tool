import { ALL_SCANNERS } from '../scanners/index.js';
import { CONFIG_KEYS } from '../orchestrator.js';
import { PROFILES } from '../profiles.js';
import { inputTier } from '../inputs.js';
import { isBinaryAvailable } from '../utils/preflight.js';
import { maskedOperatorEnv } from './operatorEnv.js';
import type { ProfileName } from '../types.js';

/**
 * Single source of truth for what each testing module IS — descriptions, install hints, option
 * docs, and operator-credential docs. Feeds the /api/modules endpoint (Testing Modules page),
 * the scan-progress descriptions in the SPA, and the Settings page credential groups.
 */

// What each scanner targets — one line, written for a non-specialist reader.
// Includes aliases for names that only appear in scan stdout ('Trivy (FS)', 'Component
// Evaluator', …) so the live progress list can describe them too.
export const SCANNER_DESCRIPTIONS: Record<string, string> = {
  'Semgrep': 'SAST — pattern-based code flaws (injection, XSS, hardcoded secrets).',
  'SonarQube': 'Code quality, bugs & vulnerabilities (needs a SonarQube server + token).',
  'Hadolint': 'Dockerfile linting & best-practice / hardening checks.',
  'Trivy': 'Dependency & container CVE scanning (software composition analysis).',
  'Trivy (FS)': 'Dependency & container CVE scanning (software composition analysis).',
  'Dockle': 'Container image CIS hardening checks (needs a built image).',
  'Checkov': 'Infrastructure-as-Code misconfiguration scan (Terraform / Dockerfile).',
  'OSV-Scanner': 'Open-source dependency vulnerabilities from the OSV database.',
  'OWASP ZAP': 'DAST — dynamic web scan (XSS / SQLi / auth) against a running URL.',
  'Jest Coverage': 'Measures JS/TS test coverage against the threshold.',
  'Qodo Cover-Agent': 'AI-generates tests to raise coverage (needs the cover-agent binary + an LLM key; Gemini supported).',
  'Keploy API Tests': 'Replays recorded API test cases to catch regressions between releases.',
  'k6 Load Test': 'Performance / load test against a running URL.',
  'Promptfoo': 'LLM prompt evaluation — tone, accuracy, and safety of prompt outputs.',
  'Garak (LLM DAST)': 'LLM red-teaming — prompt injection, jailbreaks, unsafe output.',
  'Bandit': 'Python SAST — insecure calls, weak crypto, injection patterns.',
  'pip-audit': 'Python dependency CVEs from the PyPI advisory database.',
  'gosec': 'Go SAST — insecure code patterns (SQL injection, weak rand, file perms).',
  'govulncheck': 'Go vulnerability scan — calls into known-vulnerable stdlib/module code.',
  'SpotBugs': 'Java bytecode analysis — bugs and security anti-patterns (via Maven/Gradle).',
  'OWASP Dependency-Check': 'Java dependency CVE scan against the NVD database.',
  '.NET Analyzers': '.NET SAST — Roslyn security analyzers on build.',
  '.NET NuGet Audit': '.NET dependency CVEs via the NuGet advisory feed.',
  'Clippy': 'Rust linter — correctness, style, and suspicious-pattern checks.',
  'cargo-audit': 'Rust crate CVEs from the RustSec advisory database.',
  'Gitleaks (Secrets)': 'Secret scanning — leaked keys/tokens in the code and git history.',
  'Logic Tests': "Runs the app's own test suite (npm test / pytest / …).",
  'Component Evaluator': 'Per-component checks — auth, robustness, fail-safe, coherence — across the app graph.',
  'Component Evaluator (LLM)': 'LLM reasoning pass over components — semantic robustness/coherence review.',
  'HTTP Security Headers': 'Response-header hardening of a running URL — CSP, HSTS, cookie flags, version leaks.',
  'npm audit': 'Known npm dependency advisories straight from the npm registry (no extra tools).',
  'Dependency Freshness': 'How far dependencies have drifted behind upstream (npm / pip).',
};

export const MODULE_GROUPS: { id: string; label: string }[] = [
  { id: 'static', label: 'Static analysis' },
  { id: 'security', label: 'Security & supply chain' },
  { id: 'container', label: 'Container' },
  { id: 'testing', label: 'Testing & quality' },
  { id: 'llm', label: 'LLM safety' },
];

// Copy-paste install hints for the external tools DAT shells out to.
// Python-based tools use pipx (Homebrew's Python is PEP 668 externally-managed, so plain `pip
// install` is blocked). cover-agent is NOT on PyPI — it ships as a GitHub release binary.
export const INSTALL_HINTS: Record<string, string> = {
  semgrep: 'brew install semgrep', trivy: 'brew install trivy', gitleaks: 'brew install gitleaks',
  hadolint: 'brew install hadolint', dockle: 'brew install dockle', checkov: 'pipx install checkov',
  'osv-scanner': 'brew install osv-scanner', 'sonar-scanner': 'brew install sonar-scanner',
  bandit: 'pipx install bandit', 'pip-audit': 'pipx install pip-audit', gosec: 'brew install gosec',
  govulncheck: 'go install golang.org/x/vuln/cmd/govulncheck@latest', cargo: 'install Rust (rustup)',
  dotnet: 'install the .NET SDK', mvn: 'install Maven', gradle: 'install Gradle', k6: 'brew install k6',
  keploy: 'see keploy.io/docs/install', python3: 'install Python 3', docker: 'install Docker Desktop',
  gcloud: 'brew install --cask google-cloud-sdk',
  'cover-agent': 'download cover-agent-<os> from github.com/qodo-ai/qodo-cover/releases',
  npm: 'install Node.js (includes npm)', pip3: 'install Python 3 (includes pip)',
};

export interface OptionDoc {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  default?: unknown;
  description: string;
}
export interface ScannerDoc { options: OptionDoc[]; envKeys?: string[]; note?: string }

// Hand-written per-scanner docs (keyed by config key) for what can't be derived from the
// registry: the tool-specific options in DatConfig.scanners (src/types.ts) and the operator
// env keys a scanner consumes. Defaults mirror the fallbacks in each scanner's run().
export const SCANNER_DOCS: Record<string, ScannerDoc> = {
  semgrep: { options: [
    { name: 'rules', type: 'string[]', default: ['p/security-audit'], description: 'Semgrep rule packs to run.' },
    { name: 'customRulesDir', type: 'string', default: 'rules', description: 'Directory of additional custom rules.' },
  ] },
  sonarqube: { options: [
    { name: 'projectKey', type: 'string', default: 'auto: app folder slug', description: 'Project key sent to the server (override; else SONAR_PROJECT_KEY, else the app folder name).' },
    { name: 'hostUrl', type: 'string', description: 'SonarQube server URL (else SONAR_HOST_URL).' },
    { name: 'sources', type: 'string', default: '.', description: 'Source path analysed.' },
  ], envKeys: ['SONAR_TOKEN', 'SONAR_HOST_URL'],
    note: 'With SONAR_HOST_URL + SONAR_TOKEN set, DAT runs SonarQube on any app — no in-repo sonar-project.properties needed. A self-hosted server auto-creates the project on first analysis. A repo that ships its own properties file is respected as-is.' },
  hadolint: { options: [
    { name: 'target', type: 'string', default: 'Dockerfile', description: 'Dockerfile path to lint.' },
  ] },
  trivy: { options: [
    { name: 'generateSbom', type: 'boolean', default: false, description: 'Also emit a CycloneDX SBOM.' },
    { name: 'sbomPath', type: 'string', default: 'results/bom.json', description: 'Where to write the SBOM.' },
  ] },
  dockle: { options: [
    { name: 'imageName', type: 'string', default: 'project-image:latest', description: 'Built image to check against CIS benchmarks.' },
  ] },
  checkov: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory scanned for IaC files.' },
  ] },
  osv: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory scanned for dependency manifests.' },
  ] },
  zap: { options: [
    { name: 'failOnMissingTarget', type: 'boolean', default: true, description: 'Raise a coverage gap when no DAST URL is provided.' },
  ] },
  jest: { options: [
    { name: 'threshold', type: 'number', default: 80, description: 'Minimum line-coverage percent.' },
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory containing the JS/TS project.' },
  ] },
  coverAgent: { options: [
    { name: 'sourceFilePath', type: 'string', description: 'Source file to generate tests for.' },
    { name: 'testFilePath', type: 'string', description: 'Existing test file to extend.' },
    { name: 'testCommand', type: 'string', description: 'Command that runs the test suite.' },
  ], envKeys: ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    note: 'With only a Gemini key set, DAT passes --model gemini/<llm.model> automatically.' },
  keploy: { options: [
    { name: 'appCmd', type: 'string', default: 'npm start', description: 'Command that boots the app for replay.' },
  ] },
  k6: { options: [
    { name: 'thresholdMs', type: 'number', default: 500, description: 'p95 latency budget in milliseconds.' },
    { name: 'failOnMissingTarget', type: 'boolean', default: true, description: 'Raise a coverage gap when no URL is provided.' },
  ] },
  promptfoo: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory containing promptfooconfig.yaml.' },
  ], envKeys: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] },
  garak: { options: [], note: 'Needs the garak Python package importable by python3.' },
  bandit: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Python source directory to scan.' },
  ] },
  pipAudit: { options: [
    { name: 'targetFile', type: 'string', default: 'requirements.txt', description: 'Requirements file to audit.' },
  ] },
  gosec: { options: [
    { name: 'targetDir', type: 'string', default: './...', description: 'Go package pattern to scan.' },
  ] },
  govulncheck: { options: [
    { name: 'targetDir', type: 'string', default: './...', description: 'Go package pattern to scan.' },
  ] },
  spotbugs: { options: [] },
  dependencyCheck: { options: [] },
  dotnetSast: { options: [] },
  dotnetSca: { options: [] },
  clippy: { options: [] },
  cargoAudit: { options: [] },
  gitleaks: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory (and its git history) to scan.' },
  ] },
  logicTests: { options: [
    { name: 'command', type: 'string', description: 'Test command (auto-detected per ecosystem when unset).' },
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory the tests run in.' },
    { name: 'failOnMissingTests', type: 'boolean', default: true, description: 'Treat a missing test suite as a blocking gap.' },
  ] },
  httpHeaders: { options: [],
    note: 'Runs only when a target URL is provided (--url or --deploy); otherwise it skips with an INFO note.' },
  npmAudit: { options: [
    { name: 'targetDir', type: 'string', default: '.', description: 'Directory containing package-lock.json.' },
  ] },
  depFreshness: { options: [] },
};

export interface OperatorKeyDoc {
  group: 'llm' | 'cloud' | 'integrations' | 'sast';
  purpose: string;
  unlocks: string;
}

// One-line docs for each operator credential (~/.dat/.env) — what it is and what setting it
// turns on. Grouping drives the Settings page sections.
export const OPERATOR_KEY_DOCS: Record<string, OperatorKeyDoc> = {
  GEMINI_API_KEY: { group: 'llm', purpose: 'Google AI Studio API key for the Gemini backend.',
    unlocks: 'LLM component evaluator, Cover-Agent test generation, AI remediation.' },
  OPENAI_API_KEY: { group: 'llm', purpose: 'OpenAI API key.',
    unlocks: 'Cover-Agent and Promptfoo with OpenAI models.' },
  ANTHROPIC_API_KEY: { group: 'llm', purpose: 'Anthropic API key.',
    unlocks: 'Cover-Agent and Promptfoo with Claude models.' },
  GCP_PROJECT_ID: { group: 'cloud', purpose: 'Google Cloud project id.',
    unlocks: 'Ephemeral --deploy previews on Cloud Run and the Vertex AI LLM backend.' },
  NEON_API_KEY: { group: 'cloud', purpose: 'Neon serverless-Postgres API key.',
    unlocks: 'Throwaway databases auto-provisioned for --deploy DAST runs.' },
  NEON_ORG_ID: { group: 'cloud', purpose: 'Neon organization id (optional).',
    unlocks: 'Org/region placement of the ephemeral databases.' },
  DEFECTDOJO_URL: { group: 'integrations', purpose: 'DefectDojo instance URL.',
    unlocks: 'Pushing SARIF scan results into DefectDojo (--push-dojo).' },
  DEFECTDOJO_API_KEY: { group: 'integrations', purpose: 'DefectDojo API key.',
    unlocks: 'Authentication for the DefectDojo push.' },
  DEPENDENCY_TRACK_URL: { group: 'integrations', purpose: 'Dependency-Track instance URL.',
    unlocks: 'Pushing the SBOM into Dependency-Track (--push-dtrack).' },
  DEPENDENCY_TRACK_API_KEY: { group: 'integrations', purpose: 'Dependency-Track API key.',
    unlocks: 'Authentication for the Dependency-Track push.' },
  SONAR_TOKEN: { group: 'sast', purpose: 'SonarQube authentication token.',
    unlocks: 'The SonarQube code-quality scanner.' },
  SONAR_HOST_URL: { group: 'sast', purpose: 'SonarQube server URL (e.g. http://localhost:9000).',
    unlocks: 'Running SonarQube on any app with no in-repo config (self-hosted auto-creates the project).' },
  SONAR_ORGANIZATION: { group: 'sast', purpose: 'SonarCloud organization key (SonarCloud only).',
    unlocks: 'SonarCloud analysis; not needed for a self-hosted server.' },
};

export const OPERATOR_GROUPS: { id: OperatorKeyDoc['group']; label: string }[] = [
  { id: 'llm', label: 'LLM keys' },
  { id: 'cloud', label: 'Cloud & deploy' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'sast', label: 'SAST' },
];

export interface ModuleEntry {
  key: string;
  name: string;
  module: string;
  description: string;
  supportedLanguages: string[] | 'all';
  binaries: { name: string; installed?: boolean; hint?: string }[];
  inputs: { label: string; category: string; tier: string; consequence?: string }[];
  envKeys: { key: string; set?: boolean; purpose?: string }[];
  options: OptionDoc[];
  note?: string;
  profiles: ProfileName[];
  configSnippet: string;
}
export interface ModulesResponse {
  groups: { id: string; label: string }[];
  modules: ModuleEntry[];
}

function configSnippet(key: string, name: string, options: OptionDoc[]): string {
  const lines = [`# .dat.config.yaml — enable ${name}`, 'scanners:', `  ${key}:`, '    enabled: true'];
  for (const o of options) {
    const def = o.default === undefined ? '' : Array.isArray(o.default) ? `[${o.default.join(', ')}]` : String(o.default);
    lines.push(`    # ${o.name}: ${def || '<value>'}`.padEnd(34) + ` # ${o.description}`);
  }
  return lines.join('\n') + '\n';
}

/** The probe-free catalog (deterministic — unit-testable without touching the PATH). */
export function buildStaticCatalog(): ModulesResponse {
  const modules: ModuleEntry[] = ALL_SCANNERS.map((s) => {
    const key = CONFIG_KEYS[s.name];
    const doc = SCANNER_DOCS[key] ?? { options: [] };
    const profileNames = (['quick', 'standard', 'security'] as const)
      .filter((p) => PROFILES[p].includes(key)) as ProfileName[];
    return {
      key,
      name: s.name,
      module: s.module,
      description: SCANNER_DESCRIPTIONS[s.name] ?? '',
      supportedLanguages: s.supportedLanguages,
      binaries: (s.requiredBinaries ?? []).map((b) => ({ name: b, hint: INSTALL_HINTS[b] })),
      inputs: (s.expectedInputs ?? []).map((i) => ({
        label: i.label, category: i.category, tier: inputTier(i.category), consequence: i.consequence,
      })),
      envKeys: (doc.envKeys ?? []).map((k) => ({ key: k, purpose: OPERATOR_KEY_DOCS[k]?.purpose })),
      options: doc.options,
      note: doc.note,
      profiles: [...profileNames, 'full'],
      configSnippet: configSnippet(key, s.name, doc.options),
    };
  });
  return { groups: MODULE_GROUPS, modules };
}

/** Full catalog with live binary-installed probes and operator-key set-status. */
export async function buildModuleCatalog(): Promise<ModulesResponse> {
  const catalog = buildStaticCatalog();
  const keyStatus = new Map(maskedOperatorEnv().map((s) => [s.key, s.set]));
  const binaries = [...new Set(catalog.modules.flatMap((m) => m.binaries.map((b) => b.name)))];
  const installed = new Map(await Promise.all(
    binaries.map(async (b) => [b, await isBinaryAvailable(b)] as const)
  ));
  for (const m of catalog.modules) {
    for (const b of m.binaries) b.installed = installed.get(b.name) ?? false;
    for (const k of m.envKeys) k.set = keyStatus.get(k.key) ?? Boolean(process.env[k.key]);
  }
  return catalog;
}
