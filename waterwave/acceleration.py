"""Optional native FFT/compression implementations; formulas remain unchanged."""
from contextlib import nullcontext
import os
import zipfile
from scipy import fft

INFO = {'fft': 'scipy', 'compression': 'zlib'}
if os.name == 'nt':
    # Explicit HighQoS applies only to this computation process. Leave the OS
    # power plan and every other application's scheduling policy untouched.
    try:
        import ctypes
        from ctypes import wintypes
        class PowerThrottling(ctypes.Structure):
            _fields_ = [('Version', wintypes.ULONG), ('ControlMask', wintypes.ULONG), ('StateMask', wintypes.ULONG)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        state = PowerThrottling(1, 1, 0)
        INFO['high_qos'] = bool(kernel.SetProcessInformation(kernel.GetCurrentProcess(), 4, ctypes.byref(state), ctypes.sizeof(state)))
    except (OSError, AttributeError):
        INFO['high_qos'] = False
_backend = None
try:
    import pyfftw
    import pyfftw.interfaces.scipy_fft
    import pyfftw.interfaces.cache
    pyfftw.config.PLANNER_EFFORT = 'FFTW_ESTIMATE'
    pyfftw.interfaces.cache.enable()
    pyfftw.interfaces.cache.set_keepalive_time(300)
    _backend = pyfftw.interfaces.scipy_fft
    INFO['fft'] = 'FFTW '+pyfftw.__version__
except ImportError:
    pass
try:
    from zlib_ng import zlib_ng
    zipfile.zlib = zlib_ng
    INFO['compression'] = 'zlib-ng'
except ImportError:
    pass


def fft_backend():
    return fft.set_backend(_backend) if _backend is not None else nullcontext()
