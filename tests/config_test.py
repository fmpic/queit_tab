import unittest
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
    def test_empty_list_allowed(self):
        self.assertEqual(self.read('shortcuts: []'), [])

if __name__ == '__main__': unittest.main()
