import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, searchURL } from '../src/search.mjs';
test('default Google, whitespace, Chinese and reserved character encoding', () => {
  const url = new URL(searchURL('  推理 a&b + #?  '));
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('q'), '推理 a&b + #?');
  assert.equal(url.hash, '');
});
test('all four engines and aliases select the proper destination and parameter', () => {
  for (const [alias, host, param] of [['g','www.google.com','q'],['b','www.bing.com','q'],['d','duckduckgo.com','q'],['ddg','duckduckgo.com','q'],['bd','www.baidu.com','wd'],['BAIDU','www.baidu.com','wd']]) {
    const url = new URL(searchURL(` !${alias} 测试 / + 中文 `));
    assert.equal(url.hostname, host);
    assert.equal(url.searchParams.get(param), '测试 / + 中文');
  }
});
test('unknown commands stay literal, embedded bangs do not switch engines', () => {
  assert.equal(parseSearch('!unknown cat').query, '!unknown cat');
  assert.equal(parseSearch('learn !b cat').engine, 'google');
  assert.equal(parseSearch('!bcat').engine, 'google');
});
test('explicit command overrides the menu; menu fallback remains valid', () => {
  assert.equal(parseSearch('cat', 'bing').engine, 'bing');
  assert.equal(parseSearch('!d cat', 'bing').engine, 'duckduckgo');
  assert.equal(parseSearch('cat', 'bad').engine, 'google');
});
test('empty query or command alone cannot navigate', () => {
  for (const value of ['', '  ', '!g', '!b ', '!ddg\n', '!bd \t']) assert.equal(searchURL(value), null);
});
