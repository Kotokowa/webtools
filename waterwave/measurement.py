"""Masked measurement and streaming temporal statistics (final3 MATLAB port)."""
import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.linalg import factorized


def valid_mask(image, cfg, thresholds=None):
    w = int(cfg.mask_window) | 1
    mean = ndimage.uniform_filter(image, w, mode="reflect")
    std = np.sqrt(np.maximum(ndimage.uniform_filter(image**2, w, mode="reflect")-mean**2, 0))
    if thresholds is None:
        thresholds = (cfg.mask_dark*np.percentile(image, 90), cfg.mask_mod*np.median(std),
                      cfg.mask_saturation*image.max())
    dark, mod, sat = thresholds
    bad = (image < dark) | (std < mod) | (image > sat)
    labels, _ = ndimage.label(bad, np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    bad &= sizes[labels] >= cfg.mask_min_blob
    radius = int(cfg.mask_grow + cfg.mask_guard)
    if radius:
        y, x = np.ogrid[-radius:radius+1, -radius:radius+1]
        bad = ndimage.binary_dilation(bad, x*x+y*y <= radius*radius)
    border = np.zeros(image.shape, bool)
    b = int(cfg.mask_guard)+2
    border[:b] = border[-b:] = True
    border[:, :b] = border[:, -b:] = True
    return ~(bad | border), bad & ~border, thresholds


def fill_pattern(image, reference, holes, carriers, ring=20):
    if not holes.any():
        return image.copy(), False
    ry, rx = np.ogrid[-ring:ring+1, -ring:ring+1]
    surrounding = ndimage.binary_dilation(holes, structure=rx*rx+ry*ry <= ring*ring) & ~holes
    y, x = np.indices(image.shape)
    basis = [np.ones(image.shape)]
    for k in carriers:
        phase = k[0]*x+k[1]*y
        basis.extend([np.cos(phase), np.sin(phase)])
    ids = np.flatnonzero(surrounding)[::max(1, int(surrounding.sum())//60000)]
    out = image.copy()
    if len(ids) < 50:
        out[holes] = reference[holes]
        return out, True
    design = np.stack([a.ravel()[ids] for a in basis], axis=1)
    coeff, _, rank, _ = np.linalg.lstsq(design, reference.ravel()[ids], rcond=None)
    if rank < len(basis):
        out[holes] = reference[holes]
        return out, True
    out[holes] = sum(c*a[holes] for c, a in zip(coeff, basis))
    return out, False


class Bridge:
    def __init__(self):
        self.mask = None

    def apply(self, field, holes):
        if not holes.any():
            return field
        if self.mask is None or not np.array_equal(holes, self.mask):
            self.mask = holes.copy()
            self.ids = np.flatnonzero(holes)
            index = np.full(field.size, -1, dtype=int)
            index[self.ids] = np.arange(len(self.ids))
            rows, cols, data = [], [], []
            self.boundaries = []
            width = field.shape[1]
            for shift in (-width, width, -1, 1):
                neighbors = self.ids+shift
                inside = index[neighbors] >= 0
                rows.extend(np.flatnonzero(inside)); cols.extend(index[neighbors[inside]])
                data.extend([-1.]*int(inside.sum()))
                self.boundaries.append((np.flatnonzero(~inside), neighbors[~inside]))
            matrix = sparse.coo_matrix((data, (rows, cols)), shape=(len(self.ids),)*2).tocsc()
            self.solve = factorized(matrix + 4*sparse.eye(len(self.ids), format="csc"))
        rhs = np.zeros(len(self.ids))
        for rows, neighbors in self.boundaries:
            rhs[rows] += field.ravel()[neighbors]
        out = field.copy()
        out.ravel()[self.ids] = self.solve(rhs)
        return out


class RMSAccumulator:
    def __init__(self, shape, min_fraction=.8, frequency=0):
        self.count = np.zeros(shape, np.int32)
        self.sum2 = np.zeros(shape)
        self.sum4 = np.zeros(shape)
        self.n = 0
        self.fraction, self.frequency = min_fraction, frequency
        if frequency:
            self.normal = np.zeros((*shape, 3, 3))
            self.rhs = np.zeros((*shape, 3))

    def add(self, h, time=None):
        valid = np.isfinite(h)
        a = np.where(valid, h, 0).astype(float)
        if self.frequency and (time is None or not np.isfinite(time)):
            raise ValueError("锁相需要有效时间戳")
        self.count += valid; self.sum2 += a*a; self.sum4 += a**4; self.n += 1
        if self.frequency:
            phase = 2*np.pi*self.frequency*time
            b = np.array([np.cos(phase), np.sin(phase), 1.])
            self.normal += valid[..., None, None]*np.outer(b, b)
            self.rhs += a[..., None]*b

    def finish(self):
        n = np.maximum(self.count, 1)
        mean2 = self.sum2/n
        z = np.sqrt(mean2)
        dz = np.sqrt(np.maximum(self.sum4/n-mean2**2, 0)/n)/np.maximum(2*z, 1e-30)
        valid = (self.count >= self.fraction*self.n) & (self.count > 0)
        if self.frequency:
            inv = np.linalg.pinv(self.normal, rcond=1e-10)
            coef = np.einsum("...ij,...j->...i", inv, self.rhs)
            z = np.linalg.norm(coef[..., :2], axis=-1)/np.sqrt(2)
            residual = np.maximum(self.sum2-np.sum(coef*self.rhs, axis=-1), 0)
            cov = inv * (residual/np.maximum(n-3, 1))[..., None, None]
            grad = np.zeros_like(coef)
            grad[..., :2] = coef[..., :2]/np.maximum(2*z[..., None], 1e-30)
            dz = np.sqrt(np.maximum(np.einsum("...i,...ij,...j->...", grad, cov, grad), 0))
            valid &= (self.count > 3) & (np.linalg.matrix_rank(self.normal, tol=1e-8) == 3)
        z[~valid] = np.nan; dz[~valid | (self.count < 2)] = np.nan
        return dict(Z=z, dZ=dz, valid=valid, count=self.count.copy(), n_frames=self.n)
