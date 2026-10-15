import unittest
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from html.parser import HTMLParser
from unittest.mock import patch
import shutil
import build
from build import read_shortcuts

class ConfigTest(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'shortcuts.yaml'
            path.write_text(text, encoding='utf-8')
            return read_shortcuts(path)
    def test_yaml_and_origin(self):
        items = self.read('shortcuts:\n  - name: "文档 & 资料"\n    url: https://example.org:8443/docs?q=a\n  - name: Custom\n    url: https://example.net\n    icon: https://cdn.example.net/logo.png\n')
        self.assertEqual(items[0]['icon'], 'https://example.org:8443/favicon.ico')
        self.assertEqual(items[1]['icon'], 'https://cdn.example.net/logo.png')
    def test_invalid_urls_and_schema(self):
        for field in ['url', 'icon']:
            for bad in ['javascript:alert(1)', 'data:image/svg+xml,x', 'https://u:p@example.com', 'https://example.com:99999', 'https://ex ample.com', 123]:
                with self.subTest(field=field, bad=bad):
                    import yaml
                    item = {'name': 'Test', 'url': 'https://example.com', field: bad}
                    with self.assertRaises(ValueError): self.read(yaml.safe_dump({'shortcuts':[item]}))
        for text in ['shortcuts: nope', 'shortcuts:\n - name: A', 'shortcuts: []\nunknown: true', 'shortcuts:\n - name: ""\n   url: https://example.com']:
            with self.assertRaises(ValueError): self.read(text)
    def test_shortcuts_open_in_new_tabs(self):
        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.shortcuts = []
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'a' and attrs.get('class') == 'shortcut':
                    self.shortcuts.append(attrs)

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(build.ROOT / 'src', root / 'src')
            (root / 'shortcuts.yaml').write_text('shortcuts:\n - name: Test\n   url: https://example.com\n', encoding='utf-8')
            with patch.object(build, 'ROOT', root):
                build.build()
            parser = Links()
            parser.feed((root / 'dist' / 'index.html').read_text(encoding='utf-8'))
            self.assertEqual(len(parser.shortcuts), 1)
            link = parser.shortcuts[0]
            self.assertEqual(link['href'], 'https://example.com')
            self.assertEqual(link['target'], '_blank')
            self.assertEqual(set(link['rel'].split()), {'noopener', 'noreferrer'})
            self.assertIn('新标签页', link['aria-label'])

    def test_empty_list_allowed(self):
        self.assertEqual(self.read('shortcuts: []'), [])

if __name__ == '__main__': unittest.main()
