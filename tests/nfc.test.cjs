const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeNdef, encodeRaw } = require('../scripts/pack.cjs');
const root = path.join(__dirname, '..');
const brotli = fs.readFileSync(path.join(root, 'src/vendor/brotli-decode.js'), 'utf8').replace('export let BrotliDecode', 'let BrotliDecode');
const codec = fs.readFileSync(path.join(root, 'src/nfc-codec.js'), 'utf8');
const ctx = { TextDecoder, URL, Uint8Array, Int8Array };
vm.createContext(ctx); vm.runInContext(brotli + '\n' + codec, ctx);
function decode(input) { ctx.input = input; return vm.runInContext('decodeCard(input)', ctx, { timeout: 3000 }); }
function fixture(version) {
  const message = Buffer.from('Test card\n\nHello!');
  const website = Buffer.from('example.com');
  const common = Buffer.from([0x66,0xcc,0xff,0x99,0xd8,0x5a]);
  const sizes = Buffer.from([message.length,0,website.length]);
  const header = version === 3 ? Buffer.concat([Buffer.from('8A\x03'), common, sizes]) : Buffer.concat([Buffer.from([56,65,2,49,64,40,56]),common,Buffer.from([28,1,8,8]),sizes]);
  const image = Buffer.alloc(320); image[0] = 0x80; // Mirror transform restores pixels 0 and 63.
  return Buffer.concat([header,image,Buffer.alloc(8),message,website]);
}
for (const version of [2,3]) test(`v${version} exact Brotli/Base81 round-trip and rendering`, () => {
  const raw = fixture(version);
  const { url } = makeNdef(raw, 'https://example.com/');
  const decoded = decode(url);
  assert.deepEqual(Buffer.from(decoded.raw), raw);
  assert.equal(decoded.message, 'Test card\n\nHello!');
  assert.equal(decoded.rows[0], '8' + ' '.repeat(62) + '8');
  assert.equal(decoded.color, '#66ccff');
  assert.equal(decoded.website, 'https://example.com/');
});
test('NDEF TLV reconstructs the exact HTTPS URL; size is checked', () => {
  const raw = fixture(3);
  // Long endpoint exercises both extended TLV and non-short NDEF record length.
  const data = makeNdef(raw, 'https://example.com/' + 'x'.repeat(280));
  assert.equal(data.tlv[0], 3); assert.equal(data.tlv[1], 255);
  assert.equal(data.tlv.readUInt16BE(2), data.record.length);
  assert.equal(data.record[0], 0xc1); assert.equal(data.record[6], 0x55);
  assert.equal(data.record.readUInt32BE(2), data.record.length - 7);
  assert.equal(data.record[7], 4);
  assert.equal('https://' + data.record.subarray(8).toString('utf8'), data.url);
  assert.equal(data.tlv.at(-1), 254);
  assert.throws(() => makeNdef(raw, 'https://example.com/' + 'x'.repeat(700)), /capacity/);
});
test('invalid alphabets, versions and incomplete data fail explicitly', () => {
  assert.throws(() => decode('bad%input'));
  const raw = fixture(3); raw[2] = 99;
  assert.throws(() => decode(encodeRaw(raw).code), /格式/);
  assert.throws(() => decode(encodeRaw(fixture(3).subarray(0,350)).code), /完整/);
  assert.throws(() => makeNdef(fixture(3), 'http://example.com/'), /HTTPS/);
});
