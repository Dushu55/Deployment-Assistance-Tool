# Deployment Assist Tool (DAT)

An intermediate **CI/CD quality & security gate** that sits between your application and its
deployment. DAT evaluates the app for defects, security flaws, best-practice violations, and —
per-component — **fail-safe attributes, robustness, and coherence** (buttons, inputs, API calls,
endpoints, network config). It produces a **human-readable report** and a **machine-consumable fix
manifest** that a coding agent (Claude Code) can act on.

> Status: actively developed POC→enterprise tool. `main` is CI-gated and branch-protected.

## What it does

- **Polyglot scanner orchestration** — wraps ~25 best-of-breed tools (Semgrep, Trivy, OSV, Gitleaks,
  Checkov, Hadolint, Dockle, OWASP ZAP, k6, language SAST/SCA, Garak/Promptfoo for LLM apps) behind
  one normalized pipeline, auto-detecting your stack and skipping tools that aren't installed.
- **Logical test execution** — runs your app's own test suite; failing tests block the gate.
- **Component model + evaluators** — builds a graph of UI/API/network components and flags
  per-component issues (unauth state-changing endpoint, API call with no timeout/error handling,
  unvalidated input, world-open security group, cross-stack auth mismatch). Deterministic rules plus
  an optional LLM reasoning tier (Gemini).
- **Application readiness preflight** — a POC→enterprise assessment (`NOT PRODUCTION-SAFE` →
  `PRODUCTION-SAFE` → `ENTERPRISE-GRADE`) with plain-English, tiered guidance.
- **Self-explaining reports** — console, shareable **HTML**, PDF, SARIF, CSV — each explains what the
  score, severities, gate decision, and fixes mean.
- **Fix manifest for Claude Code** — versioned, lossless findings with code excerpts, categories,
  `componentRef`, and verification commands.
- **Ephemeral GCP deployment** (`--deploy`) for DAST against a live preview, with cost controls and
  guaranteed teardown.
- **Enterprise hardening** — zod config validation (fail-fast), secret-redacted logs, per-scanner
  observability, per-scanner timeouts, webhook authz + rate limiting, supply-chain provenance.

## Quick start

```bash
npm ci && npm run build

# Check readiness, then scan the current project with the friendly HTML report + fix manifest:
node dist/index.js preflight
node dist/index.js scan --profile standard --html results/report.html --fix-manifest results/fix-manifest.json --explain
```

Exit code `0` = quality gate passed, `1` = failed. Pick breadth with `--profile quick|standard|security|full`.

## Use `dat` from any project + host reports locally

Install the CLI globally once, then run it from any application's directory and browse every scan's
report at a local URL:

```bash
npm run build && npm link          # exposes a global `dat` command

dat serve                          # one terminal: hosts reports at http://localhost:4737 (loopback only)

cd /path/to/your/app && dat scan   # any other terminal: scans, then prints a link:
#   📰 Report published: http://localhost:4737/r/<app>-<timestamp>.html
```

Each scan auto-publishes its HTML report into a private library at `~/.dat/reports/` (owner-only
`0600`/`0700`, outside any git repo) and the server lists them at `http://localhost:4737`. Only the
**127.0.0.1** loopback is bound (not your LAN), only the self-contained HTML is served (never the
fix-manifest/SARIF), and the **100** most recent reports are kept (older ones are deleted). Use
`dat scan --no-publish` to keep a scan out of the library, `dat serve --port <n>` (or `DAT_PORT`) to
change the port, and `DAT_HOME` to relocate the library.

## Documentation

| Doc | What |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | Full CLI reference, profiles, preflight, reports, hardening |
| [docs/APP_READINESS_REQUIREMENTS.md](docs/APP_READINESS_REQUIREMENTS.md) | What your app needs to get a meaningful scan, by tier |
| [docs/TESTING.md](docs/TESTING.md) | How to install, test, and run DAT against your app |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [docs/COMPONENT_MODEL.md](docs/COMPONENT_MODEL.md) | The component graph + evaluators |
| [docs/CLAUDE_FIX_PROTOCOL.md](docs/CLAUDE_FIX_PROTOCOL.md) | How an agent consumes the fix manifest |
| [docs/ENTERPRISE_ROADMAP.md](docs/ENTERPRISE_ROADMAP.md) | Phased roadmap & status |

## Usage as a GitHub App

DAT can run as a native GitHub App that scans PRs and reports a Check Run; webhook execution is
restricted to trusted contributors with optional org/repo allow-lists and rate limiting. See the
User Manual.

## License

Internal / TBD.
