// Browser-only equivalent of perspective_cropper.py. No image leaves the device.
const Perspective = (() => {
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function order(points) {
    if (points.length !== 4 || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw Error('请选择四个有效角点');
    const center = points.reduce((c, p) => [c[0] + p[0] / 4, c[1] + p[1] / 4], [0, 0]);
    const sorted = points.map(p => [...p]).sort((a, b) => Math.atan2(a[1] - center[1], a[0] - center[0]) - Math.atan2(b[1] - center[1], b[0] - center[0]));
    const start = sorted.reduce((best, p, i) => p[0] + p[1] < sorted[best][0] + sorted[best][1] ? i : best, 0);
    const result = sorted.slice(start).concat(sorted.slice(0, start));
    for (let i = 0; i < 4; i++) {
      const a = result[i], b = result[(i + 1) % 4], c = result[(i + 2) % 4];
      if (distance(a, b) < 1 || (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 1) throw Error('四个点需要围成凸四边形，请调整角点');
    }
    return result;
  }
  function dimensions(points) {
    const p = order(points);
    return { width: Math.max(2, Math.round(Math.max(distance(p[0], p[1]), distance(p[3], p[2])))), height: Math.max(2, Math.round(Math.max(distance(p[0], p[3]), distance(p[1], p[2])))) };
  }
  // Solve the inverse homography: output rectangle -> source quadrilateral.
  function transform(points, width, height) {
    const source = order(points), target = [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]];
    const rows = [];
    target.forEach(([x, y], i) => {
      const [u, v] = source[i];
      rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    });
    for (let i = 0; i < 8; i++) {
      let pivot = i;
      for (let j = i + 1; j < 8; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
      [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
      const divisor = rows[i][i];
      if (Math.abs(divisor) < 1e-10) throw Error('角点过于接近，无法校正');
      for (let k = i; k < 9; k++) rows[i][k] /= divisor;
      for (let j = 0; j < 8; j++) if (j !== i) {
        const factor = rows[j][i];
        for (let k = i; k < 9; k++) rows[j][k] -= factor * rows[i][k];
      }
    }
    return rows.map(row => row[8]);
  }
  function map(matrix, x, y) {
    const d = matrix[6] * x + matrix[7] * y + 1;
    return [(matrix[0] * x + matrix[1] * y + matrix[2]) / d, (matrix[3] * x + matrix[4] * y + matrix[5]) / d];
  }
  // Cubic convolution (a = -0.75, as used by OpenCV INTER_CUBIC).
  function cubic(x) {
    x = Math.abs(x);
    return x <= 1 ? (1.25 * x - 2.25) * x * x + 1 : x < 2 ? ((-0.75 * x + 3.75) * x - 6) * x + 3 : 0;
  }
  function renderRows(source, output, matrix, first, last) {
    for (let y = first; y < last; y++) for (let x = 0; x < output.width; x++) {
      const [sx, sy] = map(matrix, x, y), ix = Math.floor(sx), iy = Math.floor(sy);
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
        const px = Math.max(0, Math.min(source.width - 1, ix + dx)), py = Math.max(0, Math.min(source.height - 1, iy + dy));
        const offset = (py * source.width + px) * 4;
        const weight = cubic(sx - ix - dx) * cubic(sy - iy - dy), a = source.data[offset + 3] * weight;
        alpha += a; red += source.data[offset] * a; green += source.data[offset + 1] * a; blue += source.data[offset + 2] * a;
      }
      const offset = (y * output.width + x) * 4;
      output.data[offset] = alpha > 0 ? red / alpha : 0;
      output.data[offset + 1] = alpha > 0 ? green / alpha : 0;
      output.data[offset + 2] = alpha > 0 ? blue / alpha : 0;
      output.data[offset + 3] = alpha;
    }
  }
  return { order, dimensions, transform, map, renderRows };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Perspective;
