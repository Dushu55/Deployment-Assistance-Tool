import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseNpmAudit, runNpmAudit } from './npmAudit.js';

const FIXTURE = {
  auditReportVersion: 2,
  vulnerabilities: {
    'left-pad': {
      name: 'left-pad', severity: 'critical', range: '<1.3.0',
      via: [{ title: 'Prototype pollution', url: 'https://github.com/advisories/GHSA-abcd-1234-wxyz', severity: 'critical' }],
      fixAvailable: true,
    },
    lodash: {
      name: 'lodash', severity: 'moderate', range: '<4.17.21',
      via: [{ title: 'ReDoS in trim', url: 'https://github.com/advisories/GHSA-29mw-wpgm-hmr9', severity: 'moderate' }],
      fixAvailable: { name: 'lodash', version: '4.17.21', isSemVerMajor: false },
    },
    'transitive-thing': {
      name: 'transitive-thing', severity: 'low', range: '*',
      via: ['lodash'], // string-only chain — no advisory object
      fixAvailable: false,
    },
  },
};

test('parseNpmAudit', async (t) => {
  await t.test('maps npm severities correctly — moderate is MEDIUM, not HIGH', () => {
    const issues = parseNpmAudit(FIXTURE);
    const sev = Object.fromEntries(issues.map((i) => [i.message.split(' ')[1], i.severity]));
    assert.strictEqual(sev['left-pad'], 'CRITICAL');
    assert.strictEqual(sev['lodash'], 'MEDIUM');
    assert.strictEqual(sev['transitive-thing'], 'LOW');
  });

  await t.test('uses the GHSA id when present, falls back otherwise', () => {
    const issues = parseNpmAudit(FIXTURE);
    assert.ok(issues.some((i) => i.id === 'GHSA-abcd-1234-wxyz'));
    assert.ok(issues.some((i) => i.id === 'NPM-AUDIT-transitive-thing'));
  });

  await t.test('remediation reflects fixAvailable', () => {
    const issues = parseNpmAudit(FIXTURE);
    const byPkg = (p: string) => issues.find((i) => i.message.includes(`Package ${p} `))!;
    assert.match(byPkg('left-pad').remediation!, /npm audit fix/);
    assert.match(byPkg('lodash').remediation!, /Upgrade lodash to 4\.17\.21/);
    assert.match(byPkg('transitive-thing').remediation!, /No fixed release/);
  });

  await t.test('empty / malformed input → no issues', () => {
    assert.deepStrictEqual(parseNpmAudit({}), []);
    assert.deepStrictEqual(parseNpmAudit(null), []);
    assert.deepStrictEqual(parseNpmAudit({ vulnerabilities: 'nope' }), []);
  });
});

test('runNpmAudit', async (t) => {
  await t.test('no lockfile → graceful INFO skip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-npmaudit-'));
    const r = await runNpmAudit(dir);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.issues.length, 1);
    assert.strictEqual(r.issues[0].id, 'NPM-AUDIT-NO-LOCKFILE');
    assert.strictEqual(r.issues[0].severity, 'INFO');
  });
});
