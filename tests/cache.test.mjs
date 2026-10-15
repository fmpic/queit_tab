import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup({ storageFails = false, networkFails = false } = {}) {
  const handlers = {};
  const stores = new Map();
  const clock = { now: Date.now() };
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
    URL, Request, Response, Set, AbortController, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return clock.now; } },
    caches: fakeCaches,
    fetch: async (src, opts) => {
      count++;
      if (opts?.mode === 'no-cors') {
        assert.equal(opts.credentials, 'omit');
        if (networkFails) throw new Error('offline');
        return new Response('icon-bytes', { headers: { 'Content-Type': 'image/png' } });
      }
      if (networkFails) throw new Error('offline');
      return new Response('network-shell');
    },
    self: { location: { href: 'https://test.example/tab/sw.js' }, addEventListener(type, listener) { handlers[type] = listener; }, clients: { async claim() {} }, async skipWaiting() {} }
  });
  // Keep cache tests independent of the user's current shortcut configuration.
  const worker = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8')
    .replace('@@VERSION@@', 'test')
    .replace('@@ICONS@@', JSON.stringify([icon]));
  vm.runInContext(worker, context);
  return { context, handlers, stores, clock, get count() { return count; } };
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

function fetchFromWorker(env, path, mode = 'navigate') {
  let result;
  env.handlers.fetch({
    request: { method: 'GET', url: new URL(path, 'https://test.example').href, mode },
    respondWith(value) { result = value; }
  });
  return result;
}

async function seedShell(env, name = 'quiet-tab-shell-test') {
  const cache = await env.context.caches.open(name);
  await cache.put('https://test.example/tab/index.html', new Response('cached-shell'));
  await cache.put('https://test.example/tab/app.js?v=test', new Response('cached-script'));
}

test('repeat navigation serves the current shell without any network wait', async () => {
  const env = setup();
  await seedShell(env);
  for (const path of ['/tab/', '/tab/index.html', '/tab/?from=new-tab']) {
    assert.equal(await (await fetchFromWorker(env, path)).text(), 'cached-shell');
  }
  assert.equal(env.count, 0);
});

test('offline navigation and versioned assets use the installed shell', async () => {
  const env = setup({ networkFails: true });
  await seedShell(env);
  assert.equal(await (await fetchFromWorker(env, '/tab/')).text(), 'cached-shell');
  assert.equal(await (await fetchFromWorker(env, '/tab/app.js?v=test', 'cors')).text(), 'cached-script');
  assert.equal(env.count, 0);
});

test('cache misses and disabled storage fall back to network', async () => {
  for (const options of [{}, { storageFails: true }]) {
    const env = setup(options);
    assert.equal(await (await fetchFromWorker(env, '/tab/')).text(), 'network-shell');
    assert.equal(await (await fetchFromWorker(env, '/tab/app.js?v=test', 'cors')).text(), 'network-shell');
    assert.equal(env.count, 2);
  }
});

test('navigation never falls back to a different shell version', async () => {
  const env = setup();
  await seedShell(env, 'quiet-tab-shell-old');
  assert.equal(await (await fetchFromWorker(env, '/tab/')).text(), 'network-shell');
  assert.equal(await (await fetchFromWorker(env, '/tab/app.js?v=test', 'cors')).text(), 'network-shell');
  assert.equal(env.count, 2);
});

test('offline navigation without a shell returns 503 even if storage is disabled', async () => {
  for (const storageFails of [false, true]) {
    const env = setup({ networkFails: true, storageFails });
    assert.equal((await fetchFromWorker(env, '/tab/')).status, 503);
  }
});

test('unrelated routes are not intercepted', () => {
  const env = setup();
  assert.equal(fetchFromWorker(env, '/other/'), undefined);
  assert.equal(fetchFromWorker(env, '/tab/settings'), undefined);
  assert.equal(fetchFromWorker(env, 'https://other.example/tab/'), undefined);
});

async function reportFailedIcon(env) {
  let pending;
  env.handlers.message({ data: { type: 'icon-failed', url: icon }, waitUntil(value) { pending = value; } });
  await pending;
}

test('reopening tabs does not extend a failed icon cooldown; retry is allowed at 24 hours', async () => {
  const env = setup();
  const firstAttempt = env.clock.now;
  await env.context.iconResponse(icon);
  await reportFailedIcon(env);
  const failures = await env.context.caches.open('quiet-tab-icon-failures-v2');
  for (const hours of [1, 12, 23]) {
    env.clock.now = firstAttempt + hours * 3600000;
    assert.equal((await env.context.iconResponse(icon)).status, 404);
    // The image error is reported even when the worker suppresses its request.
    await reportFailedIcon(env);
    assert.equal(Number(await (await failures.match(icon)).text()), firstAttempt);
    assert.equal(env.count, 1);
  }
  env.clock.now = firstAttempt + 86400000;
  assert.equal((await env.context.iconResponse(icon)).status, 200);
  assert.equal(env.count, 2);
  // A genuinely failed retry starts a new cooldown, not an expired one.
  await reportFailedIcon(env);
  assert.equal(Number(await (await failures.match(icon)).text()), env.clock.now);
});

test('activation clears old sliding cooldowns but retains successfully cached icons', async () => {
  const env = setup();
  await env.context.iconResponse(icon);
  const oldFailures = await env.context.caches.open('quiet-tab-icon-failures-v1');
  await oldFailures.put(icon, new Response(String(env.clock.now)));
  let pending;
  env.handlers.activate({ waitUntil(value) { pending = value; } });
  await pending;
  assert.equal(env.stores.has('quiet-tab-icon-failures-v1'), false);
  assert.equal((await env.context.iconResponse(icon)).status, 200);
  assert.equal(env.count, 1);
});
