"""Install optional FFT-only CUDA dependencies in this launcher's virtualenv."""
import importlib.util
from pathlib import Path
import os
import platform
import re
import shutil
import subprocess
import sys

if (os.environ.get('WATERWAVE_DISABLE_GPU') == '1' or
        platform.system() not in ('Windows', 'Linux') or platform.machine().lower() not in ('amd64', 'x86_64') or
        importlib.util.find_spec('cupy') is not None):
    raise SystemExit(0)
smi=shutil.which('nvidia-smi')
if not smi:
    raise SystemExit(0)
try:
    probe=subprocess.run([smi,'--query-gpu=driver_version,compute_cap','--format=csv,noheader'],
        capture_output=True,text=True,timeout=10,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    devices=re.findall(r'^(\d+)(?:\.\d+)+\s*,\s*(\d+)\.(\d+)\s*$',probe.stdout,re.M)
    if probe.returncode or not any(int(driver) >= 580 and (int(major), int(minor)) >= (7, 5) for driver, major, minor in devices):
        print('CUDA 13 / NVIDIA compute capability 7.5+ not detected. Continuing with CPU processing.',flush=True)
        raise SystemExit(0)
    print('Installing optional NVIDIA GPU acceleration. CPU processing remains available.',flush=True)
    subprocess.run([sys.executable,'-m','pip','install','-r',str(Path(__file__).resolve().parent.parent/'requirements-waterwave-gpu.txt')],check=True)
except (OSError,subprocess.SubprocessError):
    print('GPU setup did not finish. Continuing with CPU processing.',flush=True)
