import { spawn } from 'child_process';

// Cache probe results for the lifetime of the process so we don't re-shell for every scanner.
const cache = new Map<string, boolean>();

/**
 * Returns true if `binary` is resolvable on the current PATH.
 * Uses `command -v` via the shell, which is portable across macOS/Linux CI images.
 * Windows runners fall back to `where`.
 */
export function isBinaryAvailable(binary: string): Promise<boolean> {
  if (cache.has(binary)) return Promise.resolve(cache.get(binary)!);

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const probe = isWindows
      ? spawn('where', [binary], { stdio: 'ignore' })
      : spawn('sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' });

    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      cache.set(binary, available);
      resolve(available);
    };

    probe.on('close', (code) => finish(code === 0));
    probe.on('error', () => finish(false));
    // Defensive timeout: never let a hung probe stall the pipeline.
    setTimeout(() => { try { probe.kill(); } catch { /* noop */ } finish(false); }, 5000);
  });
}

/**
 * Given the binaries a scanner requires, returns the subset that are missing.
 * Empty array => all present.
 */
export async function missingBinaries(required: string[] = []): Promise<string[]> {
  const checks = await Promise.all(required.map(async (b) => ({ b, ok: await isBinaryAvailable(b) })));
  return checks.filter(c => !c.ok).map(c => c.b);
}

// Test/`--dry-run` seam: allow callers to pre-seed or reset the cache deterministically.
export function __setProbeCache(binary: string, available: boolean): void {
  cache.set(binary, available);
}
export function __clearProbeCache(): void {
  cache.clear();
}
