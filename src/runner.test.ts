import test from 'node:test';
import assert from 'node:assert';
import { runCommand } from './runner.js';

test('Execution Engine (Runner)', async (t) => {
  await t.test('should execute a valid command and capture stdout', async () => {
    const result = await runCommand('node', ['-e', 'console.log("hello world")']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.stdout, /hello world/);
  });

  await t.test('should capture exit codes for failing commands', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(1)']);
    assert.strictEqual(result.exitCode, 1);
  });

  await t.test('should timeout on hanging commands', async () => {
    await assert.rejects(
      // Command sleeps for 2 seconds, but timeout is 100ms
      runCommand('node', ['-e', 'setTimeout(() => {}, 2000)'], 100),
      /timed out after 100ms/
    );
  });

  await t.test('should throw error on non-existent commands', async () => {
    await assert.rejects(
      runCommand('fake-command-that-does-not-exist', []),
      /ENOENT/
    );
  });
});
