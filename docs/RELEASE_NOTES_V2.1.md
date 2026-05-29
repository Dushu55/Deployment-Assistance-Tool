# Release Notes: DAT V2.1 (The Hardened Correctness Update)

**Release Date:** May 2026  
**Version:** 2.1.0

The V2.1 release of the Deployment Assist Tool (DAT) represents a massive milestone in the security, stability, and correctness of the orchestration engine. Following a comprehensive codebase audit, over 15 critical vulnerabilities, false-negative vectors, and pipeline bypasses were addressed.

## 🚀 Key Highlights & New Features

* **Gitleaks Secrets Scanner Integration:** Hardcoded credentials are a leading cause of breaches. We have integrated `gitleaks` directly into the DAT pipeline, enabling zero-configuration secrets scanning. It is enabled by default.
* **Dependency-Track SBOM Publishing:** Trivy's CycloneDX SBOM output can now be automatically pushed to OWASP Dependency-Track using the new `--push-dtrack` CLI flag, enabling continuous supply chain vulnerability monitoring.
* **SonarQube Native Integration:** The SonarQube adapter has been completely rewritten. Instead of passively running the CLI, DAT now asynchronously polls the SonarQube Compute Engine API to fetch exact issues and actively evaluates them against the Deployment Quality Gate.
* **ZAP Active Scanning:** Upgraded OWASP ZAP from a passive baseline scan to `zap-full-scan.py`, actively probing ephemeral web applications for SQLi, CSRF, and JWT bypass vulnerabilities.
* **Global Finding Deduplication:** The orchestrator now intelligently deduplicates overlapping issues across different scanners (e.g., Trivy vs OSV) using file, line, and vulnerability ID fingerprinting.

## 🛡️ Critical Security Hardening

DAT itself is now significantly harder to exploit:
* **Shell Injection Mitigated:** Migrated the `AstGrepAutoFixer` from vulnerable `exec` calls to strict `execFile` executions.
* **LLM Prompt Injection Defense:** The Gemini-powered Dockerfile refactoring engine now includes rigorous post-generation Regex validation to block malicious injections like `RUN curl`, `nc`, or `EXPOSE 22`.
* **Webhook Denial of Wallet Protection:** Webhook events are now strictly authenticated via GitHub's `author_association`. Only `OWNER`, `MEMBER`, or `COLLABORATOR` users can trigger the expensive GCP ephemeral deployment and LLM pipelines.
* **SSRF Protection:** The Garak LLM DAST scanner now utilizes the `isSafeUrl()` boundary enforcer to prevent internal network and metadata extraction attacks.
* **Infrastructure Security:** `infra/gcp/deploy.sh` has been locked down from `--allow-unauthenticated` to `--no-allow-unauthenticated`.

## ⚠️ Action Required for Upgrading (Remaining Configurations)

To fully utilize the new V2.1 capabilities, administrators **must** complete the following configurations:

1. **Update Environment Variables (`.env`)**
   You must add the following variables to your `.env` or GCP Cloud Run Secrets to enable the new integrations:
   ```env
   # New: Dependency-Track Integration
   DEPENDENCY_TRACK_URL=https://dtrack.your-org.com
   DEPENDENCY_TRACK_API_KEY=your_dtrack_api_key
   DEPENDENCY_TRACK_PRODUCT=Your-DAT-Project
   
   # New: SonarQube API Polling
   SONAR_TOKEN=your_sonarqube_user_token
   ```

2. **Google Cloud SDK (`gcloud`) Requirement**
   To execute `infra/gcp/deploy.sh` or to utilize the GCP Cloud Run ephemeral environments locally, you **must** install and authenticate the `gcloud` CLI on your host machine:
   * Install: `brew install --cask google-cloud-sdk` (macOS) or visit [GCP Docs](https://cloud.google.com/sdk/docs/install)
   * Authenticate: `gcloud auth login`
   * Set Context: `gcloud config set project YOUR_PROJECT_ID`

3. **GitHub App Configuration**
   If you haven't deployed the GitHub App yet, ensure that you have registered a Native GitHub App on your organization account and generated the `APP_ID`, `WEBHOOK_SECRET`, and downloaded the `PRIVATE_KEY`. (See the User Manual for exact steps).

4. **Verify Command Requirement**
   The AST Auto-Fixer will now firmly **reject and revert** any code rewrites if your project does not have a native test framework (e.g., `npm test`, `pytest`) detected by the polyglot engine. Ensure your repositories have working unit tests before relying on autonomous remediation.
