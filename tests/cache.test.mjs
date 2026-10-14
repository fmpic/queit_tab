import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup({ storageFails = false, networkFails = false } = {}) {
  const handlers = {};
  const stores = new Map();
  let count = 0;
  const fakeCaches = {
    async open(name) {
      if (storageFails) throw new Error('storage disabled');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { return store.get(typeof key === 'string' ? key : key.url)?.clone(); },
        async put(key, value) { store.set(typeof key === 'string' ? key : key.url, value.clone()); },
        async delete(key) { return store.delete(typeof key === 'string' ? key : key.url); },
        async keys() { return [...store.keys()].map(url => ({ url })); },
        async addAll() {}
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = vm.createContext({
    URL, Request, Response, Set, Date, AbortController, setTimeout, clearTimeout,
    caches: fakeCaches,
    fetch: async (src, opts) => {
      count++;
      assert.equal(opts.mode, 'no-cors');
      assert.equal(opts.credentials, 'omit');
      if (networkFails) throw new Error('offline');
      return new Response('icon-bytes', { headers: { 'Content-Type': 'image/png' } });
    },
    self: { location: { href: 'https://test.example/tab/sw.js' }, addEventListener(type, listener) { handlers[type] = listener; }, clients: { async claim() {} }, async skipWaiting() {} }
  });
  vm.runInContext(readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8'), context);
  return { context, handlers, stores, get count() { return count; } };
}
const icon = 'https://github.com/favicon.ico';
test('icon miss fetches once; repeat load returns stored bytes without network', async () => {
  const env = setup();
  assert.equal(await (await env.context.iconResponse(icon)).text(), 'icon-bytes');
  assert.equal(await (await env.context.iconResponse(icon)).text(), 'icon-bytes');
  assert.equal(env.count, 1);
});
test('failed image evicts bad cached data and suppresses repeated requests', async () => {
  const env = setup();
  await env.context.iconResponse(icon);
  let pending;
  env.handlers.message({ data: { type: 'icon-failed', url: icon }, waitUntil(value) { pending = value; } });
  await pending;
  const response = await env.context.iconResponse(icon);
  assert.equal(response.status, 404);
  assert.equal(env.count, 1);
});
test('storage failures do not prevent fetching icons; network failures return fallback', async () => {
  const noStorage = setup({ storageFails: true });
  assert.equal((await noStorage.context.iconResponse(icon)).status, 200);
  const offline = setup({ networkFails: true });
  assert.equal((await offline.context.iconResponse(icon)).status, 404);
});
test('unconfigured sources never trigger network; opaque responses only route to images', async () => {
  const env = setup();
  assert.equal((await env.context.iconResponse('https://evil.example/favicon.ico')).status, 404);
  assert.equal(env.count, 0);
  let caught = false;
  env.handlers.fetch({ request: { method: 'GET', url: 'https://test.example/tab/__icon?src=' + encodeURIComponent(icon), destination: '', mode: 'cors' }, respondWith() { caught = true; } });
  assert.equal(caught, false);
  let result;
  env.handlers.fetch({ request: { method: 'GET', url: 'https://test.example/tab/__icon?src=' + encodeURIComponent(icon), destination: 'image', mode: 'no-cors' }, respondWith(value) { result = value; } });
  assert.equal((await result).status, 200);
});
