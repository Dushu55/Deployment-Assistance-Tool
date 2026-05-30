# Deployment Assist Tool (DAT) — POC → Enterprise-Grade Roadmap

**Author:** Engineering (senior review)
**Date:** 2026-05-29
**Status of codebase at time of writing:** Advanced POC. The orchestration core is well-architected; the surrounding claims of "Production Ready / V2.1" are ahead of the implementation. This roadmap is written against the *code as ground truth*, not the marketing docs.

---

## 0. Executive Summary

DAT today is a **polyglot DevSecOps orchestration CLI**: a clean `Scanner` interface with ~25 adapters that shell out to best-of-breed open-source tools (Semgrep, Trivy, ZAP, gosec, etc.), normalize their output into a unified `Issue[]`, deduplicate, score, gate, and export (console / SARIF / CSV / PDF / DefectDojo / Dependency-Track). There is also an autonomous-remediation layer (ast-grep rewrites, Gemini Dockerfile refactor, a Probot self-healing PR bot).

The **target product** is more ambitious than what exists. The stated vision is an intermediate CI/CD gate that evaluates an application **component-by-component** — buttons, inputs, API calls, network configurations — for defects, best practices, security, **fail-safe attributes, attack-resistance, robustness, and coherence**, then emits **two artifacts**: a human-readable report *and* a machine-consumable format that Claude Code (or any coding agent) can ingest to perform the fixes.

The central insight driving this roadmap:

> **The existing DAT is a file/line and URL-level scanner orchestrator. The target product needs a component-level application model plus a reasoning layer on top of it, and a well-designed fix-handoff contract. The component model and the fix contract are net-new; the orchestrator is the foundation to build them on.**

We therefore sequence the work in six phases: **(0) Truth & Foundation → (1) Fix-Handoff Contract → (2) Application/Component Model → (3) Component Evaluators → (4) Enterprise Hardening → (5) Scale & GA.** Phases 0 and 1 are low-risk and high-leverage and should land first.

---

## 1. Current-State Assessment (code as ground truth)

### 1.1 What is genuinely solid

- **Scanner abstraction** (`src/types.ts` → `Scanner` interface) and the **registry** (`src/scanners/index.ts`). Adding deterministic checks is mechanical.
- **Concurrency-limited execution** with signal-safe child-process cleanup (`src/orchestrator.ts`, `src/runner.ts`).
- **Environment detection** (`src/env.ts`) — heuristic ecosystem detection driving scanner pruning and verify-command selection.
- **Auto-fix safety design** (`src/autofix/index.ts`) — verify-command whitelist, revert-on-failure, revert-on-missing-verify. The *intent* is correct and fail-safe.
- **SSRF guard** (`src/utils/security.ts` `isSafeUrl()`) applied to ZAP and k6.
- **Unified severity mapping** that fail-safes unknown severities to `HIGH` (`src/utils.ts` `mapSeverity`).

### 1.2 Confirmed defects & overstated claims (verified against source)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| A | **Gitleaks secrets scanner never runs.** Registered in `scanners/index.ts` but missing from `CONFIG_KEYS` in `orchestrator.ts` (and from `.dat.config.yaml`). The orchestrator filter drops any scanner not in `CONFIG_KEYS`. | `orchestrator.ts:18-43`, `orchestrator.ts:142-144`, `scanners/index.ts:53` | The V2.1 headline "secrets scanning enabled by default" is dead on arrival. |
| B | **Auto-fixer runs on every scan, ignoring `config.autoFix.enabled`.** | `orchestrator.ts:197-201` | A plain `dat scan` mutates the working tree by design. Not enterprise-safe default. |
| C | **Rollback assumes a git repo.** Revert uses `git checkout --`. | `autofix/index.ts:130,149` | In non-git checkouts (this repo included), a failed-verification fix cannot be reverted → broken code persists. The safety net fails exactly where needed. |
| D | **DAST silently bypasses the gate with no URL.** ZAP/k6 return `success:true` + INFO when `url` is absent. | `zap.ts:11-18`, `k6.ts:10-17` | Their own FINDINGS marks this CRITICAL and unresolved; release notes imply ZAP is hardened. Dynamic flaws never block. |
| E | **No external-tool preflight.** Every adapter assumes its binary is installed; failure surfaces only as `success:false` per scanner. | all `src/scanners/*.ts` | On a clean runner most scanners no-op silently; "Production Ready" is aspirational. |
| F | **Reachability is regex string-matching**, acknowledged false-negative risk for CVE suppression (fails open, which is the right default). | `reachability/index.ts` | Complex import paths can demote real CVEs. |
| G | **Tests are presence-assertions**, not parsing/logic tests. | `src/**/*.test.ts` | No regression confidence in the parsing layer that is the heart of each adapter. |
| H | **SARIF export is lossy** (messages truncated to 100 chars, no structured remediation/fingerprint). | `reporters/sarif.ts:30` | Inadequate as the agent fix-handoff format. |
| I | **Readiness score is an unbounded linear subtraction**, not normalized by repo size. | `utils.ts:33-46` | A large monorepo with many LOWs scores the same as a tiny app with one CRITICAL. Skews the gate. |
| J | **Not a git repository; workspace clutter.** `temp_test.ts`, `test-autofix.ts`, committed `venv/`, `dist/`, root `patch_*.py`. | repo root | No provenance, no history, no branch protection. |

### 1.3 The structural gap to the vision

The vision asks for evaluation of **components** — "buttons, inputs, API calls, network configurations" — with judgments about **fail-safe behavior, robustness, and coherence**. DAT has **no concept of a component**. It reasons about files, lines, and a target URL. Generic Semgrep rules catch a sliver of this incidentally, but questions like *"does this submit button handle the error/loading/disabled path?", "does this input validate, sanitize, and bound its value?", "does this fetch() have a timeout, retry, auth, and error boundary?", "is this security-group rule least-privilege?"* require:

1. an **application/component model** (Phase 2), and
2. a **reasoning layer** — deterministic rules where possible, LLM where judgment is required (Phase 3).

This is the product differentiator and the bulk of net-new engineering.

---

## 2. Target Architecture (where we are going)

```
                         ┌─────────────────────────────────────────────┐
   Triggers              │              DAT Evaluation Engine           │
   CLI / GitHub App ───► │                                              │
                         │  1. Environment + Component Discovery        │
                         │     (env.ts + NEW component model builder)   │
                         │            │                                 │
                         │            ▼                                 │
                         │  2. Deterministic Scanners (existing)        │
                         │     SAST / SCA / IaC / DAST / secrets        │
                         │            │                                 │
                         │            ▼                                 │
                         │  3. Component Evaluators (NEW)               │
                         │     per-component fail-safe / robustness /   │
                         │     coherence checks (rules + LLM)           │
                         │            │                                 │
                         │            ▼                                 │
                         │  4. Aggregation: Issue[] + Component graph   │
                         │     dedup, reachability, scoring, gate       │
                         └────────────┬────────────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                          ▼
        Human-readable report                   Machine fix-manifest (NEW)
        (PDF / HTML / console)                  fix-manifest.json → Claude Code
```

Key additions to the existing engine: a **Component Model** (§2 builder), **Component Evaluators** that emit into the same `Issue[]` plumbing, and a **Fix Manifest** exporter that becomes the contract with coding agents.

---

## 3. Phased Roadmap

> Effort is in engineer-weeks (ew) for one senior engineer, rough order-of-magnitude. "Risk" is delivery risk, not security.

### Phase 0 — Truth & Foundation  *(≈2–3 ew · Risk: Low)*

> **Status (2026-05-30): substantially DONE.** Repo under version control + CODEOWNERS; scrap removed;
> Defects A, B, C, D, E, I closed with tests; presence-only tests replaced (40→80); docs reconciled.
> Remaining: broader parser-test coverage. (GitHub branch protection on `main` is now ENABLED —
> repo made public; require-PR + CI status check `Run DevSecOps Scanners` (strict/up-to-date) +
> dismiss-stale + linear history + no force-push/deletion; admins not enforced so maintainers can
> still hotfix.)

Make the existing tool trustworthy and the repo professional. Prerequisite for everything else.

- [ ] `git init`, import history, add branch protection, CODEOWNERS, conventional commits.
- [ ] Remove scrap (`temp_test.ts`, `test-autofix.ts`, `test-k6.js`, root `patch_*.py`, `add_comments.py`); stop committing `venv/` and `dist/` (build in CI).
- [ ] **Fix defect A**: add `'Gitleaks (Secrets)'` to `CONFIG_KEYS` and `.dat.config.yaml`; add a regression test that asserts every `ALL_SCANNERS` entry has a `CONFIG_KEYS` mapping (this class of bug must be impossible going forward).
- [ ] **Fix defect B**: gate the auto-fixer behind `config.autoFix.enabled` (default **off** for `scan`; opt-in flag `--auto-fix`, and on by default only in the PR-bot path).
- [ ] **Fix defect C**: detect git presence; if absent, snapshot files before fix and restore from snapshot instead of `git checkout`. Refuse auto-fix in a dirty/non-git tree unless `--force`.
- [ ] **Fix defect D**: when a DAST scanner is enabled but no URL is resolvable, emit a `HIGH` "coverage gap" issue (configurable to hard-fail) instead of a silent INFO pass.
- [ ] **Fix defect E**: add a `preflight()` capability probe per scanner (binary present + min version). Report missing tools as an explicit "skipped — tool unavailable" state, distinct from "ran clean."
- [ ] **Replace presence-assertion tests** (defect G) with table-driven parsing tests using captured real tool fixtures (Semgrep/Trivy/ZAP JSON). Target the parsing logic, the dedup, and `mapSeverity` edge cases.
- [ ] **Score normalization** (defect I): bound and normalize the readiness score by finding density / project size; document the formula.
- [ ] **Doc reconciliation** (see Appendix A): correct `FINDINGS.md`, `RELEASE_NOTES_V2.1.md`, and `IMPLEMENTATION_PLAN.md` to match code reality.

**Exit criteria:** clean repo, green CI with meaningful tests, no silent gate bypasses, auto-fix safe-by-default, docs match code.

### Phase 1 — Fix-Handoff Contract (Claude-Code-consumable format)  *(≈1.5–2 ew · Risk: Low)*

> **Status (2026-05-30): DONE.** Versioned `fix-manifest.json` exporter + `--fix-manifest` flag +
> [CLAUDE_FIX_PROTOCOL.md](CLAUDE_FIX_PROTOCOL.md) shipped and tested. Optional `dat verify --manifest`
> convenience command remains a follow-up. A **`Logic Tests`** provision (functional-correctness
> execution feeding the gate and manifest) was added alongside, per stakeholder emphasis.

The highest-leverage net-new artifact. Unblocks the entire "agent fixes it" loop and is cheap because it rides the existing `Issue[]`.

- [ ] Define **`fix-manifest.json`** schema (versioned). Per finding:
  - stable `findingId` (deterministic fingerprint), `category` (`defect | security | best-practice | robustness | coherence | fail-safe`), `severity`, `source`.
  - `location`: `file`, `startLine`/`endLine`, and a **code excerpt** (±N lines of context).
  - `componentRef` (Phase 2 link; null until then).
  - `rationale` (why it matters), `suggestedFix` (concrete change or patch hint), `confidence`.
  - `verification`: the exact command the agent should run to confirm the fix (reuse `env.ts getVerifyCommand`).
  - `dependencies`: other `findingId`s that should be fixed first (ordering hints).
- [ ] Add `--fix-manifest <path>` to the CLI and a `reporters/fixManifest.ts` exporter (sibling to `sarif.ts`, but lossless).
- [ ] Author an **agent playbook** (`docs/CLAUDE_FIX_PROTOCOL.md`): how Claude Code should consume the manifest, apply fixes one finding at a time, run `verification`, and report back. Optionally a thin `dat verify --manifest` command that re-runs only the affected checks to close the loop.
- [ ] Keep SARIF for GitHub Security tab, but treat `fix-manifest.json` as the agent contract.

**Exit criteria:** a scan emits a lossless, versioned manifest; a documented protocol lets Claude Code fix findings and self-verify; round-trip demoed on `testing_data/`.

### Phase 2 — Application / Component Model  *(≈4–6 ew · Risk: Medium-High)*

> **Status (2026-05-30): V1 DONE.** Typed `ComponentGraph` schema + three heuristic extractors
> (React/JSX UI + fetch/axios calls, Express/Fastify/Next endpoints, Terraform AWS network),
> cross-stack `ApiCall→ApiEndpoint` linkage, per-extractor coverage reporting, persistence, a
> `dat model` command + `scan --component-model` flag, and `componentRef` attribution in the fix
> manifest. 18 new tests. Extraction is heuristic (AST upgrade tracked); see
> [COMPONENT_MODEL.md](COMPONENT_MODEL.md). Remaining for V2: `submits` edges (button→call), AST
> parsing, non-AWS IaC, Vue/Angular.

The conceptual heart of the product. Build a typed inventory of the application's components so evaluators can reason per-component.

- [ ] Define a **Component graph schema**: node types `{ UIComponent, Input, Button, Form, ApiCall, ApiEndpoint, NetworkResource, AuthBoundary, DataStore }`, each with `location`, `attributes`, and `edges` (e.g., button → onClick handler → apiCall → endpoint).
- [ ] **Frontend extraction** (start with React/Vue/Angular via AST — `@ast-grep` is already a dep, or `ts-morph`): discover buttons, inputs, forms, `fetch`/`axios` calls; capture attributes (validation present? disabled/loading states? error handler? debounce?).
- [ ] **API/network extraction**: parse route definitions (Express/Fastify/Next API routes, OpenAPI specs if present) and IaC network resources (security groups, ingress, firewall rules) from the Checkov/Terraform surface already in scope.
- [ ] **Linkage & reachability**: connect UI actions → API calls → endpoints → data stores; reuse the reachability engine concept to mark live vs. dead components.
- [ ] Persist the graph alongside the report and reference it from `componentRef` in the fix manifest.

**Risk note:** framework diversity makes full coverage open-ended. Scope V1 to one frontend framework + REST + Terraform networking, behind a capability flag, and expand iteratively. Be explicit in the report about what was and wasn't modeled (no silent coverage gaps).

### Phase 3 — Component Evaluators  *(≈4–6 ew · Risk: Medium)*

> **Status (2026-05-30): deterministic tier DONE.** `src/evaluators/component/` runs 11 rules over the
> Phase 2 graph (endpoint auth, ANY-method, network least-privilege, API-call timeout/error-handling,
> cross-stack auth mismatch, input validation, form/button handlers). Findings carry precise
> `category` (security/robustness/coherence/fail-safe) + `componentRef` and flow through
> dedup/score/**gate**/manifest — security gaps block, the rest advise. Graph build moved before the
> gate. 19 tests; verified end-to-end. See USER_MANUAL §9.

Per-component checks for fail-safe attributes, robustness, and coherence. Two tiers:

- [x] **Deterministic rule evaluators** (fast, cheap, high-precision) — shipped (see status above).
- [x] **LLM reasoning evaluator** (judgment calls) for robustness & coherence — shipped. Backend-agnostic provider (AI Studio key **or** Vertex on the GCP project; consumer "AI Pro" plan is not a valid backend). Batched, evidence-required, confidence-gated, severity-capped (advisory by default, never blocks the gate unless `allowBlocking`), opt-in via `--llm-eval`. Degrades gracefully on any backend/parse failure (verified against a live 403). `src/evaluators/component/llm.ts`, `src/llm/index.ts`.
- [x] Both tiers emit standard `Issue[]` with `componentRef` set → flow through existing dedup/score/gate/manifest unchanged. *(deterministic tier done)*
- [ ] Add a confidence/abstention path: LLM findings below a confidence threshold are reported as advisory, not gate-blocking, to control false positives.
- [ ] **Richer structural edges:** build `contains` (form→input) and `submits` (button/form→ApiCall) edges in `buildComponentModel` to unlock form-level coherence rules.

**Exit criteria:** for a sample app, DAT reports per-component fail-safe/robustness/coherence findings with evidence, and they appear in both the human report and the fix manifest. *(met for the deterministic tier; LLM tier is the next step.)*

### Phase 4 — Explainability & Stakeholder Reporting  *(DONE — 2026-05-30)*

> Reports are now self-explaining via one source of truth (`src/explain.ts`): a "How to read this
> report" glossary + dynamic breakdowns (how the score was computed, why the gate passed/failed,
> per-finding category + why-it-matters). Surfaced in a new shareable **HTML report**
> (`src/reporters/html.ts`, `--html`), the enriched **PDF** (shared template), the **console**
> (`--explain`), and a **fix-manifest `glossary`** block. `explainReadinessScore` + `explainGate`
> added. 18 new tests; verified end-to-end. (This took the original "Phase 4" slot per stakeholder
> priority; the ops-hardening items below move to Phase 4b/5.)

### Phase 4b — Enterprise Hardening  *(DONE — 2026-05-30)*

> Shipped: config **schema validation** (zod, fail-fast, `as any` casts removed); **secret-redaction**
> hardening (GitHub/AWS/GCP/PEM/URL-creds + env-value registry, message + metadata) in `src/utils/redact.ts`;
> **per-scanner observability** in the `PIPELINE_END` audit event; **resilience** (configurable
> concurrency + per-scanner wall-clock timeout, `runner` config); **webhook authz** (`src/agent/authz.ts`
> — trusted association + org/repo allow-lists + per-repo rate limit); and **CI supply-chain provenance**
> (pinned tool versions, DAT self-SBOM, build-provenance attestation). +38 tests (192→230).

- [x] **Config & secrets** — schema validation + redaction hardening shipped. (Centralised secret
  *manager* integration, e.g. Vault/GSM, remains a deployment-time option, not code.)
- [x] **AuthN/Z** — trusted-association gate + org/repo allow-lists + rate limiting shipped.
- [x] **Observability** — per-scanner duration/success/skip metrics in the structured audit event.
  *(A live `/metrics` or `/health` endpoint is a hosted-service add-on — deferred to Phase 5.)*
- [x] **Supply-chain provenance** — tool pins + DAT SBOM + attestation. *(cosign release signing → Phase 5.)*
- [x] **Resilience** — per-scanner wall-clock timeout + configurable concurrency. *(Cross-invocation
  circuit-breaking + Redis-backed distributed rate limiting → hosted multi-instance, Phase 5.)*

### Phase 5 — Scale, GA & deferred hardening  *(≈3–4 ew · Risk: Medium)*

- [ ] **Reachability AST/call-graph upgrade** (defect F): replace the current regex/import-heuristic
  reachability (`src/reachability/index.ts`, fail-open today) with true AST/call-graph analysis —
  per-language parsers (Babel/TS for JS/TS, Python `ast`, Roslyn for C#, tree-sitter as a common
  layer). Catches dynamic/aliased imports and re-exports the regex misses. **~3–4 weeks, high risk**
  (parser deps, latency, maintenance surface); regex fail-open is acceptable in the interim, so this
  is its own phase. Consider adopting official scanner reachability (e.g. Trivy/CodeQL) instead of
  building bespoke parsers.
- [ ] Live `/metrics` + `/health` endpoints; cosign/sigstore release signing; cross-invocation
  circuit-breaker + Redis-backed distributed rate limiting (hosted multi-instance).
- [ ] Monorepo scale tests; incremental/changed-files-only scanning for PR latency.
- [ ] Caching of scanner results keyed by content hash.
- [ ] Feedback loop: capture accept/reject on findings and fixes to tune rules and LLM prompts (the telemetry hooks are scaffolded in the plan but not real yet — make them real).
- [ ] Hosted dashboard + trend reporting; quality-gate policy-as-code.
- [ ] GA docs, SLAs, onboarding.
- [ ] GA docs, SLAs, onboarding.

#### End-user interface (selection & consumption)
**Status (2026-05-30): config-as-code layer DONE.** Scanner selection no longer requires editing 25
YAML toggles: **profiles** (`--profile quick|standard|security|full` / `profile:` in config) +
**auto-detect** (skip scanners whose input is absent) + a **readiness preflight** (`dat preflight`)
ship today. This deliberately keeps config-as-code simple enough that the future UI only needs to
write a one-line `profile:`.
- [ ] **Visual configuration UI (later, non-technical persona):** web dashboard / GitHub App settings
  page with category-grouped toggles + thresholds, generating the same `.dat.config.yaml` (`profile:`
  + overrides) underneath. Persona: managers / security leads / QA who configure without a terminal.
- [ ] **Friendlier consumption:** plain-English PR comment + HTML report (pass/fail, blockers,
  readiness score) so non-technical reviewers understand results without the CLI.

---

## 4. Sequencing & Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3
   │            │                       │
   └────────────┴──────► Phase 4 ◄──────┘
                              │
                              ▼
                          Phase 5 (GA)
```

- **Phase 0 is a hard prerequisite** — do not build new layers on a tool that silently bypasses its own gate.
- **Phase 1 can ship immediately after 0** and delivers visible value (the agent fix loop) before the expensive component work.
- **Phases 2 and 3 are the differentiator** and the bulk of cost/risk; scope them narrow-then-wide.
- **Phase 4 hardening** can run partly in parallel once the model is stable.

---

## 5. Top Risks

1. **Component-model scope creep** (framework diversity). *Mitigation:* one framework + REST + TF networking in V1; explicit coverage reporting; iterate.
2. **LLM false positives eroding trust** in the gate. *Mitigation:* deterministic-evidence-required, confidence thresholds, advisory-vs-blocking tiers, feedback loop.
3. **Docs-vs-reality drift recurring.** *Mitigation:* CI check that fails if a documented feature lacks a corresponding test; treat docs as code.
4. **Auto-fix mutating code unexpectedly.** *Mitigation:* Phase 0 makes it opt-in and git-safe; never auto-fix without a verification net.
5. **External-tool dependency fragility.** *Mitigation:* preflight probes, version pinning, partial-result reporting.

---

## Appendix A — Documentation Corrections (code as ground truth)

Per the "trust code, fix docs" decision, the following statements in the existing docs are **inaccurate against the current source** and should be corrected:

1. **`IMPLEMENTATION_PLAN.md` header** "All Phases 1-8 Completed & Verified | Production Ready" — overstated. The engine is an advanced POC; defects A–E above are open. Recommend status: *"Advanced POC — orchestration core complete; hardening in progress."*
2. **`RELEASE_NOTES_V2.1.md` — Gitleaks "enabled by default."** False: the scanner is unreachable (defect A). Either fix the wiring (Phase 0) before claiming it, or retract the claim.
3. **`FINDINGS.md` Gap 1 (DAST silent skip)** is listed as CRITICAL/unresolved in the matrix but the release notes imply ZAP is fully hardened. The silent-skip (defect D) is still live; keep it marked unresolved until Phase 0 closes it.
4. **`FINDINGS.md` "[RESOLVED]" items** should each carry a test reference; several resolutions (e.g., dedup, severity mapping) are real in code but untested, so "resolved" is not regression-protected. Downgrade to "implemented, untested" until Phase 0 tests land.
5. **`ARCHITECTURE.md`** describes the reachability engine as a "Call-Graph" capability; the code is regex-based (defect F). Correct the description to "regex/import-heuristic reachability (call-graph planned)."

These corrections are listed here rather than applied, per the "produce the roadmap first, don't start coding yet" decision. Say the word and I'll apply them as a single docs PR.
