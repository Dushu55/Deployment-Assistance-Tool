import test from 'node:test';
import assert from 'node:assert';
import { getEnabledScanners } from './orchestrator.js';
import { isProfileName, PROFILES } from './profiles.js';
import { DatConfig } from './types.js';

// A config that, with NO profile, enables only semgrep — so we can prove profiles override flags.
function cfg(): DatConfig {
  return { scanners: { semgrep: { enabled: true } } as any, failOn: ['CRITICAL', 'HIGH'] };
}
const NODE = ['node'] as const;

test('isProfileName', () => {
  assert.ok(isProfileName('quick'));
  assert.ok(isProfileName('full'));
  assert.ok(!isProfileName('turbo'));
});

test('getEnabledScanners with profiles', async (t) => {
  await t.test('quick profile selects exactly the fast trio (language-agnostic ones)', () => {
    const names = getEnabledScanners(cfg(), NODE as any, { profile: 'quick' }).map(s => s.name).sort();
    assert.deepStrictEqual(names, ['Gitleaks (Secrets)', 'Logic Tests', 'Semgrep']);
  });

  await t.test('profile overrides per-scanner enabled flags', () => {
    // Config only enables semgrep, but the security profile must still pull in trivy, zap, etc.
    const names = getEnabledScanners(cfg(), NODE as any, { profile: 'security' }).map(s => s.name);
    assert.ok(names.includes('Trivy'));
    assert.ok(names.includes('OWASP ZAP'));
    assert.ok(!names.includes('Logic Tests')); // not part of the security set
  });

  await t.test('full enables every scanner applicable to the detected language', () => {
    const full = getEnabledScanners(cfg(), NODE as any, { profile: 'full' }).map(s => s.name);
    // Rust-only scanners must be excluded for a node project...
    assert.ok(!full.includes('cargo-audit'));
    assert.ok(!full.includes('Clippy'));
    // ...but language-agnostic ones are present.
    assert.ok(full.includes('Semgrep'));
    assert.ok(full.includes('OWASP ZAP'));
    assert.ok(full.includes('Trivy'));
  });

  await t.test('explicit profile arg wins over config.profile', () => {
    const withConfigProfile = { ...cfg(), profile: 'full' as const };
    const names = getEnabledScanners(withConfigProfile, NODE as any, { profile: 'quick' }).map(s => s.name).sort();
    assert.deepStrictEqual(names, ['Gitleaks (Secrets)', 'Logic Tests', 'Semgrep']);
  });

  await t.test('no profile falls back to per-scanner enabled flags', () => {
    const names = getEnabledScanners(cfg(), NODE as any).map(s => s.name);
    assert.deepStrictEqual(names, ['Semgrep']);
  });

  await t.test('language-specific scanners listed in a profile are still language-gated', () => {
    // 'standard' lists cargoAudit, but a node project must not activate it.
    assert.ok(PROFILES.standard.includes('cargoAudit'));
    const names = getEnabledScanners(cfg(), NODE as any, { profile: 'standard' }).map(s => s.name);
    assert.ok(!names.includes('cargo-audit'));
  });
});
