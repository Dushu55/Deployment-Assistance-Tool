import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { mapSeverity } from '../utils.js';

export async function runDockle(imageName: string = 'project-image:latest'): Promise<ScannerResult> {
  const startTime = Date.now();
  try {
    // PRE-CHECK: Ensure the target image actually exists locally before scanning
    const inspectResult = await runCommand('docker', ['image', 'inspect', imageName], 30000);
    if (inspectResult.exitCode !== 0) {
      return {
        scannerName: 'Dockle',
        success: true, // Don't fail the pipeline, just report it wasn't built
        durationMs: Date.now() - startTime,
        issues: [{
          id: 'DOCKLE-NO-IMAGE',
          severity: 'INFO',
          message: `Image '${imageName}' not found locally. Skipping Dockle scan.`,
          source: 'Dockle'
        }]
      };
    }

    const result = await runCommand('dockle', ['-f', 'json', imageName], 300000);
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
            scannerName: 'Dockle',
            success: false,
            durationMs,
            issues: [],
            error: `Dockle exited with code ${result.exitCode}. Details: ${result.stderr.trim() || result.stdout.trim().substring(0, 100)}`
        };
    }

    const parsedOutput = JSON.parse(result.stdout || '{}');
    const issues: Issue[] = [];

    if (parsedOutput.details) {
        parsedOutput.details.forEach((d: any) => {
            issues.push({
                id: d.code,
                severity: mapSeverity(d.level),
                message: d.title,
                file: imageName,
                source: 'Dockle'
            });
        });
    }

    return {
      scannerName: 'Dockle',
      success: true,
      durationMs,
      issues
    };
  } catch (err) {
    return {
      scannerName: 'Dockle',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: (err as Error).message
    };
  }
}

export const dockleScanner: Scanner = {
  name: 'Dockle',
  module: 'container',
  supportedLanguages: 'all',
  async run(ctx) {
    const image = ctx.config.scanners.dockle?.imageName || 'project-image:latest';
    return runDockle(image);
  }
};
