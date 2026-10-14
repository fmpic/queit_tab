export const ENGINES = Object.freeze({
  google: { name: 'Google', letter: 'G', url: 'https://www.google.com/search', aliases: ['g', 'google'] },
  bing: { name: 'Bing', letter: 'b', url: 'https://www.bing.com/search', aliases: ['b', 'bing'] },
  duckduckgo: { name: 'DuckDuckGo', letter: 'D', url: 'https://duckduckgo.com/', aliases: ['d', 'ddg', 'duckduckgo'] },
  baidu: { name: '百度', letter: '度', url: 'https://www.baidu.com/s', aliases: ['bd', 'baidu'] }
});
export function parseSearch(value, fallback = 'google') {
  const text = value.trim();
  const match = /^!([a-z]+)(?:\s+|$)/i.exec(text);
  const engine = match && Object.keys(ENGINES).find(key => ENGINES[key].aliases.includes(match[1].toLowerCase()));
  return { engine: engine || (ENGINES[fallback] ? fallback : 'google'), query: engine ? text.slice(match[0].length).trim() : text, explicit: !!engine };
}
export function searchURL(value, fallback = 'google') {
  const { engine, query } = parseSearch(value, fallback);
  if (!query) return null;
  const url = new URL(ENGINES[engine].url);
  url.searchParams.set(engine === 'baidu' ? 'wd' : 'q', query);
  return url.href;
}
