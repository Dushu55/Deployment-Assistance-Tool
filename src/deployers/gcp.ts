import { EphemeralDeployer, EphemeralDeployment } from './index.js';
import { logger } from '../logger.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import crypto from 'crypto';

const execAsync = promisify(exec);

export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

export interface GcpDeployerOverrides {
  projectId?: string;
  region?: string;
  cloudSqlInstance?: string;
  cpu?: string;
  memory?: string;
  maxInstances?: number;
  execFn?: ExecFn; // injectable for testing; defaults to child_process exec
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

  // Cost controls — defaults tuned for near-zero cost on short-lived scan runs.
  private cpu: string;
  private memory: string;
  private maxInstances: number;

  // Cloud SQL configurations (OFF unless explicitly configured — Cloud SQL is the costly part).
  private sqlInstance?: string;
  private dbUser?: string;
  private dbPass?: string;
  private dbName?: string;

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

    try {
      // Build the command.
      //  - --no-allow-unauthenticated: enforce IAM security (no public endpoint).
      //  - Cost controls: scale to zero between requests, cap instances, minimal CPU/memory.
      let cmd =
        `gcloud run deploy ${serviceName} --source . --region ${region} ` +
        `--no-allow-unauthenticated --format=json --quiet ` +
        `--min-instances=0 --max-instances=${Number(this.maxInstances)} ` +
        `--cpu=${cpu} --memory=${memory}`;

      if (projectId) {
        cmd += ` --project ${projectId}`;
      }

      // Inject Database Connectivity only if explicitly configured (Cloud SQL adds cost).
      if (this.sqlInstance) {
        const sqlInstance = safeArg(this.sqlInstance, 'cloudSqlInstance');
        logger.info(`Linking Cloud SQL instance: ${sqlInstance}`);
        cmd += ` --add-cloudsql-instances=${sqlInstance}`;
        cmd += ` --set-env-vars=DB_USER=${this.dbUser},DB_PASS=${this.dbPass},DB_NAME=${this.dbName},DB_HOST=/cloudsql/${sqlInstance}`;
      }

      logger.info(`Building and deploying to GCP Cloud Run (scale-to-zero, ${cpu} CPU / ${memory}, max ${this.maxInstances} instance(s))... (This may take 1-3 minutes)`);
      const { stdout } = await this.execFn(cmd);

      const parsed = JSON.parse(stdout);
      const url = parsed.status?.url;

      if (!url) {
        throw new Error('Deployment succeeded but no URL was returned in the JSON payload.');
      }

      logger.info(`GCP Cloud Run ephemeral deployment is READY at ${url}. Generating IAM Identity Token...`);

      // Generate the OIDC Identity token for hitting the authenticated endpoint.
      const tokenCmd = `gcloud auth print-identity-token --audiences="${url}"`;
      let authToken = '';
      try {
        const tokenResult = await this.execFn(tokenCmd);
        authToken = tokenResult.stdout.trim();
        logger.info(`Successfully generated IAM Identity Token for secure access.`);
      } catch (tokenErr: any) {
        logger.error(`Failed to generate identity token: ${tokenErr.message}`);
        throw new Error('Could not generate IAM token for the secure endpoint.');
      }

      return {
        id: serviceName,
        url: url,
        authToken: authToken
      };

    } catch (error: any) {
      logger.error(`Failed to trigger GCP deployment: ${error.message}`);
      throw error;
    }
  }

  async teardown(deploymentId: string): Promise<void> {
    logger.info(`Tearing down GCP Cloud Run deployment: ${deploymentId}`);

    const region = safeArg(this.region, 'region');
    const id = safeArg(deploymentId, 'deploymentId');
    const projectId = this.projectId ? safeArg(this.projectId, 'projectId') : '';

    try {
      // 1. Delete the Cloud Run service (stops all compute costs).
      let cmd = `gcloud run services delete ${id} --region ${region} --quiet`;
      if (projectId) {
        cmd += ` --project ${projectId}`;
      }

      await this.execFn(cmd);
      logger.info(`Successfully deleted GCP Cloud Run service: ${id}`);

      // 2. Delete the associated container image to prevent accumulated Artifact Registry storage costs.
      // `gcloud run deploy --source .` pushes to the `cloud-run-source-deploy` repository.
      const imageRepo = `${region}-docker.pkg.dev/${projectId}/cloud-run-source-deploy/${id}`;
      logger.info(`Cleaning up Artifact Registry image: ${imageRepo} to prevent storage costs...`);

      const deleteImageCmd = `gcloud artifacts docker images delete ${imageRepo} --delete-tags --quiet --project ${projectId}`;
      await this.execFn(deleteImageCmd);
      logger.info(`Successfully deleted ephemeral container image from Artifact Registry.`);

    } catch (error: any) {
      // Log but don't throw — teardown failures shouldn't crash the main orchestration loop.
      logger.error(`Failed during GCP teardown for ${deploymentId}: ${error.message}`);
    }
  }
}
