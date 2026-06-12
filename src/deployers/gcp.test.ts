import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { GcpCloudRunDeployer, ExecFn } from './gcp.js';

// Build an exec stub that records every command and responds based on command content.
function recorder(responses: { deploy?: any; token?: string; reject?: RegExp }) {
  const calls: string[] = [];
  const execFn: ExecFn = async (cmd: string) => {
    calls.push(cmd);
    if (responses.reject && responses.reject.test(cmd)) {
      throw new Error('gcloud failed');
    }
    if (cmd.includes('print-identity-token')) {
      return { stdout: responses.token ?? 'fake-token', stderr: '' };
    }
    if (cmd.includes('run deploy')) {
      return { stdout: JSON.stringify(responses.deploy ?? { status: { url: 'https://svc.run.app' } }), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, execFn };
}

test('GcpCloudRunDeployer.deployBranch', async (t) => {
  await t.test('returns a deployment and applies cost-control flags', async () => {
    const { calls, execFn } = recorder({ deploy: { status: { url: 'https://svc.run.app' } }, token: 'tok123' });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    const result = await d.deployBranch('main', 'abc123');

    assert.match(result.id, /^dat-ephemeral-[0-9a-f]{8}$/);
    assert.strictEqual(result.url, 'https://svc.run.app');
    assert.strictEqual(result.authToken, 'tok123');

    const deployCmd = calls.find(c => c.includes('run deploy'))!;
    assert.match(deployCmd, /--no-allow-unauthenticated/);
    assert.match(deployCmd, /--min-instances=0/);
    assert.match(deployCmd, /--max-instances=1/);
    assert.match(deployCmd, /--cpu=1/);
    assert.match(deployCmd, /--memory=512Mi/);
    assert.match(deployCmd, /--project dat-tool/);
    // Cloud SQL must NOT be linked unless explicitly configured (cost).
    assert.ok(!deployCmd.includes('--add-cloudsql-instances'));
    // No runtime env configured → no env file injected.
    assert.ok(!deployCmd.includes('--env-vars-file'));
  });

  await t.test('injects DATABASE_URL (with @ ? & chars) via a temp --env-vars-file', async () => {
    let envFileContent = '';
    let envFilePath = '';
    const execFn: ExecFn = async (cmd: string) => {
      if (cmd.includes('print-identity-token')) return { stdout: 'tok', stderr: '' };
      if (cmd.includes('run deploy')) {
        const m = cmd.match(/--env-vars-file='([^']+)'/);
        assert.ok(m, 'deploy cmd should pass --env-vars-file');
        envFilePath = m![1];
        envFileContent = fs.readFileSync(envFilePath, 'utf8');
        return { stdout: JSON.stringify({ status: { url: 'https://svc.run.app' } }), stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const url = 'postgres://u:p@h:5432/db?sslmode=require&x=1';
    let deployCmd = '';
    const recordingExec: ExecFn = async (cmd: string) => {
      if (cmd.includes('run deploy')) deployCmd = cmd;
      return execFn(cmd);
    };
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', databaseUrl: url, env: { NEXTAUTH_SECRET: 'abc' }, execFn: recordingExec });
    await d.deployBranch('main');
    // Value is JSON-quoted in YAML, so special chars survive intact.
    assert.match(envFileContent, /DATABASE_URL: "postgres:\/\/u:p@h:5432\/db\?sslmode=require&x=1"/);
    assert.match(envFileContent, /NEXTAUTH_SECRET: "abc"/);
    // Injected at BOTH runtime and build time (next build needs the DB).
    assert.match(deployCmd, /--env-vars-file=/);
    assert.match(deployCmd, /--build-env-vars-file=/);
    // Temp file is cleaned up after the deploy.
    assert.ok(!fs.existsSync(envFilePath), 'env file should be removed after deploy');
  });

  await t.test('rejects invalid env var names (injection guard)', async () => {
    const { execFn } = recorder({});
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', env: { 'BAD NAME': 'x' }, execFn });
    await assert.rejects(() => d.deployBranch('main'), /Invalid env var name/);
  });

  await t.test('honours constructor overrides over defaults', async () => {
    const { calls, execFn } = recorder({});
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', region: 'europe-west1', memory: '256Mi', maxInstances: 2, execFn });
    await d.deployBranch('feature', 'sha');
    const deployCmd = calls.find(c => c.includes('run deploy'))!;
    assert.match(deployCmd, /--region europe-west1/);
    assert.match(deployCmd, /--memory=256Mi/);
    assert.match(deployCmd, /--max-instances=2/);
  });

  await t.test('throws when no URL is returned', async () => {
    const { execFn } = recorder({ deploy: { status: {} } });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await assert.rejects(() => d.deployBranch('main'), /no URL was returned/);
  });

  await t.test('propagates a deploy failure', async () => {
    const { execFn } = recorder({ reject: /run deploy/ });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await assert.rejects(() => d.deployBranch('main'), /gcloud failed/);
  });

  await t.test('rejects unsafe config values (injection guard)', async () => {
    const { execFn } = recorder({});
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', region: 'us; rm -rf /', execFn });
    await assert.rejects(() => d.deployBranch('main'), /Unsafe region value/);
  });
});

test('GcpCloudRunDeployer.teardown', async (t) => {
  await t.test('deletes the service and the container image', async () => {
    const { calls, execFn } = recorder({});
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await d.teardown('dat-ephemeral-deadbeef');
    assert.ok(calls.some(c => c.includes('run services delete dat-ephemeral-deadbeef')));
    assert.ok(calls.some(c => c.includes('artifacts docker images delete')));
  });

  await t.test('never throws even if gcloud delete fails', async () => {
    const { execFn } = recorder({ reject: /services delete/ });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await assert.doesNotReject(() => d.teardown('dat-ephemeral-x'));
  });

  await t.test('deletes the image even when the service delete fails (independent steps)', async () => {
    const { calls, execFn } = recorder({ reject: /services delete/ });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await d.teardown('dat-ephemeral-x');
    assert.ok(calls.some(c => c.includes('artifacts docker images delete')), 'image cleanup must still run');
  });

  await t.test('treats an already-gone service as success (idempotent) and still cleans the image', async () => {
    const calls: string[] = [];
    const execFn = async (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes('services delete')) throw new Error('ERROR: Cannot find service [x]. NOT_FOUND');
      return { stdout: '', stderr: '' };
    };
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await assert.doesNotReject(() => d.teardown('dat-ephemeral-x'));
    assert.ok(calls.some(c => c.includes('artifacts docker images delete')));
  });
});

test('GcpCloudRunDeployer teardown robustness', async (t) => {
  await t.test('self-cleans the created service when a post-deploy step throws', async () => {
    // deploy succeeds, but the identity-token step fails (a user account can't mint one) — the
    // service that was already created must be torn down, not leaked.
    const { calls, execFn } = recorder({ reject: /print-identity-token/ });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    await assert.rejects(() => d.deployBranch('main'), /identity token/);
    assert.ok(
      calls.some(c => /run services delete dat-ephemeral-[0-9a-f]{8}/.test(c)),
      'a service created before the failure must be torn down',
    );
    assert.strictEqual(d.activeServiceName, undefined, 'tracked service cleared after self-cleanup');
  });

  await t.test('tracks the active service name on success and clears it after teardown', async () => {
    const { execFn } = recorder({ token: 't' });
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn });
    const dep = await d.deployBranch('main');
    assert.strictEqual(d.activeServiceName, dep.id, 'service name tracked after a successful deploy');
    await d.teardown(dep.id);
    assert.strictEqual(d.activeServiceName, undefined, 'tracked service cleared after teardown');
  });
});

test('GcpCloudRunDeployer auth modes', async (t) => {
  await t.test('default: private (--no-allow-unauthenticated) + mints an identity token', async () => {
    const { calls, execFn } = recorder({ token: 'tok' });
    const dep = await new GcpCloudRunDeployer({ projectId: 'dat-tool', execFn }).deployBranch('main');
    const deployCmd = calls.find(c => c.includes('run deploy'))!;
    assert.match(deployCmd, /--no-allow-unauthenticated/);
    assert.ok(calls.some(c => c.includes('print-identity-token')));
    assert.strictEqual(dep.authToken, 'tok');
  });

  await t.test('allowUnauthenticated: deploys public and skips the identity token', async () => {
    const { calls, execFn } = recorder({});
    const dep = await new GcpCloudRunDeployer({ projectId: 'dat-tool', allowUnauthenticated: true, execFn }).deployBranch('main');
    const deployCmd = calls.find(c => c.includes('run deploy'))!;
    assert.match(deployCmd, /--allow-unauthenticated/);
    assert.ok(!deployCmd.includes('--no-allow-unauthenticated'), 'must not also pass --no-allow-unauthenticated');
    assert.ok(!calls.some(c => c.includes('print-identity-token')), 'no token minted for a public preview');
    assert.strictEqual(dep.authToken, '');
  });
});
