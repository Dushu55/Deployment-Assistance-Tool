import test from 'node:test';
import assert from 'node:assert';
import { ComponentGraph, ComponentNode } from '../../components/types.js';
import { evaluateComponentGraphLLM } from './llm.js';

function graphOf(nodes: ComponentNode[]): ComponentGraph {
  return { schemaVersion: '1.0', generatedAt: 'T', ecosystem: { frontend: [], backend: [], iac: [] }, nodes, edges: [], coverage: [] };
}
const ep = (id: string): ComponentNode => ({ id, kind: 'ApiEndpoint', label: `EP ${id}`, location: { file: 's.ts', line: 3 }, attributes: { method: 'POST', isStateChanging: true, hasAuthMiddleware: true } });

// Build an injected promptFn that returns a canned model response.
const promptReturning = (json: string) => async () => json;

test('evaluateComponentGraphLLM guards', async (t) => {
  const graph = graphOf([ep('ApiEndpoint:s.ts:3:0')]);

  await t.test('drops findings without evidence or with unknown componentId', async () => {
    const resp = JSON.stringify([
      { componentId: 'ApiEndpoint:s.ts:3:0', title: 'No evidence', severity: 'HIGH', category: 'security', rationale: 'x', confidence: 'high' }, // no evidence -> drop
      { componentId: 'does-not-exist', title: 'Bad id', severity: 'HIGH', category: 'security', rationale: 'x', evidence: 'y', confidence: 'high' }, // unknown id -> drop
      { componentId: 'ApiEndpoint:s.ts:3:0', title: 'Valid', severity: 'HIGH', category: 'coherence', rationale: 'no rate limiting', evidence: 'attributes.method=POST', confidence: 'high' }
    ]);
    const issues = await evaluateComponentGraphLLM(graph, [], { promptFn: promptReturning(resp) });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].category, 'coherence');
    assert.strictEqual(issues[0].file, 's.ts');
    assert.strictEqual(issues[0].line, 3);
    assert.strictEqual(issues[0].source, 'Component Evaluator (LLM)');
  });

  await t.test('advisory posture: HIGH is capped to MEDIUM (high conf) / LOW (low conf)', async () => {
    const high = await evaluateComponentGraphLLM(graph, [], { promptFn: promptReturning(
      JSON.stringify([{ componentId: 'ApiEndpoint:s.ts:3:0', title: 't', severity: 'HIGH', category: 'security', rationale: 'r', evidence: 'e', confidence: 'high' }])) });
    assert.strictEqual(high[0].severity, 'MEDIUM');

    const low = await evaluateComponentGraphLLM(graph, [], { promptFn: promptReturning(
      JSON.stringify([{ componentId: 'ApiEndpoint:s.ts:3:0', title: 't', severity: 'HIGH', category: 'security', rationale: 'r', evidence: 'e', confidence: 'low' }])) });
    assert.strictEqual(low[0].severity, 'LOW');
  });

  await t.test('allowBlocking lifts the cap (HIGH stays HIGH)', async () => {
    const issues = await evaluateComponentGraphLLM(graph, [], { allowBlocking: true, promptFn: promptReturning(
      JSON.stringify([{ componentId: 'ApiEndpoint:s.ts:3:0', title: 't', severity: 'HIGH', category: 'security', rationale: 'r', evidence: 'e', confidence: 'high' }])) });
    assert.strictEqual(issues[0].severity, 'HIGH');
  });

  await t.test('invalid category falls back to robustness', async () => {
    const issues = await evaluateComponentGraphLLM(graph, [], { promptFn: promptReturning(
      JSON.stringify([{ componentId: 'ApiEndpoint:s.ts:3:0', title: 't', severity: 'LOW', category: 'made-up', rationale: 'r', evidence: 'e', confidence: 'high' }])) });
    assert.strictEqual(issues[0].category, 'robustness');
  });

  await t.test('non-JSON / empty response -> [] (never throws)', async () => {
    assert.deepStrictEqual(await evaluateComponentGraphLLM(graph, [], { promptFn: promptReturning('the model rambled') }), []);
    assert.deepStrictEqual(await evaluateComponentGraphLLM(graph, [], { promptFn: async () => { throw new Error('network'); } }), []);
  });

  await t.test('maxComponents caps what is sent', async () => {
    const many = graphOf(Array.from({ length: 30 }, (_, i) => ep(`ApiEndpoint:s.ts:${i}:${i}`)));
    let received: any;
    const capture = async (p: string) => {
      received = JSON.parse(p.split('COMPONENTS AND EXISTING FINDINGS:\n')[1]);
      return '[]';
    };
    await evaluateComponentGraphLLM(many, [], { promptFn: capture, maxComponents: 5 });
    assert.strictEqual(received.components.length, 5);
  });
});
