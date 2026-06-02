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
    const d = new GcpCloudRunDeployer({ projectId: 'dat-tool', databaseUrl: url, env: { NEXTAUTH_SECRET: 'abc' }, execFn });
    await d.deployBranch('main');
    // Value is JSON-quoted in YAML, so special chars survive intact.
    assert.match(envFileContent, /DATABASE_URL: "postgres:\/\/u:p@h:5432\/db\?sslmode=require&x=1"/);
    assert.match(envFileContent, /NEXTAUTH_SECRET: "abc"/);
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
});
