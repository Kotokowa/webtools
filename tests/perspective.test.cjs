const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/perspective.js');

test('arbitrary click order and tied diamond corners remain four distinct points', () => {
  const expected = [[10, 10], [110, 15], [100, 80], [5, 70]];
  function permutations(a) { return a.length ? a.flatMap((p, i) => permutations(a.filter((_, j) => i !== j)).map(rest => [p, ...rest])) : [[]]; }
  for (const input of permutations(expected)) assert.deepEqual(P.order(input), expected);
  const diamond = P.order([[50, 0], [100, 50], [50, 100], [0, 50]]);
  assert.equal(new Set(diamond.map(p => p.join(','))).size, 4);
  const size = P.dimensions(expected);
  assert.deepEqual(size, { width: 100, height: 66 });
});

test('duplicate, collinear, concave and non-finite selections are rejected', () => {
  for (const points of [[], [[0,0],[0,0],[10,10],[0,10]], [[0,0],[5,0],[10,0],[0,10]], [[0,0],[10,0],[2,2],[0,10]], [[NaN,0],[10,0],[10,10],[0,10]]]) assert.throws(() => P.order(points));
});

test('inverse homography maps all output corners and interior projective points', () => {
  // Independent rational mapping, rather than an affine-only fixture.
  const project = (x, y) => [(2*x + .3*y + 12) / (.002*x + .001*y + 1), (.2*x + 1.5*y + 18) / (.002*x + .001*y + 1)];
  const target = [[0,0],[99,0],[99,79],[0,79]];
  const matrix = P.transform(target.map(p => project(...p)), 100, 80);
  for (const p of [...target, [30, 20], [70, 65]]) {
    const actual = P.map(matrix, ...p), expected = project(...p);
    actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-8));
  }
});

test('cubic rendering preserves pixel identity, alpha and independently rendered row chunks', () => {
  const source = { width: 5, height: 4, data: new Uint8ClampedArray(5*4*4) };
  for (let i = 0; i < 20; i++) source.data.set([i*11, 255-i*8, i*3, i % 3 ? 255 : 80], i*4);
  const output = { width: 5, height: 4, data: new Uint8ClampedArray(5*4*4) };
  const matrix = P.transform([[0,0],[4,0],[4,3],[0,3]], 5, 4);
  P.renderRows(source, output, matrix, 0, 2); P.renderRows(source, output, matrix, 2, 4);
  assert.deepEqual(output.data, source.data);
  source.data.fill(0); source.data[0] = 255;
  P.renderRows(source, output, matrix, 0, 4);
  assert.ok(output.data.every(n => n === 0), 'invisible RGB cannot introduce colored fringes');
});
