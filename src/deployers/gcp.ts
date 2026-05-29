import { EphemeralDeployer, EphemeralDeployment } from './index.js';
import { logger } from '../logger.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import crypto from 'crypto';

const execAsync = promisify(exec);

export class GcpCloudRunDeployer implements EphemeralDeployer {
  private region: string;
  private projectId: string;
  
  // Cloud SQL configurations
  private sqlInstance?: string;
  private dbUser?: string;
  private dbPass?: string;
  private dbName?: string;

  constructor() {
    this.region = process.env.GCP_REGION || 'us-central1';
    this.projectId = process.env.GCP_PROJECT_ID || '';
    
    this.sqlInstance = process.env.GCP_CLOUD_SQL_INSTANCE;
    this.dbUser = process.env.DB_USER || 'postgres';
    this.dbPass = process.env.DB_PASS || 'password';
    this.dbName = process.env.DB_NAME || 'dat_testing_db';
  }

  async deployBranch(branch: string, commitSha?: string): Promise<EphemeralDeployment> {
    const shortHash = crypto.randomBytes(4).toString('hex');
    // Cloud Run service names must use only lowercase letters, numbers, and hyphens.
    const serviceName = `dat-ephemeral-${shortHash}`;

    logger.info(`Triggering GCP Cloud Run ephemeral deployment for branch: ${branch} (Service: ${serviceName})`);

    try {
      // 1. Build the command. Notice we removed --allow-unauthenticated to enforce IAM security.
      let cmd = `gcloud run deploy ${serviceName} --source . --region ${this.region} --no-allow-unauthenticated --format=json --quiet`;
      
      if (this.projectId) {
          cmd += ` --project ${this.projectId}`;
      }

      // 2. Inject Database Connectivity if configured
      if (this.sqlInstance) {
          logger.info(`Linking Cloud SQL instance: ${this.sqlInstance}`);
          cmd += ` --add-cloudsql-instances=${this.sqlInstance}`;
          // Set standard ENV vars for the application to pick up
          cmd += ` --set-env-vars=DB_USER=${this.dbUser},DB_PASS=${this.dbPass},DB_NAME=${this.dbName},DB_HOST=/cloudsql/${this.sqlInstance}`;
      }

      logger.info(`Building and deploying to GCP Cloud Run with IAM Authentication... (This may take 1-3 minutes)`);
      const { stdout } = await execAsync(cmd);
      
      const parsed = JSON.parse(stdout);
      const url = parsed.status?.url;

      if (!url) {
        throw new Error('Deployment succeeded but no URL was returned in the JSON payload.');
      }

      logger.info(`GCP Cloud Run ephemeral deployment is READY at ${url}. Generating IAM Identity Token...`);

      // 3. Generate the OIDC Identity token for hitting the authenticated endpoint
      const tokenCmd = `gcloud auth print-identity-token --audiences="${url}"`;
      let authToken = '';
      try {
        const tokenResult = await execAsync(tokenCmd);
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
    
    try {
      // 1. Delete the Cloud Run service (Stops all compute costs)
      let cmd = `gcloud run services delete ${deploymentId} --region ${this.region} --quiet`;
      if (this.projectId) {
          cmd += ` --project ${this.projectId}`;
      }

      await execAsync(cmd);
      logger.info(`Successfully deleted GCP Cloud Run service: ${deploymentId}`);

      // 2. Delete the associated container image to prevent accumulated Artifact Registry storage costs
      // By default, `gcloud run deploy --source .` pushes to `cloud-run-source-deploy` repository
      const imageRepo = `${this.region}-docker.pkg.dev/${this.projectId}/cloud-run-source-deploy/${deploymentId}`;
      logger.info(`Cleaning up Artifact Registry image: ${imageRepo} to prevent storage costs...`);
      
      const deleteImageCmd = `gcloud artifacts docker images delete ${imageRepo} --delete-tags --quiet --project ${this.projectId}`;
      await execAsync(deleteImageCmd);
      logger.info(`Successfully deleted ephemeral container image from Artifact Registry.`);

    } catch (error: any) {
      // We log but don't throw, as teardown failures shouldn't crash the main orchestration loop
      logger.error(`Failed during GCP teardown for ${deploymentId}: ${error.message}`);
    }
  }
}

