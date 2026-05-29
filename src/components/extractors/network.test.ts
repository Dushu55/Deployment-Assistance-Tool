import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractNetworkResources } from './network.js';

function tmpWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-net-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('extractNetworkResources', async (t) => {
  const dir = tmpWorkspace({
    'main.tf': `
      resource "aws_security_group" "open_ssh" {
        ingress {
          from_port   = 22
          to_port     = 22
          protocol    = "tcp"
          cidr_blocks = ["0.0.0.0/0"]
        }
      }
      resource "aws_security_group" "internal_only" {
        ingress {
          from_port   = 443
          to_port     = 443
          cidr_blocks = ["10.0.0.0/8"]
        }
      }
    `
  });

  const result = extractNetworkResources(dir);
  const nodes = result.nodes;
  fs.rmSync(dir, { recursive: true, force: true });

  await t.test('finds both security groups', () => {
    assert.strictEqual(nodes.length, 2);
  });

  await t.test('flags world-open SSH as a sensitive exposure', () => {
    const ssh = nodes.find(n => (n.attributes.name as string) === 'open_ssh')!;
    assert.strictEqual(ssh.attributes.openToWorld, true);
    assert.deepStrictEqual(ssh.attributes.ingressPorts, [22]);
    assert.strictEqual(ssh.attributes.exposesSensitivePort, true);
  });

  await t.test('does not flag an internal-only group as world-open', () => {
    const internal = nodes.find(n => (n.attributes.name as string) === 'internal_only')!;
    assert.strictEqual(internal.attributes.openToWorld, false);
    assert.strictEqual(internal.attributes.exposesSensitivePort, false);
  });
});
