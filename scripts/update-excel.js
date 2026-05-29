import xlsx from 'xlsx';

const workbook = xlsx.readFile('DAT_Development_Plan.xlsx');

const sheetName = 'Future Roadmap';
const data = [
  [ '  DAT: Current State (V2) & Future Trajectory (V3+)' ],
  [
    '#',
    'Original Feature',
    'Current Implementation (V2)',
    'Future Roadmap (V3 / Backlog)'
  ],
  [
    1,
    'F1',
    'LLM Flaw Detection',
    'COMPLETED (V2): Autonomous Agents that clone repo, fix flaws, and submit PRs.',
    'N/A - Fully Implemented'
  ],
  [
    2,
    'F2',
    'Auto-Remediation',
    'COMPLETED (V2): AST Auto-Fixers (ast-grep) to rewrite unsafe code automatically.',
    'N/A - Fully Implemented'
  ],
  [
    3,
    'F3',
    'Expanded Code Review',
    'COMPLETED (V2): Ephemeral Env Scanning via Vercel integration, running dynamic ZAP/k6 tests.',
    'N/A - Fully Implemented'
  ],
  [
    4,
    'F4/F5',
    'Security & Vulns',
    'COMPLETED (V2): Reachability Analysis engine natively verifying call paths for Node and Python.',
    'N/A - Fully Implemented'
  ],
  [
    5,
    'F6',
    'CI/CD Integration',
    'COMPLETED (V2): Native GitHub App architecture via Probot for 1-click org installs and webhook triggers.',
    'N/A - Fully Implemented'
  ],
  [
    6,
    'F7',
    'Docker Optimisation',
    'COMPLETED (V2): Auto-Distroless logic using LLM to dynamically rewrite vulnerable Dockerfiles.',
    'N/A - Fully Implemented'
  ],
  [
    7,
    'F8/F9',
    'Dashboard & Audit',
    'DefectDojo integration & CLI Readiness Score.',
    'Spotify Backstage Plugin: Embed DAT scores directly into org Internal Developer Portal.'
  ],
  [
    8,
    'F10',
    'Language Matrix',
    'COMPLETED (V2): Node.js, Python (Bandit/pip-audit), and Go (gosec/govulncheck) ecosystems.',
    'Expansion to Tier 2 (Java/C#) and Tier 3 (Rust) ecosystems.'
  ],
  [
    9,
    'F11',
    'Dev Feedback Loop',
    'Telemetry script scaffolding.',
    "Custom LoRA Fine-Tuning: Train local LLMs to learn the org's specific coding style."
  ],
  [
    10,
    'F12',
    'Accelerator ID',
    'Deferred (Research concept).',
    'Cross-Repo AST Search: Scan GitHub org for duplicated logic to build shared packages.'
  ],
  [],
  [ '  Language & Framework Expansion Tiers' ],
  [
    'Tier',
    'Languages',
    'Target Frameworks',
    'Status / Required Security Scanners'
  ],
  [
    'Tier 1 (Months 1-3)',
    'Python, Go (Golang)',
    'FastAPI, Django, LangChain, Gin, Fiber',
    'COMPLETED (V2): Bandit, pip-audit, gosec, govulncheck natively integrated.'
  ],
  [
    'Tier 2 (Months 3-6)',
    'Java / Kotlin, C# / .NET',
    'Spring Boot, Quarkus, ASP.NET Core',
    'SpotBugs, OWASP Dependency-Check, SecurityCodeScan'
  ],
  [
    'Tier 3 (Months 6+)',
    'Rust',
    'Actix, Tokio',
    'cargo-audit, clippy'
  ]
];

const newSheet = xlsx.utils.aoa_to_sheet(data);

// Define column widths for better readability
const wscols = [
  { wch: 5 },  // #
  { wch: 15 }, // Original Feature
  { wch: 30 }, // Current Implementation
  { wch: 50 }, // Future Roadmap
];
newSheet['!cols'] = wscols;

workbook.Sheets[sheetName] = newSheet;

xlsx.writeFile(workbook, 'DAT_Development_Plan.xlsx');
console.log('Successfully updated DAT_Development_Plan.xlsx');