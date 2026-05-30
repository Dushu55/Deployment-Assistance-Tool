import test from 'node:test';
import assert from 'node:assert';
import { redactString, redactDeep, registerEnvSecrets, __resetEnvSecrets } from './redact.js';

test('redactString patterns', async (t) => {
  __resetEnvSecrets();
  await t.test('GitHub PAT', () => assert.match(redactString('tok ' + 'ghp_' + 'a'.repeat(36)), /\[REDACTED\]/));
  await t.test('GitHub PAT removes the secret', () => assert.ok(!redactString('ghp_' + 'a'.repeat(36)).includes('aaaa')));
  await t.test('AWS access key', () => assert.match(redactString('AKIA' + 'ABCDEFGHIJ123456'), /\[REDACTED\]/));
  await t.test('Google API key', () => assert.match(redactString('AIza' + 'a'.repeat(35)), /\[REDACTED\]/));
  await t.test('Bearer token', () => assert.match(redactString('Authorization: Bearer abc.def.ghi'), /Bearer \[REDACTED\]/));
  await t.test('URL-embedded creds', () => {
    const out = redactString('postgres://user:s3cretpw@db.host:5432/x');
    assert.match(out, /\[REDACTED\]@db\.host/);
    assert.ok(!out.includes('s3cretpw'));
  });
  await t.test('key=value secrets', () => assert.match(redactString('api_key=ABC123DEF456'), /\[REDACTED\]/));
  await t.test('PEM private key', () => assert.match(redactString('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'), /\[REDACTED\]/));
  await t.test('leaves ordinary text untouched', () => assert.strictEqual(redactString('Scanned 12 files, found 3 issues.'), 'Scanned 12 files, found 3 issues.'));
});

test('registerEnvSecrets', async (t) => {
  await t.test('redacts a registered env value anywhere it appears', () => {
    __resetEnvSecrets();
    registerEnvSecrets({ GEMINI_API_KEY: 'super-secret-value-123', MY_TOKEN: 'another-secret-xyz' } as any);
    assert.strictEqual(redactString('key is super-secret-value-123 done'), 'key is [REDACTED] done');
    assert.match(redactString('using another-secret-xyz'), /\[REDACTED\]/);
    __resetEnvSecrets();
  });

  await t.test('does not register short values (avoids over-redaction)', () => {
    __resetEnvSecrets();
    registerEnvSecrets({ DB_PASS: 'short' } as any); // < 8 chars → ignored
    assert.strictEqual(redactString('the word short appears'), 'the word short appears');
    __resetEnvSecrets();
  });
});

test('redactDeep', async (t) => {
  __resetEnvSecrets();
  await t.test('scrubs nested string fields', () => {
    const out = redactDeep({ a: 'Bearer xyz.abc', nested: { token: 'token=ABC123DEF456', n: 42 }, list: ['ghp_' + 'a'.repeat(36)] });
    assert.match((out as any).a, /Bearer \[REDACTED\]/);
    assert.match((out as any).nested.token, /\[REDACTED\]/);
    assert.strictEqual((out as any).nested.n, 42);
    assert.match((out as any).list[0], /\[REDACTED\]/);
  });
});
