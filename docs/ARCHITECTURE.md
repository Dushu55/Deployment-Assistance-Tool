# Deployment Assist Tool (DAT) Architecture

DAT is a robust, massively parallelized Polyglot DevSecOps orchestration CLI and platform. It wraps the industry's best open-source scanners into a single, cohesive CI/CD pipeline, fully equipped with an autonomous code remediation engine.

## System Architecture

```mermaid
graph TD;
    subgraph Triggers & Platforms
    A1[Local CLI / CI-CD YAML] --> B(DAT Execution Engine);
    A2[Native GitHub App / Webhook] --> B;
    end
    
    subgraph Dynamic Orchestration
    B --> ED[Environment Detector];
    ED -.->|Node, Python, Go, Java, C#, Rust| Router;
    B --> Router{Polyglot Router};
    end

    subgraph Ephemeral Operations
    Router --> EE[Ephemeral Deployment Engine];
    EE -.->|Deploys to| VercelAWS[Vercel / AWS Preview];
    end

    subgraph Static Analysis SAST
    Router --> C[Semgrep & SonarQube];
    Router --> C1[Python: Bandit];
    Router --> C2[Go: gosec];
    Router --> C3[Java: SpotBugs];
    Router --> C4[C#: .NET Analyzers];
    Router --> C5[Rust: Clippy];
    end
    
    subgraph Supply Chain & IaC SCA
    Router --> F[Trivy & OSV-Scanner];
    Router --> F1[Python: pip-audit];
    Router --> F2[Go: govulncheck];
    Router --> F3[Java: OWASP Dependency-Check];
    Router --> F4[C#: .NET NuGet Audit];
    Router --> F5[Rust: cargo-audit];
    Router --> H[Checkov IaC];
    end

    subgraph Container Security
    Router --> E[Hadolint & Dockle];
    end
    
    subgraph Dynamic & Test Intelligence
    Router --> J[OWASP ZAP Adapter];
    Router --> K[k6 Load Test];
    VercelAWS -.->|Target URL| J;
    VercelAWS -.->|Target URL| K;
    Router --> L[Jest / Qodo Cover-Agent];
    end

    subgraph LLM Red Teaming
    Router --> N[Promptfoo & Garak];
    end

    C & C1 & C2 & C3 & C4 & C5 & F & F1 & F2 & F3 & F4 & F5 & H & E & J & K & L & N --> P{Result Aggregator};
    
    subgraph Advanced Deterministic Security
    P --> RA[Polyglot Reachability Engine];
    RA -.->|Filters false positives via Source Imports| P;
    end

    subgraph Output & Autonomous Action
    P --> Q[Readiness Score Engine];
    P --> R[Console Chalk Reporter];
    
    P --> AST[AST Auto-Fixers <br> ast-grep];
    P --> AI[Agentic Remediation Engine <br> LLM Self-Healing PR Bot];
    P --> AD[Auto-Distroless Docker Refactor];
    
    AST & AD --> Verify[Test-Driven Rollback Loop <br> npm/pytest/go/mvn/cargo test];
    Verify -.->|Rolls back bad fixes| AST;
    end
    
    subgraph Exporters
    P --> S[SARIF Exporter];
    P --> T[CSV Exporter];
    P --> U[PDF Generator];
    P --> V[DefectDojo REST API];
    end
    
    Verify --> A2;
    AI --> A2;
```

## Core Components
0. **Application Component Model (`src/components/`):** *(Phase 2)* Builds a typed graph of what the application is made of — `Button`/`Input`/`Form`/`ApiCall` (React/JSX), `ApiEndpoint` (Express/Fastify/Next), and `NetworkResource` (Terraform) — and links client API calls to the backend endpoints they hit. Persisted via `dat model` or `scan --component-model`; findings are attributed to components (`componentRef`) in the fix manifest. This is the foundation for per-component fail-safe/robustness evaluation (Phase 3). See [COMPONENT_MODEL.md](COMPONENT_MODEL.md).
1. **Dynamic Environment Detector (`src/env.ts`):** Scans the workspace to identify the exact ecosystems present (`package.json`, `requirements.txt`, `go.mod`, etc.) and dynamically prunes unused scanners to optimize performance.
2. **Execution Runner (`src/runner.ts`):** Safely spawns child processes for external tools with concurrency pooling, timeout handling, and `ENOENT` interception.
3. **Polyglot Reachability Engine (`src/reachability/`):** Cross-references standard SCA vulnerabilities with **regex/import-heuristic** source analysis (true AST/call-graph reachability is planned — see roadmap). It scans import/use declarations across Node, Python, Java, C#, and Rust to flag whether a vulnerable dependency is referenced in the application tree, cutting false positives. It deliberately *fails open* (treats a package as reachable on any analysis error) so a heuristic miss never suppresses a real CVE.
4. **Agentic & AST Remediation Engine (`src/autofix/` & `src/llm/`):** Moves DAT beyond "reporting" to "fixing". It leverages deterministic AST rewrites (`ast-grep`) and LLMs (Google Gemini) to automatically patch logical flaws and rewrite vulnerable `Dockerfiles` into distroless bases.
5. **Test-Driven Rollback Loop:** A critical safety net that executes the native testing framework (`npm test`, `pytest`, `cargo test`) immediately after an auto-fix. If the tests fail, the engine uses Git to silently revert the broken code before any human sees it.
6. **Native Event Listener (`src/app.ts`):** Probot/Octokit infrastructure allowing organizational 1-click install and webhook-driven executions. It works with the **Self-Healing PR Bot (`src/agent/`)** to branch, commit, and open PRs for remediated vulnerabilities completely autonomously.
7. **Ephemeral Deployment Engine (`src/deployers/`):** Dynamically spins up and tears down live preview branches using Vercel/AWS APIs to run DAST and load tests securely against untrusted PR code.
8. **Result Aggregator (`src/types.ts`):** Normalizes the widely varying JSON structures of 20+ scanning tools into a single, predictable `Issue[]` array.
9. **Quality Gate Engine:** Evaluates the mathematically calculated `Deployment Readiness Score` against configured `failOn` thresholds to enforce strict exit codes and block insecure deployments.