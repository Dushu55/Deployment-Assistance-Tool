import ExcelJS from 'exceljs';

const features = [
  ['Category', 'Feature Name', 'Description', 'Supported Ecosystems', 'Status'],
  ['Core Orchestration', 'Dynamic Environment Routing', 'Automatically detects workspace ecosystems and prunes unused scanners to reduce execution time.', 'Node, Python, Go, Java, C#, Rust', 'Production'],
  ['Core Orchestration', 'Concurrency Limiter', 'Executes tools in parallel within CPU/Memory limits using a robust worker pool.', 'All', 'Production'],
  ['Core Orchestration', 'Quality Gate & Readiness Score', 'Mathematically calculates a Deployment Readiness Score and blocks CI pipelines via configurable failOn thresholds.', 'All', 'Production'],
  ['SAST', 'Semgrep Integration', 'Advanced semantic grep engine for fast static analysis.', 'All', 'Production'],
  ['SAST', 'SonarQube Integration', 'Continuous code quality and security inspection.', 'All', 'Production'],
  ['SAST', 'Bandit Integration', 'Specialized static analysis for finding common security issues in Python code.', 'Python', 'Production'],
  ['SAST', 'gosec Integration', 'Security checker for Go AST inspecting source code for security problems.', 'Go', 'Production'],
  ['SAST', 'SpotBugs Integration', 'Bytecode static analysis for Java using Maven/Gradle plugins.', 'Java', 'Production'],
  ['SAST', '.NET Analyzers Integration', 'Leverages Roslyn analyzers / SecurityCodeScan to parse native SARIF logs from dotnet build.', 'C#', 'Production'],
  ['SAST', 'Clippy Integration', 'Official Rust linter integrated for catching security and performance anti-patterns.', 'Rust', 'Production'],
  ['SCA', 'Trivy Integration', 'Universal filesystem and lockfile scanner for OS and library vulnerabilities.', 'All', 'Production'],
  ['SCA', 'OSV-Scanner Integration', 'Google OSV database integration for deep vulnerability scanning.', 'All', 'Production'],
  ['SCA', 'pip-audit Integration', 'Scans Python environments and requirements for known vulnerabilities.', 'Python', 'Production'],
  ['SCA', 'govulncheck Integration', 'Official Google vulnerability scanning for Go modules with native reachability.', 'Go', 'Production'],
  ['SCA', 'OWASP Dependency-Check', 'Scans project dependencies in Maven/Gradle ecosystems to detect publicly disclosed vulnerabilities.', 'Java', 'Production'],
  ['SCA', '.NET NuGet Audit', 'Scans dotnet projects for vulnerable NuGet packages.', 'C#', 'Production'],
  ['SCA', 'cargo-audit Integration', 'Checks Rust Cargo.lock files against the RustSec Advisory Database.', 'Rust', 'Production'],
  ['Container Security', 'Hadolint Integration', 'Lints Dockerfiles against best practice rules.', 'Dockerfiles', 'Production'],
  ['Container Security', 'Dockle Integration', 'CIS benchmark scanner for built container images.', 'Docker Images', 'Production'],
  ['IaC Security', 'Checkov Integration', 'Static code analysis for Infrastructure as Code (Terraform, CloudFormation, Kubernetes).', 'Cloud/IaC', 'Production'],
  ['Dynamic Analysis (DAST)', 'OWASP ZAP Integration', 'Dynamic application security testing against live preview URLs.', 'Web/APIs', 'Production'],
  ['Test Intelligence', 'k6 Load Testing', 'Enforces strict performance thresholds against ephemeral environments.', 'Web/APIs', 'Production'],
  ['Test Intelligence', 'Qodo Cover-Agent', 'Agentic loop that generates missing unit tests for uncovered code.', 'All', 'Production'],
  ['Test Intelligence', 'Keploy Integration', 'Records live API traffic and auto-generates e2e integration tests.', 'Web/APIs', 'Production'],
  ['Test Intelligence', 'Jest Coverage Parsing', 'Parses lcov to find safety-net gaps before auto-fixes.', 'Node.js', 'Production'],
  ['AI & Red Teaming', 'Promptfoo Integration', 'Automated prompt evaluation testing LLM semantic drift and tone.', 'LLMs', 'Production'],
  ['AI & Red Teaming', 'Garak Integration', 'Probes LLM endpoints for prompt injection and OWASP LLM vulnerabilities.', 'LLMs', 'Production'],
  ['Advanced Security', 'Reachability Engine', 'Filters out false positives by verifying if vulnerable packages are actually imported/called in source code.', 'Node, Python, Java, C#, Rust', 'Production'],
  ['Autonomous Remediation', 'AST Auto-Fixers', 'Uses ast-grep to deterministically rewrite unsafe code patterns inline.', 'TypeScript/JS (Extensible)', 'Production'],
  ['Autonomous Remediation', 'Auto-Distroless Refactoring', 'LLM-driven engine (Gemini) that converts vulnerable Dockerfiles into secure multi-stage builds.', 'Dockerfiles', 'Production'],
  ['Autonomous Remediation', 'Test-Driven Rollback Loop', 'Automatically runs native tests (npm test, pytest, go test) after a fix and reverts via git if it breaks.', 'All', 'Production'],
  ['Autonomous Remediation', 'Self-Healing PR Bot', 'Programmatic Git/GitHub Agent that pushes fix branches and opens fully formatted Pull Requests.', 'GitHub', 'Production'],
  ['Platform Integrations', 'Native GitHub App', 'Probot-based webhook listener allowing 1-click CI/CD installs without YAML configuration.', 'GitHub', 'Production'],
  ['Platform Integrations', 'Ephemeral Deployment Engine', 'Spins up isolated branch preview environments automatically for DAST testing and destroys them afterwards.', 'Vercel/AWS', 'Production'],
  ['Reporting & Export', 'SARIF Exporter', 'Produces standardized logs native to GitHub Security Tab.', 'All', 'Production'],
  ['Reporting & Export', 'PDF / CSV Generators', 'Outputs management-friendly professional reports and raw data files.', 'All', 'Production'],
  ['Reporting & Export', 'DefectDojo API Sync', 'Pushes aggregated findings automatically into enterprise vulnerability management dashboards.', 'DefectDojo', 'Production']
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Exhaustive Features');
ws.addRows(features);

// Set column widths (Category, Feature Name, Description, Supported Ecosystems, Status).
[25, 35, 90, 35, 15].forEach((width, i) => { ws.getColumn(i + 1).width = width; });

const fileName = 'DAT_Exhaustive_Features.xlsx';
await wb.xlsx.writeFile(fileName);
console.log(`Successfully generated ${fileName}`);
