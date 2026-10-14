import { ENGINES, parseSearch, searchURL } from './search.mjs';
import { createDailyQuote, QUOTE_KEY } from './quote.mjs';
import { installViewportFit } from './layout.mjs';
const form = document.querySelector('#search-form');
const query = document.querySelector('#query');
const toggle = document.querySelector('#engine-toggle');
const menu = document.querySelector('#engine-menu');
const mark = document.querySelector('#engine-mark');
installViewportFit(document.querySelector('main'));
let selected = 'google';
function updateEngine() {
  const { engine } = parseSearch(query.value, selected);
  mark.textContent = ENGINES[engine].letter;
  mark.dataset.engine = engine;
  toggle.setAttribute('aria-label', `选择搜索引擎，当前 ${ENGINES[engine].name}`);
  query.placeholder = `用 ${ENGINES[engine].name} 搜索`;
  menu.querySelectorAll('[role=menuitemradio]').forEach(item => item.setAttribute('aria-checked', String(item.dataset.engine === engine)));
}
function setMenu(open) {
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) {
    const bounds = toggle.getBoundingClientRect();
    const scale = Number(getComputedStyle(document.querySelector('main')).getPropertyValue('--page-scale')) || 1;
    const below = innerHeight - bounds.bottom - 16;
    const above = bounds.top - 16;
    const up = below < 180 && above > below;
    menu.classList.toggle('menu-above', up);
    menu.style.maxHeight = `${Math.max(44, Math.min(260, (up ? above : below) / scale - 12))}px`;
  }
}
query.addEventListener('input', updateEngine);
form.addEventListener('submit', event => {
  event.preventDefault();
  const url = searchURL(query.value, selected);
  if (url) location.assign(url);
  else { query.focus(); query.setCustomValidity('请在搜索指令后输入关键词。'); query.reportValidity(); }
});
query.addEventListener('input', () => query.setCustomValidity(''));
toggle.addEventListener('click', () => setMenu(menu.hidden));
toggle.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); setMenu(true);
    const options = [...menu.querySelectorAll('button')];
    options[event.key === 'ArrowUp' ? options.length - 1 : 0].focus();
  }
});
menu.addEventListener('keydown', event => {
  const options = [...menu.querySelectorAll('button')];
  const index = options.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  } else if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); setMenu(false); toggle.focus();
  }
});
menu.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
  const parsed = parseSearch(query.value, selected);
  selected = button.dataset.engine;
  query.value = parsed.query;
  query.setCustomValidity('');
  setMenu(false); updateEngine(); query.focus();
}));
document.addEventListener('click', event => {
  if (!event.target.closest('.engine-control')) setMenu(false);
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.engine-control')) setMenu(false);
});
document.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable);
  if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); query.focus();
  } else if (event.key === 'Escape') {
    if (!menu.hidden) { setMenu(false); toggle.focus(); }
    else query.blur();
  }
});
// Icons never delay the shell or the search box. Cache API is owned by the worker.
function loadIcons(controlled) {
  document.querySelectorAll('[data-icon]').forEach(link => {
    const remote = link.dataset.icon;
    const source = new URL(remote);
    if (location.protocol === 'https:' && source.protocol === 'http:') return;
    const img = document.createElement('img');
    img.alt = ''; img.width = 25; img.height = 25;
    img.decoding = 'async'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.hidden = true;
    img.addEventListener('load', () => { img.hidden = false; img.dataset.loaded = ''; }, { once: true });
    img.addEventListener('error', () => {
      img.remove();
      if (controlled) navigator.serviceWorker.controller?.postMessage({ type: 'icon-failed', url: remote });
    }, { once: true });
    if (controlled) {
      const local = new URL('./__icon', location.href);
      local.searchParams.set('src', remote);
      img.src = local.href;
    } else img.src = remote;
    link.querySelector('.shortcut-icon').append(img);
  });
}
async function initIcons() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { loadIcons(false); return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    if (!navigator.serviceWorker.controller) {
      let listener;
      let timer;
      await Promise.race([
        new Promise(resolve => {
          listener = () => { if (navigator.serviceWorker.controller) resolve(); };
          navigator.serviceWorker.addEventListener('controllerchange', listener);
          listener();
        }),
        new Promise(resolve => { timer = setTimeout(resolve, 2500); })
      ]);
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', listener);
    }
    loadIcons(!!navigator.serviceWorker.controller);
    // Keep registration referenced until icon startup is complete.
    void registration;
  } catch { loadIcons(false); }
}
initIcons();

// Restore instantly; fetching the daily quote never blocks search or icons.
const quoteHeading = document.querySelector('#daily-quote');
const quoteSource = document.querySelector('#quote-source');
let quoteStorage;
try { quoteStorage = window.localStorage; } catch { /* private/restricted storage */ }
const dailyQuote = createDailyQuote({ storage: quoteStorage });
function renderQuote(quote) {
  if (!quote) return;
  quoteHeading.textContent = quote.text;
  const attribution = [quote.author, quote.source ? `《${quote.source}》` : ''].filter(Boolean).join(' · ');
  quoteSource.textContent = attribution ? `— ${attribution}` : '每日一言';
}
renderQuote(dailyQuote.getCached());
let quoteTimer;
async function updateDailyQuote() {
  clearTimeout(quoteTimer);
  try {
    // Serialize same-origin tabs and re-read shared storage inside the lock.
    const refresh = () => dailyQuote.refresh();
    const quote = navigator.locks ? await navigator.locks.request(QUOTE_KEY, refresh).catch(refresh) : await refresh();
    renderQuote(quote);
  } finally {
    quoteTimer = setTimeout(() => {
      if (!document.hidden) void updateDailyQuote();
    }, Math.max(1000, dailyQuote.getNextRefreshDelay()));
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void updateDailyQuote();
});
window.addEventListener('storage', event => {
  if (event.key === QUOTE_KEY) renderQuote(dailyQuote.getCached());
});
void updateDailyQuote();
