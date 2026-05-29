import test from 'node:test';
import assert from 'node:assert';
import { semgrepScanner, parseSemgrepResults } from './semgrep.js';

test('Semgrep Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(semgrepScanner.name, 'Semgrep');
    assert.strictEqual(semgrepScanner.module, 'static');
  });
});

test('parseSemgrepResults', async (t) => {
  const fixture = {
    results: [
      { check_id: 'rules.eval', path: 'src/a.ts', start: { line: 12 },
        extra: { severity: 'ERROR', message: 'Avoid eval', fix: 'remove eval' } },
      { check_id: 'rules.weak-rng', path: 'src/b.ts', start: { line: 3 },
        extra: { severity: 'WARNING', message: 'Weak RNG' } },
      { check_id: 'rules.note', path: 'src/c.ts', start: { line: 1 },
        extra: { severity: 'INFO', message: 'FYI' } }
    ]
  };

  await t.test('maps ERROR->CRITICAL, WARNING->HIGH, INFO->INFO', () => {
    const issues = parseSemgrepResults(fixture);
    assert.strictEqual(issues[0].severity, 'CRITICAL');
    assert.strictEqual(issues[1].severity, 'HIGH');
    assert.strictEqual(issues[2].severity, 'INFO');
  });

  await t.test('extracts id, file, line, message and remediation', () => {
    const [first] = parseSemgrepResults(fixture);
    assert.strictEqual(first.id, 'rules.eval');
    assert.strictEqual(first.file, 'src/a.ts');
    assert.strictEqual(first.line, 12);
    assert.strictEqual(first.remediation, 'remove eval');
    assert.strictEqual(first.source, 'Semgrep');
  });

  await t.test('tolerates empty / missing results', () => {
    assert.deepStrictEqual(parseSemgrepResults({}), []);
    assert.deepStrictEqual(parseSemgrepResults({ results: [] }), []);
  });
});
