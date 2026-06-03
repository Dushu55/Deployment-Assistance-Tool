import crypto from 'crypto';
import { logger } from '../../logger.js';
import { DatabaseEngine } from '../../types.js';
import { ExecFn } from '../gcp.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import { DbProvisioner, ProvisionedDb } from './provisioner.js';

const execAsync = promisify(exec);

// gcloud identifiers we generate are hex/known-safe; only the project/region/tier come from config.
function safe(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:\/-]+$/.test(value)) throw new Error(`Unsafe ${label} for Cloud SQL: "${value}"`);
  return value;
}

const VERSIONS: Partial<Record<DatabaseEngine, string>> = { postgres: 'POSTGRES_15', mysql: 'MYSQL_8_0' };

/**
 * Opt-in, EXPERIMENTAL provisioner: creates a transient Cloud SQL instance + database per scan and
 * deletes it on teardown. Cloud SQL has no scale-to-zero and ~3–7 min create times, so this costs
 * real money and a missed teardown leaks ~$8–50/mo — prefer Neon. The app connects over the Cloud
 * SQL unix socket, so `cloudSqlInstance` is returned for the deployer to link via
 * --add-cloudsql-instances.
 */
export class CloudSqlProvisioner implements DbProvisioner {
  readonly name = 'cloudsql';
  private tier: string;
  private region: string;
  private projectId: string;
  private execFn: ExecFn;

  constructor(opts?: { tier?: string; region?: string; projectId?: string; execFn?: ExecFn }) {
    this.tier = opts?.tier || 'db-f1-micro';
    this.region = opts?.region || process.env.GCP_REGION || 'us-central1';
    this.projectId = opts?.projectId || process.env.GCP_PROJECT_ID || '';
    this.execFn = opts?.execFn || execAsync;
  }

  async provision(engine: DatabaseEngine): Promise<ProvisionedDb> {
    const version = VERSIONS[engine];
    if (!version) throw new Error(`Cloud SQL provisioning supports postgres/mysql, not "${engine}".`);
    const tier = safe(this.tier, 'tier');
    const region = safe(this.region, 'region');
    const proj = this.projectId ? ` --project ${safe(this.projectId, 'projectId')}` : '';
    const instance = `dat-sql-${crypto.randomBytes(4).toString('hex')}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const dbName = 'datscan';

    logger.warn('⚠️  Cloud SQL provisioning is EXPERIMENTAL and bills real money (no scale-to-zero); prefer Neon.');
    logger.info(`Creating ephemeral Cloud SQL instance ${instance} (${version}, ${tier}) — this can take several minutes…`);
    await this.execFn(`gcloud sql instances create ${instance} --database-version=${version} --tier=${tier} --region=${region} --no-backup --quiet${proj}`);
    await this.execFn(`gcloud sql users set-password postgres --instance=${instance} --password='${password}' --quiet${proj}`);
    await this.execFn(`gcloud sql databases create ${dbName} --instance=${instance} --quiet${proj}`);
    const { stdout } = await this.execFn(`gcloud sql instances describe ${instance} --format='value(connectionName)'${proj}`);
    const connectionName = stdout.trim();
    if (!connectionName) throw new Error('Cloud SQL instance created but no connectionName returned.');

    // App connects over the Cloud SQL unix socket (the deployer links --add-cloudsql-instances).
    const databaseUrl = `postgresql://postgres:${password}@localhost/${dbName}?host=/cloudsql/${connectionName}`;
    logger.info(`Cloud SQL instance ${instance} ready (${connectionName}).`);
    return { databaseUrl, handle: instance, provider: 'cloudsql', cloudSqlInstance: connectionName };
  }

  async teardown(handle: string): Promise<void> {
    const proj = this.projectId ? ` --project ${safe(this.projectId, 'projectId')}` : '';
    try {
      logger.info(`Deleting ephemeral Cloud SQL instance ${handle}…`);
      await this.execFn(`gcloud sql instances delete ${handle} --quiet${proj}`);
    } catch (e: any) {
      logger.error(`Failed to delete Cloud SQL instance ${handle} (may incur cost — delete manually): ${e.message}`);
    }
  }
}
