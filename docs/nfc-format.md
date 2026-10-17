# 8A card format — preserve compatibility

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
