import test from 'node:test';
import assert from 'node:assert';
import { ALL_SCANNERS } from './index.js';
import { CONFIG_KEYS } from '../orchestrator.js';
import { runLogicTests } from './logicTests.js';

test('Scanner registry integrity', async (t) => {
  await t.test('every registered scanner has a CONFIG_KEYS mapping', () => {
    // Guards against the "registered but unwired" class of bug (e.g. Gitleaks shipping
    // disabled because the orchestrator filter drops scanners absent from CONFIG_KEYS).
    const missing = ALL_SCANNERS.filter(s => !CONFIG_KEYS[s.name]).map(s => s.name);
    assert.deepStrictEqual(missing, [], `Scanners missing a CONFIG_KEYS entry: ${missing.join(', ')}`);
  });

  await t.test('Gitleaks is wired into the orchestrator', () => {
    assert.strictEqual(CONFIG_KEYS['Gitleaks (Secrets)'], 'gitleaks');
  });

  await t.test('scanner names are unique', () => {
    const names = ALL_SCANNERS.map(s => s.name);
    assert.strictEqual(new Set(names).size, names.length, 'Duplicate scanner names detected');
  });
});

test('Logic Tests scanner', async (t) => {
  await t.test('flags a missing test suite as HIGH instead of silently passing', async () => {
    const result = await runLogicTests(null, '.', true);
    assert.strictEqual(result.scannerName, 'Logic Tests');
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].id, 'NO-LOGIC-TESTS');
    assert.strictEqual(result.issues[0].severity, 'HIGH');
  });

  await t.test('downgrades a missing test suite to INFO when failOnMissingTests is false', async () => {
    const result = await runLogicTests(null, '.', false);
    assert.strictEqual(result.issues[0].severity, 'INFO');
  });

  await t.test('reports a failing generic suite as a gate-blocking HIGH finding', async () => {
    // `node -e process.exit(1)` simulates a non-Jest test runner that fails.
    const result = await runLogicTests('node -e process.exit(1)', '.', true);
    const failing = result.issues.find(i => i.id === 'LOGIC-TESTS-FAILED');
    assert.ok(failing, 'expected a LOGIC-TESTS-FAILED finding');
    assert.strictEqual(failing!.severity, 'HIGH');
  });

  await t.test('reports a passing generic suite as INFO', async () => {
    const result = await runLogicTests('node -e process.exit(0)', '.', true);
    assert.strictEqual(result.issues[0].id, 'LOGIC-TESTS-PASSED');
    assert.strictEqual(result.issues[0].severity, 'INFO');
  });
});
