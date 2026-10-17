const fs = require('node:fs');
const zlib = require('node:zlib');
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&'()*+,;=:@/?";
function encodeRaw(raw) {
  const br = zlib.brotliCompressSync(raw, { params: { 0: 0, 1: 10, 2: 16, 5: raw.length } });
  let n = BigInt('0x01' + br.toString('hex')), code = '';
  while (n) { code = ALPHABET[Number(n % 81n)] + code; n /= 81n; }
  return { code, compressedBytes: br.length };
}
function makeNdef(raw, endpoint, capacity = 720) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || base.hash || base.search || base.username || base.password)
    throw Error('Endpoint must be a public HTTPS page without query, fragment or credentials.');
  const { code, compressedBytes } = encodeRaw(raw);
  const url = base.href + '#' + code;
  if (new URL(url).hash.slice(1) !== code) throw Error('URL normalization changed the payload.');
  const payload = Buffer.concat([Buffer.from([4]), Buffer.from(url.slice(8), 'utf8')]);
  let header;
  if (payload.length < 256) header = Buffer.from([0xd1, 1, payload.length, 0x55]);
  else { header = Buffer.alloc(7); header[0] = 0xc1; header[1] = 1; header.writeUInt32BE(payload.length, 2); header[6] = 0x55; }
  const record = Buffer.concat([header, payload]);
  if (record.length > 65535) throw Error('NDEF record too large.');
  let length;
  if (record.length < 255) length = Buffer.from([3, record.length]);
  else { length = Buffer.from([3, 255, 0, 0]); length.writeUInt16BE(record.length, 2); }
  const tlv = Buffer.concat([length, record, Buffer.from([254])]);
  if (tlv.length > capacity) throw Error(`Needs ${tlv.length} bytes; capacity is ${capacity}. No files written.`);
  return { url, record, tlv, compressedBytes, codeCharacters: code.length, freeBytes: capacity - tlv.length };
}
module.exports = { encodeRaw, makeNdef };
if (require.main === module) {
  const [, , rawPath, endpoint, prefix] = process.argv;
  if (!rawPath || !endpoint || !prefix) {
    console.error('Usage: node scripts/pack.cjs payload.raw https://USER.github.io/REPO/ OUTPUT_PREFIX'); process.exitCode = 1;
  } else {
    const data = makeNdef(fs.readFileSync(rawPath), endpoint);
    fs.writeFileSync(prefix + '-url.txt', data.url);
    fs.writeFileSync(prefix + '.ndef', data.record);
    fs.writeFileSync(prefix + '-tlv.bin', data.tlv);
    console.log(JSON.stringify({ urlBytes: Buffer.byteLength(data.url), compressedBytes: data.compressedBytes, codeCharacters: data.codeCharacters, tlvBytes: data.tlv.length, freeBytes: data.freeBytes }, null, 2));
  }
}
