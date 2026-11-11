import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../arms/wm-chat.mjs';
import { parseArgs, planRuns } from '../harness/cli.mjs';
import { boundedRequest, requestSpend, setRequestBudget } from '../harness/native-request.mjs';
import { costFor } from '../harness/lib.mjs';

test('direct Ember preserves the WebMCP chat loop, effort, output cap, and accounting', async t => {
  const options = parseArgs(['--sites', 'nextjs-starter-medusa', '--arms', 'wm-meta-chat']);
  assert.equal(planRuns(options, { OPENROUTER_API_KEY: 'unused' }).runs.length, 0);
  const plan = planRuns(options, { MODEL_API_KEY: 'test-meta' });
  assert.equal(plan.runs[0].method.transport, 'direct');
  assert.equal(plan.runs[0].method.key, 'MODEL_API_KEY');
  assert.throws(() => planRuns({ ...options, transport: 'openrouter' }, {}), /requires direct/);
  const previous = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = 'test-meta';
  t.after(() => { if (previous === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previous; });
  setRequestBudget(1);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.meta.ai/v1/chat/completions');
    assert.equal(init.headers.authorization, 'Bearer test-meta');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'muse-ember-1.0');
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.max_tokens, 16384);
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.provider, undefined);
    assert.equal(body.include, undefined);
    assert.equal(body.max_output_tokens, undefined);
    calls++;
    if (calls === 2) assert(body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'c1'));
    return Response.json({ id: `meta-${calls}`, model: body.model,
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 20 } },
      choices: [{ finish_reason: calls === 1 ? 'tool_calls' : 'stop', message: calls === 1
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } }] }
        : { role: 'assistant', content: 'Final answer: done' } }] });
  });
  const page = { goto: async () => {}, waitForTimeout: async () => {}, waitForFunction: async () => {},
    context: () => ({ addInitScript: async () => {} }), evaluate: async (_fn, input) => input ? { ok: true } : [{ name: 'noop', inputSchema: { type: 'object', properties: {} } }] };
  const result = await run({ task: { prompt: 'Call noop, then finish.' }, capsule: { baseUrl: 'http://localhost/' }, page, model: 'muse-ember-1.0', transport: 'direct' });
  assert.equal(result.failure, ''); assert.equal(result.finalText, 'Final answer: done');
  assert.equal(result.provider, 'Meta'); assert.equal(result.cost_estimated, true);
  assert.deepEqual(result.generation_ids, ['meta-1', 'meta-2']);
  assert.equal(result.cost, 2 * costFor('muse-ember-1.0', { input_tokens: 80, output_tokens: 10, cached_input_tokens: 20 }));
  assert.equal(requestSpend(), result.cost);
  setRequestBudget(0.000001);
  await assert.rejects(boundedRequest({ model: 'muse-ember-1.0', messages: [] }, 'direct', [], 'chat/completions'), /budget would be exceeded/);
  assert.equal(calls, 2);
  setRequestBudget(1);
  await assert.rejects(boundedRequest({ model: 'muse-ember-1.0', messages: ['x'.repeat(200_001)] }, 'direct', [], 'chat/completions'), /short-context/);
  assert.equal(calls, 2);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'wrong', model: 'muse-wonder-1.0', usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  await assert.rejects(boundedRequest({ model: 'muse-ember-1.0', messages: [] }, 'direct', [], 'chat/completions'), /unexpected served Meta model/);
  await assert.rejects(boundedRequest({ model: 'muse-ember-1.0', messages: [] }, 'direct', [], 'chat/completions'), /meter blocked/);
});
