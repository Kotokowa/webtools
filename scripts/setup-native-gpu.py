"""Install optional FFT-only CUDA dependencies in this launcher's virtualenv."""
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import sys

if importlib.util.find_spec('cupy') is not None:
    raise SystemExit(0)
smi=shutil.which('nvidia-smi')
if not smi:
    raise SystemExit(0)
try:
    probe=subprocess.run([smi,'--query-gpu=driver_version','--format=csv,noheader'],
        capture_output=True,text=True,timeout=10,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    versions=[int(v) for v in re.findall(r'^(\d+)\.',probe.stdout,re.M)]
    if probe.returncode or not versions or max(versions)<580:
        raise SystemExit(0)
    print('Installing optional NVIDIA GPU acceleration. CPU processing remains available.',flush=True)
    subprocess.run([sys.executable,'-m','pip','install','-r',str(Path(__file__).resolve().parent.parent/'requirements-waterwave-gpu.txt')],check=True)
except (OSError,subprocess.SubprocessError):
    print('GPU setup did not finish. Continuing with CPU processing.',flush=True)
