"""Generate an analytical NPZ fixture using only the Python standard library."""
import math
import pathlib
import struct
import zipfile

def npy(values, shape, dtype='<f8'):
    header = repr(dict(descr=dtype, fortran_order=False, shape=shape)).encode('ascii')
    header += b' ' * ((-10-len(header)-1) % 16) + b'\n'
    payload = bytes(values) if dtype == '|b1' else struct.pack('<'+'d'*len(values), *values)
    return b'\x93NUMPY\x01\x00'+struct.pack('<H', len(header))+header+payload

root = pathlib.Path('test-results'); root.mkdir(exist_ok=True)
n = 41
x = [-5+10*i/(n-1) for i in range(n)]
y = [7.6+10*i/(n-1) for i in range(n)]
z = [.1+2*math.exp(-.5*((xx/.7)**2+((yy-12.6)/1.1)**2)) for yy in y for xx in x]
for name, factor in [('lens', 1), ('reference', .5)]:
    with zipfile.ZipFile(root/(name+'.npz'), 'w', zipfile.ZIP_DEFLATED) as out:
        for key, values, shape, dtype in [('Z',[v*factor for v in z],(n,n),'<f8'),('dZ',[.01]*(n*n),(n,n),'<f8'),
                                          ('valid',[1]*(n*n),(n,n),'|b1'),('X_cm',x,(n,),'<f8'),('Y_cm',y,(n,),'<f8')]:
            out.writestr(key+'.npy', npy(values,shape,dtype))
