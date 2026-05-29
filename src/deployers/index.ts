export interface EphemeralDeployment {
  url: string;
  id: string;
  authToken?: string; // Identity token for accessing IAM-secured endpoints
}

export interface EphemeralDeployer {
  /**
   * Triggers a deployment for a specific branch and returns the URL once it's ready.
   */
  deployBranch(branch: string, commitSha?: string): Promise<EphemeralDeployment>;
  
  /**
   * Tears down/deletes the ephemeral deployment.
   */
  teardown(deploymentId: string): Promise<void>;
}
