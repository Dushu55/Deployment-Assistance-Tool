import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isInputPresent, isNotApplicable, inputTier } from './inputs.js';
import { Scanner } from './types.js';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-inputs-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const baseCtx = (root: string, over: any = {}) => ({ workspaceRoot: root, detectedLanguages: [] as any, ...over });

test('inputTier (3-tier)', () => {
  assert.strictEqual(inputTier('dockerfile'), 'critical');
  assert.strictEqual(inputTier('deps'), 'critical');        // supply chain promoted to critical
  assert.strictEqual(inputTier('iac'), 'highly-advised');
  assert.strictEqual(inputTier('promptfoo'), 'best-practice');
  assert.strictEqual(inputTier('iac', ['iac']), 'critical'); // critical override
  assert.strictEqual(inputTier('deps', [], ['deps']), 'highly-advised'); // highly-advised override
});

test('isInputPresent', async (t) => {
  await t.test('file anyOf present / absent', () => {
    const dir = tmp({ 'Dockerfile': 'FROM node' });
    assert.strictEqual(isInputPresent({ label: 'Dockerfile', category: 'dockerfile', anyOf: ['Dockerfile'] }, baseCtx(dir)), true);
    assert.strictEqual(isInputPresent({ label: 'x', category: 'deps', anyOf: ['package.json'] }, baseCtx(dir)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('anyExtRecursive finds .tf', () => {
    const dir = tmp({ 'infra/main.tf': 'resource "x" "y" {}' });
    assert.strictEqual(isInputPresent({ label: 'IaC', category: 'iac', anyExtRecursive: ['.tf'] }, baseCtx(dir)), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('url kind satisfied by url / deploy / deployerEnabled', () => {
    const i = { label: 'DAST', category: 'dastTarget', kind: 'url' } as const;
    assert.strictEqual(isInputPresent(i, baseCtx('/x', { url: 'http://a' })), true);
    assert.strictEqual(isInputPresent(i, baseCtx('/x', { deploy: true })), true);
    assert.strictEqual(isInputPresent(i, baseCtx('/x', { deployerEnabled: true })), true);
    assert.strictEqual(isInputPresent(i, baseCtx('/x')), false);
  });

  await t.test('image kind is always treated as absent (advisory)', () => {
    assert.strictEqual(isInputPresent({ label: 'img', category: 'image', kind: 'image' }, baseCtx('/x')), false);
  });
});

test('isNotApplicable (auto-detect prune rule)', async (t) => {
  const scanner = (expectedInputs: any): Scanner => ({ name: 'X', module: 'security', supportedLanguages: 'all', expectedInputs, run: async () => ({} as any) });

  await t.test('scanner with no inputs is never pruned', () => {
    assert.strictEqual(isNotApplicable(scanner(undefined), baseCtx('/x')), false);
  });

  await t.test('best-practice input absent -> prune', () => {
    const dir = tmp({ 'README.md': '' });
    const promptfooLike = scanner([{ label: 'promptfoo', category: 'promptfoo', anyOf: ['promptfooconfig.yaml'] }]);
    assert.strictEqual(isNotApplicable(promptfooLike, baseCtx(dir)), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('best-practice input present -> keep', () => {
    const dir = tmp({ 'promptfooconfig.yaml': '' });
    const promptfooLike = scanner([{ label: 'promptfoo', category: 'promptfoo', anyOf: ['promptfooconfig.yaml'] }]);
    assert.strictEqual(isNotApplicable(promptfooLike, baseCtx(dir)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('highly-advised input absent -> NOT pruned (gap must surface)', () => {
    const dir = tmp({ 'README.md': '' });
    const checkovLike = scanner([{ label: 'IaC', category: 'iac', anyExtRecursive: ['.tf'] }]);
    assert.strictEqual(isNotApplicable(checkovLike, baseCtx(dir)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('critical input absent -> NOT pruned (gap must surface)', () => {
    const dir = tmp({ 'README.md': '' });
    const hadolintLike = scanner([{ label: 'Dockerfile', category: 'dockerfile', anyOf: ['Dockerfile'] }]);
    assert.strictEqual(isNotApplicable(hadolintLike, baseCtx(dir)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
