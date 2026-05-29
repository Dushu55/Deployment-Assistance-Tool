# Pipeline Setup Guide

Follow these steps to deploy the DAT orchestrator into your own repositories.

## 1. Local Configuration
Place a `.dat.config.yaml` file in the root of your repository:
```yaml
scanners:
  semgrep:
    enabled: true
    rules:
      - p/security-audit
    customRulesDir: "rules" # Points to internal org rules
  trivy:
    enabled: true
  osv:
    enabled: true
  checkov:
    enabled: true
  hadolint:
    enabled: true
  zap:
    enabled: true
  k6:
    enabled: true
    thresholdMs: 500
  promptfoo:
    enabled: true
  garak:
    enabled: true
failOn:
  - CRITICAL
  - HIGH
```

## 2. GitHub Actions Deployment
Copy the `.github/workflows/dat-pipeline.yml` file from this project into your target repository.

The pipeline automatically handles installing all Python, Node, and Go dependencies natively on the runner.

## 3. GitHub Security Tab Integration
Because our pipeline natively outputs `results/dat-report.sarif`, GitHub will automatically ingest the findings.
Navigate to your repository's **Security > Code scanning alerts** tab to see your unified findings natively in the UI.

## 4. DefectDojo (Optional)
To push data to your central dashboard, simply add the following GitHub Repository Secrets:
* `DEFECTDOJO_URL` (e.g., `https://defectdojo.your-org.com`)
* `DEFECTDOJO_API_KEY`

And update the CLI execution step in your workflow to include `--push-dojo`:
`run: node dist/index.js scan --sarif results/dat-report.sarif --push-dojo`
