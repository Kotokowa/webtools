"""File decoding, reusable geometry records, streaming exports and UI RPC."""
import base64
import csv
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid
import zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import signal
from .core import Config, Reconstructor, sample_geometry, synthetic_frame
from . import __version__

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
EXPORTS = {"height_npz", "raw_npz", "height_csv", "height_png", "displacement", "quality", "lines", "points", "temporal", "spectrum", "wavelength", "video"}


def natural_key(name):
    return [(0, int(p)) if p.isdigit() else (1, p.casefold()) for p in re.split(r"(\d+)", str(name))]


def decode_image(data):
    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im)
        # Preserve integer / floating grayscale TIFF values.
        return np.array(im if im.mode in ("L", "I", "F", "I;16", "I;16B") else im.convert("RGB"))


def png_bytes(image):
    b = io.BytesIO()
    image.save(b, format="PNG")
    return b.getvalue()


def image_preview(a):
    a = np.asarray(a)
    if a.dtype != np.uint8:
        lo, hi = np.percentile(a, [1, 99])
        a = np.clip((a-lo)/max(hi-lo, 1e-12)*255, 0, 255).astype(np.uint8)
    im = Image.fromarray(a)
    im.thumbnail((1100, 850))
    return base64.b64encode(png_bytes(im)).decode()


def field_image(field, limit, *, title="Elevation (mm)", scale=None, positive=False, annotate=False):
    a = np.asarray(field)
    t = np.clip(a/limit if positive else (a/limit+1)/2, 0, 1)
    stops = np.array([[27, 66, 122], [56, 140, 178], [241, 246, 247], [234, 147, 91], [165, 44, 47]])
    rgb = np.stack([np.interp(t, np.linspace(0, 1, len(stops)), stops[:, c]) for c in range(3)], axis=-1).astype(np.uint8)
    im = Image.fromarray(rgb)
    if not annotate:
        return im
    original_shape = a.shape
    im.thumbnail((1400, 1200))
    out = Image.new("RGB", (im.width+120, im.height+76), "white")
    out.paste(im, (48, 32))
    draw = ImageDraw.Draw(out)
    draw.text((48, 9), title, fill="#243746")
    bar = field_image(np.linspace(limit, 0 if positive else -limit, im.height)[:, None].repeat(16, axis=1), limit, positive=positive)
    out.paste(bar, (im.width+62, 32))
    for frac in (0, .5, 1):
        val = limit*(1-frac) if positive else limit*(1-2*frac)
        draw.text((im.width+80, 32+int(frac*(im.height-10))), f"{val:.3g}", fill="#243746")
    draw.text((48, im.height+43), "x right / y down; origin at retained ROI top-left", fill="#536877")
    if scale:
        draw.text((48, im.height+58), f"Width {(original_shape[1]-1)*scale:.3f} mm | Height {(original_shape[0]-1)*scale:.3f} mm", fill="#536877")
    return out


def validate_geometry(geometry, recon):
    if not isinstance(geometry, dict):
        raise ValueError("线点记录必须为对象")
    for key, shape in [("points", (2,)), ("lines", (2, 2))]:
        value = geometry.get(key, [])
        if not isinstance(value, list) or len(value) > 100:
            raise ValueError("最多支持 100 条线或 100 个点")
        for item in value:
            a = np.asarray(item, dtype=float)
            if a.shape != shape or not np.isfinite(a).all():
                raise ValueError("线点坐标格式不正确")
    sample_geometry(np.zeros(recon.metadata["output_shape"], np.float32), geometry,
                    recon.metadata["output_origin_px"], recon.scale)


class Session:
    def __init__(self, reference, settings):
        self.recon = Reconstructor(reference, settings.get("roi"), Config(**settings.get("config", {})))
        self.geometry = settings.get("geometry", {"lines": [], "points": []})
        validate_geometry(self.geometry, self.recon)
        self.exports = set(settings.get("exports", ["height_npz", "height_png"]))
        if self.exports - EXPORTS:
            raise ValueError("未知导出类型")
        if self.exports & {"lines", "wavelength"} and not self.geometry.get("lines"):
            raise ValueError("已勾选线数据，请先画至少一条线")
        if self.exports & {"points", "spectrum"} and not self.geometry.get("points"):
            raise ValueError("已勾选点数据，请先选至少一个点")
        if self.exports & {"temporal", "spectrum", "video"} and self.recon.config.fps <= 0:
            raise ValueError("时间分析或视频导出需要输入采集帧率")
        # Normal inherited Windows ACLs: Python 3.13 mkdtemp(mode=0700) can
        # produce directories inaccessible to a restricted desktop token.
        self.directory = Path(os.environ.get("WATERWAVE_TMP", tempfile.gettempdir())) / ("waterwave-"+uuid.uuid4().hex)
        self.directory.mkdir()
        self.path = self.directory / "water-wave-results.zip"
        self.zip = zipfile.ZipFile(self.path, "w", zipfile.ZIP_DEFLATED, compresslevel=3)
        self.frames, self.heights, self.point_signals, self.video_paths = [], [], [], []
        self.tables = {}
        self.closed = False
        self.finished = False
        self.reference_name = settings.get("reference_name", "reference")

    def table(self, name, header, rows):
        if name not in self.tables:
            f = (self.directory/name).open("w", encoding="utf-8-sig", newline="")
            w = csv.writer(f)
            w.writerow(header)
            self.tables[name] = (f, w)
        self.tables[name][1].writerows(rows)

    def array_file(self, name, **arrays):
        with self.zip.open(name, "w", force_zip64=True) as f:
            # np.savez uses an uncompressed inner ZIP; outer archive compresses it.
            np.savez(f, **arrays)

    def process(self, image, name, frame_id, time_s=None):
        if self.closed:
            raise ValueError("任务已结束，请新建处理任务")
        if not math.isfinite(float(frame_id)) or int(frame_id) != frame_id:
            raise ValueError("帧号须为整数")
        if self.frames and frame_id <= self.frames[-1]["frame_id"]:
            raise ValueError("帧号须严格递增；请按原始帧号排序")
        if time_s is not None and (not math.isfinite(time_s) or time_s < 0):
            raise ValueError("时间戳必须为非负有限值")
        pixels = int(np.prod(self.recon.metadata["output_shape"]))
        if "temporal" in self.exports and (len(self.heights)+1)*pixels*4*6 > self.recon.config.temporal_limit_mb*1024**2:
            raise ValueError("时域分析预计超出内存限额；减小选区/帧数或取消振幅相位导出。已完成帧可保留下载")
        result = self.recon.restore(image)
        h = result["height_mm"]
        seq = len(self.frames)+1
        tag = f"{seq:06d}_frame_{frame_id}"
        origin, scale = self.recon.metadata["output_origin_px"], self.recon.scale
        samples = sample_geometry(h, self.geometry, origin, scale)
        if "wavelength" in self.exports:
            for sample in samples:
                if sample["kind"] != "line":
                    continue
                values = np.asarray(sample["height_mm"], dtype=float)
                wavelength = frequency = ""
                note = "too few samples or zero signal"
                if len(values) >= 16 and np.std(values) > 1e-9:
                    distance = sample["distance_mm"]
                    dx = float(distance[-1]/(len(distance)-1))
                    window = signal.windows.hann(len(values), sym=False)
                    amp = np.abs(np.fft.rfft((values-values.mean())*window))*2/window.sum()
                    freq = np.fft.rfftfreq(len(values), dx)
                    k = int(np.argmax(amp[1:])+1)  # Restore skipped DC index.
                    frequency = float(freq[k])
                    wavelength = 1/frequency
                    note = "projected along line; FFT bin estimate; finite-length resolution"
                    self.table(f"line_{sample['id']}_spatial_spectrum.csv",
                               ["frame_id", "spatial_frequency_per_mm", "amplitude_mm"],
                               [[frame_id, float(f), float(a)] for f, a in zip(freq, amp)])
                self.table("wavelength.csv", ["frame_id", "time_s", "line_id", "spatial_frequency_per_mm", "wavelength_mm", "note"],
                           [[frame_id, time_s, sample["id"], frequency, wavelength, note]])
        meta = {"source_name": str(name), "frame_id": int(frame_id), "time_s": time_s,
                "min_mm": float(h.min()), "max_mm": float(h.max()), "rms_mm": float(np.sqrt(np.mean(h*h))),
                "mean_mm": float(h.mean()), "low_carrier_fraction": result["low_carrier_fraction"],
                "mean_displacement_px": result["mean_displacement_px"], "warnings": result["warnings"]}
        if "height_npz" in self.exports:
            self.array_file(f"height/{tag}.npz", height_mm=h, x_mm=np.arange(h.shape[1])*scale,
                            y_mm=np.arange(h.shape[0])*scale, origin_px=origin,
                            frame_id=frame_id, time_s=np.nan if time_s is None else time_s)
        if "raw_npz" in self.exports:
            self.array_file(f"before_detrend/{tag}.npz", height_mm=result["raw_height_mm"])
        if "height_csv" in self.exports:
            with self.zip.open(f"height_csv/{tag}.csv", "w") as binary:
                with io.TextIOWrapper(binary, encoding="utf-8", newline="") as f:
                    np.savetxt(f, h, delimiter=",", fmt="%.7g", header="height_mm; rows=y, columns=x; scale/origin in manifest.json")
        if self.exports & {"height_png", "video"}:
            pic = field_image(h, self.recon.config.color_limit_mm, scale=scale, annotate=True,
                              title=f"Elevation (mm) | Frame {frame_id} | t={time_s if time_s is not None else 'unknown'} s")
            data = png_bytes(pic)
            if "height_png" in self.exports:
                self.zip.writestr(f"images/{tag}.png", data)
            if "video" in self.exports:
                p = self.directory/f"{tag}.png"
                p.write_bytes(data)
                self.video_paths.append(p)
        if "displacement" in self.exports:
            self.array_file(f"optical_displacement/{tag}.npz", u_px=result["u_px"], v_px=result["v_px"],
                            slope_x=result["slope_x"], slope_y=result["slope_y"])
        if "quality" in self.exports:
            self.array_file(f"quality/{tag}.npz", carrier_strength=result["carrier_quality"])
        for sample in samples:
            kind = sample["kind"]
            if ("lines" if kind == "line" else "points") not in self.exports:
                continue
            rows = [[frame_id, "" if time_s is None else time_s, name, sample["id"], j,
                     *sample["xy_px"][j], *sample["xy_mm"][j], sample["distance_mm"][j], float(value)]
                    for j, value in enumerate(sample["height_mm"])]
            self.table("points.csv" if kind == "point" else f"line_{sample['id']}.csv",
                       ["frame_id", "time_s", "source_name", "geometry_id", "sample_index", "x_original_px", "y_original_px", "x_mm", "y_mm", "distance_mm", "height_mm"], rows)
        if "temporal" in self.exports:
            self.heights.append(h)
        if "spectrum" in self.exports:
            self.point_signals.append([float(s["height_mm"][0]) for s in samples if s["kind"] == "point"])
        self.frames.append(meta)
        preview = field_image(h, self.recon.config.color_limit_mm)
        preview.thumbnail((1100, 850))
        return {"summary": meta, "preview": base64.b64encode(png_bytes(preview)).decode(), "count": seq}

    def finish(self, partial=False):
        if self.finished:
            return self.path
        if self.closed:
            raise ValueError("任务已取消")
        if not self.frames:
            raise ValueError("还没有成功处理的帧")
        temporal_note = None
        times = [f["time_s"] for f in self.frames]
        uniform = len(times) >= 3 and all(t is not None for t in times)
        if uniform:
            delta = np.diff(times)
            uniform = bool(np.all(delta > 0) and np.allclose(delta, delta[0], rtol=1e-4, atol=1e-6))
        if self.exports & {"temporal", "spectrum"} and not uniform:
            temporal_note = "少于 3 帧、时间未知或采样不均匀：未生成 Hilbert/频谱结果"
        if "temporal" in self.exports and uniform:
            stack = np.stack(self.heights, axis=0)
            self.heights.clear()
            stack -= stack.mean(axis=0, keepdims=True)
            analytic = np.conj(signal.hilbert(stack, axis=0))
            self.array_file("temporal/amplitude_phase.npz", amplitude_mm=np.abs(analytic).astype(np.float32),
                            phase_rad=np.mod(np.angle(analytic), 2*np.pi).astype(np.float32), time_s=times,
                            frame_id=[f["frame_id"] for f in self.frames], convention="exp(-i omega t); axis order time,y,x")
            mean_amp = np.abs(analytic).mean(axis=0)
            self.zip.writestr("temporal/mean_amplitude.png", png_bytes(field_image(mean_amp,
                self.recon.config.color_limit_mm, positive=True, annotate=True, title="Mean analytic amplitude (mm)", scale=self.recon.scale)))
        if "spectrum" in self.exports and uniform:
            if self.geometry.get("points"):
                signals = np.array(self.point_signals)
                signals -= signals.mean(axis=0)
                amp = np.abs(np.fft.rfft(signals, axis=0))/len(signals)
                amp[1:-1 if len(signals)%2 == 0 else None] *= 2
                frequencies = np.fft.rfftfreq(len(signals), times[1]-times[0])
                self.table("point_spectrum.csv", ["frequency_hz"]+[f"point_{j+1}_amplitude_mm" for j in range(signals.shape[1])],
                           [[float(f), *a.tolist()] for f, a in zip(frequencies, amp)])
            else:
                temporal_note = "未选择点：未生成点频谱"
        if "video" in self.exports:
            if uniform or len(times) == 2 and None not in times and times[1] > times[0]:
                import cv2
                fps = 1/(times[1]-times[0])
                first = np.array(Image.open(self.video_paths[0]).convert("RGB"))
                hh, ww = first.shape[:2]
                ww, hh = ww+ww%2, hh+hh%2
                path = self.directory/"height.mp4"
                writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (ww, hh))
                if not writer.isOpened():
                    raise ValueError("当前 OpenCV 无法创建 MP4；请取消视频导出后重试")
                try:
                    for p in self.video_paths:
                        a = np.array(Image.open(p).convert("RGB"))
                        a = np.pad(a, ((0, hh-a.shape[0]), (0, ww-a.shape[1]), (0, 0)), constant_values=255)
                        writer.write(cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
                finally:
                    writer.release()
                self.zip.write(path, "height.mp4")
            else:
                temporal_note = (temporal_note or "") + " 非均匀或不足两帧：未生成 MP4"
        self.table("summary.csv", ["frame_id", "time_s", "source_name", "min_mm", "max_mm", "rms_mm", "low_carrier_fraction"],
                   [[f[k] for k in ["frame_id", "time_s", "source_name", "min_mm", "max_mm", "rms_mm", "low_carrier_fraction"]] for f in self.frames])
        for name, (f, _) in self.tables.items():
            f.close()
            self.zip.write(self.directory/name, name)
        manifest = {"schema": "waterwave-results-v1", "version": __version__, **self.recon.metadata,
                    "reference_name": self.reference_name, "geometry": self.geometry, "exports": sorted(self.exports),
                    "frames": self.frames, "partial": partial, "temporal_note": temporal_note,
                    "interpretation": "Relative elevation after chosen detrending. Optical u/v are not fluid particle displacements. Hilbert edge frames are unreliable. No experimental error bound is claimed."}
        self.zip.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        self.zip.close()
        self.closed = self.finished = True
        self.heights.clear()
        return self.path

    def dispose(self):
        if not self.closed:
            for f, _ in self.tables.values():
                f.close()
            self.zip.close()
        self.closed = True
        shutil.rmtree(self.directory, ignore_errors=True)


sessions = {}


def dispatch(message):
    op = message.get("op")
    if op == "inspect":
        a = decode_image(base64.b64decode(message["data"], validate=True))
        return {"width": a.shape[1], "height": a.shape[0], "preview": image_preview(a)}
    if op == "demo":
        ref, frame, _ = synthetic_frame(256, phase=float(message.get("phase", 0)))
        a = ref if message.get("reference") else frame
        data = png_bytes(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
        return {"data": base64.b64encode(data).decode()}
    if op == "start":
        a = decode_image(base64.b64decode(message["data"], validate=True))
        s = Session(a, message["settings"])
        key = uuid.uuid4().hex
        sessions[key] = s
        return {"session": key, "metadata": s.recon.metadata}
    key = message.get("session")
    if key not in sessions:
        raise ValueError("任务不存在或已被清理")
    s = sessions[key]
    if op == "frame":
        return s.process(decode_image(base64.b64decode(message["data"], validate=True)),
                         message["name"], message["frame_id"], message.get("time_s"))
    if op == "finish":
        path = s.finish(bool(message.get("partial", False)))
        with zipfile.ZipFile(path) as z:
            note = json.loads(z.read("manifest.json"))["temporal_note"]
        return {"filename": path.name, "size": path.stat().st_size,
                "note": note}
    if op == "dispose":
        s.dispose()
        del sessions[key]
        return {"ok": True}
    raise ValueError("未知操作")
