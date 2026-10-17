// 8A v2: lossless on-card avatar, message and website. No network requests.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&'()*+,;=:@/?";
function decodeCard(input) {
  let code = input.trim();
  if (code.includes('#')) code = code.slice(code.indexOf('#') + 1);
  if (!code.length || code.length > 2048) throw Error('链接数据为空或过长');
  let n = 0n;
  for (const c of code) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw Error('链接中含有不支持的字符');
    n = n * 81n + BigInt(digit);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
  if (bytes[0] !== 1) throw Error('编码标记不正确');
  const packed = new Uint8Array(BrotliDecode(new Int8Array(bytes.slice(1))));
  let raw = packed;
  if (packed[0] === 56 && packed[1] === 65 && packed[2] === 3 && packed.length >= 12) {
    // v3 fixes the canvas/glyph/accent region; expand to the v2 parsing layout.
    raw = new Uint8Array(packed.length + 8);
    raw.set([56,65,2,49,64,40,56]);
    raw.set(packed.subarray(3,9),7);
    raw.set([28,1,8,8],13);
    raw.set(packed.subarray(9,12),17);
    raw.set(packed.subarray(12),20);
  }
  if (raw.length < 20 || raw.length > 4096) throw Error('数据长度不正确');
  if (raw[0] !== 56 || raw[1] !== 65 || raw[2] !== 2 || raw[3] !== 49)
    throw Error('此解码器只支持 8A v2 / v3 格式');
  const [w, h, glyph] = raw.slice(4, 7);
  const [ax, ay, aw, ah] = raw.slice(13, 17);
  if (w !== 64 || h !== 40 || glyph !== 56 || aw !== 8 || ah !== 8 || ax + aw > w || ay + ah > h)
    throw Error('头像尺寸不正确');
  const messageLength = raw[17] + raw[18] * 256;
  if (raw.length !== 348 + messageLength + raw[19]) throw Error('内容不完整');
  const bitmap = raw.slice(20, 340);
  const bit = (a, i) => (a[i >> 3] >> (7 - (i & 7))) & 1;
  const rows = [];
  const accent = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    const colors = [];
    for (let x = 0; x < w; x++) {
      let on = bit(bitmap, y * w + x);
      if (x >= 32) on ^= bit(bitmap, y * w + 63 - x);
      row += on ? '8' : ' ';
      colors.push(Boolean(on && x >= ax && x < ax + aw && y >= ay && y < ay + ah && bit(raw.subarray(340, 348), (y - ay) * aw + x - ax)));
    }
    rows.push(row); accent.push(colors);
  }
  const color = start => '#' + Array.from(raw.slice(start, start + 3), n => n.toString(16).padStart(2, '0')).join('');
  const message = new TextDecoder('gb18030', { fatal: true }).decode(raw.slice(348, 348 + messageLength));
  const host = new TextDecoder('utf-8', { fatal: true }).decode(raw.slice(348 + messageLength));
  if (!/^[a-z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?$/i.test(host)) throw Error('网址格式不正确');
  const website = new URL('https://' + host).href;
  return { raw: packed, rows, accent, color: color(7), accentColor: color(10), message, website };
}
