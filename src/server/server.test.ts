import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Each test points DAT_HOME at a fresh temp dir so the real ~/.dat is never touched.
function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-home-'));
  process.env.DAT_HOME = dir;
  return dir;
}

async function freshLib() {
  // Re-import after DAT_HOME is set (module reads env at call time, but import once is fine).
  return await import('./library.js');
}

test('publishReport', async (t) => {
  await t.test('copies HTML (0600), records manifest, returns hosted URL', async () => {
    tmpHome();
    const lib = await freshLib();
    const src = path.join(os.tmpdir(), `rep-${Date.now()}.html`);
    fs.writeFileSync(src, '<html>green</html>');
    const url = lib.publishReport({
      htmlPath: src, appName: 'My App!', score: 42, gate: 'fail',
      summary: { critical: 1, high: 2, medium: 3, low: 4, info: 5 }, timestamp: '2026-06-03T17:18:00.000Z'
    });
    const entries = lib.readManifest();
    assert.strictEqual(entries.length, 1);
    assert.match(entries[0].file, /^my-app-20260603-171800\.html$/); // slugified appName + stamp
    assert.strictEqual(entries[0].gate, 'fail');
    assert.strictEqual(url, `http://localhost:${lib.serverPort()}/r/${entries[0].file}`);
    const reportPath = path.join(lib.reportsDir(), entries[0].file);
    assert.strictEqual(fs.readFileSync(reportPath, 'utf8'), '<html>green</html>');
    // Owner-only: no group/other permission bits.
    assert.strictEqual(fs.statSync(reportPath).mode & 0o077, 0, 'report should be owner-only');
  });

  await t.test('prunes to the newest 100, deleting older files', async () => {
    tmpHome();
    const lib = await freshLib();
    const src = path.join(os.tmpdir(), `rep2-${Date.now()}.html`);
    fs.writeFileSync(src, 'x');
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    let firstFile = '';
    for (let i = 0; i < lib.RETENTION + 5; i++) {
      const url = lib.publishReport({
        htmlPath: src, appName: 'app', score: 0, gate: 'pass',
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        timestamp: new Date(base + i * 60000).toISOString()
      });
      if (i === 0) firstFile = url.split('/r/')[1];
    }
    const entries = lib.readManifest();
    assert.strictEqual(entries.length, lib.RETENTION, 'manifest capped at RETENTION');
    const htmlFiles = fs.readdirSync(lib.reportsDir()).filter(f => f.endsWith('.html'));
    assert.strictEqual(htmlFiles.length, lib.RETENTION, 'only RETENTION report files on disk');
    assert.ok(!fs.existsSync(path.join(lib.reportsDir(), firstFile)), 'oldest report file deleted');
  });
});

test('resolveReportSidecar', async (t) => {
  await t.test('resolves the .json sidecar written by publishReport, rejects traversal/non-html', async () => {
    tmpHome();
    const lib = await freshLib();
    const { resolveReportSidecar } = await import('./serve.js');
    const src = path.join(os.tmpdir(), `rep-sc-${Date.now()}.html`);
    fs.writeFileSync(src, '<html>x</html>');
    lib.publishReport({
      htmlPath: src, appName: 'sc', score: 10, gate: 'fail',
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, timestamp: '2026-06-03T09:00:00.000Z',
      results: [{ scannerName: 'Semgrep', success: true, durationMs: 1, issues: [{ id: 'X', severity: 'HIGH', message: 'm', source: 'Semgrep' }] }]
    });
    const file = lib.readManifest()[0].file;
    const resolved = resolveReportSidecar(file);
    assert.ok(resolved && fs.existsSync(resolved), 'sidecar resolves');
    assert.strictEqual((JSON.parse(fs.readFileSync(resolved!, 'utf8')) as any[])[0].scannerName, 'Semgrep');
    assert.strictEqual(resolveReportSidecar('../../etc/passwd'), null);
    assert.strictEqual(resolveReportSidecar('index.json'), null); // not a *.html basename
    assert.strictEqual(resolveReportSidecar('nope.html'), null);  // no sidecar on disk
  });
});

test('report server handler', async (t) => {
  tmpHome();
  const lib = await freshLib();
  const { startReportServer } = await import('./serve.js');
  const src = path.join(os.tmpdir(), `rep3-${Date.now()}.html`);
  fs.writeFileSync(src, '<html>report-body</html>');
  const { file } = (() => {
    lib.publishReport({ htmlPath: src, appName: 'demo', score: 90, gate: 'pass', summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, timestamp: '2026-06-03T10:00:00.000Z' });
    return lib.readManifest()[0];
  })();

  const server = startReportServer(0); // ephemeral port
  await new Promise(r => server.once('listening', r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const get = (p: string) => fetch(base + p);

  try {
    await t.test('GET / lists reports', async () => {
      const r = await get('/');
      assert.strictEqual(r.status, 200);
      assert.match(await r.text(), /demo/);
    });
    await t.test('GET /r/<file>.html serves the report', async () => {
      const r = await get('/r/' + file);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(await r.text(), '<html>report-body</html>');
    });
    await t.test('GET /index.json returns the manifest', async () => {
      const r = await get('/index.json');
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await r.json() as any[]).length, 1);
    });
    await t.test('path traversal → 404', async () => {
      const r = await get('/r/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
      assert.strictEqual(r.status, 404);
    });
    await t.test('non-.html under /r/ → 404', async () => {
      const r = await get('/r/index.json');
      assert.strictEqual(r.status, 404);
    });
    await t.test('missing report → 404', async () => {
      const r = await get('/r/nope.html');
      assert.strictEqual(r.status, 404);
    });
    await t.test('non-GET → 405', async () => {
      const r = await fetch(base + '/', { method: 'POST' });
      assert.strictEqual(r.status, 405);
    });
  } finally {
    server.close();
  }
});
