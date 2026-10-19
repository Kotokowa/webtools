import io
import json
import os
from pathlib import Path
import tempfile
import shutil
import uuid
import unittest
import zipfile
import base64
import urllib.request
import threading
import numpy as np
from PIL import Image
from waterwave.core import Config, Reconstructor, detrend_field, inverse_gradient, sample_geometry, synthetic_frame, unwrap_phase
from waterwave.session import Session, decode_image, natural_key

ROOT = Path(__file__).resolve().parent.parent


class CoreTests(unittest.TestCase):
    def test_known_height_and_scale(self):
        ref, img, truth = synthetic_frame()
        r = Reconstructor(ref, config=Config(detrend="none"))
        self.assertAlmostEqual(r.scale, 1.5/8, places=5)
        out = r.restore(img)["height_mm"]
        truth = truth[10:-10, 10:-10]
        truth -= truth.mean()
        out -= out.mean()
        error = np.sqrt(np.mean((out-truth)**2))/np.sqrt(np.mean(truth**2))
        self.assertLess(error, .03)
        self.assertGreater(np.corrcoef(out.ravel(), truth.ravel())[0, 1], .995)

    def test_identity_is_zero(self):
        ref, _, _ = synthetic_frame()
        result = Reconstructor(ref).restore(ref)
        self.assertLess(np.max(np.abs(result["height_mm"])), 1e-7)

    def test_rotated_checkerboard(self):
        y, x = np.indices((320, 384), dtype=float)
        theta = .27
        xx, yy = x*np.cos(theta)-y*np.sin(theta), x*np.sin(theta)+y*np.cos(theta)
        ref = 128+55*np.cos(np.pi/10*(xx+yy))+55*np.cos(np.pi/10*(xx-yy))
        r = Reconstructor(ref)
        self.assertAlmostEqual(r.scale, .15, delta=.001)
        self.assertLess(abs(np.dot(r.kr,r.ku)), .001)

    def test_translation_is_removed(self):
        ref, _, _ = synthetic_frame()
        moved = np.roll(ref, (2, 1), axis=(0, 1))
        result = Reconstructor(ref).restore(moved)
        self.assertLess(np.max(np.abs(result["height_mm"])), .005)

    def test_spectral_integral(self):
        n=128
        y,x=np.indices((n,n))
        a=2*np.pi/n
        h=np.cos(a*x)*np.cos(2*a*y)
        gx=-a*np.sin(a*x)*np.cos(2*a*y)
        gy=-2*a*np.cos(a*x)*np.sin(2*a*y)
        recovered=inverse_gradient(gx,gy,difference=False,boundary=False)
        np.testing.assert_allclose(recovered,h,atol=1e-10)

    def test_two_dimensional_unwrap(self):
        y,x=np.indices((256,256));p=4*np.sin(2*np.pi*x/256)*np.cos(2*np.pi*y/256)
        unwrapped=unwrap_phase(np.angle(np.exp(1j*p)))
        delta=unwrapped-p
        self.assertLess(np.std(delta),1e-9)

    def test_detrending_and_sampling(self):
        y,x=np.indices((64,80));a=3+.2*x-.1*y+.01*x*x-.002*x*y
        self.assertLess(np.max(np.abs(detrend_field(a,'quadratic'))),1e-10)
        field=x+2*y
        out=sample_geometry(field.astype(float),{'points':[[11.5,22.5]],'lines':[[[10,20],[15,20]]]},[10,20],.2)
        self.assertAlmostEqual(out[0]['height_mm'][0],6.5)
        np.testing.assert_allclose(out[1]['height_mm'],np.arange(6))
        with self.assertRaises(ValueError):sample_geometry(field,{'points':[[0,0]]},[10,20],.2)

    def test_bad_inputs(self):
        ref,_,_=synthetic_frame()
        with self.assertRaises(ValueError):Reconstructor(np.ones((128,128)))
        with self.assertRaises(ValueError):Reconstructor(ref,[-1,0,256,256])
        with self.assertRaises(ValueError):Reconstructor(ref,config=Config(n_water=1.0))
        with self.assertRaises(ValueError):Reconstructor(ref).restore(ref[:128])

    def test_gray16_precision_and_sort(self):
        a=np.arange(128*128,dtype=np.uint16).reshape(128,128)
        buf=io.BytesIO();Image.fromarray(a).save(buf,format='TIFF')
        np.testing.assert_array_equal(decode_image(buf.getvalue()),a)
        self.assertEqual(sorted(['f_100.tiff','f_2.tiff','f_10.tiff'],key=natural_key),['f_2.tiff','f_10.tiff','f_100.tiff'])


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=ROOT/'.waterwave-tmp'/('tests-'+uuid.uuid4().hex)
        cls.tmp.mkdir(parents=True)
        cls.old=os.environ.get('WATERWAVE_TMP')
        os.environ['WATERWAVE_TMP']=str(cls.tmp)

    @classmethod
    def tearDownClass(cls):
        if cls.old is None:os.environ.pop('WATERWAVE_TMP',None)
        else:os.environ['WATERWAVE_TMP']=cls.old
        shutil.rmtree(cls.tmp)

    def test_exports_and_frame_traceability(self):
        ref,img,_=synthetic_frame()
        settings={'config':{'fps':100},'geometry':{'lines':[[[20,128],[235,128]]],'points':[[128,128]]},
                  'exports':['height_npz','raw_npz','height_csv','height_png','displacement','quality','lines','points','spectrum','temporal','wavelength']}
        s=Session(ref,settings)
        try:
            for i,frame in enumerate([50,100,150]):
                _,img,_=synthetic_frame(phase=i*.5)
                s.process(img,f'wave_{frame:04d}.tiff',frame,(frame-1)/100)
            path=s.finish()
            with zipfile.ZipFile(path) as z:
                self.assertIsNone(z.testzip())
                m=json.loads(z.read('manifest.json'))
                self.assertEqual([r['frame_id'] for r in m['frames']],[50,100,150])
                self.assertEqual(m['frames'][0]['time_s'],.49)
                self.assertIn('temporal/amplitude_phase.npz',z.namelist())
                self.assertIn('wavelength.csv',z.namelist())
                data=np.load(io.BytesIO(z.read('height/000001_frame_50.npz')))
                self.assertEqual(data['height_mm'].shape,(236,236))
                self.assertEqual(int(data['frame_id']),50)
                csv=z.read('line_1.csv').decode('utf-8-sig')
                self.assertIn('50,0.49,wave_0050.tiff',csv)
                t=np.load(io.BytesIO(z.read('temporal/amplitude_phase.npz')))
                self.assertEqual(t['amplitude_mm'].shape,(3,236,236))
        finally:s.dispose()

    def test_partial_and_nonuniform(self):
        ref,img,_=synthetic_frame()
        s=Session(ref,{'config':{'fps':10},'exports':['temporal']})
        try:
            for f,t in [(1,0),(2,.1),(4,.3)]:s.process(img,'source',f,t)
            with self.assertRaises(ValueError):s.process(img[:128],'wrong size',5,.4)
            with zipfile.ZipFile(s.finish(partial=True)) as z:
                m=json.loads(z.read('manifest.json'))
                self.assertTrue(m['partial'])
                self.assertIsNotNone(m['temporal_note'])
                self.assertNotIn('temporal/amplitude_phase.npz',z.namelist())
        finally:s.dispose()

    def test_optical_calibration_scaling(self):
        ref,img,_=synthetic_frame()
        r1=Reconstructor(ref,config=Config(acrylic_mm=0,water_depth_mm=20))
        r2=Reconstructor(ref,config=Config(acrylic_mm=0,water_depth_mm=40))
        np.testing.assert_allclose(r1.restore(img)['height_mm'],2*r2.restore(img)['height_mm'],atol=1e-6)

    def test_local_video_roundtrip(self):
        import cv2
        from waterwave.server import Handler, ThreadingHTTPServer
        from waterwave.session import png_bytes
        path=self.tmp/'fixture.avi'
        writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),10,(256,256))
        self.assertTrue(writer.isOpened())
        ref,_,_=synthetic_frame()
        for i in range(3):
            _,frame,_=synthetic_frame(phase=i*.2)
            a=np.clip(frame,0,255).astype(np.uint8)
            writer.write(cv2.cvtColor(a,cv2.COLOR_GRAY2BGR))
        writer.release()
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def call(m):
            req=urllib.request.Request(base+'/api/rpc',data=json.dumps(m).encode(),headers={'Content-Type':'application/json'})
            return json.loads(opener.open(req,timeout=20).read())
        key=session=None
        try:
            req=urllib.request.Request(base+'/api/video',data=path.read_bytes(),headers={'Content-Type':'video/avi'})
            video=json.loads(opener.open(req,timeout=20).read());key=video['video']
            self.assertEqual(video['count'],3);self.assertAlmostEqual(video['fps'],10)
            data=base64.b64encode(png_bytes(Image.fromarray(ref.astype(np.uint8)))).decode()
            info=call({'op':'start','data':data,'settings':{'config':{'fps':10},'exports':['height_npz','video']}});session=info['session']
            for i in range(3):
                result=call({'op':'video_frame','video':key,'session':session,'index':i,'name':'fixture.avi'})
                self.assertEqual(result['summary']['frame_id'],i+1)
            call({'op':'finish','session':session})
            name='实验01_results.zip'
            with opener.open(base+'/api/download?session='+session+'&filename='+urllib.parse.quote(name)) as download:
                self.assertIn("filename*=UTF-8''"+urllib.parse.quote(name,safe=''),download.headers['Content-Disposition'])
            with zipfile.ZipFile(io.BytesIO(opener.open(base+'/api/download?session='+session).read())) as z:
                self.assertIsNone(z.testzip());self.assertGreater(len(z.read('height.mp4')),1000)
                manifest=json.loads(z.read('manifest.json'))
                self.assertEqual([r['time_s'] for r in manifest['frames']],[0,.1,.2])
                output=self.tmp/'roundtrip.mp4';output.write_bytes(z.read('height.mp4'))
                cap=cv2.VideoCapture(str(output))
                self.assertEqual(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),3);cap.release()
        finally:
            if session:call({'op':'dispose','session':session})
            if key:call({'op':'release_video','video':key})
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
