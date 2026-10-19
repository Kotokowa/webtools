const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escape = s => s.replace(/<\/script/gi, '<\\/script');
let brotli = '/*\n' + read('src/vendor/LICENSE-brotli.txt') + '\n*/\n' + read('src/vendor/brotli-decode.js').replace('export let BrotliDecode', 'let BrotliDecode');
brotli = brotli.replace('totalOutput += s.outputUsed;', 'totalOutput += s.outputUsed; if (totalOutput > 4096) throw Error("展开数据超出限制");');
const codec = read('src/nfc-codec.js');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const offline = read('src/offline.html').replace('/*__BROTLI__*/', () => escape(brotli)).replace('/*__CODEC__*/', () => escape(codec));
fs.writeFileSync(path.join(root, 'dist/nfc-offline.html'), offline);
const app = [brotli, codec, read('src/app.js')].join('\n');
const html = read('src/index.html').replace('/*__APP__*/', () => escape(app));
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.copyFileSync(path.join(root, 'src/vendor/LICENSE-brotli.txt'), path.join(root, 'dist/LICENSE-brotli.txt'));
fs.writeFileSync(path.join(root, 'dist/.nojekyll'), '');
// Additive tool: no changes to NFC routing, decoder or offline artifact.
const waveDest = path.join(root, 'dist/water-wave');
fs.cpSync(path.join(root, 'src/water-wave'), waveDest, { recursive: true });
fs.mkdirSync(path.join(waveDest, 'python'), { recursive: true });
for (const name of ['__init__.py', 'core.py', 'session.py']) {
  fs.copyFileSync(path.join(root, 'waterwave', name), path.join(waveDest, 'python', name));
}
fs.copyFileSync(path.join(root, 'waterwave/LICENSE-FCD.txt'), path.join(waveDest, 'LICENSE-FCD.txt'));
console.log('Built dist/index.html and self-contained dist/nfc-offline.html.');
