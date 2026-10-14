import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyQuote, QUOTE_KEY, QUOTE_TTL, QUOTE_API } from '../src/quote.mjs';
function setup(initial) {
  const data = new Map(initial ? [[QUOTE_KEY, JSON.stringify(initial)]] : []);
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  let clock = 1700000000000;
  let calls = 0;
  let fail = false;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, QUOTE_API);
    assert.equal(options.cache, 'no-store');
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ hitokoto: `每日句子 ${calls}`, from_who: '作者', from: '出处' }) };
  };
  const options = { storage, fetcher, now: () => clock };
  return { options, data, client: createDailyQuote(options), advance: ms => { clock += ms; }, fail: () => { fail = true; }, get calls() { return calls; } };
}
test('fetch once, restore across page instances, refresh at exactly 24 hours', async () => {
  const env = setup();
  const first = await env.client.refresh();
  assert.deepEqual(first, { text: '每日句子 1', author: '作者', source: '出处' });
  const reopened = createDailyQuote(env.options);
  assert.deepEqual(reopened.getCached(), first);
  env.advance(QUOTE_TTL - 1);
  assert.deepEqual(await reopened.refresh(), first);
  assert.equal(env.calls, 1);
  assert.equal(reopened.getNextRefreshDelay(), 1);
  env.advance(1);
  assert.equal((await reopened.refresh()).text, '每日句子 2');
  assert.equal(env.calls, 2);
});
test('concurrent refreshes share a request', async () => {
  const env = setup();
  await Promise.all([env.client.refresh(), env.client.refresh(), env.client.refresh()]);
  assert.equal(env.calls, 1);
});
test('offline keeps stale quote and does not repeatedly request on reload', async () => {
  const env = setup();
  const first = await env.client.refresh();
  env.advance(QUOTE_TTL);
  env.fail();
  assert.deepEqual(await env.client.refresh(), first);
  const reopened = createDailyQuote(env.options);
  assert.deepEqual(await reopened.refresh(), first);
  assert.equal(env.calls, 2);
});
test('initial failure retains HTML fallback for the daily interval', async () => {
  const env = setup();
  env.fail();
  assert.equal(await env.client.refresh(), null);
  assert.equal(await createDailyQuote(env.options).refresh(), null);
  assert.equal(env.calls, 1);
});
test('denied storage falls back to memory and still obeys interval in this tab', async () => {
  const env = setup();
  const client = createDailyQuote({ ...env.options, storage: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } } });
  await client.refresh();
  await client.refresh();
  assert.equal(env.calls, 1);
  assert.equal(client.getCached().text, '每日句子 1');
});
test('corrupt or future-dated cache does not suppress a new fetch', async () => {
  const env = setup();
  env.data.set(QUOTE_KEY, '{invalid');
  await env.client.refresh();
  assert.equal(env.calls, 1);
  env.data.set(QUOTE_KEY, JSON.stringify({ attemptedAt: 1900000000000, quote: null }));
  await env.client.refresh();
  assert.equal(env.calls, 2);
});
test('invalid response cannot replace the last valid sentence', async () => {
  const env = setup();
  await env.client.refresh();
  env.advance(QUOTE_TTL);
  const invalid = createDailyQuote({ ...env.options, fetcher: async () => ({ ok: true, json: async () => ({ hitokoto: null }) }) });
  assert.equal((await invalid.refresh()).text, '每日句子 1');
});
