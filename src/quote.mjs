export const QUOTE_KEY = 'quiet-tab-daily-quote-v1';
export const QUOTE_TTL = 24 * 60 * 60 * 1000;
export const QUOTE_API = 'https://v1.hitokoto.cn/?encode=json&min_length=6&max_length=28';

function normalizedQuote(data) {
  if (!data || typeof data.hitokoto !== 'string') return null;
  const text = data.hitokoto.trim();
  if (!text || text.length > 200) return null;
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return { text, author: clean(data.from_who), source: clean(data.from) };
}
export function createDailyQuote({ storage, fetcher = globalThis.fetch, now = Date.now } = {}) {
  let memory = null;
  let pending;
  function read() {
    let record = memory;
    try {
      const raw = storage?.getItem(QUOTE_KEY);
      if (raw) record = JSON.parse(raw);
    } catch { /* Corrupt/restricted storage: use this tab's memory. */ }
    if (!record || !Number.isFinite(record.attemptedAt) || record.attemptedAt < 0 || record.attemptedAt > now()) return null;
    let quote = record.quote;
    if (quote && (typeof quote.text !== 'string' || !quote.text.trim() || quote.text.length > 200 || typeof quote.author !== 'string' || typeof quote.source !== 'string')) quote = null;
    return { attemptedAt: record.attemptedAt, quote };
  }
  function save(record) {
    memory = record;
    try { storage?.setItem(QUOTE_KEY, JSON.stringify(record)); } catch { /* quota/privacy */ }
  }
  async function requestQuote() {
    const cached = read();
    if (cached && now() - cached.attemptedAt < QUOTE_TTL) return cached.quote;
    const attemptedAt = now();
    const record = { attemptedAt, quote: cached?.quote || null };
    // Mark the attempt before fetch so another tab or reload won't spam the API.
    save(record);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetcher(QUOTE_API, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error('Quote API unavailable');
      const quote = normalizedQuote(await response.json());
      if (!quote) throw new Error('Invalid quote response');
      record.quote = quote;
      save(record);
    } catch { /* Keep the last sentence or the HTML fallback for 24 hours. */ }
    finally { clearTimeout(timer); }
    return record.quote;
  }
  return {
    getCached: () => read()?.quote || null,
    getNextRefreshDelay: () => {
      const cached = read();
      return cached ? Math.max(0, QUOTE_TTL - (now() - cached.attemptedAt)) : 0;
    },
    refresh: () => {
      if (!pending) pending = requestQuote().finally(() => { pending = null; });
      return pending;
    }
  };
}
