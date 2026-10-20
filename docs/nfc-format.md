# 8A card format — preserve compatibility

## Compatibility and new cards

Existing **v2 and v3 cards are permanent supported inputs**. Their layouts,
byte order, colors, GB18030 text, mirror transform and URL parsing stay as
documented below. Do not reinterpret their bodies as the new format. A v3
card cannot retroactively describe arbitrary dimensions; the viewer retains
its original layout reader. Its text and URL lengths were already stored.
Version 4 was never published and is reserved; it is not a supported format.

New **v5** cards use tagged, length-delimited fields. This costs some space
but avoids fixed offsets and delimiter collisions in arbitrary binary data.
No physical rewrite is needed for old cards. v5 changes the inner payload;
the same HTTPS/Base81/Brotli/NDEF wrapper and root fragment route are retained.

## Version 5 wire format

Start with ASCII `8A`, then version byte `05`, followed by fields until EOF.
Each field is `type:u8 | length:unsigned-LEB128 | value:length bytes`.
Unsigned LEB128 integers use 7 data bits per byte (least significant group
first), bit 7 means another byte follows. Canonical encoding, at most 3 bytes.
For example 300 = `AC 02`. No separator or end marker is required inside the
payload: the field length unambiguously locates the next field, even when
the value contains marker-like bytes. Fields may be reordered.

| Type | Required | Value |
| --- | --- | --- |
| 1 | yes | Width ULEB128, height ULEB128; no extra bytes |
| 2 | no | Single visible ASCII glyph, default `8` |
| 3 | yes | RGB palette, 3 bytes per color, 1–255 entries |
| 4 | yes | Packed palette indices, row-major, MSB first |
| 5 | no | UTF-8 message, default empty |
| 6 | no | Full UTF-8 HTTP(S) URL; default no link |

Pixel index 0 = transparent/blank, 1..N = palette entry 0..N-1. Bit depth
is `ceil(log2(N+1))`; exactly `ceil(width*height*depth/8)` bytes, final unused
bits must be zero. Dimensions 1–128 on each side. Every index must be in the
palette. Duplicate recognized fields, malformed UTF-8, bad lengths and
inconsistent dimensions are errors. Unknown field types with bit 7 clear
are optional and skipped by declared length; unknown types with bit 7 set
are critical and require an updated decoder. New semantics that invalidate
existing required fields need a new version rather than silently changing v5.

Raw payload cap 4096 bytes, encoded fragment cap 8192 characters. The
Classic 1K packer separately enforces its 720-byte physical NDEF budget.
Adding fields/colors may exceed capacity even though the format supports
them; it never silently truncates content. Personal data stays on the tag.

Example creation (Python stdlib + Node built-ins, no installed dependencies):

```sh
python scripts/make-payload.py examples/nfc-v5.json PRIVATE-payload.raw
node scripts/pack.cjs PRIVATE-payload.raw https://kotokowa.github.io/webtools/ PRIVATE-card
```

The example grid derives its dimensions automatically. Edit `palette`,
`pixels`, `message`, and `url` freely within the limits. Keep real personal
inputs outside the public repo. Old `rows`-based JSON continues to encode v3.

The NDEF record is a well-known URI (`U`), prefix byte `04` (`https://`). Its
fragment contains all personal content; the endpoint serves a generic viewer.
Changing a host or path does not change the payload but increases tag size.
An obsolete host prevents automatic first-time opening; the fragment can
still be decoded by the saved standalone HTML. There is no automatic failover.

## Base81 and compression

Alphabet, exactly 81 symbols:

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&'()*+,;=:@/?
```

Prefix Brotli-compressed bytes with `01`, interpret as a big-endian unsigned
integer, and express it in this base. Reverse the process and remove the
sentinel to decode. All symbols are allowed unescaped in a URI fragment.
The packer uses Brotli generic mode, quality 10, lgwin 16, size hint = raw
length. Decoder output is capped at 4096 bytes. This is compression, not
encryption; there is no cryptographic authenticity or payload checksum.

## Version 3

Fixed canvas 64×40, glyph `8`; green accent region x=28, y=1, width=8, height=8.
The header is 12 bytes:

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 2 | ASCII `8A` |
| 2 | 1 | Version = 3 |
| 3 | 3 | Primary RGB |
| 6 | 3 | Accent RGB |
| 9 | 2 | GB18030 message byte length, little endian |
| 11 | 1 | Website byte length |

Then 320 bitmap bytes, 8 accent-mask bytes, message bytes, ASCII HTTPS website
host/path (scheme omitted). For each bitmap row, store the left 32 bits
big-endian, followed by `right32 XOR reverseBits(left32)` big-endian. Pixels
and the accent mask are MSB first. A mask bit colors only an occupied glyph.
The website is linked with `https://`; message is rendered as text, never HTML.

Version 2 has a 20-byte header: `8A`, version=2, flags=0x31, width=64,
height=40, glyph=56, primaryRGB[3], accentRGB[3], x=28, y=1, w=8, h=8,
messageLengthLE[2], websiteLength. Body layout is identical.

## NDEF and card storage

The packer uses short record/TLV lengths when possible and extended lengths
otherwise. The file `*-tlv.bin` contains `03`, length, NDEF record, then `FE`.
For standard Classic 1K formatting, sector 0 is reserved for MAD; sectors
1–15 provide 720 bytes. The complete TLV must fit within that budget.

No separate second full decoding URL is automatically embedded. Save the
card URL, raw/TLV files, this specification, and standalone HTML as a backup.
The viewer downloads no browser plugins and makes no further network requests.
