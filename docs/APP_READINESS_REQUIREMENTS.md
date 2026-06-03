# Is your app ready for DAT? — Readiness Requirements

DAT scans whatever you point it at and **SKIPs any check whose input is missing** (a skip is always
reported — never a silent pass). The more of the below you provide, the deeper the scan goes. The
tiers here match the readiness ladder DAT prints: ⛔ NOT PRODUCTION-SAFE → 🟡 PRODUCTION-SAFE →
✅ ENTERPRISE-GRADE.

> Don't fill this out by hand — run `dat preflight` (read-only) from your app and it tells you
> exactly which items are present vs. missing, tiered, with a grade. This doc explains *what each
> item is and how DAT detects it*.

## ⛔ Mandatory (critical tier — fix to reach Production-Safe)

| Requirement | Why it matters | How DAT detects it | How to satisfy |
|---|---|---|---|
| **Dependency manifest** | Supply-chain CVE scanning (Trivy, OSV) | `package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.lock`, `Gemfile`, or `composer.json` at the root | Commit your manifest at the repo root |
| **Test suite** | Logic Tests run them; failing tests block the gate | A known test command exists for the detected language (`npm test`, `pytest`, `go test`, …) | Have runnable tests + the standard script |
| **DAST target** | Dynamic scans (ZAP, k6, Garak) need a live app | `--url <url>`, or `--deploy`, or `deployer.enabled: true` | Pass `--url`, or use `--deploy` |
| **`.dat.config.yaml`** | Pins the profile, severity gate, and scanner selection | File present at the root | `dat init` (roadmap), or copy the template config |
| **Dockerfile** | Container hardening (Hadolint) + the `--deploy` image build | `Dockerfile` at the workspace root | Add a Dockerfile (a Next.js + Prisma example lives in [TESTING.md](TESTING.md)) |

## 🟡 Highly advised (close these to reach Enterprise-Grade)

| Requirement | Why it matters | How DAT detects it |
|---|---|---|
| **IaC files** | Infra misconfiguration (Checkov) | `*.tf` files, or a `Dockerfile` |
| **Language lockfile** | Pinned-dependency CVEs (pip-audit, cargo-audit) | `requirements.txt`, `Cargo.lock`, … |
| **Built container image** | Image CIS benchmark (Dockle) | Can't be auto-verified — build the image locally to enable |

## 💡 Best practice (maturity)

| Requirement | Why it matters | How DAT detects it |
|---|---|---|
| **LLM eval config** | Prompt accuracy / red-teaming (Promptfoo, Garak) | `promptfooconfig.yaml` / `.yml` |
| **API test directory** | API regression coverage (Keploy) | a `keploy/` directory |

## Runtime info needed for a live `--deploy` DAST run

- **Database** — DAT auto-detects the engine from `prisma/schema.prisma`, `docker-compose.yml`,
  dependency drivers (`pg`, `mysql2`, `mongoose`, …), or a `DATABASE_URL` in `.env`, and prints it
  in the preflight. For a meaningful dynamic scan the deployed preview needs a **reachable DB**.
  Set `deployer.database.provider: neon` (+ a `NEON_API_KEY`) and DAT **auto-provisions** a throwaway
  Postgres, migrates it, injects it at build + runtime, and destroys it after the scan — no manual DB
  setup. Otherwise supply a `DATABASE_URL` in the app's `.env` yourself.
- **Secrets / env vars** — anything in `.env` the app needs at runtime (auth secrets, API keys).
- **Build & start** — a working `Dockerfile` (or a buildpack-supported app) and the port it listens on.

## Quick self-check

```bash
# From your app directory (or use --path / --repo to point DAT elsewhere):
dat preflight              # readiness checklist, tiered, with a grade (exit 0)
dat preflight --strict     # exit non-zero if any CRITICAL input is missing (use as a CI gate)
```

`dat scan` also runs this check automatically at startup (warn mode); add `--strict-preflight` to
abort the scan when a required input is missing, or `--skip-preflight` to bypass it.
