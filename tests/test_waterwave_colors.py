import base64
import io
import json
import unittest
import zipfile
import numpy as np
from PIL import Image
from waterwave.core import Config, synthetic_frame
from waterwave.colors import TABLES
from waterwave.session import Session, field_image
from waterwave.fields import save_field, dispatch_field, artifacts
from test_waterwave_v2 import gaussian_field


class ColorTests(unittest.TestCase):
    def test_jet_nan_saturation_and_colorbar(self):
        image=np.asarray(field_image(np.array([[-2.,-1.,0.,1.,2.,np.nan]]),1))
        np.testing.assert_array_equal(image[0,0],TABLES['jet'][0])
        np.testing.assert_array_equal(image[0,1],image[0,0])
        np.testing.assert_array_equal(image[0,3],TABLES['jet'][-1])
        np.testing.assert_array_equal(image[0,4],image[0,3])
        np.testing.assert_array_equal(image[0,5],[150,150,150])
        for palette in TABLES:
            a=np.linspace(1,-1,128)[:,None].repeat(64,axis=1)
            annotated=np.asarray(field_image(a,1,colormap=palette,annotate=True))
            np.testing.assert_array_equal(annotated[32:160,48],annotated[32:160,64+62])
        with self.assertRaises(ValueError): Config(colormap='unknown').validate()

    def test_colormap_changes_pixels_not_height_exports(self):
        ref,img,_=synthetic_frame();values=[];pictures=[]
        for palette in ('jet','gray'):
            session=Session(ref,dict(config=dict(water_depth_mm=20,colormap=palette),exports=['height_npz','height_png','rms_png','rms_npz']))
            try:
                session.process(img,'frame_0001.png',1,0);path=session.finish(False)
                with zipfile.ZipFile(path) as z:
                    height=next(n for n in z.namelist() if n.startswith('height/') and n.endswith('.npz'))
                    with np.load(io.BytesIO(z.read(height))) as data:values.append(data['height_mm'])
                    pictures.append(z.read(next(n for n in z.namelist() if n.startswith('images/'))))
                    self.assertEqual(json.loads(z.read('manifest.json'))['config']['colormap'],palette)
                    with np.load(io.BytesIO(z.read('rms.npz'))) as data:self.assertEqual(json.loads(str(data['config_json']))['colormap'],palette)
            finally:session.dispose()
        np.testing.assert_array_equal(values[0],values[1]);self.assertNotEqual(*pictures)

    def test_focal_selection_and_recolor(self):
        lens=gaussian_field(n=33);ref=gaussian_field(n=33);ref['Z']=lens['Z']/2
        key=save_field(lens);reference=save_field(ref)
        try:
            gray=dispatch_field(dict(op='field_info',field=key,colormap='gray'))
            pixels=np.asarray(Image.open(io.BytesIO(base64.b64decode(gray['preview']))))
            np.testing.assert_array_equal(pixels[:,:,0],pixels[:,:,1])
            result=dispatch_field(dict(op='field_analyze',field=key,reference=reference,center=[0,12.6],options=dict(starts=1,fit_samples=3000),exports=[],colormap='gray',gain_selection=['line'],full_analysis=False))
            self.assertAlmostEqual(result['metrics']['fit_gain']['line_gain'],4,places=4)
            self.assertNotIn('area_gain',result['metrics']['fit_gain'])
            with zipfile.ZipFile(artifacts[result['artifact']]) as z:
                self.assertNotIn('fit.npz',z.namelist())
                self.assertNotIn('area_gain',json.loads(z.read('focal.json'))['fit_gain'])
            dispatch_field(dict(op='artifact_dispose',artifact=result['artifact']))
        finally:
            for field in (key,reference):dispatch_field(dict(op='field_dispose',field=field))
