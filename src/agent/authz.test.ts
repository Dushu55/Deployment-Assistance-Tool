import test from 'node:test';
import assert from 'node:assert';
import { authorizeWebhook, __resetRateLimit } from './authz.js';

const baseEnv = {} as NodeJS.ProcessEnv;

test('authorizeWebhook', async (t) => {
  await t.test('blocks untrusted author_association', () => {
    __resetRateLimit();
    const r = authorizeWebhook({ authorAssociation: 'NONE', org: 'o', repo: 'o/r', env: baseEnv });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /Untrusted/);
  });

  await t.test('allows a trusted contributor with no allow-lists', () => {
    __resetRateLimit();
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'MEMBER', org: 'o', repo: 'o/r', env: baseEnv }).allowed, true);
  });

  await t.test('enforces the org allow-list', () => {
    __resetRateLimit();
    const env = { DAT_ALLOWED_ORGS: 'acme, globex' } as NodeJS.ProcessEnv;
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'OWNER', org: 'evilcorp', repo: 'evilcorp/x', env }).allowed, false);
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'OWNER', org: 'Acme', repo: 'Acme/x', env }).allowed, true);
  });

  await t.test('enforces the repo allow-list', () => {
    __resetRateLimit();
    const env = { DAT_ALLOWED_REPOS: 'acme/app' } as NodeJS.ProcessEnv;
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'OWNER', org: 'acme', repo: 'acme/other', env }).allowed, false);
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'OWNER', org: 'acme', repo: 'acme/app', env }).allowed, true);
  });

  await t.test('rate-limits per repo within the window and resets after it', () => {
    __resetRateLimit();
    const env = { DAT_RATE_LIMIT_PER_HOUR: '2' } as NodeJS.ProcessEnv;
    const at = (now: number) => authorizeWebhook({ authorAssociation: 'MEMBER', org: 'o', repo: 'o/r', env, now });
    assert.strictEqual(at(1000).allowed, true);
    assert.strictEqual(at(2000).allowed, true);
    assert.strictEqual(at(3000).allowed, false);            // 3rd within the hour → blocked
    assert.strictEqual(at(3000 + 3_600_001).allowed, true); // window elapsed → allowed again
  });

  await t.test('separate repos have independent rate-limit buckets', () => {
    __resetRateLimit();
    const env = { DAT_RATE_LIMIT_PER_HOUR: '1' } as NodeJS.ProcessEnv;
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'MEMBER', org: 'o', repo: 'o/a', env, now: 1 }).allowed, true);
    assert.strictEqual(authorizeWebhook({ authorAssociation: 'MEMBER', org: 'o', repo: 'o/b', env, now: 1 }).allowed, true);
  });
});
