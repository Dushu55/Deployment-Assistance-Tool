import test from 'node:test';
import assert from 'node:assert';
import { zapScanner, parseZapResults, runZap } from './zap.js';

test('OWASP ZAP Scanner Adapter', async (t) => {
  await t.test('registers with correct properties', () => {
    assert.strictEqual(zapScanner.name, 'OWASP ZAP');
    assert.strictEqual(zapScanner.module, 'security');
    assert.deepStrictEqual(zapScanner.requiredBinaries, ['docker']);
  });

  await t.test('emits a HIGH DAST coverage gap (not a silent pass) when no URL is given', async () => {
    const res = await runZap(undefined, undefined, true);
    assert.strictEqual(res.issues.length, 1);
    assert.strictEqual(res.issues[0].id, 'DAST-COVERAGE-GAP');
    assert.strictEqual(res.issues[0].severity, 'HIGH');
  });

  await t.test('downgrades the coverage gap to INFO when failOnMissingTarget is false', async () => {
    const res = await runZap(undefined, undefined, false);
    assert.strictEqual(res.issues[0].severity, 'INFO');
  });
});

test('parseZapResults', async (t) => {
  const fixture = {
    site: [
      {
        alerts: [
          { pluginid: '40012', name: 'Reflected XSS', riskdesc: 'High (Medium)',
            desc: '<p>Cross-site scripting</p>', solution: '<p>Encode output</p>' },
          { pluginid: '10038', name: 'CSP not set', riskdesc: 'Medium', desc: 'No CSP header' }
        ]
      }
    ]
  };

  await t.test('maps ZAP riskdesc through mapSeverity and strips HTML', () => {
    const issues = parseZapResults(fixture, 'https://app.example.com');
    assert.strictEqual(issues.length, 2);
    assert.strictEqual(issues[0].severity, 'HIGH');     // "High (Medium)" -> HIGH
    assert.strictEqual(issues[1].severity, 'MEDIUM');
    assert.ok(!/[<>]/.test(issues[0].message), 'HTML tags should be stripped from message');
    assert.strictEqual(issues[0].file, 'https://app.example.com');
    assert.strictEqual(issues[0].source, 'OWASP ZAP');
  });

  await t.test('tolerates an empty / siteless report', () => {
    assert.deepStrictEqual(parseZapResults({}, 'u'), []);
    assert.deepStrictEqual(parseZapResults({ site: [] }, 'u'), []);
  });
});
