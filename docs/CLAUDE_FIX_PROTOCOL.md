# DAT → Claude Code Fix Protocol

DAT emits a machine-consumable **Fix Manifest** (`results/dat-fix-manifest.json`) alongside its
human reports. This document is the contract a coding agent (Claude Code) follows to consume the
manifest, apply fixes, and verify them. It complements — not replaces — SARIF (which stays for the
GitHub Security tab); the manifest is the *actionable* artifact.

Generate it with:

```bash
node dist/index.js scan --fix-manifest results/dat-fix-manifest.json
```

## Manifest schema (v1.0)

```jsonc
{
  "schemaVersion": "1.0",
  "tool": "Deployment Assist Tool (DAT)",
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "gate": {
    "passed": false,                 // did the quality gate pass?
    "failOn": ["CRITICAL", "HIGH"],  // severities that block deploy
    "readinessScore": 42             // 0–100 health indicator (not the gate)
  },
  "summary": { "critical": 1, "high": 1, "medium": 1, "low": 0, "info": 1 },
  "coverageGaps": [                  // scanners that did NOT run — coverage is incomplete
    { "scanner": "Trivy", "reason": "Required tool(s) not found on PATH: trivy" }
  ],
  "findings": [
    {
      "findingId": "Semgrep:rules.eval::src/a.ts:4", // stable; safe to dedupe/track across runs
      "category": "security",        // security | defect | best-practice | robustness | coherence | fail-safe | coverage
      "severity": "CRITICAL",
      "gateBlocking": true,          // true => fixing this is required to pass the gate
      "source": "Semgrep",
      "title": "rules.eval",
      "rationale": "Avoid eval",     // why it matters
      "location": {
        "file": "src/a.ts",
        "startLine": 4,
        "endLine": 4,
        "excerpt": "1: ...\n4: eval(userInput)\n..." // ±3 lines of context
      },
      "suggestedFix": "remove eval", // may be null
      "verification": { "command": "npm test" }, // run after fixing to confirm
      "dependencies": [],            // findingIds to fix first (ordering hints)
      "confidence": "high",          // deterministic scanners are high; LLM evaluators will vary
      "status": "open"
    }
  ]
}
```

Notes:
- `findings` are **sorted gate-blocking-first, then by severity**, so fixing top-down clears the
  deploy blocker fastest.
- `INFO` issues are intentionally **excluded** — they are not actionable.
- `coverageGaps` are surfaced deliberately: a missing scanner is *not* a clean pass. Treat a gap in
  a security/test scanner as a reason to install the tool and re-run, not to ignore.

## Agent workflow

1. **Read** `results/dat-fix-manifest.json`. If `gate.passed` is already `true` and there are no
   `gateBlocking` findings, stop — nothing is required.
2. **Triage**: work the `findings` array in order. Prioritise `gateBlocking: true`. Respect
   `dependencies` (fix listed prerequisites first).
3. **For each finding**:
   - Open `location.file` at `location.startLine`; the `excerpt` shows the surrounding code.
   - Apply a fix guided by `rationale` + `suggestedFix`. Keep the change minimal and local.
   - Run `verification.command` (e.g. `npm test`). It must pass before moving on. If it fails,
     revert your edit and either try a different fix or leave the finding `open` with a note.
4. **Do not** weaken or delete tests to make `verification` pass — that defeats the logical-test
   provision. A failing `category: "defect"` finding means the application logic is wrong, not the test.
5. **Re-scan** to confirm: `node dist/index.js scan --fix-manifest <path>` and check that fixed
   `findingId`s are gone and `gate.passed` is `true`.

## Round-trip with the gate

The manifest's `findingId` is deterministic (`source:id::file[:line]`), so a re-scan after fixes
produces a manifest where resolved findings simply disappear. An agent can diff manifests across
runs to prove progress without re-reading every file.

## Relationship to DAT's own auto-fixer

DAT ships a deterministic AST auto-fixer (`--auto-fix`) for a narrow set of mechanical rewrites
(e.g. stripping `eval`). The Fix Manifest is the broader, agent-driven path for everything the AST
rules don't cover — logic defects, robustness/coherence gaps, and context-dependent security fixes.
Both are guarded by the same verification command.
