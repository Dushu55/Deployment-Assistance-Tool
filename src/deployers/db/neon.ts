import crypto from 'crypto';
import { logger } from '../../logger.js';
import { DatabaseEngine } from '../../types.js';
import { DbProvisioner, ProvisionedDb } from './provisioner.js';

type FetchFn = typeof fetch;

const NEON_API = 'https://console.neon.tech/api/v2';

/**
 * Provisions a disposable Neon Postgres project per scan (instant, free tier, auto-suspends).
 * `provision()` creates a project and returns its connection URI; `teardown()` deletes the
 * project. Auth via NEON_API_KEY (set once by the DAT operator). Neon is Postgres-only.
 */
export class NeonProvisioner implements DbProvisioner {
  readonly name = 'neon';
  private apiKey: string;
  private regionId: string;
  private orgId: string;
  private fetchFn: FetchFn;

  constructor(opts?: { apiKey?: string; regionId?: string; orgId?: string; fetchFn?: FetchFn }) {
    this.apiKey = opts?.apiKey || process.env.NEON_API_KEY || '';
    this.regionId = opts?.regionId || 'aws-us-east-1';
    // Org-scoped Neon accounts require org_id on project creation (Account/Org settings page).
    this.orgId = opts?.orgId || process.env.NEON_ORG_ID || '';
    this.fetchFn = opts?.fetchFn || fetch;
  }

  private async api(path: string, method: string, body?: unknown): Promise<any> {
    const res = await this.fetchFn(`${NEON_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Neon API ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? {} : res.json();
  }

  async provision(engine: DatabaseEngine): Promise<ProvisionedDb> {
    if (engine !== 'postgres') {
      throw new Error(`Neon provisions Postgres only (app needs "${engine}"). Use deployer.database.provider: cloudsql or manual.`);
    }
    if (!this.apiKey) {
      throw new Error('NEON_API_KEY is not set — cannot auto-provision a Neon database.');
    }
    logger.info('Provisioning ephemeral Neon Postgres project…');
    const name = `dat-ephemeral-${crypto.randomBytes(4).toString('hex')}`;
    const project: Record<string, unknown> = { name, region_id: this.regionId };
    if (this.orgId) project.org_id = this.orgId; // required for org-scoped accounts
    const out = await this.api('/projects', 'POST', { project });
    const projectId: string | undefined = out?.project?.id;
    const uri: string | undefined = out?.connection_uris?.[0]?.connection_uri;
    if (!projectId || !uri) {
      throw new Error('Neon project created but no connection URI was returned.');
    }
    logger.info(`Neon project ${projectId} ready (ephemeral).`);
    return { databaseUrl: uri, handle: projectId, provider: 'neon' };
  }

  async teardown(handle: string): Promise<void> {
    // Never throw from teardown — a failed cleanup must not crash the pipeline (but Neon
    // auto-suspends and is free, so a missed delete costs nothing).
    try {
      await this.api(`/projects/${handle}`, 'DELETE');
      logger.info(`Deleted ephemeral Neon project ${handle}.`);
    } catch (e: any) {
      logger.error(`Failed to delete Neon project ${handle}: ${e.message}`);
    }
  }
}
