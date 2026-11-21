"""RMS field interchange, repeat statistics and focal analysis. Units: cm, mm."""
import io
import json
import numpy as np
from scipy import io as sio, ndimage, optimize, signal
from scipy.interpolate import RegularGridInterpolator


def clean(value):
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def load_field(data, name):
    source = io.BytesIO(data) if isinstance(data, bytes) else data
    if name.lower().endswith('.mat'):
        try:
            obj = sio.loadmat(source, simplify_cells=True)
        except NotImplementedError as exc:
            raise ValueError('需要 MATLAB v7 MAT；不支持 v7.3 HDF5') from exc
    else:
        with np.load(source, allow_pickle=False) as src:
            keys = ('Z', 'Z_rms', 'rms', 'X_cm', 'Y_cm', 'xc', 'yc', 'x_mm', 'y_mm',
                    'cm_per_pixel', 'valid', 'dZ', 'config_json', 'xy_cal_applied')
            obj = {key: src[key] for key in keys if key in src.files}
    z = next((np.asarray(obj[k], float) for k in ('Z', 'Z_rms', 'rms') if k in obj), None)
    if z is None or z.ndim != 2 or min(z.shape) < 2:
        raise ValueError('RMS 文件缺少二维 Z 场')
    if 'X_cm' in obj and 'Y_cm' in obj:
        x, y = np.asarray(obj['X_cm']), np.asarray(obj['Y_cm'])
        xv, yv = x[0] if x.ndim == 2 else x.ravel(), y[:, 0] if y.ndim == 2 else y.ravel()
        if x.ndim == 2 and (x.shape != z.shape or not np.allclose(x, xv[None, :])):
            raise ValueError('X_cm 必须为直角坐标网格')
        if y.ndim == 2 and (y.shape != z.shape or not np.allclose(y, yv[:, None])):
            raise ValueError('Y_cm 必须为直角坐标网格')
    elif 'xc' in obj and 'yc' in obj:
        xv, yv = np.ravel(obj['xc']), np.ravel(obj['yc'])
    elif 'x_mm' in obj and 'y_mm' in obj:
        xv, yv = np.ravel(obj['x_mm'])/10, np.ravel(obj['y_mm'])/10
    elif 'cm_per_pixel' in obj:
        scale = float(np.asarray(obj['cm_per_pixel']).item())
        xv, yv = (np.arange(z.shape[1])+1)*scale, (np.arange(z.shape[0])+1)*scale
    else:
        raise ValueError('RMS 文件缺少物理坐标')
    if len(xv) != z.shape[1] or len(yv) != z.shape[0] or not np.isfinite(xv).all() or not np.isfinite(yv).all() or np.any(np.diff(xv) <= 0) or np.any(np.diff(yv) <= 0):
        raise ValueError('RMS 坐标尺寸或顺序无效')
    valid = np.asarray(obj.get('valid', np.isfinite(z)), bool) & np.isfinite(z)
    dz = np.asarray(obj.get('dZ', np.full(z.shape, np.nan)), float)
    if valid.shape != z.shape or dz.shape != z.shape or np.any(z[valid] < 0) or np.any(dz[np.isfinite(dz)] < 0):
        raise ValueError('RMS 掩膜、数值或误差场无效')
    z[~valid] = np.nan
    if not valid.any():
        raise ValueError('RMS 场没有有效像素')
    cfg = obj.get('config_json', '{}')
    if isinstance(cfg, np.ndarray): cfg = str(cfg.item())
    if not isinstance(cfg, str): cfg = '{}'
    if cfg == '{}':
        old = obj.get('cfg', {}); stats = obj.get('stats', {})
        old = old if isinstance(old, dict) else {}; stats = stats if isinstance(stats, dict) else {}
        mapped = {}
        for source, target in [('h_water', 'water_depth_mm'), ('H_scale', 'height_scale'), ('nw', 'n_water'), ('np', 'n_acrylic'), ('na', 'n_air')]:
            value = stats.get(source, old.get(source))
            if value is not None and np.isscalar(value): mapped[target] = float(value)
        if old.get('T_wave') is not None and np.isscalar(old['T_wave']) and old['T_wave'] > 0:
            mapped['frequency_hz'] = 1/float(old['T_wave'])
        if 'xy_cal_applied' in obj: mapped['coordinate_calibration'] = bool(obj['xy_cal_applied'])
        cfg = json.dumps(mapped)
    return dict(Z=z, dZ=dz, valid=valid, X_cm=np.asarray(xv, float), Y_cm=np.asarray(yv, float),
                config_json=cfg, source=name)


def compatible(a, b):
    for key in ('X_cm', 'Y_cm'):
        if a[key].shape != b[key].shape or not np.allclose(a[key], b[key], atol=1e-7, rtol=1e-5):
            raise ValueError('RMS 物理坐标不一致，不能自动缩放或对齐')
    ca, cb = json.loads(str(a.get('config_json', '{}'))), json.loads(str(b.get('config_json', '{}')))
    for key in ('water_depth_mm', 'frequency_hz', 'height_scale', 'coordinate_calibration', 'displacement_calibration',
                'excitation_amplitude', 'amplitude_unit'):
        if key in ca and key in cb:
            va, vb = ca[key], cb[key]
            same = np.isclose(va, vb, rtol=1e-8, atol=1e-10) if isinstance(va, (float, int)) and isinstance(vb, (float, int)) else va == vb
            if not same: raise ValueError('RMS 标定或工况不一致：'+key)


def average_fields(fields):
    first = next(fields)
    mean = np.nan_to_num(first['Z']).copy(); m2 = np.zeros_like(mean)
    variance = first['dZ']**2
    valid = first['valid'].copy(); n = 1
    sources = [str(first.get('source', ''))]
    grids = []
    for field in fields:
        field, interpolated = reference_on_grid(field, first)
        if interpolated: grids.append(str(field.get('source', '')))
        n += 1
        z = np.nan_to_num(field['Z'])
        delta = z-mean; mean += delta/n; m2 += delta*(z-mean)
        variance += field['dZ']**2; valid &= field['valid']
        sources.append(str(field.get('source', '')))
    ua = np.sqrt(np.maximum(m2, 0)/(n*(n-1))) if n > 1 else np.full_like(mean, np.nan)
    measurement = np.sqrt(variance)/n
    dz = np.sqrt(measurement**2+ua**2) if n > 1 else measurement
    for value in (mean, ua, measurement, dz): value[~valid] = np.nan
    return dict(Z=mean, dZ=dz, valid=valid, X_cm=first['X_cm'], Y_cm=first['Y_cm'],
                uA=ua, dZ_measurement=measurement, repeats=n, config_json=first.get('config_json', '{}'),
                sources_json=json.dumps(sources), grid_interpolated_sources_json=json.dumps(grids),
                uncertainty_interpolation='linear standard uncertainty; conservative correlated bound', source='average')


def reference_on_grid(reference, field):
    """Interpolate only sub-pixel calibration drift, in physical coordinates."""
    try:
        compatible(field, reference)
        return reference, False
    except ValueError:
        # Keep the existing condition/calibration checks, independently of axes.
        compatible(field, {**reference, 'X_cm': field['X_cm'], 'Y_cm': field['Y_cm']})
    for key in ('X_cm', 'Y_cm'):
        a, b = field[key], reference[key]
        pixel = min(float(np.median(np.diff(a))), float(np.median(np.diff(b))))
        if a.shape != b.shape or np.max(np.abs(a-b)) > pixel:
            raise ValueError('参考 RMS 网格偏差超过一个像素，请检查机位、ROI 与标定')
    x, y = np.meshgrid(field['X_cm'], field['Y_cm'])
    points = np.column_stack([y.ravel(), x.ravel()])
    result = {**reference, 'X_cm': field['X_cm'], 'Y_cm': field['Y_cm']}
    for key in ('Z', 'dZ'):
        values = np.where(reference['valid'], reference[key], np.nan)
        fun = RegularGridInterpolator((reference['Y_cm'], reference['X_cm']), values,
                                      bounds_error=False, fill_value=np.nan)
        result[key] = fun(points).reshape(field['Z'].shape)
    result['valid'] = np.isfinite(result['Z'])
    if result['valid'].sum() < .98*reference['valid'].sum():
        raise ValueError('参考 RMS 网格共同有效区域不足')
    return result, True


def model(p, x, y, kind):
    baseline, amp, xc, yc, sx, sy, theta = p[:7]
    dx, dy = x-xc, y-yc
    u, v = np.cos(theta)*dx+np.sin(theta)*dy, -np.sin(theta)*dx+np.cos(theta)*dy
    r2 = (u/sx)**2+(v/sy)**2
    if kind == 'supergauss':
        return baseline+amp*np.exp(-np.maximum(.5*r2, 1e-30)**p[7])
    if kind == 'core_halo':
        return baseline+amp*((1-p[7])*np.exp(-.5*r2)+p[7]*np.exp(-.5*r2/p[8]**2))
    return baseline+amp*np.exp(-.5*r2)


def width(t, z, baseline, peak_range=None):
    finite = np.isfinite(z)
    if finite.sum() < 5: return np.nan
    candidates = finite if peak_range is None else finite & (abs(t) <= peak_range)
    if not candidates.any(): return np.nan
    peak = int(np.argmax(np.where(candidates, z, -np.inf))); target = baseline+(z[peak]-baseline)/2
    if not z[peak] > baseline: return np.nan
    crossings = []
    for direction in (-1, 1):
        j = peak
        while 0 <= j+direction < len(z):
            k = j+direction
            if not (finite[j] and finite[k]): break
            if z[k] <= target:
                crossings.append(t[j]+(t[k]-t[j])*(target-z[j])/(z[k]-z[j]))
                break
            j = k
    return abs(crossings[1]-crossings[0]) if len(crossings) == 2 else np.nan


def measured_width(t, values, peak_range):
    valid = np.isfinite(values)
    if valid.sum() < 10: return np.nan
    smoothed = ndimage.uniform_filter1d(np.where(valid, values, 0.), 5, mode='nearest')
    smoothed /= np.maximum(ndimage.uniform_filter1d(valid.astype(float), 5, mode='nearest'), .2)
    smoothed[~valid] = np.nan
    return width(t, smoothed, float(np.percentile(smoothed[valid], 10)), peak_range)


def profile_width(field, center, theta, t, p, kind, peak_range):
    qx, qy = center[0]+t*np.cos(theta), center[1]+t*np.sin(theta)
    values = sample(field, qx, qy)
    estimated = width(t, model(p, qx, qy, kind), p[0], peak_range)
    measured = measured_width(t, values, peak_range)
    return (measured, 'measured') if np.isfinite(measured) else (estimated, 'model' if np.isfinite(estimated) else 'unavailable')


def sample(field, x, y, key='Z'):
    values = field[key].copy()
    values[~field['valid']] = np.nan
    fun = RegularGridInterpolator((field['Y_cm'], field['X_cm']), values, bounds_error=False, fill_value=np.nan)
    return fun(np.column_stack([y, x]))


def steepness(z, cfg, focus_values=None):
    f, h = float(cfg.get('frequency_hz', 0)), float(cfg.get('water_depth_mm', 0))/1000
    if f <= 0 or h <= 0: return {}
    g, sigma, rho = (float(cfg.get(key, default)) for key,default in
                     [('gravity_m_s2',9.796), ('surface_tension_n_m',.072), ('density_kg_m3',998.)])
    if not np.isfinite([g, sigma, rho]).all() or min(g, rho) <= 0 or sigma < 0:
        raise ValueError('色散关系参数无效')
    omega = 2*np.pi*f
    k = optimize.brentq(lambda k: (g*k+sigma*k**3/rho)*np.tanh(k*h)-omega**2, 1e-9, 1e7)
    t = np.tanh(k*h)
    cg = ((g+3*sigma*k*k/rho)*t+(g*k+sigma*k**3/rho)*h*(1-t*t))/(2*omega)
    finite = z[np.isfinite(z)]
    peak = np.sqrt(2)*np.max(finite)
    effective = np.sqrt(2*np.mean(finite**2))
    typical = np.sqrt(2)*np.percentile(finite, 90)
    ak = peak*.001*k
    nonlinear = float(cfg.get('ak_linear_limit', .15)); breaking = np.pi*.142*t
    focus = np.sqrt(2)*np.max(focus_values) if focus_values is not None and len(focus_values) else np.nan
    return dict(wavelength_cm=200*np.pi/k, phase_speed_m_s=omega/k, group_speed_m_s=cg,
                wavenumber_rad_m=k, period_s=1/f, water_depth_m=h,
                amplitude_peak_mm=peak, amplitude_effective_mm=effective, amplitude_typical_mm=typical, amplitude_focus_mm=focus,
                ak_peak=ak, ak_effective=effective*.001*k, ak_typical=typical*.001*k, ak_focus=focus*.001*k,
                miche_limit=breaking, nonlinear_limit=nonlinear, flag_nonlinear=ak>nonlinear, flag_breaking=ak>breaking,
                single_frequency=True)


def reference_diagnostics(field, reference, incident_y=None):
    x, y = reference['X_cm'], reference['Y_cm']
    field_x, field_y = field['X_cm'], field['Y_cm']
    spacing = np.array([np.median(np.diff(field_x)), np.median(np.diff(field_y))])
    ref_spacing = np.array([np.median(np.diff(x)), np.median(np.diff(y))])
    same_size = field['Z'].shape == reference['Z'].shape
    offset = [float(np.max(abs(a-b))) for a, b in ((x, field_x), (y, field_y))] if same_size else None
    target = y[0]+.05*(y[-1]-y[0]) if incident_y is None else float(incident_y)
    if not np.isfinite(target) or not y[0] <= target <= y[-1]:
        raise ValueError('入射截面超出参考 RMS 范围')
    row = int(np.argmin(abs(y-target)))
    valid = reference['valid'][row]
    segments = valid[1:] & valid[:-1]
    power = reference['Z'][row]**2
    lengths = np.diff(x)
    rms = reference['Z'][reference['valid']]
    return dict(same_size=same_size, same_spacing=bool(np.allclose(spacing, ref_spacing, rtol=1e-3, atol=0)),
                spacing_cm=spacing, reference_spacing_cm=ref_spacing, max_axis_offset_cm=offset,
                same_range=bool(np.allclose([x[0], x[-1], y[0], y[-1]], [field_x[0], field_x[-1], field_y[0], field_y[-1]], atol=1e-6, rtol=1e-5)),
                incident_y_cm=float(y[row]), incident_valid_fraction=float(lengths[segments].sum()/(x[-1]-x[0])),
                incident_rms2_line_mm2_cm=float(np.sum(.5*(power[1:]+power[:-1])[segments]*lengths[segments])),
                reference_rms_median_mm=float(np.median(rms)), reference_rms_max_mm=float(np.max(rms)))


def lock_focus(field, options=None):
    opts = dict(x_span_cm=10, y_min_cm=8, y_max_cm=22, expected_y_cm=13, y_sigma_cm=6, smooth_px=5)
    opts.update(options or {})
    span, low, high, expected, sigma, smooth = (float(opts[key]) for key in
        ('x_span_cm', 'y_min_cm', 'y_max_cm', 'expected_y_cm', 'y_sigma_cm', 'smooth_px'))
    if not np.isfinite([span, low, high, expected, sigma, smooth]).all() or min(span, sigma) <= 0 or low >= high or not 0 <= smooth <= 50:
        raise ValueError('自动锁焦范围或权重无效')
    x, y = field['X_cm'], field['Y_cm']
    corridor = (abs(x-np.median(x))[None, :] <= span) & (y[:, None] >= low) & (y[:, None] <= high) & field['valid']
    if not corridor.any(): raise ValueError('自动锁焦走廊没有有效数据，请调整范围或手动选焦')
    valid = field['valid']
    smooth_z = ndimage.gaussian_filter(np.where(valid, field['Z'], 0.), smooth)
    smooth_z /= np.maximum(ndimage.gaussian_filter(valid.astype(float), smooth), 1e-12)
    peaks = corridor & (smooth_z == ndimage.maximum_filter(np.where(valid, smooth_z, -np.inf), size=3))
    score = smooth_z * np.exp(-.5*((y[:, None]-expected)/sigma)**2)
    row, col = np.unravel_index(np.argmax(np.where(peaks if peaks.any() else corridor, score, -np.inf)), score.shape)
    weights = np.where((abs(x-x[col])[None, :] <= 2) & (abs(y[:, None]-y[row]) <= 2) & valid, smooth_z, 0.)
    total = weights.sum()
    center = [float(weights.sum(axis=0)@x/total), float(weights.sum(axis=1)@y/total)] if total > 0 else [float(x[col]), float(y[row])]
    return dict(center_cm=center, score=float(score[row, col]))


def analyze(field, center, options=None, reference=None):
    opts = dict(half_width_cm=2.5, line_length_cm=3., axes_cm=[9., 3.], fill_model=True, use_fwhm=False,
                core_mode='soft', core_level=.5, background_pct=2, fit_models=['gaussian', 'supergauss', 'core_halo'],
                fit_samples=60000, starts=3, seed=20261117)
    opts.update(options or {})
    xc, yc = map(float, center)
    half, length = float(opts['half_width_cm']), float(opts['line_length_cm'])
    fit_length = float(opts.get('fit_line_cm', length))
    half_x = float(opts.get('fit_half_x_cm', half)); half_y = float(opts.get('fit_half_y_cm', half))
    core_level = float(opts['core_level']); background_pct = float(opts['background_pct'])
    opts['fit_line_cm'] = fit_length
    axes = np.asarray(opts['axes_cm'], float)
    if axes.shape != (2,) or not np.isfinite([xc, yc, half, length, fit_length, half_x, half_y, *axes]).all() or min(half, length, fit_length, half_x, half_y, *axes) <= 0:
        raise ValueError('焦点与积分范围无效')
    models = opts['fit_models']; core_mode = opts['core_mode']
    if not models or any(kind not in ('gaussian','supergauss','core_halo') for kind in models) or core_mode not in ('soft','radial','threshold','all') or not 0 < core_level < 1 or not 0 <= background_pct < 50:
        raise ValueError('拟合模型或主峰参数无效')
    if axes[0] < axes[1]: raise ValueError('长全轴不能小于短全轴')
    if not field['X_cm'][0] <= xc <= field['X_cm'][-1] or not field['Y_cm'][0] <= yc <= field['Y_cm'][-1]:
        raise ValueError('焦点超出 RMS 场')
    reference_interpolated = False
    reference_pair = None
    if reference is not None:
        reference_pair = reference_diagnostics(field, reference, opts.get('incident_y_cm'))
        reference, reference_interpolated = reference_on_grid(reference, field)
    x, y = np.meshgrid(field['X_cm'], field['Y_cm'])
    z, dz = field['Z'], field['dZ']
    search = (abs(x-xc) <= half) & (abs(y-yc) <= half) & field['valid']
    if search.sum() < 30: raise ValueError('焦点搜索区有效数据不足')
    if np.ptp(z[search]) < 1e-12: raise ValueError('焦点搜索区没有可分辨的主峰')
    smoothed = ndimage.gaussian_filter(np.nan_to_num(z), 1)/np.maximum(ndimage.gaussian_filter(field['valid'].astype(float), 1), 1e-12)
    peak = np.unravel_index(np.argmax(np.where(search, smoothed, -np.inf)), z.shape)
    px, py = float(x[peak]), float(y[peak])
    region = (abs(x-px) <= half_x) & (abs(y-py) <= half_y) & field['valid'] if 'fit_half_x_cm' in opts or 'fit_half_y_cm' in opts else search
    if region.sum() < 30: raise ValueError('拟合窗口内有效数据不足')
    baseline = float(np.percentile(z[region], 10)); amp = max(float(z[region].max()-baseline), 1e-9)
    # MATLAB's soft weights are binary: retain main lobe and low background.
    intervals = []
    profile_smooth = ndimage.uniform_filter(np.where(field['valid'], z, np.nanmean(z)), 3, mode='constant')
    for profile, pos in ((profile_smooth[peak[0], :], peak[1]), (profile_smooth[:, peak[1]], peak[0])):
        minima = signal.find_peaks(-profile)[0]
        left, right = minima[minima < pos], minima[minima > pos]
        intervals.append((left[-1] if len(left) else 0, right[0] if len(right) else len(profile)-1))
    (xl, xr), (yl, yr) = intervals
    fitting = region.copy()
    for outside, boundary, enabled in ((x < field['X_cm'][xl], z[peak[0], xl], xl > 0),
                                       (x > field['X_cm'][xr], z[peak[0], xr], xr < z.shape[1]-1),
                                       (y < field['Y_cm'][yl], z[yl, peak[1]], yl > 0),
                                       (y > field['Y_cm'][yr], z[yr, peak[1]], yr < z.shape[0]-1)):
        if core_mode == 'soft' and enabled and np.isfinite(boundary): fitting &= ~(outside & (z > boundary))
    if core_mode in ('threshold', 'radial') or (core_mode == 'soft' and fitting.sum() < 200):
        cutoff = core_level*smoothed[peak]**2
        if core_mode == 'radial':
            limit = min(half_x, half_y, 12.)
            step = max(.1, limit/120)
            domain = region & (np.hypot(x-px, y-py) < limit)
            buckets = (np.hypot(x[domain]-px, y[domain]-py)/step).astype(int)
            counts = np.bincount(buckets)
            if len(counts) > 3:
                observed = np.bincount(buckets, smoothed[domain]**2)/np.maximum(counts, 1)
                occupied = counts > 0
                if occupied.sum() >= 3:
                    observed = np.interp(np.arange(len(counts)), np.flatnonzero(occupied), observed[occupied])
                    smooth_radial = ndimage.uniform_filter1d(observed, 3, mode='nearest')
                    minima, _ = signal.find_peaks(-smooth_radial, prominence=.15*smoothed[peak]**2)
                    minima = minima[smooth_radial[minima] <= .75*smoothed[peak]**2]
                    if len(minima): cutoff = smooth_radial[minima[0]]
        labels, _ = ndimage.label(region & ((z*z >= cutoff) | (x == px) & (y == py)))
        label = labels[peak]
        if label:
            core = ndimage.binary_dilation(labels == label, iterations=10) & region
            ring = ndimage.binary_dilation(core, iterations=10) & region & ~core & (z <= baseline+.1*amp)
            fitting = core | ring
    if fitting.sum() < 30: raise ValueError('主峰拟合区有效数据不足')
    ids = np.flatnonzero(fitting)[::max(1, int(np.ceil(fitting.sum()/int(opts['fit_samples']))))]
    xx, yy, zz = x.ravel()[ids], y.ravel()[ids], z.ravel()[ids]
    pixel = min(np.median(np.diff(field['X_cm'])), np.median(np.diff(field['Y_cm'])))
    lower = [0, 0, max(x[region].min(), x.min()), max(y[region].min(), y.min()), pixel/2, pixel/2, -np.pi]
    upper = [max(float(z[region].max())*2, 1e-6), amp*5, x[region].max(), y[region].max(), half_x*4, half_y*4, np.pi]
    if not np.all(np.asarray(upper) > lower): raise ValueError('拟合窗口过窄')
    initial = [max(baseline, 0), amp, px, py, half_x/3, half_y/4, 0]
    rng = np.random.default_rng(int(opts['seed']))
    fits = []
    for kind in models:
        lo, hi, start = lower.copy(), upper.copy(), initial.copy()
        if kind == 'supergauss': lo += [.5]; hi += [6.]; start += [1.5]
        if kind == 'core_halo': lo += [0., 1.05]; hi += [.98, 8.]; start += [.2, 2.]
        lo, hi = np.array(lo), np.array(hi)
        best = None
        for attempt in range(int(opts['starts'])):
            p = np.array(start, float)
            if attempt: p[4:6] *= rng.uniform(.65, 1.6, 2); p[6] = rng.uniform(-np.pi/2, np.pi/2)
            p = np.clip(p, lo+1e-10, hi-1e-10)
            result = optimize.least_squares(lambda p: model(p, xx, yy, kind)-zz, p, bounds=(lo, hi),
                                            loss='huber', f_scale=max(amp*.05, 1e-8), max_nfev=250)
            residual = model(result.x, xx, yy, kind)-zz
            sse = float(residual@residual)
            if best is None or sse < best['sse']:
                cov = np.linalg.pinv(result.jac.T@result.jac)*sse/max(len(zz)-len(p), 1)
                best = dict(kind=kind, p=result.x, sse=sse, rmse=np.sqrt(sse/len(zz)), covariance=cov,
                            bound_hits=np.flatnonzero(result.active_mask).tolist(), converged=bool(result.success))
        n, k = len(zz), len(best['p'])
        best['aicc'] = n*np.log(max(best['sse']/n, 1e-30))+2*k+2*k*(k+1)/max(n-k-1, 1)
        fits.append(best)
    fit = min(fits, key=lambda f: f['rmse'])
    p, kind = fit['p'], fit['kind']
    fitted = model(p, x, y, kind)
    major_theta = (p[6]+(np.pi/2 if p[5] > p[4] else 0)+np.pi/2) % np.pi-np.pi/2
    area_theta = float(np.deg2rad(opts['theta_deg'])) if 'theta_deg' in opts else float(major_theta)
    if not np.isfinite(area_theta): raise ValueError('积分方向无效')
    metrics = dict(model=kind, center_cm=p[2:4], user_center_cm=[xc, yc], theta_rad=p[6],
                   major_theta_rad=major_theta, area_theta_rad=area_theta,
                   reference_grid_interpolated=reference_interpolated, reference_pair=reference_pair,
                   baseline_mm=p[0], measured_peak_mm=float(z[region].max()), smoothed_peak_mm=float(smoothed[region].max()),
                   model_peak_mm=float(model(p, p[2], p[3], kind)), rmse_mm=fit['rmse'],
                   r_squared=1-fit['sse']/max(float(np.sum((zz-zz.mean())**2)), 1e-30),
                   candidates=[{k: f[k] for k in ('kind', 'rmse', 'aicc', 'bound_hits', 'converged')} for f in fits],
                   parameters=p, covariance=fit['covariance'], fit_sample_count=len(zz), options=opts)
    profiles = {}; draws = rng.multivariate_normal(p, fit['covariance'], size=200, check_valid='ignore')
    draws = draws[(draws[:, 4] > 0) & (draws[:, 5] > 0)]
    if kind == 'supergauss': draws = draws[draws[:, 7] > 0]
    if kind == 'core_halo': draws = draws[(draws[:, 8] > 1) & (draws[:, 7] >= 0) & (draws[:, 7] <= .98)]
    metrics['fit_parameter_std'] = np.std(draws, axis=0, ddof=1) if len(draws) > 1 else np.full_like(p, np.nan)
    metrics['background_noise_mm'] = float(np.percentile(z[field['valid']], background_pct))
    metrics['measured_peak_xy_cm'] = [px, py]
    span = max(8., float(np.hypot(np.ptp(field['X_cm']), np.ptp(field['Y_cm']))))
    t = np.linspace(-span, span, 4001)
    peak_range = min(half, .35*span)
    energy = np.where(field['valid'], z*z, fitted*fitted) if opts['fill_model'] else z*z
    ref_energy = reference['Z']**2 if reference is not None else None
    for label, c in (('user', [xc, yc]), ('fit', p[2:4])):
        for axis, theta in (('x', 0), ('y', np.pi/2), ('u', p[6]), ('v', p[6]+np.pi/2)):
            qx, qy = c[0]+t*np.cos(theta), c[1]+t*np.sin(theta)
            values, errors = sample(field, qx, qy), sample(field, qx, qy, 'dZ')
            predicted = model(p, qx, qy, kind)
            measured, estimated = measured_width(t, values, peak_range), width(t, predicted, p[0], peak_range)
            widths = [measured_width(t, values+rng.normal(size=len(t))*np.nan_to_num(errors), peak_range) for _ in range(100)] if np.isfinite(measured) and np.any(errors>0) else []
            model_widths = [width(t, model(d, qx, qy, kind), d[0], peak_range) for d in draws]
            finite_widths = np.asarray(widths)[np.isfinite(widths)]
            finite_models = np.asarray(model_widths)[np.isfinite(model_widths)]
            key = label+'_'+axis
            metrics[key+'_fwhm_cm'] = measured if np.isfinite(measured) else estimated
            metrics[key+'_fwhm_source'] = 'measured' if np.isfinite(measured) else 'model' if np.isfinite(estimated) else 'unavailable'
            metrics[key+'_measured_fwhm_std_cm'] = 1.4826*np.median(abs(finite_widths-np.median(finite_widths))) if len(finite_widths) > 1 else np.nan
            metrics[key+'_model_fwhm_std_cm'] = np.std(finite_models, ddof=1) if len(finite_models) > 1 else np.nan
            metrics[key+'_model_fwhm_cm'] = estimated
            visible = np.flatnonzero(np.isfinite(values))
            plot = slice(visible[0], visible[-1]+1) if len(visible) > 1 else slice(None)
            profiles[key] = np.column_stack([t[plot], qx[plot], qy[plot], values[plot], errors[plot], predicted[plot]])
        line_length = length if label == 'user' else fit_length
        tx = np.linspace(c[0]-line_length/2, c[0]+line_length/2, max(3, min(10001, int(line_length/pixel)+1)))
        zy = np.full_like(tx, c[1]); lens = sample(field, tx, zy)
        gains = dict(line_gain=None, area_gain=None)
        dx, dy = x-c[0], y-c[1]
        along = np.cos(area_theta)*dx+np.sin(area_theta)*dy
        across = -np.sin(area_theta)*dx+np.cos(area_theta)*dy
        def integrate_area(prefix, lengths):
            if not np.isfinite(lengths).all() or min(lengths) <= 0:
                gains[prefix+'_gain'] = None
                return
            ellipse = (along/(lengths[0]/2))**2+(across/(lengths[1]/2))**2 <= 1
            coverage = float(np.mean(field['valid'][ellipse])) if ellipse.any() else 0.
            gains[prefix+'_gain'] = None
            gains[prefix+'_valid_fraction'] = coverage
            gains[prefix+'_model_fraction'] = (1-coverage) if opts['fill_model'] else 0.
            valid_area = ellipse & np.isfinite(energy)
            if reference is not None: valid_area &= reference['valid']
            pixel_area = np.median(np.diff(field['X_cm']))*np.median(np.diff(field['Y_cm']))
            gains[prefix+'_lens_rms2_mm2_cm2'] = float(np.sum(energy[valid_area])*pixel_area) if valid_area.any() else None
            if reference is not None:
                denominator = np.sum(ref_energy[valid_area])*pixel_area
                gains[prefix+'_reference_rms2_mm2_cm2'] = denominator if valid_area.any() else None
                gains[prefix+'_gain'] = gains[prefix+'_lens_rms2_mm2_cm2']/denominator if denominator > 0 else None
        integrate_area('area', axes)
        if opts['use_fwhm']:
            if 'theta_deg' in opts:
                widths = [profile_width(field, c, area_theta+offset, t, p, kind, peak_range) for offset in (0, np.pi/2)]
            else:
                directions = ('u', 'v') if p[4] >= p[5] else ('v', 'u')
                widths = [(metrics[f'{label}_{axis}_fwhm_cm'], metrics[f'{label}_{axis}_fwhm_source']) for axis in directions]
            lengths, sources = zip(*widths)
            metrics[label+'_fwhm_ellipse'] = dict(axes_cm=lengths, sources=sources, theta_rad=area_theta)
            integrate_area('fwhm_area', lengths)
        refline = sample(reference, tx, zy) if reference is not None else None
        ok = np.isfinite(lens) if refline is None else np.isfinite(lens) & np.isfinite(refline)
        segments = ok[1:] & ok[:-1]
        integrate = lambda values: np.sum(.5*(values[:-1]**2+values[1:]**2)[segments]*np.diff(tx)[segments])
        gains['line_lens_rms2_mm2_cm'] = integrate(lens) if segments.any() else None
        gains['line_valid_fraction'] = float(segments.mean())
        if refline is not None:
            den = integrate(refline)
            gains['line_reference_rms2_mm2_cm'] = den if segments.any() else None
            gains['line_gain'] = gains['line_lens_rms2_mm2_cm']/den if den > 0 else None
        metrics[label+'_gain'] = gains
    radii = np.hypot(x-p[2], y-p[3])[region]
    power = np.maximum(fitted[region]**2-p[0]**2, 0)
    order = np.argsort(radii); cumulative = np.cumsum(power[order])
    for fraction in (.5, .8, .9, .95):
        metrics['ee'+str(int(fraction*100))+'_radius_cm'] = float(radii[order[min(np.searchsorted(cumulative, fraction*cumulative[-1]), len(order)-1)]]) if cumulative[-1] > 0 else None
    metrics['ee_domain'] = 'valid pixels in selected fit window'
    if cumulative[-1] > 0:
        indices = np.unique(np.linspace(0, len(order)-1, min(len(order), 512), dtype=int))
        profiles['encircled_energy'] = np.column_stack([radii[order[indices]], cumulative[indices]/cumulative[-1]])
    cfg = json.loads(str(field.get('config_json', '{}')))
    metrics['model_peak_std_mm'] = float(np.std([model(d, d[2], d[3], kind) for d in draws], ddof=1)) if len(draws) > 1 else None
    if cfg.get('coordinate_calibration') and cfg.get('pipeline') != 'legacy':
        sx, sy = cfg.get('cal_x_slope', 1.022), cfg.get('cal_y_slope', 1.020)
        us, ub = cfg.get('cal_slope_error', .001), cfg.get('cal_offset_error_cm', .02)
        cal_center = np.sqrt((p[2:4]*us/np.array([sx, sy]))**2+(ub/np.array([sx, sy]))**2)
        metrics['center_calibration_std_cm'] = cal_center
        metrics['center_total_std_cm'] = np.sqrt(cal_center**2+np.diag(fit['covariance'])[2:4])
        for label in ('user', 'fit'):
            for axis, theta in (('x', 0), ('y', np.pi/2), ('u', p[6]), ('v', p[6]+np.pi/2)):
                key = label+'_'+axis
                calibration = metrics[key+'_fwhm_cm']*np.hypot(np.cos(theta)*us/sx, np.sin(theta)*us/sy)
                stat = metrics.get(key+'_'+metrics[key+'_fwhm_source']+'_fwhm_std_cm', np.nan)
                metrics[key+'_calibration_fwhm_std_cm'] = calibration
                metrics[key+'_total_fwhm_std_cm'] = np.hypot(stat, calibration)
    metrics['steepness'] = steepness(np.where(field['valid'], z, np.nan), cfg,
                                     z[field['valid'] & (np.hypot(x-p[2], y-p[3]) <= 1)])
    design = opts.get('design')
    if design:
        wavelength = design.get('wavelength_cm') or metrics['steepness'].get('wavelength_cm')
        if wavelength is None: raise ValueError('计算设计尺度需输入波长，或为 RMS 提供水深和频率')
        values = [float(value) for value in (wavelength, design['focus_cm'], design['aperture_cm'], design['coefficient'])]
        if not np.isfinite(values).all() or min(values) <= 0: raise ValueError('设计焦距、口径、波长和系数须为正数')
        wavelength, focal_length, aperture, coefficient = values
        design_width = coefficient*wavelength*focal_length/aperture
        metrics['design'] = dict(wavelength_cm=wavelength, fwhm_cm=design_width, suggested_line_cm=2*design_width,
                                 concentration_window_cm=[4*design_width, 4*design_width])
    return clean(metrics), profiles, fitted, fitting
