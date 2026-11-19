#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv-waterwave/bin/python ]; then
    python3 -m venv .venv-waterwave
fi
.venv-waterwave/bin/python -c 'import numpy, scipy, PIL, cv2, pyfftw, zlib_ng' 2>/dev/null || .venv-waterwave/bin/python -m pip install -r requirements-waterwave.txt
.venv-waterwave/bin/python scripts/setup-native-gpu.py || true
exec .venv-waterwave/bin/python -m waterwave
