/* A tiny static-shell and favicon cache. No proxy, analytics or backend. */
const VERSION = 'c9554dffcea9';
const SHELL = 'quiet-tab-shell-' + VERSION;
const ICONS = 'quiet-tab-icons-v1';
const FAILURES = 'quiet-tab-icon-failures-v1';
const ROOT = new URL('./', self.location.href);
const ASSETS = ['index.html', 'styles.css?v=' + VERSION, 'app.js?v=' + VERSION, 'favicon.svg'].map(path => new URL(path, ROOT).href);
const ALLOWED_ICONS = new Set(["https://chatgpt.com/favicon.ico", "https://ng.117823.xyz/favicon.ico", "https://notes.zhiim.eu.org/favicon.ico", "https://rss.zhiim.eu.org/favicon.ico", "https://zb.zhiim.eu.org/favicon.ico", "https://zhiim.eu.org/favicon.ico"]);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('quiet-tab-shell-') && key !== SHELL).map(key => caches.delete(key)));
    // Remove stale icons after a deployment changes YAML; bound cache growth.
    for (const name of [ICONS, FAILURES]) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      await Promise.all(requests.filter(req => !ALLOWED_ICONS.has(req.url)).map(req => cache.delete(req)));
    }
    await self.clients.claim();
  })());
});
async function iconResponse(src) {
  if (!ALLOWED_ICONS.has(src)) return new Response('', { status: 404 });
  let cache;
  try {
    cache = await caches.open(ICONS);
    const cached = await cache.match(src);
    if (cached) return cached;
    const failures = await caches.open(FAILURES);
    const failed = await failures.match(src);
    if (failed && Date.now() - Number(await failed.text()) < 86400000) return new Response('', { status: 404 });
  } catch { /* Storage disabled or quota exceeded: keep network icons usable. */ }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(src, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (response.type === 'opaque' || response.ok) {
      try { await cache?.put(src, response.clone()); } catch { /* HTTP cache still works. */ }
      return response;
    }
  } catch { /* Image error handler leaves the letter placeholder in place. */ }
  finally { clearTimeout(timeout); }
  return new Response('', { status: 404 });
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  if (url.pathname === new URL('__icon', ROOT).pathname) {
    // An opaque cross-origin response may only answer a no-cors image request.
    if (request.destination === 'image' && request.mode === 'no-cors') event.respondWith(iconResponse(url.searchParams.get('src')));
    return;
  }
  if (request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === new URL('index.html', ROOT).pathname)) {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match(new URL('index.html', ROOT).href)) || new Response('Offline', { status: 503 }); }
    })());
  } else if (ASSETS.includes(request.url)) {
    event.respondWith((async () => {
      try { const cached = await caches.match(request); if (cached) return cached; } catch { /* disabled storage */ }
      return fetch(request);
    })());
  }
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'icon-failed' || !ALLOWED_ICONS.has(event.data.url)) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(ICONS);
      await cache.delete(event.data.url);
      const failures = await caches.open(FAILURES);
      await failures.put(event.data.url, new Response(String(Date.now())));
    } catch { /* Cache is optional when browser storage is restricted. */ }
  })());
});
