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
    if name.lower().endswith('.mat'):
        try:
            obj = sio.loadmat(io.BytesIO(data), simplify_cells=True)
        except NotImplementedError as exc:
            raise ValueError('需要 MATLAB v7 MAT；不支持 v7.3 HDF5') from exc
    else:
        with np.load(io.BytesIO(data), allow_pickle=False) as src:
            obj = dict(src)
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
    for field in fields:
        compatible(first, field)
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
                sources_json=json.dumps(sources), source='average')


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


def width(t, z, baseline):
    finite = np.isfinite(z)
    if finite.sum() < 5: return np.nan
    peak = int(np.nanargmax(z)); target = baseline+(z[peak]-baseline)/2
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


def sample(field, x, y, key='Z'):
    values = field[key].copy()
    values[~field['valid']] = np.nan
    fun = RegularGridInterpolator((field['Y_cm'], field['X_cm']), values, bounds_error=False, fill_value=np.nan)
    return fun(np.column_stack([y, x]))


def steepness(z, cfg):
    f, h = float(cfg.get('frequency_hz', 0)), float(cfg.get('water_depth_mm', 0))/1000
    if f <= 0 or h <= 0: return {}
    g, sigma, rho = 9.796, .072, 998.
    omega = 2*np.pi*f
    k = optimize.brentq(lambda k: (g*k+sigma*k**3/rho)*np.tanh(k*h)-omega**2, 1e-9, 1e7)
    t = np.tanh(k*h)
    cg = ((g+3*sigma*k*k/rho)*t+(g*k+sigma*k**3/rho)*h*(1-t*t))/(2*omega)
    ak = np.sqrt(2)*np.nanmax(z)*.001*k
    return dict(wavelength_cm=200*np.pi/k, phase_speed_m_s=omega/k, group_speed_m_s=cg,
                ak_peak=ak, miche_limit=np.pi*.142*t, nonlinear_limit=.15, single_frequency=True)


def analyze(field, center, options=None, reference=None):
    opts = dict(half_width_cm=2.5, line_length_cm=3., axes_cm=[9., 3.], fill_model=True,
                fit_samples=60000, starts=3, seed=20261117)
    opts.update(options or {})
    xc, yc = map(float, center)
    half, length = float(opts['half_width_cm']), float(opts['line_length_cm'])
    axes = np.asarray(opts['axes_cm'], float)
    if not np.isfinite([xc, yc, half, length, *axes]).all() or min(half, length, *axes) <= 0:
        raise ValueError('焦点与积分范围无效')
    if not field['X_cm'][0] <= xc <= field['X_cm'][-1] or not field['Y_cm'][0] <= yc <= field['Y_cm'][-1]:
        raise ValueError('焦点超出 RMS 场')
    if reference is not None: compatible(field, reference)
    x, y = np.meshgrid(field['X_cm'], field['Y_cm'])
    z, dz = field['Z'], field['dZ']
    region = (abs(x-xc) <= half) & (abs(y-yc) <= half) & field['valid']
    if region.sum() < 30: raise ValueError('焦点搜索区有效数据不足')
    if np.ptp(z[region]) < 1e-12: raise ValueError('焦点搜索区没有可分辨的主峰')
    smoothed = ndimage.gaussian_filter(np.nan_to_num(z), 1)/np.maximum(ndimage.gaussian_filter(field['valid'].astype(float), 1), 1e-12)
    peak = np.unravel_index(np.argmax(np.where(region, smoothed, -np.inf)), z.shape)
    px, py = float(x[peak]), float(y[peak])
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
        if enabled and np.isfinite(boundary): fitting &= ~(outside & (z > boundary))
    if fitting.sum() < 200:
        labels, _ = ndimage.label(region & (z*z >= .5*smoothed[peak]**2))
        label = labels[peak]
        if label:
            core = ndimage.binary_dilation(labels == label, iterations=10) & region
            ring = ndimage.binary_dilation(core, iterations=10) & region & ~core & (z <= baseline+.1*amp)
            fitting = core | ring
    if fitting.sum() < 30: raise ValueError('主峰拟合区有效数据不足')
    ids = np.flatnonzero(fitting)[::max(1, int(np.ceil(fitting.sum()/int(opts['fit_samples']))))]
    xx, yy, zz = x.ravel()[ids], y.ravel()[ids], z.ravel()[ids]
    pixel = min(np.median(np.diff(field['X_cm'])), np.median(np.diff(field['Y_cm'])))
    lower = [0, 0, max(xc-half, x.min()), max(yc-half, y.min()), pixel/2, pixel/2, -np.pi]
    upper = [max(float(z[region].max())*2, 1e-6), amp*5, min(xc+half, x.max()), min(yc+half, y.max()), half*4, half*4, np.pi]
    initial = [max(baseline, 0), amp, px, py, half/3, half/4, 0]
    rng = np.random.default_rng(int(opts['seed']))
    fits = []
    for kind in ('gaussian', 'supergauss', 'core_halo'):
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
    metrics = dict(model=kind, center_cm=p[2:4], user_center_cm=[xc, yc], theta_rad=p[6],
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
    t = np.linspace(-2*half, 2*half, max(101, min(2001, int(4*half/pixel)+1)))
    for label, c in (('user', [xc, yc]), ('fit', p[2:4])):
        for axis, theta in (('x', 0), ('y', np.pi/2), ('u', p[6]), ('v', p[6]+np.pi/2)):
            qx, qy = c[0]+t*np.cos(theta), c[1]+t*np.sin(theta)
            values, errors = sample(field, qx, qy), sample(field, qx, qy, 'dZ')
            predicted = model(p, qx, qy, kind)
            measured, estimated = width(t, values, p[0]), width(t, predicted, p[0])
            widths = [width(t, values+rng.normal(size=len(t))*errors, p[0]) for _ in range(100)]
            model_widths = [width(t, model(d, qx, qy, kind), d[0]) for d in draws]
            finite_widths = np.asarray(widths)[np.isfinite(widths)]
            finite_models = np.asarray(model_widths)[np.isfinite(model_widths)]
            key = label+'_'+axis
            metrics[key+'_fwhm_cm'] = measured if np.isfinite(measured) else estimated
            metrics[key+'_fwhm_source'] = 'measured' if np.isfinite(measured) else 'model'
            metrics[key+'_measured_fwhm_std_cm'] = np.std(finite_widths, ddof=1) if len(finite_widths) > 1 else np.nan
            metrics[key+'_model_fwhm_std_cm'] = np.std(finite_models, ddof=1) if len(finite_models) > 1 else np.nan
            metrics[key+'_model_fwhm_cm'] = estimated
            profiles[key] = np.column_stack([t, qx, qy, values, errors, predicted])
        tx = np.linspace(c[0]-length/2, c[0]+length/2, max(3, int(length/pixel)+1))
        zy = np.full_like(tx, c[1]); lens = sample(field, tx, zy)
        gains = dict(line_gain=None, area_gain=None)
        theta = float(opts.get('theta_deg', p[6]*180/np.pi))*np.pi/180
        dx, dy = x-c[0], y-c[1]
        ellipse = ((np.cos(theta)*dx+np.sin(theta)*dy)/(axes[0]/2))**2+((-np.sin(theta)*dx+np.cos(theta)*dy)/(axes[1]/2))**2 <= 1
        energy = z*z
        if opts['fill_model']: energy = np.where(field['valid'], energy, fitted*fitted)
        gains['area_valid_fraction'] = float(np.mean(field['valid'][ellipse])) if ellipse.any() else 0.
        gains['area_model_fraction'] = (1-gains['area_valid_fraction']) if opts['fill_model'] else 0.
        if reference is not None:
            refline = sample(reference, tx, zy)
            # Never bridge missing segments in a measured line integral.
            ok = np.isfinite(lens) & np.isfinite(refline)
            segments = ok[1:] & ok[:-1]
            integrate = lambda a: np.sum(.5*(a[:-1]**2+a[1:]**2)[segments]*np.diff(tx)[segments])
            den = integrate(refline)
            gains['line_gain'] = integrate(lens)/den if den > 0 else None
            gains['line_valid_fraction'] = float(segments.mean())
            valid_area = ellipse & reference['valid'] & np.isfinite(energy)
            den = np.sum(reference['Z'][valid_area]**2)
            gains['area_gain'] = np.sum(energy[valid_area])/den if den > 0 else None
        metrics[label+'_gain'] = gains
    radii = np.hypot(x-p[2], y-p[3])[region]
    power = np.maximum(fitted[region]**2-p[0]**2, 0)
    order = np.argsort(radii); cumulative = np.cumsum(power[order])
    for fraction in (.5, .8, .9, .95):
        metrics['ee'+str(int(fraction*100))+'_radius_cm'] = float(radii[order[min(np.searchsorted(cumulative, fraction*cumulative[-1]), len(order)-1)]]) if cumulative[-1] > 0 else None
    metrics['ee_domain'] = 'valid pixels in selected fit window'
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
                stat = metrics[key+'_'+metrics[key+'_fwhm_source']+'_fwhm_std_cm']
                metrics[key+'_calibration_fwhm_std_cm'] = calibration
                metrics[key+'_total_fwhm_std_cm'] = np.hypot(stat, calibration)
    metrics['steepness'] = steepness(z, cfg)
    return clean(metrics), profiles, fitted, fitting
