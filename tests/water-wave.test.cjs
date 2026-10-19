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
  for (const name of ['index.html','app.js','style.css','worker.js','guide.html','LICENSE-FCD.txt']) {
    assert.ok(fs.statSync(path.join(root,'dist/water-wave',name)).size > 0);
  }
  const offline = fs.readFileSync(path.join(root,'dist/nfc-offline.html'),'utf8');
  assert.ok(!offline.includes('pyodide'));
  assert.ok(!offline.includes('water-wave'));
});

test('new tool remains separate and raw NFC fragment routing keeps priority', () => {
  const app = fs.readFileSync(path.join(root,'src/app.js'),'utf8');
  assert.ok(app.includes("id: 'water-wave'"));
  const fragment = app.indexOf('if (location.hash.length > 1) return mountNfc(location.hash)');
  assert.ok(fragment > 0);
  assert.ok(fragment < app.indexOf("const tool = new URLSearchParams(location.search).get('tool')"));
});
