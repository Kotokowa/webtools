import io
import json
import unittest
import numpy as np
from scipy.io import savemat
from waterwave.core import Config, Reconstructor, synthetic_frame
from waterwave.measurement import RMSAccumulator, Bridge
from waterwave.analysis import analyze, average_fields, load_field, compatible, steepness


def gaussian_field(n=65, amplitude=2, error=.01):
    x = np.linspace(-5, 5, n); y = np.linspace(7.6, 17.6, n)
    xx, yy = np.meshgrid(x, y)
    z = .1+amplitude*np.exp(-.5*((xx/.7)**2+((yy-12.6)/1.1)**2))
    return dict(Z=z, dZ=np.full_like(z, error), valid=np.ones_like(z, bool), X_cm=x, Y_cm=y,
                config_json=json.dumps(dict(water_depth_mm=30, frequency_hz=6)))


class MeasurementTests(unittest.TestCase):
    def test_final3_recovers_known_wave_with_matching_physics(self):
        ref, image, truth = synthetic_frame()
        cfg = Config(water_depth_mm=20, coordinate_calibration=False, displacement_calibration=False, detrend='none')
        recon = Reconstructor(ref, config=cfg)
        h = recon.restore(image)['height_mm']; truth = truth[10:-10, 10:-10]
        valid = np.isfinite(h); a, b = h[valid], truth[valid]; a -= a.mean(); b -= b.mean()
        self.assertLess(np.sqrt(np.mean((a-b)**2)/np.mean(b*b)), .03)

    def test_internal_occlusion_is_never_reported_as_measured_height(self):
        ref, image, _ = synthetic_frame()
        ref[100:150, 110:145] = 0; image[100:150, 110:145] = 0
        result = Reconstructor(ref).restore(image)
        self.assertTrue(np.isnan(result['height_mm'][95:135, 105:130]).all())
        self.assertTrue(np.isfinite(result['height_mm'][20:60, 20:60]).all())

    def test_calibration_switches_are_independent(self):
        ref, image, _ = synthetic_frame()
        a = Reconstructor(ref, config=Config(coordinate_calibration=False))
        b = Reconstructor(ref, config=Config(coordinate_calibration=True))
        np.testing.assert_allclose(a.restore(image)['height_mm'], b.restore(image)['height_mm'])
        np.testing.assert_allclose(b.coordinates()[1], (a.coordinates()[1]-.5)/1.020)
        c = Reconstructor(ref, config=Config(displacement_calibration=False))
        self.assertGreater(np.nanmax(np.abs(c.restore(image)['height_mm']-b.restore(image)['height_mm'])), 1e-5)

    def test_harmonic_bridge_recovers_plane_and_caches(self):
        y,x=np.indices((32,32)); plane=(x+2*y).astype(float); holes=np.zeros(plane.shape,bool);holes[10:20,12:18]=True
        image=plane.copy();image[holes]=0;bridge=Bridge();out=bridge.apply(image,holes);solver=bridge.solve
        np.testing.assert_allclose(out,plane,atol=1e-10);bridge.apply(image,holes);self.assertIs(solver,bridge.solve)

    def test_streaming_rms_and_insufficient_coverage(self):
        acc=RMSAccumulator((2,2)); samples=[]
        for i in range(100):
            h=np.full((2,2),3*np.cos(2*np.pi*i/100));h[0,0]=np.nan if i<30 else h[0,0];samples.append(h);acc.add(h,i/100)
        out=acc.finish();self.assertAlmostEqual(out['Z'][1,1],3/np.sqrt(2),places=12);self.assertTrue(np.isnan(out['Z'][0,0]));self.assertGreater(out['dZ'][1,1],0)

    def test_lockin_handles_irregular_missing_samples_and_frequency(self):
        times=np.random.default_rng(42).uniform(0,4,200)
        acc=RMSAccumulator((1,2), frequency=6)
        for i,t in enumerate(times):
            h=np.array([[2*np.cos(2*np.pi*6*t)+3*np.sin(2*np.pi*6*t)+.7]*2]);
            if i%7==0:h[0,0]=np.nan
            acc.add(h,t)
        out=acc.finish();np.testing.assert_allclose(out['Z'],np.sqrt(13/2),atol=1e-10);self.assertLess(np.nanmax(out['dZ']),1e-7)


class AnalysisTests(unittest.TestCase):
    def test_repeat_arithmetic_mean_and_error(self):
        a=gaussian_field();b=gaussian_field();b['Z']=a['Z']*2
        mean=average_fields(iter([a,b]));np.testing.assert_allclose(mean['Z'],a['Z']*1.5);np.testing.assert_allclose(mean['uA'],a['Z']/2)
        single=average_fields(iter([a]));self.assertTrue(np.isnan(single['uA']).all())

    def test_mat_npz_units_and_grid_validation(self):
        f=gaussian_field();out=io.BytesIO();savemat(out,f);loaded=load_field(out.getvalue(),'field.mat');np.testing.assert_allclose(loaded['Z'],f['Z']);compatible(f,loaded)
        out=io.BytesIO();np.savez(out,**f);loaded=load_field(out.getvalue(),'field.npz');compatible(f,loaded)
        loaded['X_cm']+=1
        with self.assertRaises(ValueError):compatible(f,loaded)

    def test_gaussian_focus_width_and_reference_gain(self):
        f=gaussian_field(n=49);ref=gaussian_field(n=49);ref['Z']=f['Z']/2
        metrics,profiles,model,mask=analyze(f,[0,12.6],dict(starts=1,fit_samples=3000),ref)
        np.testing.assert_allclose(metrics['center_cm'],[0,12.6],atol=.01)
        self.assertAlmostEqual(metrics['fit_x_fwhm_cm'],2*np.sqrt(2*np.log(2))*.7,delta=.06)
        self.assertAlmostEqual(metrics['fit_y_fwhm_cm'],2*np.sqrt(2*np.log(2))*1.1,delta=.06)
        self.assertAlmostEqual(metrics['fit_gain']['line_gain'],4,places=5)
        self.assertAlmostEqual(metrics['fit_gain']['area_gain'],4,places=5)
        self.assertGreater(metrics['ee90_radius_cm'],metrics['ee50_radius_cm'])
        json.dumps(metrics,allow_nan=False)

    def test_dispersion_satisfies_equation(self):
        st=steepness(np.ones((2,2)),dict(water_depth_mm=30,frequency_hz=6));k=200*np.pi/st['wavelength_cm']
        self.assertAlmostEqual((9.796*k+.072*k**3/998)*np.tanh(k*.03),(12*np.pi)**2,places=6)


if __name__=='__main__':unittest.main()
