import { Probot } from "probot";
import { logger } from "./logger.js";
import { runDatPipeline } from "./orchestrator.js";
import { GcpCloudRunDeployer } from "./deployers/gcp.js";
import { EphemeralDeployment } from "./deployers/index.js";

export default (app: Probot) => {
  app.log.info("Deployment Assist Tool (DAT) GitHub App loaded!");

  // Listen for Pull Request opened and synchronize (new commits pushed) events
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    const { repository, pull_request } = context.payload;
    const repoFullName = repository.full_name;
    const prNumber = pull_request.number;
    const branch = pull_request.head.ref;
    const sha = pull_request.head.sha;

    logger.info(`Webhook Received: PR event for ${repoFullName}#${prNumber}`);
    context.log.info(`Target branch: ${branch} (commit: ${sha})`);

    // SECURITY PATCH: Verify if PR author is an authorized contributor (Denial of Wallet / Abuse protection)
    const authorAssociation = pull_request.author_association;
    const trustedAssociations = ["OWNER", "MEMBER", "COLLABORATOR"];
    
    if (!trustedAssociations.includes(authorAssociation)) {
      logger.warn(`Untrusted PR author (${pull_request.user?.login}, association: ${authorAssociation}). Skipping DAT pipeline execution to prevent Abuse/DoS.`);
      
      try {
        await context.octokit.rest.checks.create({
          owner: repository.owner.login,
          repo: repository.name,
          name: "DAT Security & Quality Scan",
          head_sha: sha,
          status: "completed",
          conclusion: "skipped",
          output: {
            title: "Execution Skipped",
            summary: `DAT pipeline is restricted to trusted contributors (OWNER, MEMBER, COLLABORATOR). The author's association is ${authorAssociation}.`
          }
        });
      } catch (e: any) {
         logger.error(`Failed to create skipped check run: ${e.message}`);
      }
      return;
    }

    let checkRunId: number | undefined;
    let ephemeralDeployment: EphemeralDeployment | undefined;
    const deployer = new GcpCloudRunDeployer();

    try {
      const checkRun = await context.octokit.rest.checks.create({
        owner: repository.owner.login,
        repo: repository.name,
        name: "DAT Security & Quality Scan",
        head_sha: sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      });
      checkRunId = checkRun.data.id;
      logger.info(`Created Check Run ID ${checkRunId} for ${repoFullName}#${prNumber}`);

      // 1. Provision Ephemeral Environment
      let targetUrl: string | undefined;
      let authToken: string | undefined;
      try {
        ephemeralDeployment = await deployer.deployBranch(branch, sha);
        targetUrl = ephemeralDeployment.url;
        authToken = ephemeralDeployment.authToken;
        logger.info(`Ephemeral deployment ready for testing: ${targetUrl}`);
      } catch (err: any) {
        logger.warn(`Skipping ephemeral deployment: ${err.message}`);
        // If GCP env vars aren't set or it fails, we just don't pass a URL,
        // and DAST scanners like ZAP/k6 will gracefully skip or use a fallback config.
      }

      // 2. Execute DAT Pipeline
      const { report, failedGate } = await runDatPipeline({
        module: 'all',
        sarif: `results/dat-report-${prNumber}.sarif`,
        url: targetUrl, // Dynamically route DAST scanners to the new preview URL
        authToken: authToken, // Pass the IAM token so ZAP/k6 can penetrate the unauthenticated firewall
        auditContext: {
          actor: pull_request.user?.login || 'unknown',
          source: 'GITHUB_WEBHOOK',
          commitSha: sha,
          branch: branch,
          repo: repoFullName
        }
      });

      // 3. Update Check Run based on the results
      if (report) {
        await context.octokit.rest.checks.update({
          owner: repository.owner.login,
          repo: repository.name,
          check_run_id: checkRunId,
          status: "completed",
          conclusion: failedGate ? "failure" : "success",
          completed_at: new Date().toISOString(),
          output: {
            title: `DAT Scan ${failedGate ? "Failed" : "Passed"}`,
            summary: `Readiness Score: \nCritical: ${report.summary.critical} \nHigh: ${report.summary.high}\nMedium: ${report.summary.medium}\nLow: ${report.summary.low}`,
          }
        });
        logger.info(`Check Run ${checkRunId} updated successfully.`);
      }

    } catch (error: any) {
      logger.error(`Failed to process webhook or run DAT: ${error.message}`);
      
      if (checkRunId) {
        await context.octokit.rest.checks.update({
          owner: repository.owner.login,
          repo: repository.name,
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "action_required",
          output: {
            title: "DAT Engine Error",
            summary: error.message
          }
        });
      }
    } finally {
      // 4. Teardown Ephemeral Environment Post-Scan
      if (ephemeralDeployment?.id) {
        try {
          await deployer.teardown(ephemeralDeployment.id);
        } catch (teardownErr: any) {
          logger.error(`Failed to teardown deployment ${ephemeralDeployment.id}: ${teardownErr.message}`);
        }
      }
    }
  });

  // Future expansion: listen for issue_comment to trigger on demand (e.g., /dat-scan)
};
