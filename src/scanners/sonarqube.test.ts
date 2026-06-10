import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSonarConfigured, runSonarQube, sonarqubeScanner } from './sonarqube.js';

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
