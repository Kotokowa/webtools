const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('static build ships the exact desktop Python core and separate tool assets', () => {
  require('../scripts/build.cjs');
  for (const name of ['__init__.py', 'core.py', 'session.py']) {
    assert.deepEqual(fs.readFileSync(path.join(root,'waterwave',name)), fs.readFileSync(path.join(root,'dist/water-wave/python',name)));
  }
  for (const name of ['index.html','app.js','ui-utils.js','video-worker.js','style.css','worker.js','guide.html','LICENSE-FCD.txt']) {
    assert.ok(fs.statSync(path.join(root,'dist/water-wave',name)).size > 0);
  }
  const offline = fs.readFileSync(path.join(root,'dist/nfc-offline.html'),'utf8');
  assert.ok(!offline.includes('pyodide'));
  assert.ok(!offline.includes('water-wave'));
});

const {sampleGeometry,resultFilename,progressTitle} = require('../src/water-wave/ui-utils.js');
test('numeric and drawn samples share cropped bounds and preserve fractional coordinates', () => {
  const bounds=[110,210,389,489];
  assert.deepEqual(sampleGeometry('point',null,[125.25,240.5],bounds),{kind:'points',value:[125.25,240.5]});
  assert.deepEqual(sampleGeometry('hline',null,[0,300.5],bounds).value,[[110,300.5],[389,300.5]]);
  assert.deepEqual(sampleGeometry('vline',null,[250.25,0],bounds).value,[[250.25,210],[250.25,489]]);
  assert.deepEqual(sampleGeometry('line',[110,210],[389,489],bounds).value,[[110,210],[389,489]]);
  assert.throws(()=>sampleGeometry('point',null,[390,300],bounds));
  assert.throws(()=>sampleGeometry('point',null,[NaN,300],bounds));
  assert.throws(()=>sampleGeometry('line',[200,300],[200.1,300],bounds));
});
test('result names strip image frame padding but keep complete video stems', () => {
  for(const width of [3,4,5]) {
    const names=[1,2,20].map(n=>`2mm_frame_${String(n).padStart(width,'0')}.tiff`);
    assert.equal(resultFilename(names),'2mm_frame_results.zip');
  }
  assert.equal(resultFilename(['波场_  1.tif','波场_ 20.tif']),'波场_results.zip');
  assert.equal(resultFilename(['output.avi'],true),'output_results.zip');
  assert.equal(resultFilename(['experiment2026.mp4'],true),'experiment2026_results.zip');
  assert.equal(resultFilename(['0001.tif','0002.tif'],false,'试验/2mm_frames'),'2mm_frames_results.zip');
  assert.equal(resultFilename(['foo:bar_001.png']),'foo_bar_results.zip');
});
test('tab progress distinguishes restoring from packing', () => {
  assert.match(progressTitle(1,3),/^恢复中-33%（1\/3）/);
  assert.match(progressTitle(3,3,true),/^恢复中-100%（3\/3，打包中）/);
});

test('new tool remains separate and raw NFC fragment routing keeps priority', () => {
  const app = fs.readFileSync(path.join(root,'src/app.js'),'utf8');
  assert.ok(app.includes("id: 'water-wave'"));
  const fragment = app.indexOf('if (location.hash.length > 1) return mountNfc(location.hash)');
  assert.ok(fragment > 0);
  assert.ok(fragment < app.indexOf("const tool = new URLSearchParams(location.search).get('tool')"));
});
