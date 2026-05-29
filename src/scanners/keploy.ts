import { runCommand } from '../runner.js';
import { ScannerResult, Scanner } from '../types.js';
import fs from 'fs';

export async function runKeploy(appCmd: string = 'npm start'): Promise<ScannerResult> {
  const startTime = Date.now();

  // Basic check to see if keploy test directory exists, otherwise skip to save time in CI
  if (!fs.existsSync('./keploy')) {
    return {
      scannerName: 'Keploy API Tests',
      success: true,
      durationMs: Date.now() - startTime,
      issues: [{ id: 'NO-KEPLOY-TESTS', severity: 'INFO', message: 'No Keploy test suite found in ./keploy directory. Skipping.', source: 'Keploy' }]
    };
  }

  try {
    // Replay mode. In CI, keploy spins up the app, replays recorded YAML tests, and checks responses.
    const result = await runCommand('keploy', ['test', '-c', appCmd], 300000); 
    const durationMs = Date.now() - startTime;

    if (result.exitCode !== 0) {
       return {
          scannerName: 'Keploy API Tests', success: false, durationMs, issues: [{
              id: 'KEPLOY-TEST-FAILED',
              severity: 'HIGH',
              message: `Keploy API regression tests failed. Details: ${result.stderr.trim() || result.stdout.substring(0, 200)}`,
              source: 'Keploy'
          }],
       };
    }

    return { 
        scannerName: 'Keploy API Tests', 
        success: true, 
        durationMs, 
        issues: [{ id: 'KEPLOY-PASSED', severity: 'INFO', message: 'All Keploy API regression tests passed successfully.', source: 'Keploy' }] 
    };
  } catch (err) {
     return { scannerName: 'Keploy API Tests', success: false, durationMs: Date.now() - startTime, issues: [], error: (err as Error).message };
  }
}

export const keployScanner: Scanner = {
  name: 'Keploy API Tests',
  module: 'testing',
  supportedLanguages: 'all',
  requiredBinaries: ['keploy'],
  expectedInputs: [{ label: 'keploy test directory', category: 'apiTests', anyOf: ['keploy'] }],
  async run(ctx) {
    const appCmd = ctx.config.scanners.keploy?.appCmd || 'npm start';
    return runKeploy(appCmd);
  }
};
