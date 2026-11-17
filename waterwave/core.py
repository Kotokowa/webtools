"""Fast checkerboard demodulation and refractive surface reconstruction.

FCD / phase unwrapping / inverse-gradient portions adapted from Sander
Wildeman's MIT-licensed MATLAB FCD (2017–2018). See LICENSE-FCD.txt.
All image displacements are pixels; final elevation and coordinates are mm.
Image coordinates: x right, y down. Rectangles use [x0,y0,x1,y1), zero based.
"""
from dataclasses import asdict, dataclass
import math
import numpy as np
from scipy import fft, ndimage, signal
from .measurement import valid_mask, fill_pattern, Bridge


@dataclass
class Config:
    water_depth_mm: float = 30.0
    acrylic_mm: float = 10.0
    n_water: float = 1.33
    n_acrylic: float = 1.49
    n_air: float = 1.00029
    square_mm: float = 1.5
    mm_per_pixel: float = 0.0  # zero: estimate from carrier peaks
    edge_crop: int = 10
    unwrap: bool = True
    remove_mean_displacement: bool = True
    detrend: str = "quadratic"
    filter_ratio: float = 1.0
    integration: str = "difference"
    color_limit_mm: float = 1.0
    fps: float = 100.0
    temporal_limit_mb: float = 256.0
    pipeline: str = "final3"
    height_scale: float = 1.0
    masking: bool = True
    mask_dark: float = .25
    mask_mod: float = .30
    mask_saturation: float = 1.01
    mask_window: int = 21
    mask_min_blob: int = 100
    mask_grow: int = 2
    mask_guard: int = 10
    fill_ring: int = 20
    coordinate_calibration: bool = True
    displacement_calibration: bool = True
    cal_x_slope: float = 1.022
    cal_y_slope: float = 1.020
    cal_x_offset_cm: float = .04
    cal_y_offset_cm: float = .05
    cal_slope_error: float = .001
    cal_offset_error_cm: float = .02
    rms_min_fraction: float = .8
    lockin: bool = False
    frequency_hz: float = 6.0
    excitation_amplitude: float = 0.0
    amplitude_unit: str = 'V'

    def validate(self):
        for key, value in asdict(self).items():
            if isinstance(value, (int, float)) and not math.isfinite(value):
                raise ValueError(f"{key} 必须为有限数值")
        if self.pipeline not in ("final3", "legacy"):
            raise ValueError("未知算法版本")
        if self.excitation_amplitude < 0 or not isinstance(self.amplitude_unit, str) or not self.amplitude_unit.strip():
            raise ValueError("激励振幅或单位无效")
        if min(self.height_scale, self.cal_x_slope, self.cal_y_slope) <= 0:
            raise ValueError("标定系数须大于 0")
        for key in ("mask_window", "mask_min_blob", "mask_grow", "mask_guard", "fill_ring"):
            value = getattr(self, key)
            if value < 0 or value != int(value):
                raise ValueError("掩膜尺寸须为非负整数")
        if self.mask_window < 1 or not 0 < self.rms_min_fraction <= 1 or self.frequency_hz < 0:
            raise ValueError("RMS 或掩膜参数无效")
        if self.lockin and self.frequency_hz <= 0:
            raise ValueError("锁相频率须大于 0")
        if min(self.mask_dark, self.mask_mod, self.mask_saturation, self.cal_slope_error, self.cal_offset_error_cm) < 0:
            raise ValueError("阈值及不确定度不能为负")
        if self.water_depth_mm <= 0 or self.acrylic_mm < 0:
            raise ValueError("水深须大于 0，底板厚度不能为负")
        if not (self.n_water > self.n_air > 0 and self.n_acrylic > 0):
            raise ValueError("折射率必须为正，水的折射率须大于空气")
        if self.square_mm <= 0 or self.mm_per_pixel < 0:
            raise ValueError("格长须大于 0，手动像素尺度不能为负")
        if int(self.edge_crop) != self.edge_crop or self.edge_crop < 0:
            raise ValueError("边缘裁剪必须为非负整数")
        self.edge_crop = int(self.edge_crop)
        if self.detrend not in ("none", "plane", "quadratic"):
            raise ValueError("未知去趋势方式")
        if self.integration not in ("difference", "spectral"):
            raise ValueError("未知积分方式")
        if not 0.1 <= self.filter_ratio <= 1.0:
            raise ValueError("滤波半径系数须在 0.1–1 之间")
        if self.color_limit_mm <= 0 or self.fps < 0 or self.temporal_limit_mb <= 0:
            raise ValueError("色标、内存限额须大于 0，帧率不能为负")


def gray(image):
    a = np.asarray(image)
    if a.ndim == 3 and a.shape[2] >= 3:
        a = np.asarray(a[..., :3], dtype=np.float64) @ [0.298936, 0.587043, 0.114021]
    if a.ndim != 2 or min(a.shape) < 8 or not np.isfinite(a).all():
        raise ValueError("需要至少 8×8 的有效二维灰度或 RGB 图片")
    return np.asarray(a, dtype=np.float64)


def kvec(n):
    return 2 * np.pi * fft.fftfreq(n)


def find_carriers(reference):
    a = gray(reference)
    ny, nx = a.shape
    win = signal.windows.hamming(ny, sym=False)[:, None] * signal.windows.hamming(nx, sym=False)
    spectrum = np.abs(fft.fftshift(fft.fft2((a - a.mean()) * win)))
    kx, ky = np.meshgrid(fft.fftshift(kvec(nx)), fft.fftshift(kvec(ny)))
    spectrum[kx**2 + ky**2 <= (4 * np.pi / min(a.shape))**2] = 0
    if spectrum.max() <= np.finfo(float).eps:
        raise ValueError("参考图没有可识别的格纹；请选择清晰的棋盘格区域")
    labels, n = ndimage.label(spectrum > 0.5 * spectrum.max(), np.ones((3, 3)))
    candidates = ndimage.maximum_position(spectrum, labels, list(range(1, n + 1)))
    candidates = [p for p in candidates if 0 < p[0] < ny-1 and 0 < p[1] < nx-1]
    candidates.sort(key=lambda p: spectrum[p], reverse=True)
    if len(candidates) < 4:
        raise ValueError("未找到四个棋盘格载波峰；请缩小到无遮挡格纹区域并检查对焦")
    peaks = []
    def offset(left, center, right):
        l, c, r = np.log(np.maximum([left, center, right], np.finfo(float).tiny))
        den = l + r - 2*c
        return float(np.clip(-0.5*(r-l)/den, -0.5, 0.5)) if abs(den) > 1e-15 else 0.0
    for y, x in candidates[:4]:
        dx = offset(spectrum[y, x-1], spectrum[y, x], spectrum[y, x+1])
        dy = offset(spectrum[y-1, x], spectrum[y, x], spectrum[y+1, x])
        peaks.append([kx[y, x] + dx*2*np.pi/nx, ky[y, x] + dy*2*np.pi/ny])
    peaks = np.asarray(peaks)
    kr = peaks[np.argmin(np.abs(np.arctan2(peaks[:, 1], peaks[:, 0])))]
    cross = (kr[0]*peaks[:, 1] - kr[1]*peaks[:, 0]) / np.linalg.norm(peaks, axis=1)
    ku = peaks[np.argmax(cross)]
    if abs(np.linalg.det([kr, ku])) < 0.1*np.linalg.norm(kr)*np.linalg.norm(ku):
        raise ValueError("载波方向几乎平行，无法可靠求解二维位移")
    return kr, ku


def inverse_gradient(fx, fy, *, difference=True, boundary=True):
    """MATLAB fftinvgrad2 impulse boundary correction and least-squares inverse."""
    fx, fy = np.array(fx, dtype=float, copy=True), np.array(fy, dtype=float, copy=True)
    if fx.shape != fy.shape or min(fx.shape) < 4:
        raise ValueError("梯度尺寸不匹配或过小")
    ny, nx = fx.shape
    if boundary:
        x_edge, y_edge = fx[:, [0, -1]].copy(), fy[[0, -1], :].copy()
        fx[:, [0, -1]] = -0.5 * fx[:, 1:-1].sum(axis=1, keepdims=True)
        fy[[0, -1], :] = -0.5 * fy[1:-1, :].sum(axis=0, keepdims=True)
    mx, my = fx.mean(), fy.mean()
    kx, ky = np.meshgrid(kvec(nx), kvec(ny))
    if difference:
        kx, ky = np.sin(kx), np.sin(ky)
    k2 = kx*kx + ky*ky
    if nx % 2 == 0:
        kx[:, nx//2] = 0
    if ny % 2 == 0:
        ky[ny//2, :] = 0
    k2[k2 < np.finfo(float).eps] = 1
    h = fft.ifft2((-1j*kx*fft.fft2(fx) - 1j*ky*fft.fft2(fy)) / k2).real
    y, x = np.indices(h.shape)
    h += mx*x + my*y
    if boundary:
        h[:, 0] = (4*h[:, 1] - h[:, 2] - 2*x_edge[:, 0])/3
        h[:, -1] = (4*h[:, -2] - h[:, -3] + 2*x_edge[:, 1])/3
        h[0] = (4*h[1] - h[2] - 2*y_edge[0])/3
        h[-1] = (4*h[-2] - h[-3] + 2*y_edge[1])/3
    return h


def unwrap_phase(ph):
    """Volkov & Zhu FFT unwrap, ported from FCD unwrap2 (not 1D unwrap)."""
    ny, nx = ph.shape
    kx, ky = np.meshgrid(kvec(nx), kvec(ny))
    z = np.exp(1j*ph)
    fp, fz = fft.fft2(ph), fft.fft2(z)
    jx = (fft.ifft2(1j*kx*fz)/(1j*z)).real - fft.ifft2(1j*kx*fp).real
    jy = (fft.ifft2(1j*ky*fz)/(1j*z)).real - fft.ifft2(1j*ky*fp).real
    j = inverse_gradient(jx, jy, difference=False, boundary=False)
    j -= j[max(0, ny//2-1), max(0, nx//2-1)]
    jumps = np.rint(j/(2*np.pi)).astype(np.int64)
    values, counts = np.unique(jumps, return_counts=True)
    return ph + (jumps-values[counts.argmax()])*2*np.pi


def detrend_field(h, mode, valid=None):
    if mode == "none":
        return h.copy()
    # Normalized coordinates avoid the ill-conditioning of raw pixel powers.
    y, x = np.meshgrid(np.linspace(-1, 1, h.shape[0]), np.linspace(-1, 1, h.shape[1]), indexing="ij")
    basis = [np.ones_like(x), x, y]
    if mode == "quadratic":
        basis += [x*x, y*y, x*y]
    elif mode != "plane":
        raise ValueError("未知去趋势方式")
    design = np.stack([b.ravel() for b in basis], axis=1)
    valid = np.isfinite(h) if valid is None else valid & np.isfinite(h)
    ids = np.flatnonzero(valid)
    if len(ids) < len(basis):
        raise ValueError("有效像素不足以去趋势")
    ids = ids[::max(1, int(np.ceil(len(ids)/300000)))]
    coeff = np.linalg.lstsq(design[ids], h.ravel()[ids], rcond=None)[0]
    return h - (design @ coeff).reshape(h.shape)


class Reconstructor:
    def __init__(self, reference, roi=None, config=None):
        self.config = config or Config()
        self.config.validate()
        a = gray(reference)
        self.image_shape = a.shape
        ny, nx = a.shape
        roi = roi if roi is not None else [0, 0, nx, ny]
        if len(roi) != 4 or any(not isinstance(v, (int, np.integer)) for v in roi):
            raise ValueError("ROI 必须为四个整数 [x0,y0,x1,y1]")
        x0, y0, x1, y1 = roi
        if not (0 <= x0 < x1 <= nx and 0 <= y0 < y1 <= ny):
            raise ValueError("ROI 超出图片范围")
        if min(x1-x0, y1-y0) < max(64, 2*self.config.edge_crop+16):
            raise ValueError("选区过小；至少 64×64，且须留出边缘裁剪区域")
        self.roi = list(roi)
        self.reference = a[y0:y1, x0:x1]
        self.valid_ref = np.ones(self.reference.shape, bool)
        self.holes_ref = np.zeros(self.reference.shape, bool)
        self.bridge = Bridge()
        self.fill_fallbacks = 0
        detection = self.reference.copy()
        if self.config.masking and self.config.pipeline != "legacy":
            self.valid_ref, self.holes_ref, self.thresholds = valid_mask(self.reference, self.config)
            if self.valid_ref.sum() < 64:
                raise ValueError("参考图有效格纹不足")
            detection[~self.valid_ref] = np.median(detection[self.valid_ref])
        self.kr, self.ku = find_carriers(detection)
        self.reference, fallback = fill_pattern(self.reference, self.reference, self.holes_ref,
                                               [self.kr, self.ku], int(self.config.fill_ring))
        self.fill_fallbacks += int(fallback)
        self.radius = np.linalg.norm(self.kr-self.ku)/2*self.config.filter_ratio
        ky, kx = self.reference.shape
        gx, gy = np.meshgrid(kvec(kx), kvec(ky))
        fref = fft.fft2(self.reference)
        self.carriers = []
        for k in [self.kr, self.ku]:
            mask = (gx-k[0])**2 + (gy-k[1])**2 < self.radius**2
            ref = fft.ifft2(fref*mask)
            self.carriers.append((mask, np.conj(ref), np.abs(ref)))
        self.scale = self.config.mm_per_pixel or float(np.linalg.norm(self.kr+self.ku)*self.config.square_mm/(2*np.pi))
        self.leff = (self.config.water_depth_mm + self.config.acrylic_mm*self.config.n_water/self.config.n_acrylic)*(1-self.config.n_air/self.config.n_water)
        self.H = self.config.height_scale*self.leff/self.scale
        self.warnings = []
        cosine = float(np.dot(self.kr, self.ku)/(np.linalg.norm(self.kr)*np.linalg.norm(self.ku)))
        ratio = float(np.linalg.norm(self.kr)/np.linalg.norm(self.ku))
        if abs(cosine) > .15 or abs(ratio-1) > .15:
            self.warnings.append("两组载波不够正交或周期不一致；检查透视、格纹类型及手动像素尺度")
        if self.config.detrend == "quadratic":
            self.warnings.append("已扣除全局二次曲面：真实长波与大尺度起伏也可能被削弱")

    @property
    def metadata(self):
        e = self.config.edge_crop
        return {"config": asdict(self.config), "image_shape": list(self.image_shape), "roi": self.roi,
                "output_shape": [int(n-2*e) for n in self.reference.shape],
                "output_origin_px": [self.roi[0]+e, self.roi[1]+e],
                "mm_per_pixel": self.scale, "effective_optical_length_mm": self.leff,
                "x_mm": self.coordinates()[0].tolist(), "y_mm": self.coordinates()[1].tolist(),
                "algorithm": self.config.pipeline, "fill_fallback_count": self.fill_fallbacks,
                "H_pixels": self.H, "carrier_r_rad_per_pixel": self.kr.tolist(),
                "carrier_u_rad_per_pixel": self.ku.tolist(), "filter_radius": float(self.radius),
                "coordinate_convention": "original image pixel centers; x right, y down; ROI half-open",
                "warnings": self.warnings}

    def coordinates(self):
        e = self.config.edge_crop
        offset = 0 if self.config.pipeline == 'legacy' else 1
        x = (np.arange(self.reference.shape[1]-2*e)+offset)*self.scale
        y = (np.arange(self.reference.shape[0]-2*e)+offset)*self.scale
        if self.config.coordinate_calibration and self.config.pipeline != "legacy":
            x = (x-10*self.config.cal_x_offset_cm)/self.config.cal_x_slope
            y = (y-10*self.config.cal_y_offset_cm)/self.config.cal_y_slope
        return x, y

    def restore(self, image):
        a = gray(image)
        if a.shape != self.image_shape:
            raise ValueError(f"动态图尺寸 {a.shape} 与参考图 {self.image_shape} 不一致；不能自动缩放定量输入")
        x0, y0, x1, y1 = self.roi
        frame = a[y0:y1, x0:x1]
        valid, holes = self.valid_ref.copy(), self.holes_ref.copy()
        if self.config.masking and self.config.pipeline != "legacy":
            vf, hf, _ = valid_mask(frame, self.config, self.thresholds)
            valid &= vf; holes |= hf
            frame, fallback = fill_pattern(frame, self.reference, holes, [self.kr, self.ku], int(self.config.fill_ring))
            self.fill_fallbacks += int(fallback)
        if valid.sum() < 64:
            raise ValueError("动态图有效像素不足")
        fd = fft.fft2(frame)
        phases, qualities = [], []
        for mask, refconj, refamp in self.carriers:
            field = fft.ifft2(fd*mask)
            ph = -np.angle(field*refconj)
            phases.append(unwrap_phase(ph) if self.config.unwrap else ph)
            # Signal strength, NOT an uncertainty or accuracy estimate.
            med = max(float(np.median(refamp)), np.finfo(float).tiny)
            qualities.append(np.minimum(refamp/med, np.abs(field)/med))
        kr, ku = self.kr, self.ku
        det = kr[0]*ku[1]-kr[1]*ku[0]
        u = (ku[1]*phases[0]-kr[1]*phases[1])/det
        v = (kr[0]*phases[1]-ku[0]*phases[0])/det
        e = self.config.edge_crop
        cut = (slice(e, -e), slice(e, -e)) if e else (slice(None), slice(None))
        if self.config.pipeline == "legacy":
            u, v, valid = u[cut], v[cut], valid[cut]
        else:
            u, v = self.bridge.apply(u, holes), self.bridge.apply(v, holes)
            if self.config.displacement_calibration:
                u = (u-10*self.config.cal_x_offset_cm/self.scale)/self.config.cal_x_slope
                v = (v-10*self.config.cal_y_offset_cm/self.scale)/self.config.cal_y_slope
        mean = [float(u[valid].mean()), float(v[valid].mean())]
        if self.config.remove_mean_displacement:
            u, v = u-mean[0], v-mean[1]
        raw = inverse_gradient(-u, -v, difference=self.config.integration == "difference")/self.H*self.scale
        if self.config.pipeline != "legacy":
            raw, u, v, valid = raw[cut], u[cut], v[cut], valid[cut]
        height = detrend_field(raw, self.config.detrend, valid)
        raw[~valid] = np.nan; height[~valid] = np.nan
        q = np.minimum(*qualities)[cut]
        low = float(np.mean(q < .15))
        warnings = self.warnings.copy()
        if low > .05:
            warnings.append(f"{100*low:.1f}% 像素的载波较弱；遮挡/失焦可能污染积分高度")
        return {"height_mm": height.astype(np.float32), "raw_height_mm": raw.astype(np.float32),
                "u_px": u.astype(np.float32), "v_px": v.astype(np.float32),
                "slope_x": (-u/self.H).astype(np.float32), "slope_y": (-v/self.H).astype(np.float32),
                "carrier_quality": q.astype(np.float32), "mean_displacement_px": mean,
                "low_carrier_fraction": low, "warnings": warnings, "valid": valid}


def sample_geometry(field, geometry, origin, scale):
    """Bilinear sampling. Geometry always uses original image pixel centers."""
    rows = []
    ny, nx = field.shape
    for i, point in enumerate(geometry.get("points", [])):
        rows.append(("point", i+1, np.array([point], dtype=float)))
    for i, line in enumerate(geometry.get("lines", [])):
        a, b = np.asarray(line, dtype=float)
        count = max(2, int(np.ceil(np.linalg.norm(b-a)))+1)
        rows.append(("line", i+1, np.linspace(a, b, count)))
    out = []
    for kind, idx, xy in rows:
        local = xy-np.asarray(origin)
        if (not np.isfinite(local).all() or (local < 0).any() or
                (local[:, 0] > nx-1).any() or (local[:, 1] > ny-1).any()):
            raise ValueError(f"{kind} {idx} 位于有效高度场之外（请留出边缘裁剪）")
        values = ndimage.map_coordinates(field, [local[:, 1], local[:, 0]], order=1, mode="nearest")
        distance = np.linalg.norm(xy-xy[0], axis=1)*scale
        out.append({"kind": kind, "id": idx, "xy_px": xy, "xy_mm": local*scale,
                    "distance_mm": distance, "height_mm": values})
    return out


def synthetic_frame(n=256, phase=0.0, amplitude_mm=.3):
    """Analytic small-slope fixture: known sinusoidal elevation, no image interpolation."""
    y, x = np.indices((n, n), dtype=float)
    scale, period, leff = 1.5/8, 128., (20+10*1.33/1.49)*(1-1.00029/1.33)
    w = 2*np.pi/period
    h = amplitude_mm*np.cos(w*x+phase)*np.cos(w*y)
    sx = -amplitude_mm*w/scale*np.sin(w*x+phase)*np.cos(w*y)
    sy = -amplitude_mm*w/scale*np.cos(w*x+phase)*np.sin(w*y)
    u, v = -leff*sx/scale, -leff*sy/scale
    def grid(xx, yy):
        return 127.5 + 57*np.cos(np.pi/8*(xx+yy)) + 57*np.cos(np.pi/8*(xx-yy))
    return grid(x, y), grid(x-u, y-v), h
