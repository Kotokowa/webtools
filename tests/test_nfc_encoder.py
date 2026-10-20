import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('encoder', Path(__file__).parents[1] / 'scripts/make-payload.py')
encoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(encoder)


class EncoderTests(unittest.TestCase):
    def test_independent_wire_example(self):
        # 3 pixels, two bits each: 01 10 00 => 0x60. Literal TLV fields.
        result = encoder.build({'pixels': [[1, 2, 0]], 'palette': ['#112233', '#445566'], 'message': 'Hi'})
        self.assertEqual(result, bytes.fromhex('38410501020301030611223344556604016005024869'))

    def test_utf8_long_fields_and_extra_color(self):
        content = {'pixels': [[1, 2, 3], [0, 3, 1]], 'palette': ['#112233', '#445566', '#778899'],
                   'message': '你好' * 50, 'url': 'https://example.com/path?q=中文#锚点', 'glyph': '@'}
        result = encoder.build(content)
        self.assertIn(content['message'].encode('utf-8'), result)
        self.assertIn(content['url'].encode('utf-8'), result)
        self.assertIn(b'\x02\x01@', result)
        self.assertIn(b'\x05\xac\x02', result)  # 300 UTF-8 bytes, LEB128 length.

    def test_validation(self):
        for pixels in [[], [[]], [[1], [1, 2]], [[2]], [[True]]]:
            with self.subTest(pixels=pixels), self.assertRaises(ValueError):
                encoder.build({'pixels': pixels, 'palette': ['#112233']})
        with self.assertRaises(ValueError):
            encoder.build({'pixels': [[1]], 'palette': ['#112233'], 'url': 'javascript:alert(1)'})
        with self.assertRaises(ValueError):
            encoder.build({'pixels': [[1]], 'palette': ['#112233'], 'message': 'a' * 4096})


if __name__ == '__main__':
    unittest.main()
