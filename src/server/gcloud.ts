import { execFileSync } from 'child_process';

/**
 * Best-effort probe of the local gcloud setup. The GCP deployer authenticates via gcloud's ambient
 * credentials (not env vars), and resolves the project from GCP_PROJECT_ID — but operators typically
 * set the project with `gcloud config set project`, not an env var. So the UI reads gcloud directly
 * to report deploy-readiness and to derive GCP_PROJECT_ID for the scan subprocess.
 *
 * Cached for the process lifetime; any failure (gcloud absent / not authed) yields nulls.
 */
export interface GcloudStatus { account: string | null; project: string | null }

let cached: GcloudStatus | undefined;

function probe(args: string[]): string | null {
  try {
    const out = execFileSync('gcloud', args, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

export function gcloudStatus(): GcloudStatus {
  if (cached) return cached;
  const account = probe(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
  const projectRaw = probe(['config', 'get-value', 'project']);
  // `gcloud config get-value` prints "(unset)" to stderr but can echo an empty/paren value too.
  const project = projectRaw && projectRaw !== '(unset)' ? projectRaw : null;
  cached = { account: account ? account.split(/\r?\n/)[0] : null, project };
  return cached;
}

/** Reset the cache (tests). */
export function __resetGcloudCache(): void {
  cached = undefined;
}

/** Seed the cache so tests are deterministic regardless of the host's gcloud. */
export function __setGcloudCache(status: GcloudStatus): void {
  cached = status;
}
