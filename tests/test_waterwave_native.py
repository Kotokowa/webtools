import json
import threading
import unittest
import urllib.request
import urllib.error
import numpy as np
from scipy import fft
from waterwave.acceleration import fft_backend
from waterwave.core import Reconstructor, Config, synthetic_frame
from waterwave.server import Handler, ThreadingHTTPServer


class NativeOriginTests(unittest.TestCase):
    def test_accelerated_fft_preserves_reconstruction(self):
        ref, frame, _ = synthetic_frame(128)
        cfg=Config(pipeline='final3', masking=False)
        expected=Reconstructor(ref, config=cfg).restore(frame)['height_mm']
        with fft.set_workers(2), fft_backend():
            actual=Reconstructor(ref, config=cfg).restore(frame)['height_mm']
        np.testing.assert_allclose(actual, expected, atol=1e-6, rtol=1e-5)

    def test_online_tool_can_connect_but_other_origins_cannot(self):
        server=ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread=threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url=f'http://127.0.0.1:{server.server_port}/api/info'
        try:
            with opener.open(urllib.request.Request(url, headers={'Origin':'https://kotokowa.github.io'})) as response:
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://kotokowa.github.io')
                self.assertEqual(json.load(response)['protocol'], 2)
            req=urllib.request.Request(url, method='OPTIONS', headers={
                'Origin':'https://kotokowa.github.io', 'Access-Control-Request-Private-Network':'true'})
            with opener.open(req) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Private-Network'], 'true')
            for origin in ('https://example.com', 'https://kotokowa.github.io.evil.example', 'null'):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    opener.open(urllib.request.Request(url, headers={'Origin':origin}))
                self.assertEqual(error.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError) as error:
                opener.open(urllib.request.Request(url, headers={'Host':'attacker.example'}))
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__=='__main__': unittest.main()
