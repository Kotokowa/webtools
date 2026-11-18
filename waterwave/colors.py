"""Shared 256-entry color tables; rendering never changes numerical fields."""
import json
from pathlib import Path
import numpy as np

TABLES = json.loads(Path(__file__).with_name('colormaps.json').read_text(encoding='utf-8'))


def color_rgb(values, name='jet'):
    if name not in TABLES:
        raise ValueError('未知色图：'+str(name))
    index = np.minimum((np.clip(values, 0, 1)*256).astype(int), 255)
    return np.asarray(TABLES[name], dtype=np.uint8)[index].copy()
