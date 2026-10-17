# Kotokowa Webtools

A small static toolbox, published at https://kotokowa.github.io/webtools/.

- **NFC decoder:** restores a 64×40 character avatar, two colors, message and
  website from an 8A v2/v3 URL fragment. Payloads stay in the fragment and are
  decoded in the browser. No analytics, remote libraries or personal fixtures.
- **Text encoders:** UTF-8 Base64, URL component encoding and hexadecimal.
- **Offline backup:** download `nfc-offline.html`; it bundles the complete
  decoder and works without a server when a saved card URL is pasted into it.

## Develop and publish

Node.js 22+, no npm packages needed:

```sh
npm test
npm run build
```

Serve `dist/` with any static server or open its HTML files locally. GitHub
Settings → Pages → Source must be **GitHub Actions**. Pushes to `main` test,
build and deploy through `.github/workflows/pages.yml`.

Add a tool entry to `TOOLS` in `src/app.js` and implement its mount function.
Use `?tool=id` for tool routes. Keep the bare root `#payload` route and the
existing v2/v3 decoders backward compatible: physical cards cannot be updated
when the website changes. The build produces standalone HTML without runtime
dependencies. Keep source modules separate and add new assets to the build
script as the site grows.

## Encode an NFC card (local CLI)

See [format specification](docs/nfc-format.md). This is a custom payload
format, carried by a standard NDEF HTTPS URI record; it is not a general
HTML-in-NFC viewer.

```sh
python scripts/make-payload.py PRIVATE-content.json PRIVATE-payload.raw
node scripts/pack.cjs PRIVATE-payload.raw https://kotokowa.github.io/webtools/ PRIVATE-card
```

Input JSON fields: `rows` (40 rows, each 64 spaces/`8`), `foreground` and
`accent` (`#RRGGBB`), `accentBase64` (8 mask bytes, fixed region x28/y1/8×8),
`message`, `url` (HTTPS host/path). Save personal files **outside this repo**.
The packer produces a URL text file, raw NDEF record, and `-tlv.bin` for
Proxmark3. It refuses output above the 720-byte Classic 1K NDEF data area.

Always check the deployed viewer and exact final URL before formatting a card.
MIFARE Classic support varies by phone; formatting a CUID card does not turn
it into an NTAG chip. Normal tap behavior may require unlocking the phone
and confirming an NFC notification. No host or memory medium lasts forever.

The source and offline decoder contain no card-owner message or avatar.
The shared card link itself contains all that data and is not encrypted.

## Third-party code

The bundled Brotli decoder is Google MIT-licensed code, obtained from
`arfct/itty-bitty`. See `src/vendor/LICENSE-brotli.txt`; the build removes its
module export and applies a 4096-byte decompressed-output cap. The remaining
project code is MIT-licensed; see LICENSE.
