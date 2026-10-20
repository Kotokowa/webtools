"""Build an 8A v3/v5 payload; Python standard library only. Private input stays local.

python scripts/make-payload.py content.json payload.raw
Input: rows (40 strings of 64 spaces/8), foreground, accent,
accentBase64 (8 bytes, region x28 y1 w8 h8), message, url.
Or v5: palette, rectangular pixels (0 transparent, 1..N colors), message, url.
"""
import argparse
import base64
import json
import struct
from pathlib import Path
from urllib.parse import urlsplit


def build_v3(content):
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


def varint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(kind, value):
    return bytes([kind]) + varint(len(value)) + value


def build_v5(content):
    """Self-describing image. Pixel 0 is transparent; 1..N index RGB palette."""
    pixels = content['pixels']
    height = len(pixels)
    width = len(pixels[0]) if height else 0
    if not (1 <= width <= 128 and 1 <= height <= 128) or any(len(row) != width for row in pixels):
        raise ValueError('Expected rectangular pixel rows, dimensions 1..128')
    palette = content['palette']
    if not 1 <= len(palette) <= 255:
        raise ValueError('Expected 1..255 colors')
    colors = bytearray()
    for color in palette:
        if len(color) != 7 or color[0] != '#':
            raise ValueError('Colors must be #RRGGBB')
        colors.extend(bytes.fromhex(color[1:]))
    glyph = content.get('glyph', '8')
    if len(glyph) != 1 or not 33 <= ord(glyph) <= 126:
        raise ValueError('Glyph must be one visible ASCII character')
    depth = len(palette).bit_length()
    bitmap = bytearray((width * height * depth + 7) // 8)
    bit = 0
    for row in pixels:
        for index in row:
            if type(index) is not int or not 0 <= index <= len(palette):
                raise ValueError('Pixel index outside palette')
            for shift in range(depth - 1, -1, -1):
                bitmap[bit // 8] |= ((index >> shift) & 1) << (7 - bit % 8)
                bit += 1
    result = b'8A\x05' + field(1, varint(width) + varint(height))
    if glyph != '8':
        result += field(2, glyph.encode('ascii'))
    result += field(3, bytes(colors)) + field(4, bytes(bitmap))
    if content.get('message'):
        result += field(5, content['message'].encode('utf-8'))
    if content.get('url'):
        url = content['url']
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or any(ord(c) <= 32 or ord(c) == 127 for c in url):
            raise ValueError('URL must be HTTP(S), without credentials or control characters')
        result += field(6, url.encode('utf-8'))
    if len(result) > 4096:
        raise ValueError('Payload exceeds 4096-byte decoder limit')
    return result


def build(content):
    # Preserve existing command/input behavior for people with v3 source JSON.
    version = content.get('version', 5 if 'pixels' in content else 3)
    if version == 5:
        return build_v5(content)
    if version == 3:
        return build_v3(content)
    raise ValueError('Encoder supports versions 3 and 5')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build legacy v3 or flexible v5 NFC payload')
    parser.add_argument('input')
    parser.add_argument('output')
    args = parser.parse_args()
    payload = build(json.loads(Path(args.input).read_text(encoding='utf-8')))
    Path(args.output).write_bytes(payload)
    print(f'Wrote {len(payload)} bytes')
