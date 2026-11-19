"""Optional resident GPU demodulation using the same core formulas and float64."""
import os
from pathlib import Path
import tempfile
from .core import demodulate

INFO = {'available': False}
cp = None
if os.environ.get('WATERWAVE_DISABLE_GPU') != '1':
    try:
        os.environ.setdefault('CUPY_CACHE_DIR', str(Path(os.environ.get('WATERWAVE_TMP', tempfile.gettempdir()))/'waterwave-cupy-cache'))
        import cupy as cp
        if cp.cuda.runtime.getDeviceCount():
            properties=cp.cuda.runtime.getDeviceProperties(0)
            name=properties['name']
            INFO.update(available=True, name=name.decode() if isinstance(name, bytes) else str(name),
                        cupy=cp.__version__, operation='float64 demodulation and phase unwrapping')
            cp.get_default_memory_pool().set_limit(size=2*1024**3)
    except Exception as error:
        INFO['reason']=str(error)


class Demodulator:
    def __init__(self, recon):
        self.host=recon.carriers
        self.kr,self.ku,self.unwrap=recon.kr,recon.ku,recon.config.unwrap
        self.device=None

    def __call__(self, frame):
        if INFO['available']:
            try:
                if self.device is None:
                    cp.fft.config.get_plan_cache().set_memsize(512*1024**2)
                    self.device=[(cp.asarray(mask),cp.asarray(ref),cp.asarray(amp),med)
                                 for mask,ref,amp,med in self.host]
                result=demodulate(cp.asarray(frame),self.device,self.kr,self.ku,self.unwrap,xp=cp,transform=cp.fft)
                return tuple(cp.asnumpy(value) for value in result)
            except Exception as error:
                INFO.update(available=False, fallback_reason=str(error))
                self.device=None
                try: cp.get_default_memory_pool().free_all_blocks()
                except Exception: pass
        return demodulate(frame,self.host,self.kr,self.ku,self.unwrap)


def make_demodulator(recon):
    if INFO['available'] and recon.reference.size >= 262144:
        return Demodulator(recon)
    return None
