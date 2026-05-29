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
  await t.test('bare app: required inputs (config, DAST target) reported missing', async () => {
    const dir = tmp({ 'package.json': '{"name":"x"}' }); // node, but no Dockerfile/tests/url/config
    const r = await checkReadiness(cfg, { configPath: '.dat.config.yaml', workspaceRoot: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(r.datConfigPresent, false);
    assert.ok(r.requiredMissing > 0, 'expected required inputs missing');
    // DAST target is required and absent (no url/deploy) -> counted.
    const zap = r.scanners.find(s => s.scanner === 'OWASP ZAP');
    assert.ok(zap && zap.inputs.some(i => i.category === 'dastTarget' && !i.present && i.tier === 'required'));
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

  await t.test('advisory missing does not inflate requiredMissing', async () => {
    // standard profile includes Checkov (iac, advisory). With a Dockerfile, tests, config and no url,
    // ensure advisory IaC/promptfoo absence lands in advisoryMissing, not requiredMissing.
    const dir = tmp({ 'package.json': '{"scripts":{"test":"x"}}', 'Dockerfile': 'FROM node', '.dat.config.yaml': 'x: 1' });
    const r = await checkReadiness({ ...cfg, profile: 'standard' }, { configPath: '.dat.config.yaml', workspaceRoot: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(r.advisoryMissing >= 0);
    // Dockerfile present + config present + node test script => required (dockerfile, datConfig, testSuite) satisfied; standard has no dastTarget scanner.
    assert.strictEqual(r.requiredMissing, 0, `expected 0 required missing, got ${r.requiredMissing}`);
  });
});
