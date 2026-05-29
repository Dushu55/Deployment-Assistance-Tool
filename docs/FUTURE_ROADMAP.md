# DAT: Future Roadmap & Expansion Strategy (V3+)

This document outlines the strategic evolution of the Deployment Assist Tool (DAT). As of the completion of **V2**, the vast majority of our core autonomous remediation, dynamic analysis, and Tier 1 polyglot support (Python & Go) are **fully implemented and in production.**

---

## 1. V2 Core Pipeline (Recently Completed)

The following capabilities represent the massive architectural leaps taken in V2 to upgrade DAT from a pipeline orchestrator to an autonomous remediation engine. They are now considered part of the core MVP.

| Original Feature | Current V2 Implementation (Production) | Future Trajectory |
| :--- | :--- | :--- |
| **F1: LLM Flaw Detection** | **COMPLETED:** Autonomous Agents that clone the repo, fix logical flaws, and submit passing PRs automatically. | N/A - Implemented |
| **F2: Auto-Remediation** | **COMPLETED:** AST Auto-Fixers via native `ast-grep` integration rewriting unsafe code automatically with test-driven rollback verification. | N/A - Implemented |
| **F3: Expanded Code Review** | **COMPLETED:** Ephemeral Environment Scanning mapping Vercel live previews dynamically to DAST (ZAP) and Load (k6) testing engines. | N/A - Implemented |
| **F4/F5: Security & Vulns** | **COMPLETED:** Reachability Analysis upgrading SCA to verify actual call paths in Node and Python, drastically cutting false positives. | N/A - Implemented |
| **F6: CI/CD Integration** | **COMPLETED:** Native GitHub App scaffolding via Probot for true webhook-driven, 1-click org-wide installs. | N/A - Implemented |
| **F7: Docker Optimisation** | **COMPLETED:** Auto-Distroless logic triggering LLMs to seamlessly rewrite vulnerable Dockerfiles to secure multi-stage builds. | N/A - Implemented |
| **F10: Language Matrix** | **COMPLETED:** Tier 1 Polyglot support (Python & Go). Dynamic Environment Detection auto-routes scanning tools. | *See "Tier 2 & 3 Support" below.* |

---

## 2. Long-Term Backlog (V3 / Deferred)

The following high-value but highly complex features represent the active backlog for V3 and beyond.

*   **Spotify Backstage Plugin:** Embed DAT's Deployment Readiness Scores directly into the organization's Internal Developer Portal (IDP).
*   **Custom LoRA Fine-Tuning:** Use Dev accept/reject data to continuously train a local LLM to learn the organization's specific coding style, resulting in better automated PR fixes.
*   **Cross-Repo AST Search:** Scan the entire GitHub organization for duplicated logic and suggest extracting it into a shared internal NPM/PyPI/Go package.
*   **Native GCP Cloud Logging (Stackdriver):** Implement `@google-cloud/logging-winston` to stream our structured audit JSON logs securely into GCP for immutable SOC2/HIPAA compliance retention.

---

## 3. Practical Expansion: Tier 2 & Tier 3 Ecosystem Support

With Node.js, Python, and Go now fully integrated, the roadmap targets the following enterprise legacy and edge-performance ecosystems:

### Tier 2: Enterprise Legacy & Core (Months 3-6)
*   **Java / Kotlin:** 
    *   *Frameworks:* Spring Boot, Quarkus.
    *   *Tool Additions:* SpotBugs, OWASP Dependency-Check (native Maven/Gradle integrations).
*   **C# / .NET:**
    *   *Frameworks:* ASP.NET Core.
    *   *Tool Additions:* SecurityCodeScan, .NET analyzers.

### Tier 3: High-Performance Edge (Months 6+)
*   **Rust:**
    *   *Frameworks:* Actix, Tokio.
    *   *Tool Additions:* cargo-audit, clippy.
