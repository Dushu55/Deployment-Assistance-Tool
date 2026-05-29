import { runCommand } from '../runner.js';
import { ScannerResult, Issue, Scanner } from '../types.js';
import { EnvironmentDetector } from '../env.js';
import { SupportedLanguage } from '../types.js';
import fs from 'fs';
import path from 'path';

/**
 * Logic Tests scanner.
 *
 * Unlike the Jest *coverage* scanner (which only measures how much code is exercised),
 * this scanner verifies the *logical correctness* of the application by executing its
 * test suite and treating FAILING tests as gate-blocking findings. This is the
 * functional-correctness signal in the evaluation pipeline: does the application
 * actually behave as intended before it is allowed to deploy?
 *
 * Behaviour:
 *  - Failing tests  -> HIGH findings (one per failure where structured output is available),
 *                      so they block the quality gate and flow into the Claude fix-manifest.
 *  - Missing suite  -> a coverage-gap finding (HIGH by default, configurable) instead of a
 *                      silent pass, so "no tests" is never mistaken for "tests passed".
 *  - Passing suite  -> a single INFO finding recording the verified count.
 */

interface JestFailure {
  fullName: string;
  file?: string;
  line?: number;
  message?: string;
}

// Parse Jest's `--json` output into discrete failing-test records.
function parseJestJson(stdout: string): { failures: JestFailure[]; numTotal: number; numFailed: number } | null {
  // Jest may emit non-JSON warnings before the JSON blob; isolate the JSON object.
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed.numTotalTests !== 'number') return null;

  const failures: JestFailure[] = [];
  for (const suite of parsed.testResults || []) {
    const file = suite.testFilePath || suite.name;
    for (const assertion of suite.assertionResults || suite.testResults || []) {
      if (assertion.status === 'failed') {
        const title = [...(assertion.ancestorTitles || []), assertion.title || assertion.fullName]
          .filter(Boolean)
          .join(' › ');
        const rawMsg = (assertion.failureMessages || []).join('\n');
        failures.push({
          fullName: title || 'unnamed test',
          file: file ? path.relative(process.cwd(), file) : undefined,
          line: assertion.location?.line,
          // First meaningful line of the failure, stripped of ANSI colour codes.
          message: rawMsg ? rawMsg.replace(/\[[0-9;]*m/g, '').split('\n').find((l: string) => l.trim()) : undefined
        });
      }
    }
  }
  return { failures, numTotal: parsed.numTotalTests, numFailed: parsed.numFailedTests ?? failures.length };
}

function looksLikeJest(command: string, targetDir: string): boolean {
  if (/\bjest\b/.test(command)) return true;
  const markers = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'];
  if (markers.some(m => fs.existsSync(path.join(targetDir, m)))) return true;
  try {
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.jest) return true;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.jest) return true;
    }
  } catch {
    // ignore malformed package.json; fall back to generic execution
  }
  return false;
}

export async function runLogicTests(
  command: string | null,
  targetDir: string = '.',
  failOnMissingTests: boolean = true
): Promise<ScannerResult> {
  const startTime = Date.now();

  // No resolvable test command for the detected ecosystem -> coverage gap, not a pass.
  if (!command) {
    return {
      scannerName: 'Logic Tests',
      success: true,
      durationMs: Date.now() - startTime,
      issues: [{
        id: 'NO-LOGIC-TESTS',
        severity: failOnMissingTests ? 'HIGH' : 'INFO',
        message: 'No logical/functional test suite was detected for this ecosystem. ' +
          'Application correctness was NOT verified before deployment. Add a test command ' +
          '(e.g. `npm test`, `pytest`) or set scanners.logicTests.command in .dat.config.yaml.',
        source: 'Logic Tests'
      }]
    };
  }

  try {
    const useJest = looksLikeJest(command, targetDir);
    // For Jest we force structured JSON so we can surface each failing test individually.
    const [bin, ...baseArgs] = command.split(' ').filter(Boolean);
    const args = useJest && !/--json/.test(command)
      ? (bin === 'npm' ? ['test', '--', '--json', '--passWithNoTests'] : [...baseArgs, '--json', '--passWithNoTests'])
      : baseArgs;

    const result = await runCommand(bin, args, 300000, targetDir);
    const durationMs = Date.now() - startTime;

    if (useJest) {
      const parsedJest = parseJestJson(result.stdout) || parseJestJson(result.stderr);
      if (parsedJest) {
        if (parsedJest.numFailed === 0) {
          return {
            scannerName: 'Logic Tests',
            success: true,
            durationMs,
            issues: [{
              id: 'LOGIC-TESTS-PASSED',
              severity: 'INFO',
              message: `All ${parsedJest.numTotal} logical test(s) passed.`,
              source: 'Logic Tests'
            }]
          };
        }
        const issues: Issue[] = parsedJest.failures.map(f => ({
          id: 'TEST-FAILURE',
          severity: 'HIGH',
          message: `Failing test: ${f.fullName}${f.message ? ` — ${f.message.trim().substring(0, 200)}` : ''}`,
          file: f.file,
          line: f.line,
          remediation: 'Fix the application logic or the test so the assertion passes; a failing test indicates the deployed behaviour is incorrect or unverified.',
          source: 'Logic Tests'
        }));
        return { scannerName: 'Logic Tests', success: true, durationMs, issues };
      }
      // Structured parse failed (jest missing or unexpected output) -> fall through to exit-code logic.
    }

    // Generic / non-Jest frameworks: rely on the process exit code.
    if (result.exitCode === 0) {
      return {
        scannerName: 'Logic Tests',
        success: true,
        durationMs,
        issues: [{
          id: 'LOGIC-TESTS-PASSED',
          severity: 'INFO',
          message: `Logical test suite passed (command: \`${command}\`).`,
          source: 'Logic Tests'
        }]
      };
    }

    // Distinguish "tests failed" from "couldn't run the tests at all".
    const combined = `${result.stderr}\n${result.stdout}`;
    const notRunnable = /command not found|not recognized|cannot find module|no such file|ENOENT/i.test(combined) && !/\d+ (failing|failed)/i.test(combined);
    if (notRunnable) {
      return {
        scannerName: 'Logic Tests',
        success: false,
        durationMs,
        issues: [],
        error: `Could not execute logical test command \`${command}\`. Is the test framework installed? Details: ${combined.trim().substring(0, 200)}`
      };
    }

    return {
      scannerName: 'Logic Tests',
      success: true,
      durationMs,
      issues: [{
        id: 'LOGIC-TESTS-FAILED',
        severity: 'HIGH',
        message: `Logical test suite failed (command: \`${command}\`). ${combined.trim().substring(0, 300)}`,
        remediation: 'Inspect the failing tests; the application logic does not satisfy its own test contract and must not be deployed.',
        source: 'Logic Tests'
      }]
    };
  } catch (err) {
    return {
      scannerName: 'Logic Tests',
      success: false,
      durationMs: Date.now() - startTime,
      issues: [],
      error: (err as Error).message
    };
  }
}

export const logicTestsScanner: Scanner = {
  name: 'Logic Tests',
  module: 'testing',
  supportedLanguages: 'all',
  expectedInputs: [{ label: 'Test suite / command', category: 'testSuite', kind: 'testSuite' }],
  async run(ctx) {
    const cfg = ctx.config.scanners.logicTests;
    const targetDir = cfg?.targetDir || '.';
    const failOnMissing = cfg?.failOnMissingTests ?? true;
    // Prefer an explicit command; otherwise resolve the idiomatic test command for the ecosystem.
    const detector = new EnvironmentDetector(targetDir === '.' ? process.cwd() : path.resolve(process.cwd(), targetDir));
    const command = cfg?.command || detector.getVerifyCommand(ctx.detectedLanguages as SupportedLanguage[]);
    return runLogicTests(command, targetDir, failOnMissing);
  }
};
