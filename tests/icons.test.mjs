import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const loader = app.slice(app.indexOf('function loadIcons('), app.indexOf('async function initIcons('));

function setup({ controlled = false, remote = 'https://example.org/favicon.ico' } = {}) {
  const handlers = {};
  const messages = [];
  const images = [];
  const image = {
    dataset: {},
    addEventListener(type, handler) { handlers[type] = handler; },
    remove() { this.removed = true; },
    set src(value) {
      // Capture settings at request time, not just after insertion.
      this.request = { url: value, loading: this.loading, hidden: this.hidden };
    }
  };
  const context = vm.createContext({
    URL,
    location: { protocol: 'https:', href: 'https://tab.example/start/' },
    navigator: { serviceWorker: { controller: { postMessage(message) { messages.push(message); } } } },
    document: {
      querySelectorAll() {
        return [{ dataset: { icon: remote }, querySelector() { return { append(img) { images.push(img); } }; } }];
      },
      createElement(tag) { assert.equal(tag, 'img'); return image; }
    }
  });
  vm.runInContext(loader, context);
  context.loadIcons(controlled);
  return { image, images, handlers, messages };
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
