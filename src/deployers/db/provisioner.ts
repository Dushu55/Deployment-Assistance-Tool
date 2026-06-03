import { DatabaseEngine, DatConfig } from '../../types.js';
import { ExecFn } from '../gcp.js';
import { NeonProvisioner } from './neon.js';
import { CloudSqlProvisioner } from './cloudsql.js';

export interface ProvisionedDb {
  databaseUrl: string;          // connection string to inject into the preview (build + runtime)
  handle: string;               // provider-specific id used by teardown()
  provider: string;
  cloudSqlInstance?: string;    // Cloud SQL connection name to link via --add-cloudsql-instances
}

export interface DbProvisioner {
  readonly name: string;
  provision(engine: DatabaseEngine): Promise<ProvisionedDb>;
  teardown(handle: string): Promise<void>;
}

type DatabaseConfig = NonNullable<NonNullable<DatConfig['deployer']>['database']>;

/**
 * Build the provisioner for a run, or `null` when auto-provisioning is off ('manual' — today's
 * behavior, where the URL comes from config/env or not at all). Default provider: neon when
 * NEON_API_KEY is present, else manual.
 */
export function createProvisioner(
  config: DatabaseConfig | undefined,
  deps?: { fetchFn?: typeof fetch; execFn?: ExecFn; projectId?: string }
): DbProvisioner | null {
  const provider = config?.provider ?? (process.env.NEON_API_KEY ? 'neon' : 'manual');
  if (provider === 'manual') return null;
  if (config?.autoProvision === false) return null;
  if (provider === 'neon') {
    return new NeonProvisioner({ regionId: config?.neon?.regionId, orgId: config?.neon?.orgId, fetchFn: deps?.fetchFn });
  }
  if (provider === 'cloudsql') {
    return new CloudSqlProvisioner({
      tier: config?.cloudsql?.tier,
      region: config?.cloudsql?.region,
      projectId: deps?.projectId,
      execFn: deps?.execFn
    });
  }
  return null;
}
