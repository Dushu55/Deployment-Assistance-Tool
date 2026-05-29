import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { ReachabilityEngine } from './index.js';

test('ReachabilityEngine - Node.js', async (t) => {
  const tempDir = fs.mkdtempSync('reach-test-');

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('detects reachable package', async () => {
    fs.writeFileSync(path.join(tempDir, 'index.js'), `import { clone } from 'lodash';`);
    const engine = new ReachabilityEngine(tempDir, ['node']);
    const result = await engine.checkPackage('lodash');
    
    assert.strictEqual(result.isReachable, true);
    assert.strictEqual(result.packageName, 'lodash');
    assert.ok(result.evidenceFiles && result.evidenceFiles.length > 0);
  });

  await t.test('detects unreachable package', async () => {
    fs.writeFileSync(path.join(tempDir, 'index.js'), `import { something } from 'express';`);
    const engine = new ReachabilityEngine(tempDir, ['node']);
    // 'axios' is not in the file
    const result = await engine.checkPackage('axios');
    
    assert.strictEqual(result.isReachable, false);
    assert.strictEqual(result.evidenceFiles, undefined);
  });
});

test('ReachabilityEngine - Python', async (t) => {
  const tempDir = fs.mkdtempSync('reach-test-py-');

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('detects reachable package in python', async () => {
    fs.writeFileSync(path.join(tempDir, 'main.py'), `import requests\nfrom django import models`);
    const engine = new ReachabilityEngine(tempDir, ['python']);
    
    const res1 = await engine.checkPackage('requests');
    assert.strictEqual(res1.isReachable, true);

    const res2 = await engine.checkPackage('django');
    assert.strictEqual(res2.isReachable, true);
  });
});
