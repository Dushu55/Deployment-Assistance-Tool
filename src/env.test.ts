import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { EnvironmentDetector } from './env.js';

test('EnvironmentDetector', async (t) => {
  const tempDir = fs.mkdtempSync('env-test-');

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await t.test('detects node environment', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    const detector = new EnvironmentDetector(tempDir);
    const languages = detector.detectLanguages();
    assert.deepStrictEqual(languages, ['node']);
    assert.strictEqual(detector.getVerifyCommand(languages), 'npm test');
  });

  await t.test('detects polyglot environment (node + python)', () => {
    fs.writeFileSync(path.join(tempDir, 'requirements.txt'), '');
    const detector = new EnvironmentDetector(tempDir);
    const languages = detector.detectLanguages();
    
    // Sort for deterministic assertion
    const sorted = languages.sort();
    assert.deepStrictEqual(sorted, ['node', 'python']);
    
    // getVerifyCommand returns the first one it finds logic-wise, which is node first.
    assert.strictEqual(detector.getVerifyCommand(languages), 'npm test');
  });

  await t.test('detects go environment', () => {
    fs.rmSync(path.join(tempDir, 'package.json'), { force: true });
    fs.rmSync(path.join(tempDir, 'requirements.txt'), { force: true });
    
    fs.writeFileSync(path.join(tempDir, 'go.mod'), '');
    const detector = new EnvironmentDetector(tempDir);
    const languages = detector.detectLanguages();
    assert.deepStrictEqual(languages, ['go']);
    assert.strictEqual(detector.getVerifyCommand(languages), 'go test ./...');
  });
});
