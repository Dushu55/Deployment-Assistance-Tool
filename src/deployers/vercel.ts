import { EphemeralDeployer, EphemeralDeployment } from './index.js';
import { logger } from '../logger.js';

export class VercelDeployer implements EphemeralDeployer {
  private apiToken: string;
  private projectId: string;
  private teamId?: string;

  constructor() {
    this.apiToken = process.env.VERCEL_API_TOKEN || '';
    this.projectId = process.env.VERCEL_PROJECT_ID || '';
    this.teamId = process.env.VERCEL_TEAM_ID;
  }

  private getBaseUrl(): string {
    let url = 'https://api.vercel.com';
    return url;
  }

  private appendTeamId(url: string): string {
    if (this.teamId) {
      return `${url}${url.includes('?') ? '&' : '?'}teamId=${this.teamId}`;
    }
    return url;
  }

  async deployBranch(branch: string, commitSha?: string): Promise<EphemeralDeployment> {
    if (!this.apiToken || !this.projectId) {
      throw new Error('VERCEL_API_TOKEN and VERCEL_PROJECT_ID must be set');
    }

    logger.info(`Triggering Vercel deployment for branch: ${branch}`);

    // Create the deployment
    const createUrl = this.appendTeamId(`${this.getBaseUrl()}/v13/deployments`);
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'dat-ephemeral-preview',
        project: this.projectId,
        gitSource: {
          type: 'github',
          ref: branch,
          // Normally we'd need repoId, but assuming project is already linked in Vercel.
          // Vercel can derive it from the linked project.
        }
      })
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`Failed to trigger Vercel deployment: ${createRes.status} ${errBody}`);
    }

    const deployment = await createRes.json() as any;
    const deploymentId = deployment.id;
    let deploymentUrl = deployment.url;
    
    // Ensure URL has protocol
    if (deploymentUrl && !deploymentUrl.startsWith('http')) {
        deploymentUrl = `https://${deploymentUrl}`;
    }

    logger.info(`Vercel deployment created: ${deploymentId}. Polling for readiness...`);

    // Poll until READY
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 60; // 60 * 5s = 5 minutes timeout
    
    while (!isReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
      
      const statusUrl = this.appendTeamId(`${this.getBaseUrl()}/v13/deployments/${deploymentId}`);
      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': `Bearer ${this.apiToken}` }
      });
      
      if (!statusRes.ok) continue;
      
      const statusData = await statusRes.json() as any;
      if (statusData.readyState === 'READY') {
        isReady = true;
        deploymentUrl = statusData.url;
        if (!deploymentUrl.startsWith('http')) {
          deploymentUrl = `https://${deploymentUrl}`;
        }
      } else if (statusData.readyState === 'ERROR' || statusData.readyState === 'CANCELED') {
        throw new Error(`Vercel deployment failed with state: ${statusData.readyState}`);
      }
    }

    if (!isReady) {
      throw new Error('Vercel deployment timed out waiting for READY state.');
    }

    logger.info(`Vercel deployment ${deploymentId} is READY at ${deploymentUrl}`);

    return {
      id: deploymentId,
      url: deploymentUrl
    };
  }

  async teardown(deploymentId: string): Promise<void> {
    logger.info(`Tearing down Vercel deployment: ${deploymentId}`);
    
    const deleteUrl = this.appendTeamId(`${this.getBaseUrl()}/v13/deployments/${deploymentId}`);
    const res = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Failed to delete Vercel deployment ${deploymentId}: ${res.status} ${errBody}`);
    } else {
      logger.info(`Successfully deleted Vercel deployment: ${deploymentId}`);
    }
  }
}
