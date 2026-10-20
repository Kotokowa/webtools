// Permanent v2/v3 readers + self-describing v5 TLV reader. No network requests.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~!$&'()*+,;=:@/?";
function decodeCard(input) {
  let code = input.trim();
  if (code.includes('#')) code = code.slice(code.indexOf('#') + 1);
  if (!code.length || code.length > 8192) throw Error('链接数据为空或过长');
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
  if (packed[0] === 56 && packed[1] === 65 && packed[2] === 5) return decodeCardV5(packed);
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
    throw Error('此解码器只支持 8A v2 / v3 / v5 格式');
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

function cardVarint(bytes, cursor) {
  let value = 0, factor = 1;
  for (let i = 0; i < 3; i++) {
    if (cursor.offset >= bytes.length) throw Error('字段长度不完整');
    const byte = bytes[cursor.offset++];
    value += (byte & 127) * factor;
    if (!(byte & 128)) {
      if (i && byte === 0) throw Error('字段长度编码不规范');
      return value;
    }
    factor *= 128;
  }
  throw Error('字段长度过大');
}

function decodeCardV5(raw) {
  if (raw.length > 4096) throw Error('数据长度不正确');
  const fields = new Map(), cursor = { offset: 3 };
  while (cursor.offset < raw.length) {
    const type = raw[cursor.offset++];
    const length = cardVarint(raw, cursor);
    if (length > raw.length - cursor.offset) throw Error('字段内容不完整');
    const value = raw.subarray(cursor.offset, cursor.offset + length);
    cursor.offset += length;
    if (type >= 1 && type <= 6) {
      if (fields.has(type)) throw Error('字段重复');
      fields.set(type, value);
    } else if (type & 128) throw Error('此卡需要更新版本的解码器');
    // Unknown non-critical field: skip its declared length.
  }
  for (const type of [1, 3, 4]) if (!fields.has(type)) throw Error('缺少图像字段');
  const size = fields.get(1), position = { offset: 0 };
  const width = cardVarint(size, position), height = cardVarint(size, position);
  if (position.offset !== size.length || !width || !height || width > 128 || height > 128)
    throw Error('图像尺寸超出范围');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const glyph = fields.has(2) ? utf8.decode(fields.get(2)) : '8';
  if (!/^[\x21-\x7e]$/.test(glyph)) throw Error('头像字符须为单个可见 ASCII 字符');
  const rgb = fields.get(3);
  if (!rgb.length || rgb.length % 3 || rgb.length > 255 * 3) throw Error('调色板长度不正确');
  const palette = [];
  for (let i = 0; i < rgb.length; i += 3)
    palette.push('#' + Array.from(rgb.subarray(i, i + 3), n => n.toString(16).padStart(2, '0')).join(''));
  const depth = Math.ceil(Math.log2(palette.length + 1)), pixels = fields.get(4);
  const usedBits = width * height * depth;
  if (pixels.length !== Math.ceil(usedBits / 8)) throw Error('像素数据长度与尺寸不符');
  if (usedBits % 8 && (pixels[pixels.length - 1] & ((1 << (8 - usedBits % 8)) - 1)))
    throw Error('像素填充位不为零');
  const rows = [], colorRows = [];
  let bit = 0;
  for (let y = 0; y < height; y++) {
    let row = ''; const colors = [];
    for (let x = 0; x < width; x++) {
      let index = 0;
      for (let b = 0; b < depth; b++, bit++) index = index * 2 + ((pixels[bit >> 3] >> (7 - (bit & 7))) & 1);
      if (index > palette.length) throw Error('像素引用不存在的颜色');
      row += index ? glyph : ' '; colors.push(index ? palette[index - 1] : null);
    }
    rows.push(row); colorRows.push(colors);
  }
  const message = fields.has(5) ? utf8.decode(fields.get(5)) : '';
  let website = '';
  if (fields.has(6)) {
    const text = utf8.decode(fields.get(6));
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || /[\x00-\x20\x7f]/.test(text))
      throw Error('网址必须是 HTTP(S) 地址');
    website = url.href;
  }
  return { raw, version: 5, rows, colorRows, color: palette[0], palette, width, height, glyph, message, website };
}

// Shared renderer keeps online/offline viewers consistent for all versions.
function renderCardAvatar(pre, data) {
  pre.replaceChildren(); pre.style.color = data.color;
  pre.dataset.columns = data.rows[0].length;
  for (let y = 0; y < data.rows.length; y++) {
    for (let x = 0; x < data.rows[y].length; x++) {
      const color = data.colorRows ? data.colorRows[y][x] : data.accent[y][x] ? data.accentColor : data.color;
      if (color && color !== data.color) {
        const span = document.createElement('span'); span.style.color = color; span.textContent = data.rows[y][x]; pre.append(span);
      } else pre.append(document.createTextNode(data.rows[y][x]));
    }
    if (y < data.rows.length - 1) pre.append(document.createTextNode('\n'));
  }
}
