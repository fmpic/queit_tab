#!/usr/bin/env python3
"""YAML -> pre-rendered static site. Only deployment tooling needs PyYAML."""
from pathlib import Path
from urllib.parse import urlsplit
import hashlib
import html
import json
import shutil
import sys
import yaml

ROOT = Path(__file__).resolve().parent

def web_url(value, field):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError(f'{field} 必须是有效的 HTTP(S) URL')
    parts = urlsplit(value)
    if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password or any(c.isspace() for c in value):
        raise ValueError(f'{field} 必须是无用户名密码的 HTTP(S) URL: {value!r}')
    _ = parts.port  # Validate malformed/out-of-range ports, too.
    return value

def read_shortcuts(path):
    data = yaml.safe_load(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or set(data) != {'shortcuts'} or not isinstance(data['shortcuts'], list):
        raise ValueError('配置应仅包含 shortcuts 列表')
    if not 0 <= len(data['shortcuts']) <= 48:
        raise ValueError('shortcuts 最多支持 48 项')
    result = []
    for i, item in enumerate(data['shortcuts'], 1):
        if not isinstance(item, dict) or not {'name', 'url'} <= set(item) or set(item) - {'name', 'url', 'icon'}:
            raise ValueError(f'第 {i} 项应包含 name、url，和可选 icon')
        name = item['name']
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise ValueError(f'第 {i} 项 name 必须是 1～80 字符的非空字符串')
        url = web_url(item['url'], f'第 {i} 项 url')
        parts = urlsplit(url)
        origin = f'{parts.scheme}://{parts.netloc}'
        icon = web_url(item.get('icon', origin + '/favicon.ico'), f'第 {i} 项 icon')
        result.append({'name': name.strip(), 'url': url, 'icon': icon, 'domain': parts.hostname.removeprefix('www.')})
    return result

def build():
    shortcuts = read_shortcuts(ROOT / 'shortcuts.yaml')
    source = ROOT / 'src'
    content = {p.name: p.read_text(encoding='utf-8') for p in source.iterdir() if p.is_file()}
    version = hashlib.sha256((json.dumps(shortcuts, ensure_ascii=False, sort_keys=True) + ''.join(content[k] for k in sorted(content))).encode()).hexdigest()[:12]
    out = ROOT / 'dist'
    if out.exists(): shutil.rmtree(out)
    out.mkdir()
    esc = lambda value: html.escape(value, quote=True)
    cards = []
    for item in shortcuts:
        cards.append(f'<a class="shortcut" href="{esc(item["url"])}" data-icon="{esc(item["icon"])}" aria-label="打开 {esc(item["name"])}" rel="noreferrer"><span class="shortcut-icon" aria-hidden="true"><span class="shortcut-letter">{esc(item["name"][0].upper())}</span></span><span class="shortcut-name">{esc(item["name"])}</span><span class="shortcut-domain">{esc(item["domain"])}</span></a>')
    page = content['index.html'].replace('@@SHORTCUTS@@', '\n'.join(cards)).replace('@@VERSION@@', version)
    if not shortcuts:
        page = page.replace('class="shortcuts-section"', 'class="shortcuts-section" hidden')
    (out / 'index.html').write_text(page, encoding='utf-8')
    # Bundle local modules without shipping a bundler or runtime dependency.
    modules = ['search.mjs', 'quote.mjs', 'layout.mjs', 'app.mjs']
    app = '\n'.join('\n'.join(line for line in content[file].splitlines() if not line.startswith('import ')).replace('export ', '') for file in modules)
    (out / 'app.js').write_text(app, encoding='utf-8')
    icons = sorted(set(item['icon'] for item in shortcuts))
    worker = content['sw.js'].replace('@@VERSION@@', version).replace('@@ICONS@@', json.dumps(icons, ensure_ascii=False))
    (out / 'sw.js').write_text(worker, encoding='utf-8')
    for file in ['styles.css', 'favicon.svg']:
        (out / file).write_text(content[file], encoding='utf-8')
    total = sum(p.stat().st_size for p in out.iterdir())
    print(f'生成 dist/：{len(shortcuts)} 个快捷方式，{total:,} bytes（未压缩，不含远端图标），版本 {version}')
    return version

if __name__ == '__main__':
    try: build()
    except (ValueError, yaml.YAMLError) as exc:
        print(f'配置错误：{exc}', file=sys.stderr)
        sys.exit(1)
