import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSonarConfigured, runSonarQube, sonarqubeScanner, deriveProjectKey, buildSonarArgs, classifySonarIssue, sonarRemediation } from './sonarqube.js';
import { DatConfig } from '../types.js';

test('SonarQube scanner', async (t) => {
  const saved = { tok: process.env.SONAR_TOKEN, host: process.env.SONAR_HOST_URL, key: process.env.SONAR_PROJECT_KEY };
  const clearEnv = () => { delete process.env.SONAR_TOKEN; delete process.env.SONAR_HOST_URL; delete process.env.SONAR_PROJECT_KEY; };

  await t.test('registers as a static scanner', () => {
    assert.strictEqual(sonarqubeScanner.name, 'SonarQube');
    assert.strictEqual(sonarqubeScanner.module, 'static');
  });

  await t.test('isSonarConfigured: false with no env and no properties file', () => {
    clearEnv();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-sonar-'));
    assert.strictEqual(isSonarConfigured(empty), false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  await t.test('isSonarConfigured: true via env, or via sonar-project.properties', () => {
    clearEnv();
    process.env.SONAR_TOKEN = 'tok';
    process.env.SONAR_HOST_URL = 'https://sonar.example.com';
    assert.strictEqual(isSonarConfigured('/nonexistent'), true);
    clearEnv();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-sonar-'));
    fs.writeFileSync(path.join(dir, 'sonar-project.properties'), 'sonar.projectKey=x\n');
    assert.strictEqual(isSonarConfigured(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('runSonarQube skips gracefully (not FAILED) when unconfigured', async () => {
    clearEnv();
    // cwd has no sonar-project.properties → unconfigured → skip without invoking sonar-scanner.
    const r = await runSonarQube();
    assert.strictEqual(r.success, true, 'must not fail the gate');
    assert.strictEqual(r.skipped, true);
    assert.ok(r.issues.every((i) => i.severity === 'INFO'));
  });

  // restore
  process.env.SONAR_TOKEN = saved.tok; process.env.SONAR_HOST_URL = saved.host; process.env.SONAR_PROJECT_KEY = saved.key;
  if (saved.tok === undefined) delete process.env.SONAR_TOKEN;
  if (saved.host === undefined) delete process.env.SONAR_HOST_URL;
  if (saved.key === undefined) delete process.env.SONAR_PROJECT_KEY;
});

// ---- unilateral-run helpers (no in-repo sonar config needed) ----
const SONAR_ENV = ['SONAR_TOKEN', 'SONAR_HOST_URL', 'SONAR_PROJECT_KEY', 'SONAR_ORGANIZATION'];
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of SONAR_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try { fn(); } finally {
    for (const k of SONAR_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const cfg = (sonarqube: any, exclude?: string[]): DatConfig =>
  ({ scanners: { sonarqube }, failOn: ['CRITICAL', 'HIGH'], ...(exclude ? { exclude } : {}) } as any);

test('classifySonarIssue', async (t) => {
  await t.test('a code smell (maintainability) is best-practice and clamped to MEDIUM — never gate-blocking', () => {
    // S2871-style: SonarQube MQR rates the reliability/maintainability impact HIGH, but it must not gate.
    const r = classifySonarIssue({ type: 'CODE_SMELL', impacts: [{ softwareQuality: 'MAINTAINABILITY', severity: 'HIGH' }] });
    assert.strictEqual(r.category, 'best-practice');
    assert.strictEqual(r.severity, 'MEDIUM');
  });

  await t.test('a reliability bug is a defect and clamped (not security, not gate-blocking)', () => {
    const r = classifySonarIssue({ type: 'BUG', impacts: [{ softwareQuality: 'RELIABILITY', severity: 'HIGH' }] });
    assert.strictEqual(r.category, 'defect');
    assert.strictEqual(r.severity, 'MEDIUM');
  });

  await t.test('a real vulnerability keeps its security category AND full severity', () => {
    const r = classifySonarIssue({ type: 'VULNERABILITY', impacts: [{ softwareQuality: 'SECURITY', severity: 'HIGH' }] });
    assert.strictEqual(r.category, 'security');
    assert.strictEqual(r.severity, 'HIGH');
  });

  await t.test('a SECURITY impact on a non-VULNERABILITY type still counts as security', () => {
    const r = classifySonarIssue({ type: 'CODE_SMELL', impacts: [{ softwareQuality: 'SECURITY', severity: 'BLOCKER' }] });
    assert.strictEqual(r.category, 'security');
    assert.strictEqual(r.severity, 'CRITICAL'); // BLOCKER → CRITICAL, kept because it is security
  });

  await t.test('falls back to legacy severity when no MQR impacts are present', () => {
    const r = classifySonarIssue({ type: 'CODE_SMELL', severity: 'INFO' });
    assert.strictEqual(r.category, 'best-practice');
    assert.strictEqual(r.severity, 'LOW'); // legacy INFO → LOW
  });
});

test('sonarRemediation', async (t) => {
  await t.test('returns a concrete hint for a known rule (any language prefix)', () => {
    assert.match(sonarRemediation('typescript:S2871')!, /compare function/i);
    assert.match(sonarRemediation('javascript:S2871')!, /compare function/i);
  });
  await t.test('returns a generic pointer for an unknown rule, undefined when no rule', () => {
    assert.match(sonarRemediation('typescript:S9999')!, /SonarSource rule typescript:S9999/);
    assert.strictEqual(sonarRemediation(undefined), undefined);
  });
});

test('deriveProjectKey', async (t) => {
  await t.test('explicit config override wins over env and slug', () => {
    withEnv({ SONAR_PROJECT_KEY: 'from-env' }, () => {
      assert.strictEqual(deriveProjectKey('/x/some-app', cfg({ enabled: true, projectKey: 'explicit-key' })), 'explicit-key');
    });
  });
  await t.test('SONAR_PROJECT_KEY wins over the folder slug', () => {
    withEnv({ SONAR_PROJECT_KEY: 'env-key' }, () => {
      assert.strictEqual(deriveProjectKey('/x/some-app', cfg({ enabled: true })), 'env-key');
    });
  });
  await t.test('falls back to a sanitized folder slug (case preserved)', () => {
    withEnv({}, () => {
      assert.strictEqual(deriveProjectKey('/x/My App!', cfg({ enabled: true })), 'My-App');
      assert.strictEqual(deriveProjectKey('/x/bakery_shop', cfg({ enabled: true })), 'bakery_shop');
    });
  });
  await t.test('prefixes dat- for all-digit or empty slugs (SonarQube rejects all-numeric keys)', () => {
    withEnv({}, () => {
      assert.strictEqual(deriveProjectKey('/x/12345', cfg({ enabled: true })), 'dat-12345');
      assert.strictEqual(deriveProjectKey('/x/@@@', cfg({ enabled: true })), 'dat-app');
    });
  });
});

test('buildSonarArgs', async (t) => {
  await t.test('returns nothing when the repo ships its own properties file', () => {
    withEnv({ SONAR_HOST_URL: 'http://localhost:9000' }, () => {
      assert.deepStrictEqual(buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }), hasProperties: true }), []);
    });
  });
  await t.test('injects host/projectKey/projectName/sources/scm flags', () => {
    withEnv({ SONAR_HOST_URL: 'http://localhost:9000' }, () => {
      const args = buildSonarArgs({ cwd: '/x/bakery_shop', config: cfg({ enabled: true }), hasProperties: false });
      assert.ok(args.includes('-Dsonar.host.url=http://localhost:9000'));
      assert.ok(args.includes('-Dsonar.projectKey=bakery_shop'));
      assert.ok(args.includes('-Dsonar.projectName=bakery_shop'));
      assert.ok(args.includes('-Dsonar.sources=.'));
      assert.ok(args.includes('-Dsonar.scm.disabled=true'));
    });
  });
  await t.test('always excludes dependency/build dirs and merges the global exclude globs', () => {
    withEnv({ SONAR_HOST_URL: 'http://h' }, () => {
      const args = buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }, ['**/*.test.ts']), hasProperties: false });
      const exc = args.find(a => a.startsWith('-Dsonar.exclusions='))!;
      assert.ok(exc.includes('**/node_modules/**'), 'node_modules excluded by default');
      assert.ok(exc.includes('**/results/**'), "DAT's own results/ output dir excluded by default");
      assert.ok(exc.includes('**/*.test.ts'), 'user exclude merged in');
      // even with no config.exclude, defaults are still applied
      const bare = buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }), hasProperties: false });
      assert.ok(bare.some(a => a.startsWith('-Dsonar.exclusions=') && a.includes('node_modules')));
    });
  });
  await t.test('adds organization only when provided (SonarCloud opt-in)', () => {
    withEnv({ SONAR_HOST_URL: 'http://h' }, () => {
      assert.ok(!buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }), hasProperties: false }).some(a => a.startsWith('-Dsonar.organization')));
    });
    withEnv({ SONAR_HOST_URL: 'http://h', SONAR_ORGANIZATION: 'my-org' }, () => {
      assert.ok(buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }), hasProperties: false }).includes('-Dsonar.organization=my-org'));
    });
  });
  await t.test('never places the token on the command line', () => {
    withEnv({ SONAR_HOST_URL: 'http://h', SONAR_TOKEN: 'super-secret-token' }, () => {
      const joined = buildSonarArgs({ cwd: '/x/app', config: cfg({ enabled: true }), hasProperties: false }).join(' ');
      assert.ok(!joined.includes('super-secret-token'));
      assert.ok(!/sonar\.(token|login|password)/.test(joined));
    });
  });
});

test('isSonarConfigured (host-based)', async (t) => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dat-sonar-'));
  await t.test('host via config (no env) + token → configured', () => {
    withEnv({ SONAR_TOKEN: 't' }, () => {
      assert.strictEqual(isSonarConfigured(tmp(), cfg({ enabled: true, hostUrl: 'http://h' })), true);
    });
  });
  await t.test('token only (no host, no file) → not configured', () => {
    withEnv({ SONAR_TOKEN: 't' }, () => {
      assert.strictEqual(isSonarConfigured(tmp()), false);
    });
  });
});
