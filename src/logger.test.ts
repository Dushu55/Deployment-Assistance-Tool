import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Regression test for the silent audit-loss bug: winston-daily-rotate-file writes asynchronously,
// so a bare process.exit() right after logging dropped the LAST line (e.g. the final DB_TEARDOWN
// event on a deploy run). flushLogger() must guarantee that line reaches disk before exit.
test('flushLogger persists the final audit line across process.exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-flush-'));
  const loggerPath = path.join(__dirname, 'logger.ts');
  const auditPath = path.join(__dirname, 'audit.ts');
  // The child logs two lines then exits IMMEDIATELY after flushLogger — the unflushed bug drops
  // the second line. LOG_DIR anchors to cwd/logs, so logs land under our temp dir.
  const child = `
    import { logger, flushLogger } from ${JSON.stringify(loggerPath)};
    import { emitInfraEvent } from ${JSON.stringify(auditPath)};
    logger.info('first line, should never be the one lost');
    emitInfraEvent('DB_TEARDOWN', 'OK', { handle: 'FLUSH-REGRESSION' });
    await flushLogger();
    process.exit(0);
  `;
  const scriptPath = path.join(dir, 'child.mts');
  fs.writeFileSync(scriptPath, child);

  const tsx = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
  const run = spawnSync(tsx, [scriptPath], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') {
    // tsx not resolvable in this environment — skip rather than fail spuriously.
    return;
  }
  assert.strictEqual(run.status, 0, `child exited non-zero: ${run.stderr}`);

  const logsDir = path.join(dir, 'logs');
  const files = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).filter(f => f.endsWith('.log')) : [];
  assert.ok(files.length > 0, 'expected an audit log file to be written');
  const contents = files.map(f => fs.readFileSync(path.join(logsDir, f), 'utf8')).join('\n');
  assert.match(contents, /"action":"DB_TEARDOWN"/, 'the final DB_TEARDOWN line must survive process.exit');
  assert.match(contents, /FLUSH-REGRESSION/);
  fs.rmSync(dir, { recursive: true, force: true });
});
