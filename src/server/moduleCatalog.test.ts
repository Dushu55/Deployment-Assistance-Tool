import test from 'node:test';
import assert from 'node:assert';
import { buildStaticCatalog, SCANNER_DESCRIPTIONS, SCANNER_DOCS, INSTALL_HINTS, OPERATOR_KEY_DOCS, MODULE_GROUPS } from './moduleCatalog.js';
import { ALL_SCANNERS } from '../scanners/index.js';
import { CONFIG_KEYS } from '../orchestrator.js';
import { PROFILES } from '../profiles.js';
import { OPERATOR_ENV_KEYS } from './operatorEnv.js';

test('module catalog completeness', async (t) => {
  const catalog = buildStaticCatalog();

  await t.test('every registered scanner has a catalog entry with a description and docs', () => {
    assert.strictEqual(catalog.modules.length, ALL_SCANNERS.length);
    for (const s of ALL_SCANNERS) {
      const m = catalog.modules.find((x) => x.name === s.name);
      assert.ok(m, `missing catalog entry for ${s.name}`);
      assert.ok(m!.description, `missing description for ${s.name}`);
      assert.ok(SCANNER_DOCS[m!.key], `missing SCANNER_DOCS for ${m!.key}`);
    }
  });

  await t.test('every required binary has an install hint', () => {
    for (const m of catalog.modules) {
      for (const b of m.binaries) {
        assert.ok(INSTALL_HINTS[b.name], `missing install hint for binary ${b.name} (${m.name})`);
      }
    }
  });

  await t.test('every module belongs to a known group', () => {
    const ids = new Set(MODULE_GROUPS.map((g) => g.id));
    for (const m of catalog.modules) assert.ok(ids.has(m.module), `${m.name} has unknown group ${m.module}`);
  });

  await t.test('profile membership agrees with PROFILES (full always included)', () => {
    for (const m of catalog.modules) {
      assert.ok(m.profiles.includes('full'), `${m.name} should be in full`);
      for (const p of ['quick', 'standard', 'security'] as const) {
        assert.strictEqual(m.profiles.includes(p), PROFILES[p].includes(m.key),
          `${m.name} profile membership mismatch for ${p}`);
      }
    }
  });

  await t.test('config snippet names the config key and enables the scanner', () => {
    for (const m of catalog.modules) {
      assert.match(m.configSnippet, new RegExp(`  ${m.key}:`), `${m.name} snippet missing key`);
      assert.match(m.configSnippet, /enabled: true/, `${m.name} snippet missing enabled`);
    }
  });

  await t.test('all operator env keys are documented', () => {
    for (const k of OPERATOR_ENV_KEYS) {
      assert.ok(OPERATOR_KEY_DOCS[k], `missing OPERATOR_KEY_DOCS for ${k}`);
    }
  });

  await t.test('stdout-alias descriptions are retained for the live progress list', () => {
    for (const alias of ['Trivy (FS)', 'Component Evaluator']) {
      assert.ok(SCANNER_DESCRIPTIONS[alias], `missing alias description: ${alias}`);
    }
  });

  await t.test('CONFIG_KEYS covers every scanner', () => {
    for (const s of ALL_SCANNERS) assert.ok(CONFIG_KEYS[s.name], `missing CONFIG_KEYS for ${s.name}`);
  });
});
