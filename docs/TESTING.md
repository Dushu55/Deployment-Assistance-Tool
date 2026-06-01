# Testing the Deployment Assist Tool (DAT)

This guide gets you from a fresh clone to running DAT against a real application and validating its
outputs. There are three layers: **unit tests** (DAT's own correctness), **smoke/e2e** (the CLI +
pipeline), and **scanning a target app** (using DAT as intended).

## 0. Prerequisites

| Need | For |
|---|---|
| **Node.js ≥ 20** (`npm`) | everything (the CLI, tests) |
| Docker | OWASP ZAP, Dockle (container scanners) |
| Python 3 | Semgrep, Checkov, Bandit, pip-audit, Garak |
| `gcloud` CLI | `--deploy` ephemeral GCP environments |
| A Gemini API key **or** Vertex/GCP | the `--llm-eval` reasoning tier (optional) |

DAT degrades gracefully: **any scanner whose tool isn't installed is reported SKIPPED, not failed.**
The built-in engine (component evaluators, logic tests, all reporters) needs **no external tools**, so
you can validate the whole pipeline with just Node.

## 1. Install & build

```bash
npm ci          # or: npm install
npm run build   # compiles to dist/ and copies report templates
```

## 2. Unit tests (DAT's own correctness)

```bash
npm test            # ~230 tests, all pure (no network/tools needed)
npm run typecheck   # strict TS, no emit
```

## 3. Smoke & end-to-end

```bash
npm run test:smoke  # CLI boots: --help / --version
npm run test:e2e    # full pipeline → validates all 6 artifacts in results/
```

`test:e2e` runs a scan with every exporter and asserts each artifact exists and is well-formed:
`results/e2e-report.{sarif,csv,pdf,html}`, `results/e2e-fix-manifest.json`,
`results/e2e-component-model.json`. (It scans the repo's deliberately-vulnerable `testing_data/`
fixtures, so the quality gate is *expected* to fail — the test is about artifact generation.)

## 4. Run DAT against your own application

From your app's repo root (or point `--config` / paths at it):

```bash
# 1. (Recommended) Check readiness first — what's configured vs. missing, POC→enterprise.
node /path/to/dat/dist/index.js preflight

# 2. Scan, emitting the stakeholder HTML report + the Claude-Code fix manifest.
node /path/to/dat/dist/index.js scan \
  --html results/report.html \
  --fix-manifest results/fix-manifest.json \
  --component-model results/component-model.json \
  --explain
```

Pick scanner breadth with a **profile** (no need to hand-toggle): `--profile quick|standard|security|full`.

**Exit code:** `0` = quality gate passed, `1` = failed (findings at `failOn` severities). Wire that into CI.

### What to expect
- **Console**: per-scanner results + severity legend (full glossary with `--explain`).
- **`report.html`**: shareable, self-explaining (gate banner, score breakdown, per-finding "why it
  matters", coverage gaps). Open it in a browser — see [USER_MANUAL.md](USER_MANUAL.md) §13.
- **`fix-manifest.json`**: machine-consumable findings for Claude Code — see
  [CLAUDE_FIX_PROTOCOL.md](CLAUDE_FIX_PROTOCOL.md).
- **`component-model.json`**: the buttons/inputs/API-calls/endpoints/network graph — see
  [COMPONENT_MODEL.md](COMPONENT_MODEL.md).

### Enabling more scanners
Install the relevant tool, then re-run — `preflight` shows which tools are missing and which scanners
they unlock. To exercise everything on one machine: Docker + Python 3 + Semgrep/Trivy/Gitleaks/Checkov.

## 5. Optional: LLM reasoning tier

```bash
# Backend A — AI Studio key:
echo 'GEMINI_API_KEY=AIza...' >> .env
# Backend B — Vertex on your GCP project:
gcloud auth application-default login && echo 'GOOGLE_GENAI_USE_VERTEXAI=true' >> .env

node dist/index.js scan --llm-eval --component-model results/cm.json
# → "🧠 Component Evaluator (LLM): N advisory finding(s)". Without a backend it skips cleanly.
```

## 6. Optional: ephemeral GCP deployment for DAST

```bash
gcloud auth login
node dist/index.js scan --deploy   # provisions Cloud Run preview → scans live URL → tears down
```
Cost-controlled (scale-to-zero, capped instance, no Cloud SQL); teardown is guaranteed. See
[USER_MANUAL.md](USER_MANUAL.md) §6.

## 7. CI

Pushes to `main` run `.github/workflows/dat-pipeline.yml`: the gate is DAT's own
**typecheck + unit tests + build**; the self-scan and SBOM/provenance steps are best-effort. `main`
is branch-protected (PR + this check required).

## Troubleshooting
- **`Invalid .dat.config.yaml`** — config validation is fail-fast; the error lists each bad field. Fix and re-run.
- **Many scanners SKIPPED** — their tools aren't installed; that's expected. Install tools or narrow with `--only`.
- **LLM 403 / invalid key** — use a real `AIza…` AI Studio key or configure Vertex; the tier is advisory and never blocks.
- **PDF step slow/fails** — it launches headless Chromium (puppeteer); HTML is the dependency-free alternative.
