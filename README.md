# Kotokowa Webtools

A small static toolbox, published at https://kotokowa.github.io/webtools/.

- **NFC decoder:** restores a 64×40 character avatar, two colors, message and
  website from an 8A v2/v3 URL fragment. Payloads stay in the fragment and are
  decoded in the browser. No analytics, remote libraries or personal fixtures.
- **Text encoders:** UTF-8 Base64, URL component encoding and hexadecimal.
- **Water Wave Lab:** FCD checkerboard surface reconstruction at
  [`water-wave/`](https://kotokowa.github.io/webtools/water-wave/). Import image
  sequences/folders/video, reuse ROI/line/point JSON records, and export
  calibrated relative elevation, images, profiles, spectra and analytic
  amplitude/phase. One Python core runs locally or in a Pyodide worker.
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
when the website changes. The original NFC and text tools produce standalone
HTML without runtime dependencies. Water Wave Lab is a separate static page:
its browser mode downloads Pyodide 0.27.7 plus NumPy/SciPy/Pillow from jsDelivr
on first use. Input images remain on the user's device. The original tools
and offline NFC viewer do not acquire these runtime dependencies.

## Water Wave Lab (Python 3.11+)

Windows: download and extract this repository, then double-click
`launch-water-wave.bat`. It creates an isolated virtual environment on first
use. After installing dependencies, local processing works offline.

```sh
python -m pip install -r requirements-waterwave.txt
python -m waterwave
# Numerical / export tests
python -m unittest discover -s tests -p test_waterwave.py -v
```

The local UI listens only on `http://127.0.0.1:8765/`. For a different port,
use `python -m waterwave --port 8767`. Stop the process with Ctrl+C after
downloading results. Local temporary files can be redirected by setting
`WATERWAVE_TMP` to an existing writable directory.

See [the user guide](src/water-wave/guide.html) for coordinates, calibration,
file formats and limitations. Defaults: 20 mm water, 10 mm acrylic, 1.5 mm
checker squares, plane subtraction. Confirm these values for each experiment.
Quadratic subtraction reproduces the MATLAB new-list background removal but
can remove real long-wavelength structure. Optical u/v are not fluid particle
displacements. A synthetic validation error is not an experimental guarantee.

`waterwave/core.py` contains the numerical library; `session.py` handles
decoding and streaming ZIP exports; `server.py` serves the local GUI and
OpenCV video decoding. `src/water-wave/worker.js` loads the same Python
modules in the browser. Web video is sampled with the supplied constant FPS;
use local mode for AVI or precise video frame extraction. MP4 result export
is local-only. Large image stacks and ZIPs are best processed locally.

No experiment images, measurement results, private paths or credentials are
included in the published source or website.

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

FCD carrier demodulation, phase unwrapping and inverse-gradient algorithms
are adapted from Sander Wildeman's MIT-licensed MATLAB FCD (2017–2018).
See `waterwave/LICENSE-FCD.txt` and the algorithm comments in `core.py`.
