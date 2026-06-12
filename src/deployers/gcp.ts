import { EphemeralDeployer, EphemeralDeployment } from './index.js';
import { logger } from '../logger.js';
import { emitInfraEvent } from '../audit.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

export interface GcpDeployerOverrides {
  projectId?: string;
  region?: string;
  cloudSqlInstance?: string;
  databaseUrl?: string;
  env?: Record<string, string>;
  cpu?: string;
  memory?: string;
  maxInstances?: number;
  // Opt-in: deploy the ephemeral preview WITHOUT IAM auth so a DAST scanner can reach it directly.
  // Default false (private + IAM identity token). Useful when no service account is available to
  // mint an identity token (e.g. a personal gcloud login). The preview is torn down after the scan.
  allowUnauthenticated?: boolean;
  execFn?: ExecFn; // injectable for testing; defaults to child_process exec
}

// Env var names must be valid shell identifiers; values are written to a YAML file (never the
// shell), so they may contain any characters (URLs, secrets) without escaping concerns.
function assertEnvKey(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env var name for GCP deployment: "${key}"`);
  }
  return key;
}

// Allow only shell-safe characters in any value we interpolate into a gcloud command line.
// Prevents command injection via config/env-supplied values.
function safeArg(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:\/-]+$/.test(value)) {
    throw new Error(`Unsafe ${label} value for GCP deployment: "${value}"`);
  }
  return value;
}

export class GcpCloudRunDeployer implements EphemeralDeployer {
  private region: string;
  private projectId: string;
  private execFn: ExecFn;

  /**
   * Name of the Cloud Run service once it has actually been created on GCP — set the moment the
   * deploy succeeds, before the (failure-prone) post-deploy steps. The orchestrator reads this in its
   * `finally` so a service is torn down even when `deployBranch` later throws and never returns a
   * deployment handle. Cleared after a successful teardown.
   */
  public activeServiceName?: string;

  // Cost controls — defaults tuned for near-zero cost on short-lived scan runs.
  private cpu: string;
  private memory: string;
  private maxInstances: number;

  // Cloud SQL configurations (OFF unless explicitly configured — Cloud SQL is the costly part).
  private sqlInstance?: string;
  private dbUser?: string;
  private dbPass?: string;
  private dbName?: string;

  // Runtime env injected into the preview (DATABASE_URL + any extras the app needs to boot).
  private databaseUrl?: string;
  private extraEnv: Record<string, string>;

  // When true, deploy the preview public (no IAM) and skip identity-token generation.
  private allowUnauthenticated: boolean;

  constructor(overrides?: GcpDeployerOverrides) {
    this.region = overrides?.region || process.env.GCP_REGION || 'us-central1';
    this.projectId = overrides?.projectId || process.env.GCP_PROJECT_ID || '';
    this.execFn = overrides?.execFn || execAsync;

    this.cpu = overrides?.cpu || '1';
    this.memory = overrides?.memory || '512Mi';
    this.maxInstances = overrides?.maxInstances ?? 1;

    this.sqlInstance = overrides?.cloudSqlInstance || process.env.GCP_CLOUD_SQL_INSTANCE;
    this.dbUser = process.env.DB_USER || 'postgres';
    this.dbPass = process.env.DB_PASS || 'password';
    this.dbName = process.env.DB_NAME || 'dat_testing_db';

    this.databaseUrl = overrides?.databaseUrl || process.env.DATABASE_URL;
    this.extraEnv = overrides?.env || {};
    this.allowUnauthenticated = overrides?.allowUnauthenticated === true
      || process.env.GCP_ALLOW_UNAUTHENTICATED === 'true';
  }

  /** Collect all runtime env to inject into the preview (DATABASE_URL + Cloud SQL DB_* + extras). */
  private buildEnvMap(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.sqlInstance) {
      env.DB_USER = this.dbUser!; env.DB_PASS = this.dbPass!;
      env.DB_NAME = this.dbName!; env.DB_HOST = `/cloudsql/${this.sqlInstance}`;
    }
    if (this.databaseUrl) env.DATABASE_URL = this.databaseUrl;
    for (const [k, v] of Object.entries(this.extraEnv)) env[assertEnvKey(k)] = v;
    return env;
  }

  async deployBranch(branch: string, commitSha?: string): Promise<EphemeralDeployment> {
    const shortHash = crypto.randomBytes(4).toString('hex');
    // Cloud Run service names must use only lowercase letters, numbers, and hyphens.
    const serviceName = `dat-ephemeral-${shortHash}`;

    const region = safeArg(this.region, 'region');
    const cpu = safeArg(this.cpu, 'cpu');
    const memory = safeArg(this.memory, 'memory');
    const projectId = this.projectId ? safeArg(this.projectId, 'projectId') : '';

    logger.info(`Triggering GCP Cloud Run ephemeral deployment for branch: ${branch} (Service: ${serviceName})`);

    // Runtime env (DATABASE_URL, Cloud SQL DB_*, extras) is written to a temp YAML file and passed
    // via --env-vars-file — values never touch the shell, so URLs/secrets need no escaping.
    let envFile: string | undefined;
    try {
      // Build the command.
      //  - --no-allow-unauthenticated: enforce IAM security (no public endpoint).
      //  - Cost controls: scale to zero between requests, cap instances, minimal CPU/memory.
      const authFlag = this.allowUnauthenticated ? '--allow-unauthenticated' : '--no-allow-unauthenticated';
      let cmd =
        `gcloud run deploy ${serviceName} --source . --region ${region} ` +
        `${authFlag} --format=json --quiet ` +
        `--min-instances=0 --max-instances=${Number(this.maxInstances)} ` +
        `--cpu=${cpu} --memory=${memory}`;

      if (projectId) {
        cmd += ` --project ${projectId}`;
      }

      // Link Cloud SQL only if explicitly configured (Cloud SQL adds cost).
      if (this.sqlInstance) {
        const sqlInstance = safeArg(this.sqlInstance, 'cloudSqlInstance');
        logger.info(`Linking Cloud SQL instance: ${sqlInstance}`);
        cmd += ` --add-cloudsql-instances=${sqlInstance}`;
      }

      // Inject runtime env via a temp YAML file (handles DATABASE_URL's @ / ? / & safely).
      const envMap = this.buildEnvMap();
      const envKeys = Object.keys(envMap);
      if (envKeys.length > 0) {
        envFile = path.join(os.tmpdir(), `dat-env-${crypto.randomBytes(6).toString('hex')}.yaml`);
        const yaml = envKeys.map(k => `${k}: ${JSON.stringify(envMap[k])}`).join('\n') + '\n';
        fs.writeFileSync(envFile, yaml, { mode: 0o600 });
        logger.info(`Injecting ${envKeys.length} env var(s) into the preview (build + runtime): ${envKeys.join(', ')}`);
        // Runtime (--env-vars-file) plus build (--build-env-vars-file). NOTE: build-env-vars reach
        // BUILDPACK builds, NOT Docker `RUN` steps — so a Dockerfile app that queries the DB during
        // `next build` must instead avoid build-time DB access (e.g. mark routes force-dynamic).
        cmd += ` --env-vars-file='${envFile}' --build-env-vars-file='${envFile}'`; // single-quoted: path is internal
      }

      logger.info(`Building and deploying to GCP Cloud Run (scale-to-zero, ${cpu} CPU / ${memory}, max ${this.maxInstances} instance(s))... (This may take 1-3 minutes)`);
      const { stdout } = await this.execFn(cmd);

      // The service now exists on GCP. Record it BEFORE the failure-prone post-deploy steps so the
      // orchestrator's finally can always tear it down even if those steps throw.
      this.activeServiceName = serviceName;
      emitInfraEvent('DEPLOY_CREATE', 'OK', { service: serviceName, region: this.region });

      try {
        const parsed = JSON.parse(stdout);
        const url = parsed.status?.url;

        if (!url) {
          throw new Error('Deployment succeeded but no URL was returned in the JSON payload.');
        }

        emitInfraEvent('DEPLOY_READY', 'OK', { service: serviceName, url, public: this.allowUnauthenticated });

        let authToken = '';
        if (this.allowUnauthenticated) {
          // Public ephemeral preview — no IAM token needed; the scanner reaches the URL directly.
          logger.info(`GCP Cloud Run ephemeral deployment is READY at ${url} (public, no IAM — torn down after the scan).`);
        } else {
          logger.info(`GCP Cloud Run ephemeral deployment is READY at ${url}. Generating IAM Identity Token...`);
          // Generate the OIDC Identity token for hitting the authenticated endpoint.
          const tokenCmd = `gcloud auth print-identity-token --audiences="${url}"`;
          try {
            const tokenResult = await this.execFn(tokenCmd);
            authToken = tokenResult.stdout.trim();
            logger.info(`Successfully generated IAM Identity Token for secure access.`);
          } catch (tokenErr: any) {
            logger.error(`Failed to generate identity token: ${tokenErr.message}`);
            throw new Error(
              'Could not generate an IAM identity token for the private endpoint — this requires a ' +
              'service account. For a personal gcloud login, pass --allow-unauthenticated (deploys the ' +
              'ephemeral preview public, then tears it down).',
            );
          }
        }

        return { id: serviceName, url, authToken };
      } catch (postErr: any) {
        // The service was created but is unusable (no URL / no token). Tear it down NOW so we never
        // leak it, then surface the failure to the caller.
        logger.error(`Post-deploy step failed for ${serviceName}; tearing it down before failing: ${postErr.message}`);
        await this.teardown(serviceName);
        throw postErr;
      }

    } catch (error: any) {
      logger.error(`Failed to trigger GCP deployment: ${error.message}`);
      throw error;
    } finally {
      // The env file held the build-time DATABASE_URL/secrets — remove it once the deploy submits.
      if (envFile) {
        try { fs.unlinkSync(envFile); } catch { /* best effort */ }
      }
    }
  }

  /**
   * Tear down the Cloud Run service AND its source image. The two are independent best-effort steps
   * (a failure deleting one never skips the other), idempotent (an already-gone resource is logged as
   * SKIP, not an error), and never throw — teardown must run to completion on every exit path.
   */
  async teardown(deploymentId: string): Promise<void> {
    logger.info(`Tearing down GCP Cloud Run deployment: ${deploymentId}`);

    const region = safeArg(this.region, 'region');
    const id = safeArg(deploymentId, 'deploymentId');
    const projectId = this.projectId ? safeArg(this.projectId, 'projectId') : '';
    const notFound = (msg: string) => /not found|does not exist|NOT_FOUND|could not be found/i.test(msg);

    // 1. Delete the Cloud Run service (stops all compute costs).
    try {
      let cmd = `gcloud run services delete ${id} --region ${region} --quiet`;
      if (projectId) cmd += ` --project ${projectId}`;
      await this.execFn(cmd);
      emitInfraEvent('DEPLOY_TEARDOWN', 'OK', { service: id });
      logger.info(`Successfully deleted GCP Cloud Run service: ${id}`);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      if (notFound(msg)) {
        emitInfraEvent('DEPLOY_TEARDOWN', 'SKIP', { service: id, reason: 'already gone' });
        logger.info(`Cloud Run service ${id} already absent — nothing to delete.`);
      } else {
        emitInfraEvent('DEPLOY_TEARDOWN', 'FAIL', { service: id, error: msg });
        logger.error(`Failed to delete Cloud Run service ${id}: ${msg}`);
      }
    }

    // 2. Delete the source image (independent of step 1) to avoid Artifact Registry storage costs.
    // `gcloud run deploy --source .` pushes to the `cloud-run-source-deploy` repository.
    if (!projectId) {
      logger.warn(`Skipping image cleanup for ${id}: no GCP project resolved (set GCP_PROJECT_ID or gcloud project).`);
    } else {
      const imageRepo = `${region}-docker.pkg.dev/${projectId}/cloud-run-source-deploy/${id}`;
      try {
        await this.execFn(`gcloud artifacts docker images delete ${imageRepo} --delete-tags --quiet --project ${projectId}`);
        emitInfraEvent('IMAGE_TEARDOWN', 'OK', { image: imageRepo });
        logger.info(`Successfully deleted ephemeral container image: ${imageRepo}`);
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        if (notFound(msg)) {
          emitInfraEvent('IMAGE_TEARDOWN', 'SKIP', { image: imageRepo, reason: 'already gone' });
          logger.info(`Artifact Registry image ${imageRepo} already absent.`);
        } else {
          emitInfraEvent('IMAGE_TEARDOWN', 'FAIL', { image: imageRepo, error: msg });
          logger.error(`Failed to delete image ${imageRepo}: ${msg}`);
        }
      }
    }

    // Mark this deployer's tracked service as cleaned so the orchestrator's finally won't re-tear it.
    if (this.activeServiceName === deploymentId) this.activeServiceName = undefined;
  }
}
