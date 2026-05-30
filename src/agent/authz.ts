/**
 * Webhook authorization for the hosted GitHub App: trusted-contributor check + optional org/repo
 * allow-lists + a per-repo sliding-window rate limit. Pure and injectable (no Probot/clock deps) so
 * it's unit-testable. Decisions are config-driven via environment variables.
 */

export interface AuthzInput {
  authorAssociation: string;          // GitHub pull_request.author_association
  org: string;                        // repository.owner.login
  repo: string;                       // repository.full_name (owner/name)
  now?: number;                       // epoch ms (defaults to Date.now())
  env?: NodeJS.ProcessEnv;            // injectable for tests
}

export interface AuthzResult { allowed: boolean; reason: string }

const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

// Per-repo timestamps of allowed runs (in-memory; fits a single instance — Redis for multi-instance).
const repoHistory = new Map<string, number[]>();

function parseList(raw?: string): string[] {
  return (raw || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Decide whether a webhook-triggered scan is authorized. Records the run on allow (for rate limiting). */
export function authorizeWebhook(input: AuthzInput): AuthzResult {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now();

  // 1. Trusted contributor (Denial-of-Wallet protection).
  if (!TRUSTED.includes(input.authorAssociation)) {
    return { allowed: false, reason: `Untrusted author_association '${input.authorAssociation}'. Restricted to ${TRUSTED.join(', ')}.` };
  }

  // 2. Optional org / repo allow-lists (empty = allow all).
  const allowedOrgs = parseList(env.DAT_ALLOWED_ORGS);
  if (allowedOrgs.length > 0 && !allowedOrgs.includes(input.org.toLowerCase())) {
    return { allowed: false, reason: `Org '${input.org}' is not in DAT_ALLOWED_ORGS.` };
  }
  const allowedRepos = parseList(env.DAT_ALLOWED_REPOS);
  if (allowedRepos.length > 0 && !allowedRepos.includes(input.repo.toLowerCase())) {
    return { allowed: false, reason: `Repo '${input.repo}' is not in DAT_ALLOWED_REPOS.` };
  }

  // 3. Per-repo sliding-window rate limit.
  const limit = Number(env.DAT_RATE_LIMIT_PER_HOUR ?? 20);
  if (limit > 0) {
    const windowMs = 60 * 60 * 1000;
    const recent = (repoHistory.get(input.repo) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) {
      repoHistory.set(input.repo, recent);
      return { allowed: false, reason: `Rate limit reached for '${input.repo}' (${limit}/hour). Try again later.` };
    }
    recent.push(now);
    repoHistory.set(input.repo, recent);
  }

  return { allowed: true, reason: 'Authorized.' };
}

// Test seam.
export function __resetRateLimit(): void { repoHistory.clear(); }
