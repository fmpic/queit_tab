import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const loader = app.slice(app.indexOf('const iconRequests ='), app.indexOf('async function initIcons('));
const controllerListener = app.slice(app.indexOf("if ('serviceWorker' in navigator && window.isSecureContext) {"), app.indexOf('\n// Restore instantly;'));

function setup({ controlled = false, remote = 'https://example.org/favicon.ico' } = {}) {
  const messages = [];
  const images = [];
  const listeners = new Map();
  const link = {
    dataset: { icon: remote },
    querySelector() { return { append(img) { img.isConnected = true; images.push(img); } }; }
  };
  const serviceWorker = {
    controller: { postMessage(message) { messages.push(message); } },
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  const context = vm.createContext({
    URL,
    window: { isSecureContext: true },
    location: { protocol: 'https:', href: 'https://tab.example/start/' },
    navigator: { serviceWorker },
    document: {
      querySelectorAll() { return [link]; },
      createElement(tag) {
        assert.equal(tag, 'img');
        return {
          dataset: {}, handlers: {}, isConnected: false,
          addEventListener(type, handler) { this.handlers[type] = handler; },
          remove() { this.removed = true; this.isConnected = false; },
          set src(value) {
            // Capture settings at request time, not just after insertion.
            this.request = { url: value, loading: this.loading, hidden: this.hidden };
          }
        };
      }
    }
  });
  vm.runInContext(loader + controllerListener, context);
  context.loadIcons(controlled);
  return {
    context, image: images[0], images, handlers: images[0]?.handlers, messages,
    changeController() {
      const newMessages = [];
      serviceWorker.controller = { postMessage(message) { newMessages.push(message); } };
      listeners.get('controllerchange')();
      return newMessages;
    }
  };
}

test('hidden icons start loading eagerly and become visible only after success', () => {
  const { image, images, handlers } = setup();
  assert.equal(images.length, 1);
  assert.equal(image.request.loading, 'eager');
  assert.equal(image.request.hidden, true);
  assert.equal(image.request.url, 'https://example.org/favicon.ico');
  assert.equal(image.referrerPolicy, 'no-referrer');
  handlers.load();
  assert.equal(image.hidden, false);
  assert.equal(image.dataset.loaded, '');
});

test('controlled icons use the local cache route and report failed images', () => {
  const { image, handlers, messages } = setup({ controlled: true });
  const request = new URL(image.request.url);
  assert.equal(request.origin, 'https://tab.example');
  assert.equal(request.pathname, '/start/__icon');
  assert.equal(request.searchParams.get('src'), 'https://example.org/favicon.ico');
  assert.equal(image.request.loading, 'eager');
  handlers.error();
  assert.equal(image.removed, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'icon-failed');
  assert.equal(messages[0].url, 'https://example.org/favicon.ico');
});

test('uncontrolled failures keep the placeholder without messaging the worker', () => {
  const { image, handlers, messages } = setup();
  handlers.error();
  assert.equal(image.removed, true);
  assert.equal(messages.length, 0);
});

test('HTTPS pages skip insecure icon URLs', () => {
  const { images } = setup({ remote: 'http://example.org/favicon.ico' });
  assert.equal(images.length, 0);
});

test('repeated initialization leaves pending and loaded images alone for the same worker', () => {
  const env = setup({ controlled: true });
  env.context.loadIcons(true);
  assert.equal(env.images.length, 1);
  env.handlers.load();
  env.changeController();
  assert.equal(env.images.length, 1);
  assert.equal(env.image.hidden, false);
});

test('controller changes retry icons rejected by an old worker', () => {
  const env = setup({ controlled: true });
  env.handlers.error();
  const newMessages = env.changeController();
  assert.equal(env.images.length, 2);
  const replacement = env.images[1];
  replacement.handlers.load();
  assert.equal(replacement.hidden, false);
  assert.equal(env.messages.length, 1);
  assert.deepEqual(newMessages, []);
});

test('controller changes replace pending images and ignore stale failure events', () => {
  const env = setup({ controlled: true });
  const newMessages = env.changeController();
  assert.equal(env.images.length, 2);
  assert.equal(env.image.removed, true);
  env.handlers.error();
  env.handlers.load();
  assert.deepEqual(env.messages, []);
  assert.deepEqual(newMessages, []);
  assert.equal(env.images[1].hidden, true);
  env.images[1].handlers.load();
  assert.equal(env.images[1].hidden, false);
});

test('late failures are reported to the worker that served the image, not its replacement', () => {
  const env = setup({ controlled: true });
  const newMessages = [];
  env.context.navigator.serviceWorker.controller = { postMessage(message) { newMessages.push(message); } };
  env.handlers.error();
  assert.equal(env.messages.length, 1);
  assert.deepEqual(newMessages, []);
});

function initSetup({ controlled = false, supported = true, secure = true } = {}) {
  const loaded = [];
  const listeners = new Map();
  const timers = new Map();
  let resolveRegistration, rejectRegistration;
  const registration = new Promise((resolve, reject) => {
    resolveRegistration = resolve;
    rejectRegistration = reject;
  });
  let registrations = 0;
  const serviceWorker = {
    controller: controlled ? {} : null,
    register(path, options) {
      assert.equal(path, './sw.js');
      assert.equal(options.updateViaCache, 'none');
      registrations++;
      return registration;
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      assert.equal(listeners.get(type), listener);
      listeners.delete(type);
    }
  };
  const context = vm.createContext({
    navigator: supported ? { serviceWorker } : {},
    window: { isSecureContext: secure },
    loadIcons(controlled) { loaded.push(controlled); },
    setTimeout(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(app.slice(app.indexOf('async function initIcons('), app.indexOf('\ninitIcons();')), context);
  const started = context.initIcons();
  return { loaded, listeners, timers, serviceWorker, started, resolveRegistration, rejectRegistration,
    get registrations() { return registrations; } };
}

test('cached icons start before the worker registration or update check finishes', async () => {
  const env = initSetup({ controlled: true });
  assert.deepEqual(env.loaded, [true]);
  assert.equal(env.registrations, 1);
  await env.started;
  env.resolveRegistration({});
  assert.equal(env.timers.size, 0);
});

test('failed update checks never duplicate icons or switch away from the active worker', async () => {
  const env = initSetup({ controlled: true });
  env.rejectRegistration(new Error('update server unavailable'));
  await env.started;
  assert.deepEqual(env.loaded, [true]);
});

test('first visit waits for worker control then loads cached-route icons once', async () => {
  const env = initSetup();
  assert.deepEqual(env.loaded, []);
  env.resolveRegistration({});
  // Registration promises cross the VM boundary; let both microtask queues drain.
  await new Promise(setImmediate);
  assert.equal(env.listeners.size, 1);
  env.serviceWorker.controller = {};
  env.listeners.get('controllerchange')();
  await env.started;
  assert.deepEqual(env.loaded, [true]);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('worker activation timeout falls back to direct icons and cleans up listeners', async () => {
  const env = initSetup();
  env.resolveRegistration({});
  await new Promise(setImmediate);
  const timer = [...env.timers.values()][0];
  assert.equal(timer.delay, 2500);
  timer.callback();
  await env.started;
  assert.deepEqual(env.loaded, [false]);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('failed registration, unsupported workers and insecure contexts keep direct icons usable', async () => {
  const failed = initSetup();
  failed.rejectRegistration(new Error('registration failed'));
  await failed.started;
  assert.deepEqual(failed.loaded, [false]);
  for (const options of [{ supported: false }, { secure: false }]) {
    const env = initSetup(options);
    await env.started;
    assert.deepEqual(env.loaded, [false]);
    assert.equal(env.registrations, 0);
  }
});
