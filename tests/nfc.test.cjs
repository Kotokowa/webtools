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

// Independent wire fixtures: widths deliberately cross byte boundaries.
function uint(value) {
  const bytes = [];
  do { const b = value & 127; value = Math.floor(value / 128); bytes.push(b | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
function field(type, value) { return Buffer.concat([Buffer.from([type]), uint(value.length), value]); }
function v5Fixture({ width = 5, height = 2, palette = ['#66ccff', '#72c330', '#b2e175'], message = '你好呀\n多一句话。', url = 'https://example.com/a-longer-path?q=中文#part' } = {}) {
  const depth = Math.ceil(Math.log2(palette.length + 1));
  const indices = Array.from({ length: width * height }, (_, i) => i % (palette.length + 1));
  const bits = indices.map(n => n.toString(2).padStart(depth, '0')).join('');
  const image = Buffer.from(bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g).map(n => parseInt(n, 2)));
  const fields = [
    field(6, Buffer.from(url)), // No prescribed field order.
    field(4, image),
    field(42, Buffer.from([0, 1, 3, 5, 255])), // Delimiter-like bytes inside unknown field.
    field(1, Buffer.concat([uint(width), uint(height)])),
    field(5, Buffer.from(message)),
    field(3, Buffer.from(palette.map(c => c.slice(1)).join(''), 'hex')),
    field(2, Buffer.from('@'))
  ];
  return { raw: Buffer.concat([Buffer.from('8A\x05'), ...fields]), fields, indices, image };
}
for (const colors of [1, 2, 3, 4, 7]) test(`v5 reads variable dimensions, ${colors} colors, text and URL lengths`, () => {
  const palette = ['#66ccff', '#72c330', '#b2e175', '#123456', '#abcdef', '#ff0000', '#010203'].slice(0, colors);
  const width = colors + 3, height = colors + 1;
  const { raw, indices } = v5Fixture({ width, height, palette, message: '你好\n'.repeat(48 + colors) });
  const result = decode(encodeRaw(raw).code);
  assert.equal(result.width, width); assert.equal(result.height, height);
  assert.equal(result.message, '你好\n'.repeat(48 + colors));
  assert.equal(result.website, new URL('https://example.com/a-longer-path?q=中文#part').href);
  assert.deepEqual([...result.palette], palette);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = indices[y * width + x];
    assert.equal(result.rows[y][x], index ? '@' : ' ');
    assert.equal(result.colorRows[y][x], index ? palette[index - 1] : null);
  }
});
test('v5 optional text, URL, glyph; unknown non-critical fields are skipped', () => {
  const { fields } = v5Fixture();
  const minimal = Buffer.concat([Buffer.from('8A\x05'), fields[3], fields[5], fields[1], fields[2]]);
  const result = decode(encodeRaw(minimal).code);
  assert.equal(result.message, ''); assert.equal(result.website, ''); assert.equal(result.glyph, '8');
});
test('v5 rejects truncation, duplicates, invalid dimensions/palette/pixels, critical extensions and unsafe URLs', () => {
  const { raw, fields } = v5Fixture();
  const check = parts => decode(encodeRaw(Buffer.concat([Buffer.from('8A\x05'), ...parts])).code);
  assert.throws(() => decode(encodeRaw(raw.subarray(0, raw.length - 1)).code), /完整/);
  assert.throws(() => check([...fields, fields[3]]), /重复/);
  assert.throws(() => check([...fields, field(128, Buffer.alloc(0))]), /更新版本/);
  assert.throws(() => check(fields.filter((_, i) => i !== 3)), /缺少/);
  assert.throws(() => check(fields.map((v, i) => i === 3 ? field(1, Buffer.from([0, 2])) : v)), /尺寸/);
  assert.throws(() => check(fields.map((v, i) => i === 5 ? field(3, Buffer.from([1, 2])) : v)), /调色板/);
  assert.throws(() => check(fields.map((v, i) => i === 1 ? field(4, Buffer.from([0])) : v)), /像素数据/);
  assert.throws(() => check(fields.map((v, i) => i === 1 ? field(4, Buffer.from([0, 0, 1])) : v)), /填充/);
  assert.throws(() => check(fields.map((v, i) => i === 0 ? field(6, Buffer.from('javascript:alert(1)')) : v)), /网址/);
  assert.throws(() => check(fields.map((v, i) => i === 4 ? field(5, Buffer.from([255])) : v)));
  const two = v5Fixture({ palette: ['#112233', '#445566'] });
  assert.throws(() => check(two.fields.map((v, i) => i === 1 ? field(4, Buffer.from([255, 0, 0])) : v)), /不存在的颜色/);
  assert.throws(() => decode(encodeRaw(Buffer.from([56, 65, 5, 1, 128])).code), /长度不完整/);
});
