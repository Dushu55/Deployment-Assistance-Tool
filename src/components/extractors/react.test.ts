import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractReactComponents } from './react.js';

function tmpWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-react-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('extractReactComponents', async (t) => {
  const dir = tmpWorkspace({
    'src/LoginForm.tsx': `
      export function LoginForm() {
        const submit = async () => {
          try {
            const res = await fetch('/api/login', { method: 'POST', headers: { Authorization: 'Bearer x' } });
          } catch (e) {}
        };
        const load = () => axios.get('/api/profile');
        return (
          <form onSubmit={submit}>
            <input name="email" type="email" required maxLength={120} onChange={e=>{}} />
            <input name="raw" />
            <button type="submit" disabled={busy} onClick={submit}>Login</button>
            <button>Plain</button>
          </form>
        );
      }
    `
  });

  const result = extractReactComponents(dir);
  const byKind = (k: string) => result.nodes.filter(n => n.kind === k);
  fs.rmSync(dir, { recursive: true, force: true });

  await t.test('finds forms, inputs and buttons', () => {
    assert.strictEqual(byKind('Form').length, 1);
    assert.strictEqual(byKind('Input').length, 2);
    assert.strictEqual(byKind('Button').length, 2);
  });

  await t.test('captures form onSubmit', () => {
    assert.strictEqual(byKind('Form')[0].attributes.hasOnSubmit, true);
  });

  await t.test('captures input validation attributes', () => {
    const email = byKind('Input').find(n => n.label.includes('email'));
    assert.ok(email);
    assert.strictEqual((email!.attributes.validation as any).required, true);
    assert.strictEqual((email!.attributes.validation as any).maxLength, true);
    const raw = byKind('Input').find(n => n.label.includes('raw'));
    assert.strictEqual((raw!.attributes.validation as any).required, false);
  });

  await t.test('captures button fail-safe attributes', () => {
    const submit = byKind('Button').find(n => n.attributes.isSubmit);
    assert.ok(submit);
    assert.strictEqual(submit!.attributes.hasOnClick, true);
    assert.strictEqual(submit!.attributes.disabledControlled, true);
    const plain = byKind('Button').find(n => !n.attributes.isSubmit);
    assert.strictEqual(plain!.attributes.hasOnClick, false);
  });

  await t.test('captures fetch + axios API calls with robustness attributes', () => {
    const calls = byKind('ApiCall');
    assert.strictEqual(calls.length, 2);
    const login = calls.find(n => (n.attributes.url as string) === '/api/login');
    assert.ok(login);
    assert.strictEqual(login!.attributes.method, 'POST');
    assert.strictEqual(login!.attributes.hasAuthHeader, true);
    assert.strictEqual(login!.attributes.hasErrorHandling, true); // wrapped in try{}
    const profile = calls.find(n => (n.attributes.url as string) === '/api/profile');
    assert.strictEqual(profile!.attributes.method, 'GET');
  });

  await t.test('same-origin relative calls are marked cookie-authenticated', () => {
    const calls = byKind('ApiCall');
    assert.strictEqual(calls.find(n => (n.attributes.url as string) === '/api/login')!.attributes.hasCookieAuth, true);
    assert.strictEqual(calls.find(n => (n.attributes.url as string) === '/api/profile')!.attributes.hasCookieAuth, true);
  });
});
