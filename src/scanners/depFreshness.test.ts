import test from 'node:test';
import assert from 'node:assert';
import { majorsBehind, parseNpmOutdated, parsePipOutdated } from './depFreshness.js';

test('majorsBehind', async (t) => {
  await t.test('plain semver distances', () => {
    assert.strictEqual(majorsBehind('17.0.2', '19.1.0'), 2);
    assert.strictEqual(majorsBehind('4.17.20', '4.17.21'), 0);
    assert.strictEqual(majorsBehind('2.0.0', '2.9.9'), 0);
  });
  await t.test('tolerates prefixes and garbage', () => {
    assert.strictEqual(majorsBehind('v1.2.3', '3.0.0'), 2);
    assert.strictEqual(majorsBehind('^1.0.0', '2.0.0'), 1);
    assert.strictEqual(majorsBehind('not-a-version', '2.0.0'), 0);
    assert.strictEqual(majorsBehind('3.0.0', '1.0.0'), 0); // ahead of latest → 0, never negative
  });
});

test('parseNpmOutdated', async (t) => {
  await t.test('major lag → per-package LOW; minor drift → one INFO summary', () => {
    const issues = parseNpmOutdated({
      react: { current: '17.0.2', wanted: '17.0.2', latest: '19.1.0' },
      lodash: { current: '4.17.20', wanted: '4.17.21', latest: '4.17.21' },
      chalk: { current: '5.2.0', wanted: '5.3.0', latest: '5.3.0' },
    });
    const major = issues.find((i) => i.id === 'DEP-OUTDATED-react');
    assert.strictEqual(major?.severity, 'LOW');
    assert.match(major!.message, /2 major versions behind \(17\.0\.2 → 19\.1\.0\)/);
    const summary = issues.find((i) => i.id === 'DEP-FRESH-NODE-MINOR');
    assert.strictEqual(summary?.severity, 'INFO');
    assert.match(summary!.message, /2 packages have newer minor\/patch releases/);
    assert.strictEqual(issues.length, 2);
  });
  await t.test('everything current / empty → no issues', () => {
    assert.deepStrictEqual(parseNpmOutdated({}), []);
    assert.deepStrictEqual(parseNpmOutdated(null), []);
    assert.deepStrictEqual(
      parseNpmOutdated({ x: { current: '1.0.0', wanted: '1.0.0', latest: '1.0.0' } }), []);
  });
});

test('parsePipOutdated', async (t) => {
  await t.test('pip JSON shape → same issue model', () => {
    const issues = parsePipOutdated([
      { name: 'django', version: '3.2.0', latest_version: '5.0.1' },
      { name: 'requests', version: '2.31.0', latest_version: '2.32.0' },
    ]);
    const major = issues.find((i) => i.id === 'DEP-OUTDATED-django');
    assert.strictEqual(major?.severity, 'LOW');
    assert.strictEqual(major?.file, 'requirements.txt');
    const summary = issues.find((i) => i.id === 'DEP-FRESH-PY-MINOR');
    assert.strictEqual(summary?.severity, 'INFO');
  });
  await t.test('non-array input → no issues', () => {
    assert.deepStrictEqual(parsePipOutdated({}), []);
  });
});
