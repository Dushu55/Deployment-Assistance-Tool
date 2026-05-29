# Release Notes: DAT V2.2 (POC→Enterprise Hardening Sprint)

**Release Date:** May 2026
**Version:** 2.2.0

V2.2 begins the transition of DAT from an advanced proof-of-concept to an enterprise-grade
CI/CD evaluation gate. It reconciles the codebase with its own documentation, closes correctness
and security gaps that allowed the gate to be bypassed, and adds two foundational capabilities:
**logical/functional test execution** and a **Claude-Code-consumable fix manifest**. The repository
is now under version control with CI-backed tests (40 → 80).

## 🚀 New Capabilities

* **Logical Test Execution (new `Logic Tests` scanner):** DAT now runs the application's own test
  suite and treats **failing tests as gate-blocking HIGH findings** (per-test detail via Jest
  `--json`), surfacing each failure into the report and fix manifest. A **missing** test suite is
  reported as a coverage gap rather than silently passing. This is the functional-correctness signal
  the pipeline previously lacked (the old Jest scanner measured only coverage %, not pass/fail).
* **Claude-Code Fix Manifest (`--fix-manifest`):** A versioned, lossless `fix-manifest.json` —
  the machine contract for coding agents. Each finding carries a stable id, category, gate-blocking
  flag, code excerpt, rationale, suggested fix, and verification command, sorted gate-blocking-first.
  See [CLAUDE_FIX_PROTOCOL.md](CLAUDE_FIX_PROTOCOL.md).
* **Scanner Preflight:** DAT probes each scanner's required tools and marks unavailable ones
  **SKIPPED** (distinct from "ran clean"), so a missing tool can never inflate the readiness score
  or hide a coverage gap.

## 🛡️ Correctness & Security Fixes

* **Secrets scanning now actually runs.** Gitleaks shipped in V2.1 "enabled by default" but was
  registered without a `CONFIG_KEYS` entry, so the orchestrator filtered it out and it never
  executed. It is now wired in, with a registry guard test preventing recurrence.
* **DAST can no longer silently bypass the gate.** ZAP/k6 emit a gate-relevant coverage-gap finding
  when no target URL is available, instead of returning a passing INFO result.
* **Auto-fix is now opt-in and git-safe.** It no longer mutates the working tree on every scan
  (gated behind `--auto-fix`), and reverts from in-memory snapshots rather than `git checkout`
  (which silently failed in non-git checkouts).
* **Readiness score is bounded and severity-weighted**, so cosmetic noise in a large repo no longer
  floors the score the way a real breach does.

## ⚠️ Erratum to V2.1

The V2.1 notes stated Gitleaks secrets scanning was "enabled by default." Due to the wiring defect
above, it did **not** run in V2.1. It is effective as of V2.2. Several V2.1 `[RESOLVED]` items were
documentation-only; [FINDINGS.md](FINDINGS.md) now distinguishes verified-with-tests from
implemented-but-unverified and still-open.

## 🔭 Still Open / Next

* AST/call-graph reachability (currently regex/import-heuristic; fails open by design).
* SonarQube and k6 depth (k6 still validates only HTTP 200).
* The component-level evaluation layer (buttons/inputs/API calls/network config) and density-based
  score normalization — see [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md) Phases 2–5.
