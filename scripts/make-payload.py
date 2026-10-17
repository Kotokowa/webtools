"""Build an 8A v3 payload; Python standard library only. Private input stays local.

python scripts/make-payload.py content.json payload.raw
Input: rows (40 strings of 64 spaces/8), foreground, accent,
accentBase64 (8 bytes, region x28 y1 w8 h8), message, url.
"""
import base64
import json
import struct
import sys
from pathlib import Path
from urllib.parse import urlsplit


def build(content):
    rows = content['rows']
    if len(rows) != 40 or any(len(row) != 64 or set(row) - {'8', ' '} for row in rows):
        raise ValueError('Expected 40 rows of 64 spaces/8 characters')
    def color(key):
        value = content[key]
        if len(value) != 7 or value[0] != '#':
            raise ValueError('Colors must be #RRGGBB')
        return bytes.fromhex(value[1:])
    accent = base64.b64decode(content['accentBase64'], validate=True)
    if len(accent) != 8:
        raise ValueError('Accent mask must have exactly 8 bytes')
    message = content['message'].encode('gb18030')
    parsed = urlsplit(content['url'])
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.query or parsed.fragment:
        raise ValueError('Website must be an HTTPS host/path without credentials, query or fragment')
    website = (parsed.netloc + parsed.path).encode('ascii')
    if len(message) > 65535 or len(website) > 255:
        raise ValueError('Message or website too long')
    bitmap = bytearray()
    for row in rows:
        left = int(''.join('1' if c == '8' else '0' for c in row[:32]), 2)
        right = int(''.join('1' if c == '8' else '0' for c in row[32:]), 2)
        reversed_left = int(f'{left:032b}'[::-1], 2)
        bitmap.extend(struct.pack('>II', left, right ^ reversed_left))
    header = b'8A\x03' + color('foreground') + color('accent') + struct.pack('<HB', len(message), len(website))
    result = header + bitmap + accent + message + website
    if len(result) > 4096:
        raise ValueError('Payload exceeds decoder limit')
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python scripts/make-payload.py content.json payload.raw')
    payload = build(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
    Path(sys.argv[2]).write_bytes(payload)
    print(f'Wrote {len(payload)} bytes')
