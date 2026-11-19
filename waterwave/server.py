"""Loopback-only local GUI host. Standard library HTTP; no remote backend."""
import argparse
import atexit
import base64
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import tempfile
import threading
from urllib.parse import urlparse, parse_qs, quote
import re
import uuid
import webbrowser
import numpy as np
from scipy import fft
from .session import dispatch, image_preview, sessions
from .fields import fields, artifacts
from .acceleration import fft_backend, INFO as ACCELERATOR_INFO
from .gpu import make_demodulator, INFO as GPU_INFO

ACCELERATOR_INFO['gpu'] = GPU_INFO

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "src" / "water-wave"
videos = {}
lock = threading.Lock()
calculator = ThreadPoolExecutor(max_workers=1, thread_name_prefix='waterwave')
ONLINE_ORIGIN = 'https://kotokowa.github.io'


def read_video_frame(key, index):
    import cv2
    if key not in videos:
        raise ValueError("视频不存在，请重新导入")
    entry = videos[key]
    if not isinstance(index, int) or not 0 <= index < entry["count"]:
        raise ValueError("视频帧索引越界")
    cap = entry.get('capture')
    if cap is None:
        cap = entry['capture'] = cv2.VideoCapture(str(entry['path']))
        entry['next_index'] = 0
    if entry['next_index'] != index:
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, a = cap.read()
    if not ok:
        raise ValueError(f"无法解码第 {index+1} 帧")
    entry['next_index'] = index+1
    return cv2.cvtColor(a, cv2.COLOR_BGR2RGB)


def cleanup():
    calculator.shutdown(wait=True)
    for s in list(sessions.values()):
        s.dispose()
    for mapping in (fields, artifacts):
        for path in mapping.values(): path.unlink(missing_ok=True)
        mapping.clear()
    for entry in videos.values():
        if entry.get('capture') is not None: entry['capture'].release()
        entry["path"].unlink(missing_ok=True)


def calculate(m):
    # A persistent worker keeps FFT plans bounded across HTTP requests.
    with lock, fft.set_workers(min(4, os.cpu_count() or 1)), fft_backend():
        if m.get('op') == 'video_frame':
            a = read_video_frame(m['video'], m['index'])
            s = sessions[m['session']]
            return s.process(a, m['name'], m['index']+1, m['index']/videos[m['video']]['fps'], m.get('preview', True))
        if m.get('op') == 'release_video':
            entry = videos.pop(m['video'], None)
            if entry:
                if entry.get('capture') is not None: entry['capture'].release()
                entry['path'].unlink(missing_ok=True)
            return {'ok': True}
        result=dispatch(m)
        if m.get('op') == 'start':
            recon=sessions[result['session']].recon
            recon.demodulator=make_demodulator(recon)
        return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(UI), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get('Origin')
        if origin and self.valid_origin():
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def valid_origin(self):
        return self.headers.get('Origin') in (None, ONLINE_ORIGIN,
            f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}')

    def do_OPTIONS(self):
        if not self.valid_host() or not self.valid_origin():
            return self.json_response({'error': '来源未授权'}, 403)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def json_response(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get("Host") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

    def do_GET(self):
        if not self.valid_host() or not self.valid_origin():
            return self.json_response({"error": "仅允许本机访问"}, 403)
        parsed = urlparse(self.path)
        if parsed.path == "/api/info":
            return self.json_response({"mode": "local", "protocol": 2, "version": "2.2.0", "acceleration": ACCELERATOR_INFO})
        if parsed.path == "/api/download":
            key = parse_qs(parsed.query).get("session", [""])[0]
            s = sessions.get(key)
            if not s or not s.finished:
                return self.json_response({"error": "结果未就绪"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            name = parse_qs(parsed.query).get("filename", ["water-wave-results.zip"])[0]
            name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)[:180]
            if not name.lower().endswith('.zip'):
                name += '.zip'
            self.send_header("Content-Disposition", "attachment; filename=\"water-wave-results.zip\"; filename*=UTF-8''" + quote(name, safe=''))
            self.send_header("Content-Length", str(s.path.stat().st_size))
            self.end_headers()
            with s.path.open("rb") as f:
                while data := f.read(1024*1024):
                    self.wfile.write(data)
            return
        if parsed.path == "/" or parsed.path == "/water-wave/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            return self.json_response({"error": "仅允许本机同源请求"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.path == "/api/video":
                if not 0 < length <= 16*1024**3:
                    raise ValueError("视频为空或超过本地版 16 GiB 导入限制")
                import cv2
                suffix = ".avi" if "avi" in self.headers.get("Content-Type", "") else ".mp4"
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="waterwave-video-", dir=os.environ.get("WATERWAVE_TMP")) as f:
                    path = Path(f.name)
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(1024*1024, remaining))
                        if not chunk:
                            raise ValueError("视频上传中断")
                        f.write(chunk)
                        remaining -= len(chunk)
                cap = cv2.VideoCapture(str(path))
                try:
                    fps = cap.get(cv2.CAP_PROP_FPS)
                    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    ok, a = cap.read()
                    if not ok or count < 1 or not np.isfinite(fps) or fps <= 0:
                        raise ValueError("无法解码视频或读取有效帧率，请先转为恒定帧率 MP4/AVI")
                    key = uuid.uuid4().hex
                    videos[key] = {"path": path, "fps": fps, "count": count}
                    a = cv2.cvtColor(a, cv2.COLOR_BGR2RGB)
                    return self.json_response({"video": key, "fps": fps, "count": count,
                        "width": a.shape[1], "height": a.shape[0], "preview": image_preview(a)})
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
                finally:
                    cap.release()
            if self.path != "/api/rpc":
                return self.json_response({"error": "未知端点"}, 404)
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                return self.json_response({"error": "需要 JSON 请求"}, 415)
            if not 0 < length <= 200*1024**2:
                raise ValueError("单个请求为空或超过 200 MiB，请减小输入图尺寸")
            m = json.loads(self.rfile.read(length))
            out = calculator.submit(calculate, m).result()
            self.json_response(out)
        except Exception as e:
            self.json_response({"error": str(e)}, 400)

    def log_message(self, fmt, *args):
        # Avoid printing potentially private source filenames / request bodies.
        pass


def main():
    parser = argparse.ArgumentParser(description="Water Wave Lab 本地 UI")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not UI.is_dir():
        raise SystemExit("找不到 UI。请在完整源码目录运行 python -m waterwave")
    atexit.register(cleanup)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Water Wave Lab: {url}\n按 Ctrl+C 退出。文件在本机处理。", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
