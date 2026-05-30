import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkReadiness } from './readiness.js';
import { DatConfig } from './types.js';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-readiness-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

// Use the security profile so DAST (dastTarget, required) is in scope deterministically.
const cfg: DatConfig = { scanners: {} as any, failOn: ['CRITICAL', 'HIGH'], profile: 'security' };

test('checkReadiness', async (t) => {
  await t.test('bare app: critical inputs (config, DAST target) reported missing -> not production-safe', async () => {
    const dir = tmp({ 'package.json': '{"name":"x"}' }); // node, but no Dockerfile/tests/url/config
    const r = await checkReadiness(cfg, { configPath: '.dat.config.yaml', workspaceRoot: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(r.datConfigPresent, false);
    assert.ok(r.criticalMissing > 0, 'expected critical inputs missing');
    assert.strictEqual(r.requiredMissing, r.criticalMissing, 'requiredMissing aliases criticalMissing');
    assert.strictEqual(r.readinessLevel, 'not-production-safe');
    // DAST target is critical and absent (no url/deploy) -> counted, with consequence text.
    const zap = r.scanners.find(s => s.scanner === 'OWASP ZAP');
    const dast = zap?.inputs.find(i => i.category === 'dastTarget');
    assert.ok(dast && !dast.present && dast.tier === 'critical');
    assert.ok(dast!.consequence && dast!.consequence.length > 0, 'expected consequence text');
  });

  await t.test('DAST target satisfied by url', async () => {
    const dir = tmp({ 'package.json': '{}' });
    const r = await checkReadiness(cfg, { configPath: '.dat.config.yaml', workspaceRoot: dir, url: 'https://app.example.com' });
    fs.rmSync(dir, { recursive: true, force: true });
    const zap = r.scanners.find(s => s.scanner === 'OWASP ZAP')!;
    assert.ok(zap.inputs.find(i => i.category === 'dastTarget')!.present);
  });

  await t.test('present .dat.config.yaml is not counted as missing', async () => {
    const dir = tmp({ 'package.json': '{}', '.dat.config.yaml': 'failOn: [CRITICAL]' });
    const r = await checkReadiness(cfg, { configPath: '.dat.config.yaml', workspaceRoot: dir, url: 'https://x' });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(r.datConfigPresent, true);
  });

  await t.test('critical satisfied but highly-advised missing -> production-safe (not enterprise)', async () => {
    // standard profile: Dockerfile + tests + config + deps satisfied; but no .tf (iac, highly-advised).
    const dir = tmp({
      'package.json': '{"scripts":{"test":"x"}}', // deps manifest + test script
      'Dockerfile': 'FROM node',
      '.dat.config.yaml': 'x: 1'
    });
    const r = await checkReadiness({ ...cfg, profile: 'standard' }, { configPath: '.dat.config.yaml', workspaceRoot: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(r.criticalMissing, 0, `expected 0 critical missing, got ${r.criticalMissing}`);
    // Checkov's IaC (highly-advised) is absent -> production-safe, not enterprise-grade.
    assert.strictEqual(r.readinessLevel, 'production-safe');
    assert.ok(r.highlyAdvisedMissing > 0);
  });
});
