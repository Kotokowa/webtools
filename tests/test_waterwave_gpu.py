import unittest
from unittest.mock import patch
import numpy as np
from waterwave.core import Config, Reconstructor, synthetic_frame
from waterwave import gpu


@unittest.skipUnless(gpu.INFO['available'], 'Optional CUDA runtime unavailable')
class GPUTests(unittest.TestCase):
    def test_resident_demodulation_and_runtime_fallback(self):
        ref,frame,_=synthetic_frame(512,amplitude_mm=.7)
        recon=Reconstructor(ref,config=Config(water_depth_mm=20,masking=False))
        expected=recon.restore(frame)
        recon.demodulator=gpu.make_demodulator(recon)
        self.assertIsNotNone(recon.demodulator)
        actual=recon.restore(frame)
        self.assertTrue(gpu.INFO['available'],gpu.INFO)
        for key in ('height_mm','u_px','v_px','carrier_quality'):
            np.testing.assert_allclose(actual[key],expected[key],atol=1e-6,rtol=1e-5)
        original=gpu.demodulate
        def failure(*args,**kwargs):
            if 'xp' in kwargs:raise RuntimeError('Simulated GPU allocation failure')
            return original(*args,**kwargs)
        with patch.dict(gpu.INFO),patch.object(gpu,'demodulate',side_effect=failure):
            fallback=recon.restore(frame)
            self.assertFalse(gpu.INFO['available'])
            np.testing.assert_array_equal(fallback['height_mm'],expected['height_mm'])


if __name__=='__main__':unittest.main()
