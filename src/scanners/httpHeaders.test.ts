import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { analyzeHeaders, runHttpHeaders } from './httpHeaders.js';

const HTTPS = 'https://app.example.com/';
const ids = (issues: { id: string }[]) => issues.map((i) => i.id).sort();

test('analyzeHeaders', async (t) => {
  await t.test('fully hardened response → no issues', () => {
    const h = new Headers({
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
    });
    assert.deepStrictEqual(analyzeHeaders(h, HTTPS), []);
  });

  await t.test('empty https response → CSP+HSTS MEDIUM and the LOW hygiene set', () => {
    const issues = analyzeHeaders(new Headers(), HTTPS);
    const bySev = (s: string) => issues.filter((i) => i.severity === s).map((i) => i.id).sort();
    assert.deepStrictEqual(bySev('MEDIUM'), ['HDR-CSP-MISSING', 'HDR-HSTS-MISSING']);
    assert.deepStrictEqual(bySev('LOW'),
      ['HDR-PERMISSIONS-MISSING', 'HDR-REFERRER-MISSING', 'HDR-XCTO-MISSING', 'HDR-XFO-MISSING']);
  });

  await t.test('plain http → no HSTS finding, but an informational not-https note', () => {
    const issues = analyzeHeaders(new Headers(), 'http://localhost:3000/');
    assert.ok(!ids(issues).includes('HDR-HSTS-MISSING'));
    const note = issues.find((i) => i.id === 'HDR-NOT-HTTPS');
    assert.strictEqual(note?.severity, 'INFO');
  });

  await t.test('CSP frame-ancestors satisfies the X-Frame-Options check', () => {
    const h = new Headers({ 'content-security-policy': "frame-ancestors 'none'" });
    assert.ok(!ids(analyzeHeaders(h, HTTPS)).includes('HDR-XFO-MISSING'));
  });

  await t.test('cookie without flags → Secure + HttpOnly + SameSite findings naming the cookie', () => {
    const h = new Headers();
    h.append('set-cookie', 'session=abc123; Path=/');
    const issues = analyzeHeaders(h, HTTPS).filter((i) => i.id.startsWith('HDR-COOKIE'));
    assert.deepStrictEqual(ids(issues), ['HDR-COOKIE-HTTPONLY', 'HDR-COOKIE-INSECURE', 'HDR-COOKIE-SAMESITE']);
    assert.ok(issues.every((i) => i.message.includes('"session"')));
  });

  await t.test('fully flagged cookie → no cookie findings; Secure not required on http', () => {
    const h = new Headers();
    h.append('set-cookie', 'session=abc; Secure; HttpOnly; SameSite=Lax');
    assert.deepStrictEqual(analyzeHeaders(h, HTTPS).filter((i) => i.id.startsWith('HDR-COOKIE')), []);
    const h2 = new Headers();
    h2.append('set-cookie', 'session=abc; HttpOnly; SameSite=Lax');
    assert.ok(!ids(analyzeHeaders(h2, 'http://localhost:3000/')).includes('HDR-COOKIE-INSECURE'));
  });

  await t.test('stack/version leak headers', () => {
    const h = new Headers({ 'x-powered-by': 'Express', server: 'nginx/1.25.3' });
    const found = ids(analyzeHeaders(h, HTTPS));
    assert.ok(found.includes('HDR-XPOWEREDBY-LEAK'));
    assert.ok(found.includes('HDR-SERVER-LEAK'));
    // Versionless Server header is fine.
    assert.ok(!ids(analyzeHeaders(new Headers({ server: 'nginx' }), HTTPS)).includes('HDR-SERVER-LEAK'));
  });
});

test('runHttpHeaders', async (t) => {
  await t.test('no URL → graceful INFO skip (not a HIGH gap — ZAP owns that)', async () => {
    const r = await runHttpHeaders(undefined);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.issues.length, 1);
    assert.strictEqual(r.issues[0].id, 'HDR-NO-TARGET');
    assert.strictEqual(r.issues[0].severity, 'INFO');
  });

  await t.test('metadata endpoint / bad scheme → error, not a fetch', async () => {
    const meta = await runHttpHeaders('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(meta.success, false);
    const ftp = await runHttpHeaders('ftp://example.com/');
    assert.strictEqual(ftp.success, false);
  });

  await t.test('integration: real local server, real findings', async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader('X-Powered-By', 'Express');
      res.setHeader('Set-Cookie', 'sid=1; Path=/');
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    try {
      const r = await runHttpHeaders(`http://127.0.0.1:${port}/`);
      assert.strictEqual(r.success, true);
      const found = ids(r.issues);
      assert.ok(found.includes('HDR-CSP-MISSING'));
      assert.ok(found.includes('HDR-XPOWEREDBY-LEAK'));
      assert.ok(found.includes('HDR-COOKIE-HTTPONLY'));
      assert.ok(!found.includes('HDR-HSTS-MISSING')); // http target
    } finally {
      server.close();
    }
  });

  await t.test('unreachable supplied URL → success:false with error', async () => {
    const r = await runHttpHeaders('http://127.0.0.1:1/');
    assert.strictEqual(r.success, false);
    assert.ok(r.error);
  });
});
