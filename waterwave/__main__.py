import os

# Bound small least-squares operations before importing the numerical runtime.
for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(name, '2')

from .server import main

main()
