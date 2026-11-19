"""Disk-backed RMS artifacts; only one experiment is loaded for each operation."""
import base64
import csv
import io
import json
import os
from pathlib import Path
import tempfile
import shutil
import uuid
import zipfile
import numpy as np
from scipy.io import savemat
from .analysis import load_field, average_fields, analyze, clean

fields = {}
artifacts = {}


def save_npz(path, **arrays):
    # Level 1 avoids spending CPU on nearly incompressible floating point noise.
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as out:
        for name, value in arrays.items():
            with out.open(name+'.npy', 'w', force_zip64=True) as stream:
                np.lib.format.write_array(stream, np.asanyarray(value), allow_pickle=False)


def profile_image(values, title, integration_length=None):
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (800, 420), 'white'); draw = ImageDraw.Draw(image)
    t, observed, predicted = values[:, 0], values[:, 3], values[:, 5]
    finite = np.concatenate([observed[np.isfinite(observed)], predicted[np.isfinite(predicted)]])
    lo, hi = (float(finite.min()), float(finite.max())) if len(finite) else (0, 1)
    hi = max(hi, lo+1e-9)
    draw.text((60, 12), title+' | RMS (mm)', fill='black')
    draw.line([(60, 40), (60, 360), (770, 360)], fill='black', width=1)
    draw.text((60, 380), f'{t[0]:.4g} .. {t[-1]:.4g} cm', fill='black')
    draw.text((4, 40), f'{hi:.3g}', fill='black'); draw.text((4, 345), f'{lo:.3g}', fill='black')
    if integration_length is not None:
        for position in (-integration_length/2, integration_length/2):
            px=60+710*(position-t[0])/(t[-1]-t[0])
            if 60 <= px <= 770: draw.line([(px,40),(px,360)],fill='#aaaaaa',width=1)
        draw.text((360,380), f'Integration: {-integration_length/2:g} .. {integration_length/2:g} cm', fill='black')
    for data, color in ((observed, '#157c97'), (predicted, '#c76b29')):
        previous = None
        for xx, yy in zip(t, data):
            if not np.isfinite(yy): previous = None; continue
            point = (60+710*(xx-t[0])/(t[-1]-t[0]), 360-320*(yy-lo)/(hi-lo))
            if previous is not None: draw.line([previous, point], fill=color, width=2)
            previous = point
    draw.text((450, 12), 'Measured', fill='#157c97'); draw.text((570, 12), 'Model', fill='#c76b29')
    return image


def focal_geometry(field, metrics):
    """Exact integration paths, in the physical coordinates used by analyze."""
    opts = metrics['options']
    theta = np.deg2rad(opts.get('theta_deg', np.rad2deg(metrics['theta_rad'])))
    t = np.linspace(0, 2*np.pi, 361)
    u, v = opts['axes_cm'][0]/2*np.cos(t), opts['axes_cm'][1]/2*np.sin(t)
    paths = {}
    for label, center in [('user', metrics['user_center_cm']), ('fit', metrics['center_cm'])]:
        x, y = center
        paths[label] = dict(center_cm=center,
            ellipse_cm=np.column_stack([x+np.cos(theta)*u-np.sin(theta)*v,
                                         y+np.sin(theta)*u+np.cos(theta)*v]).tolist(),
            line_cm=[[x-opts['line_length_cm']/2, y], [x+opts['line_length_cm']/2, y]])
    return dict(coordinates='cm; x right; y down', paths=paths)


def focal_geometry_image(field, geometry, colormap, selection):
    from PIL import ImageDraw
    from .session import field_image
    im = field_image(field['Z'], max(float(np.nanmax(field['Z'])), 1e-9), positive=True,
                     annotate=True, title='RMS (mm) | integration geometry',
                     axes=(field['X_cm']*10, field['Y_cm']*10), colormap=colormap)
    # Work on the plot alone so off-image integration paths cannot overwrite axes.
    plot = im.crop((48, 32, im.width-72, im.height-44))
    draw = ImageDraw.Draw(plot)
    x, y = field['X_cm'], field['Y_cm']
    def points(values):
        return [((a-x[0])/(x[-1]-x[0])*(plot.width-1),
                 (b-y[0])/(y[-1]-y[0])*(plot.height-1)) for a, b in values]
    for label in ('user', 'fit'):
        paths = geometry['paths'][label]
        color = '#eeeeee' if label == 'user' else '#111111'
        if 'area' in selection: draw.line(points(paths['ellipse_cm']), fill=color, width=3)
        if 'line' in selection: draw.line(points(paths['line_cm']), fill=color, width=3)
        cx, cy = points([paths['center_cm']])[0]
        draw.line([(cx-5,cy),(cx+5,cy)], fill=color, width=2)
        draw.line([(cx,cy-5),(cx,cy+5)], fill=color, width=2)
    im.paste(plot, (48, 32))
    ImageDraw.Draw(im).text((48, im.height-33), 'White: selected center | Black: fitted center', fill='#243746')
    return im


def new_path(suffix):
    root = Path(os.environ.get('WATERWAVE_TMP', tempfile.gettempdir()))
    return root / ('waterwave-'+uuid.uuid4().hex+suffix)


def save_field(field):
    path = new_path('.npz')
    save_npz(path, **field)
    key = uuid.uuid4().hex; fields[key] = path
    return key


def read_field(key):
    with np.load(fields[key], allow_pickle=False) as src:
        return dict(src)


def describe(key, colormap=None):
    from .session import field_image, png_bytes
    f = read_field(key)
    limit = max(float(np.nanmax(f['Z'])), 1e-9)
    colormap = colormap or json.loads(str(f.get('config_json', '{}'))).get('colormap', 'jet')
    im = field_image(f['Z'], limit, positive=True, colormap=colormap); im.thumbnail((1100, 850))
    return dict(field=key, shape=list(f['Z'].shape), x_cm=f['X_cm'].tolist(), y_cm=f['Y_cm'].tolist(),
                preview=base64.b64encode(png_bytes(im)).decode(), max_mm=limit)


def write_field_exports(archive, field, exports, prefix='rms', colormap=None):
    from .session import field_image, png_bytes
    colormap = colormap or json.loads(str(field.get('config_json', '{}'))).get('colormap', 'jet')
    if 'rms_npz' in exports:
        with archive.open(prefix+'.npz', 'w', force_zip64=True) as out: np.savez(out, **field)
    if 'rms_mat' in exports:
        out = io.BytesIO(); mat = dict(field)
        mat['X_cm'], mat['Y_cm'] = np.meshgrid(field['X_cm'], field['Y_cm'])
        savemat(out, mat, do_compression=True)
        archive.writestr(prefix+'.mat', out.getvalue())
    if 'rms_csv' in exports:
        for key in ('Z', 'dZ', 'valid', 'X_cm', 'Y_cm'):
            out = io.StringIO(); np.savetxt(out, field[key], delimiter=',')
            archive.writestr(prefix+'_'+key+'.csv', out.getvalue())
    if 'rms_png' in exports:
        for key in ('Z', 'dZ'):
            a = field[key]; finite = a[np.isfinite(a)]
            limit = max(float(finite.max()), 1e-9) if len(finite) else 1.
            archive.writestr(prefix+'_'+key+'.png', png_bytes(field_image(a, limit, positive=True, annotate=True,
                title=key+' (mm)', axes=(field['X_cm']*10, field['Y_cm']*10), colormap=colormap)))


def artifact(path):
    key = uuid.uuid4().hex; artifacts[key] = Path(path)
    return dict(artifact=key, size=Path(path).stat().st_size)


def dispatch_field(m):
    op = m['op']
    if op == 'field_import':
        return describe(save_field(load_field(base64.b64decode(m['data'], validate=True), m['name'])), m.get('colormap'))
    if op == 'field_average':
        if not m['fields']: raise ValueError('没有可平均的 RMS 场')
        return describe(save_field(average_fields(iter(read_field(k) for k in m['fields']))))
    if op == 'field_info': return describe(m['field'], m.get('colormap'))
    if op == 'field_file':
        path = new_path('.npz'); shutil.copyfile(fields[m['field']], path)
        return artifact(path)
    if op == 'field_dispose':
        path = fields.pop(m['field'], None)
        if path: path.unlink(missing_ok=True)
        return dict(ok=True)
    if op == 'artifact_chunk':
        offset = int(m.get('offset', 0)); size = int(m.get('size', 4*1024*1024))
        if offset < 0 or not 0 < size <= 4*1024*1024: raise ValueError('读取范围无效')
        with artifacts[m['artifact']].open('rb') as stream:
            stream.seek(offset); data = stream.read(size)
        return dict(data=base64.b64encode(data).decode(), size=len(data))
    if op == 'artifact_dispose':
        path = artifacts.pop(m['artifact'], None)
        if path: path.unlink(missing_ok=True)
        return dict(ok=True)
    if op in ('field_export', 'field_analyze'):
        field = read_field(m['field']); path = new_path('.zip')
        colormap = m.get('colormap') or json.loads(str(field.get('config_json', '{}'))).get('colormap', 'jet')
        cfg = json.loads(str(field.get('config_json', '{}'))); cfg['colormap'] = colormap
        field['config_json'] = json.dumps(cfg)
        metrics = None; profile_preview = None
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
            write_field_exports(archive, field, m.get('exports', ['rms_npz', 'rms_mat', 'rms_png', 'rms_csv']))
            if op == 'field_analyze':
                reference = read_field(m['reference']) if m.get('reference') else None
                metrics, profiles, fitted, mask = analyze(field, m['center'], m.get('options'), reference)
                selection = m.get('gain_selection', ['line', 'area'])
                if not isinstance(selection, list) or any(k not in ('line', 'area') for k in selection):
                    raise ValueError('未知聚焦效率类型')
                for label in ('user_gain', 'fit_gain'):
                    metrics[label] = {k: v for k, v in metrics[label].items() if k.split('_')[0] in selection}
                metrics['gain_selection'] = selection
                geometry = focal_geometry(field, metrics)
                archive.writestr('integration_geometry.json', json.dumps(geometry, ensure_ascii=False))
                from .session import png_bytes
                archive.writestr('integration_geometry.png', png_bytes(focal_geometry_image(field, geometry, colormap, selection)))
                if 'line' in selection:
                    profile_png=png_bytes(profile_image(profiles['fit_x'], 'Horizontal RMS profile', metrics['options']['line_length_cm']))
                    profile_preview=base64.b64encode(profile_png).decode()
                if 'line' in selection and not m.get('full_analysis', True):
                    values = profiles['fit_x']
                    out = io.StringIO(); np.savetxt(out, values, delimiter=',', header='distance_cm,x_cm,y_cm,Z_mm,dZ_mm,model_mm')
                    archive.writestr('profiles/fit_x.csv', out.getvalue())
                    archive.writestr('profiles/fit_x.png', profile_png)
                archive.writestr('focal.json', json.dumps(metrics, ensure_ascii=False, indent=2, allow_nan=False))
                out = io.StringIO(); writer = csv.writer(out); writer.writerow(['metric', 'value'])
                for key, value in metrics.items(): writer.writerow([key, json.dumps(value, ensure_ascii=False)])
                archive.writestr('focal.csv', out.getvalue())
                for kind in selection:
                    out = io.StringIO(); writer = csv.writer(out)
                    keys = [k for k in metrics['fit_gain'] if k.startswith(kind+'_')]
                    writer.writerow(['center', *keys])
                    for center in ('user', 'fit'):
                        writer.writerow([center, *[metrics[center+'_gain'].get(k) for k in keys]])
                    archive.writestr(kind+'_gain.csv', out.getvalue())
                if m.get('full_analysis', True):
                    for key, values in profiles.items():
                        out = io.StringIO(); np.savetxt(out, values, delimiter=',', header='distance_cm,x_cm,y_cm,Z_mm,dZ_mm,model_mm')
                        archive.writestr('profiles/'+key+'.csv', out.getvalue())
                        from .session import png_bytes
                        archive.writestr('profiles/'+key+'.png', png_bytes(profile_image(values, key, metrics['options']['line_length_cm'] if key.endswith('_x') else None)))
                    with archive.open('fit.npz', 'w', force_zip64=True) as out:
                        np.savez(out, model_Z=fitted, fit_mask=mask, X_cm=field['X_cm'], Y_cm=field['Y_cm'])
                    from .session import field_image, png_bytes
                    for name, a in [('power', field['Z']**2), ('model', fitted), ('residual', field['Z']-fitted), ('fit_mask', mask.astype(float))]:
                        limit = max(float(np.nanmax(np.abs(a))), 1e-9)
                        archive.writestr(name+'.png', png_bytes(field_image(a, limit, positive=name!='residual', annotate=True,
                            title=name, axes=(field['X_cm']*10, field['Y_cm']*10), colormap=colormap)))
            archive.writestr('provenance.json', json.dumps(clean(dict(source=str(field.get('source', '')), algorithm='final3-python-v2',
                config=json.loads(str(field.get('config_json', '{}'))), author='kotokowa', website='https://kotokowa.github.io/webtools/water-wave/')), ensure_ascii=False))
        return dict(**artifact(path), metrics=metrics, profile_preview=profile_preview)
    raise ValueError('未知 RMS 操作')
