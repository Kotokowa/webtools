import io
import unittest
import numpy as np
from scipy import ndimage
from waterwave.measurement import dilate_disk, fill_pattern
from waterwave.core import detrend_field, synthetic_frame, inverse_gradient
from waterwave.session import Session
from waterwave.fields import dispatch_field, artifacts
from waterwave.analysis import reference_on_grid


class StreamingTests(unittest.TestCase):
    def test_real_inverse_gradient_matches_full_complex_transform(self):
        rng=np.random.default_rng(14)
        for shape in ((63,79),(64,80),(63,80),(64,79)):
            fx,fy=rng.normal(size=(2,*shape))
            ny,nx=shape
            for difference in (False,True):
                kx,ky=np.meshgrid(2*np.pi*np.fft.fftfreq(nx),2*np.pi*np.fft.fftfreq(ny))
                if difference:kx,ky=np.sin(kx),np.sin(ky)
                k2=kx*kx+ky*ky
                if nx%2==0:kx[:,nx//2]=0
                if ny%2==0:ky[ny//2,:]=0
                k2[k2<np.finfo(float).eps]=1
                expected=np.fft.ifft2((-1j*kx*np.fft.fft2(fx)-1j*ky*np.fft.fft2(fy))/k2).real
                expected+=fx.mean()*np.arange(nx)[None,:]+fy.mean()*np.arange(ny)[:,None]
                np.testing.assert_allclose(inverse_gradient(fx,fy,difference=difference,boundary=False),expected,atol=1e-12)

    def test_reference_interpolation_preserves_physical_linear_field(self):
        x = np.linspace(0, 10, 100); y = np.linspace(0, 8, 80)
        def field(x, y):
            z = 1+x[None, :]+2*y[:, None]
            return dict(Z=z, dZ=np.full_like(z, .01), valid=np.ones_like(z, bool), X_cm=x, Y_cm=y)
        target=field(x, y); reference=field(x*1.00022, y*1.00022)
        aligned, changed=reference_on_grid(reference, target)
        self.assertTrue(changed)
        np.testing.assert_allclose(aligned['Z'], target['Z'], atol=1e-12)
        with self.assertRaises(ValueError): reference_on_grid(field(x+.2, y), target)

    def test_disk_dilation_is_exact_including_borders_and_empty_masks(self):
        rng = np.random.default_rng(7)
        masks = [rng.random((71, 83)) < .02, np.zeros((71, 83), bool), np.ones((71, 83), bool)]
        for mask in masks:
            for radius in (0, 1, 3, 12, 20):
                y, x = np.ogrid[-radius:radius+1, -radius:radius+1]
                expected = ndimage.binary_dilation(mask, x*x+y*y <= radius*radius)
                np.testing.assert_array_equal(dilate_disk(mask, radius), expected)

    def test_sparse_pattern_basis_matches_dense_original(self):
        y, x = np.indices((97, 113)); carriers = [(0.4, .3), (.2, -.4)]
        basis = [np.ones(x.shape)]
        for k in carriers:
            phase = k[0]*x+k[1]*y
            basis += [np.cos(phase), np.sin(phase)]
        ref = sum(c*b for c, b in zip([120, 30, 10, 40, -5], basis))
        holes = np.zeros(ref.shape, bool); holes[25:60, 35:70] = True
        image = ref.copy(); image[holes] = 0
        out, fallback = fill_pattern(image, ref, holes, carriers, 12)
        self.assertFalse(fallback)
        np.testing.assert_allclose(out, ref, atol=1e-10)

    def test_detrending_matches_dense_fit_with_missing_pixels(self):
        rng = np.random.default_rng(12); h = rng.normal(size=(79, 91))
        valid = rng.random(h.shape) > .2
        y, x = np.meshgrid(np.linspace(-1, 1, h.shape[0]), np.linspace(-1, 1, h.shape[1]), indexing='ij')
        for mode in ('plane', 'quadratic'):
            basis = [np.ones_like(x), x, y]
            if mode == 'quadratic': basis += [x*x, y*y, x*y]
            design = np.stack([b.ravel() for b in basis], axis=1)
            coeff = np.linalg.lstsq(design[valid.ravel()], h[valid], rcond=None)[0]
            expected = h-(design@coeff).reshape(h.shape)
            np.testing.assert_allclose(detrend_field(h, mode, valid), expected, atol=1e-12)

    def test_frame_files_are_drained_and_cached_rms_matches_fresh(self):
        ref, frame, _ = synthetic_frame(128)
        options = dict(config=dict(masking=False), exports=['height_npz'], direct_files=True)
        fresh, resumed = Session(ref, options), Session(ref, options)
        try:
            for i in (1, 2):
                result = fresh.process(frame, 'source.avi', i, (i-1)/100, preview=False)
                self.assertNotIn('preview', result)
                self.assertEqual(len(result['files']), 2)
                self.assertEqual(fresh.direct_files, [])
                item = result['files'][0]
                p = artifacts[item['artifact']]
                resumed.cached_frame(p.read_bytes(), 'source.avi', i, (i-1)/100)
                dispatch_field(dict(op='artifact_dispose', artifact=item['artifact']))
                dispatch_field(dict(op='artifact_dispose', artifact=result['files'][1]['artifact']))
                self.assertFalse(p.exists())
            for key in ('Z', 'dZ', 'count', 'valid'):
                np.testing.assert_allclose(fresh.rms.finish()[key], resumed.rms.finish()[key])
        finally:
            fresh.dispose(); resumed.dispose()


if __name__ == '__main__': unittest.main()
