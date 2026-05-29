import { logger } from '../logger.js';

export interface PullRequestOptions {
  owner: string;
  repo: string;
  head: string; // The branch with the fixes
  base: string; // The branch to merge into (e.g., 'main')
  title: string;
  body: string;
}

export class GitHubAgent {
  private token: string;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || '';
  }

  /**
   * Opens a Pull Request using the GitHub REST API.
   */
  async createPullRequest(options: PullRequestOptions): Promise<string | null> {
    if (!this.token) {
      logger.error('GITHUB_TOKEN is not set. Cannot open Pull Request automatically.');
      return null;
    }

    const { owner, repo, head, base, title, body } = options;
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;

    logger.info(`Opening Pull Request to merge ${head} into ${base} for ${owner}/${repo}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          title,
          head,
          base,
          body
        })
      });

      if (!response.ok) {
        const errData = await response.text();
        throw new Error(`GitHub API returned ${response.status}: ${errData}`);
      }

      const data = await response.json() as any;
      logger.info(`✅ Successfully opened Pull Request: ${data.html_url}`);
      return data.html_url;

    } catch (error: any) {
      logger.error(`Failed to create Pull Request: ${error.message}`);
      return null;
    }
  }
}
