function mountPerspective() {
  app.replaceChildren(...title('图片透视裁剪', '选出照片中的四个角，把倾斜的纸张、屏幕或画面校正为矩形。图片仅在当前浏览器处理。'));
  const root = el('section', { class: 'cropper' });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/bmp', id: 'crop-file' });
  const open = el('label', { for: 'crop-file', text: '选择图片（JPG / PNG / WebP / BMP）', class: 'crop-file-label' }, [file]);
  const undo = el('button', { type: 'button', text: '撤销一点', disabled: '', id: 'crop-undo' });
  const clear = el('button', { type: 'button', text: '清空选点', disabled: '', id: 'crop-clear' });
  const save = el('button', { type: 'button', text: '下载校正图片', class: 'primary', disabled: '', id: 'crop-save' });
  const format = el('select', { 'aria-label': '下载格式', id: 'crop-format' }, [el('option', { value: 'png', text: 'PNG · 保留透明背景' }), el('option', { value: 'jpeg', text: 'JPG · 白色背景' })]);
  const status = el('p', { class: 'status', role: 'status', id: 'crop-status', text: '请选择或拖入一张图片，也可以粘贴剪贴板中的图片。' });
  const info = el('p', { class: 'muted crop-info' });
  const source = el('canvas', { id: 'crop-source', tabindex: '0', 'aria-label': '原图选点区域。点击四个角，或用下方坐标输入框精确选点。' });
  const preview = el('canvas', { id: 'crop-preview', hidden: '', 'aria-label': '透视校正预览' });
  const empty = el('p', { class: 'muted crop-empty', text: '选满四个角后，预览会显示在这里。' });
  const sourceBox = el('div', { class: 'crop-stage' }, [source]);
  const previewBox = el('div', { class: 'crop-stage crop-preview-stage' }, [empty, preview]);
  const coordinates = el('div', { class: 'crop-coordinates', hidden: '' });
  const inputs = [];
  for (let i = 0; i < 4; i++) {
    const row = el('div', { class: 'crop-coordinate' }, [el('span', { text: '点 ' + (i + 1) })]);
    const pair = ['X', 'Y'].map((axis, j) => {
      const input = el('input', { type: 'number', min: '0', step: '1', 'aria-label': '点 ' + (i + 1) + ' 的 ' + axis, placeholder: axis });
      input.addEventListener('change', () => {
        if (!pixels) return;
        if (!points[i]) {
          if (i !== points.length || pair.some(n => n.value === '')) return;
          points.push([Number(pair[0].value), Number(pair[1].value)]);
        }
        points[i][j] = Number(input.value);
        points[i] = points[i].map((n, k) => Math.max(0, Math.min(k ? pixels.height - 1 : pixels.width - 1, n)));
        changed();
      });
      row.append(el('label', { text: axis }, [input]));
      return input;
    });
    inputs.push(pair); coordinates.append(row);
  }
  root.append(open, info, el('div', { class: 'toolbar' }, [undo, clear, format, save]), status,
    el('p', { class: 'muted crop-help', text: '依次点击四个角（任意顺序），再拖动圆点微调。也可输入原图坐标。Esc 清空 · Backspace 撤销 · Enter 下载。' }),
    el('div', { class: 'crop-panes' }, [el('section', { class: 'panel' }, [el('h2', { text: '原图 · 四角选点' }), sourceBox]), el('section', { class: 'panel' }, [el('h2', { text: '校正预览' }), previewBox])]), coordinates);
  app.append(root);
  let pixels = null, bitmap = null, points = [], filename = 'image', drag = null, revision = 0, loadId = 0, timer, busy = false, disposed = false;
  let view = { scale: 1, x: 0, y: 0, width: 1, height: 1 };
  function syncInputs() {
    inputs.forEach((pair, i) => pair.forEach((input, j) => {
      input.disabled = !pixels || busy || i > points.length;
      input.max = pixels ? (j ? pixels.height : pixels.width) - 1 : 0;
      input.value = points[i] ? Math.round(points[i][j]) : '';
    }));
  }
  function controls() {
    undo.disabled = clear.disabled = busy || !points.length;
    file.disabled = format.disabled = busy;
    let valid = false;
    try { Perspective.order(points); valid = true; } catch {}
    save.disabled = busy || !valid;
    syncInputs();
  }
  function draw() {
    const width = Math.max(1, sourceBox.clientWidth), height = 360, ratio = Math.min(devicePixelRatio || 1, 2);
    source.width = Math.round(width * ratio); source.height = height * ratio;
    source.style.height = height + 'px';
    const ctx = source.getContext('2d'); ctx.scale(ratio, ratio);
    if (!bitmap) { ctx.fillStyle = '#607788'; ctx.font = '15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('选择、拖入或粘贴图片', width / 2, height / 2); return; }
    const scale = Math.min((width - 32) / pixels.width, (height - 32) / pixels.height);
    view = { scale, x: (width - pixels.width * scale) / 2, y: (height - pixels.height * scale) / 2, width: pixels.width * scale, height: pixels.height * scale };
    ctx.drawImage(bitmap, view.x, view.y, view.width, view.height);
    let outline = points;
    if (points.length === 4) try { outline = Perspective.order(points); } catch {}
    ctx.beginPath(); outline.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](view.x + p[0] * scale, view.y + p[1] * scale));
    if (points.length === 4) { ctx.closePath(); ctx.fillStyle = '#00b8e52b'; ctx.fill(); }
    ctx.strokeStyle = '#00a5d8'; ctx.lineWidth = 2; ctx.stroke();
    points.forEach((p, i) => {
      const x = view.x + p[0] * scale, y = view.y + p[1] * scale;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = '#ffcc00'; ctx.fill(); ctx.strokeStyle = '#243746'; ctx.stroke();
      ctx.fillStyle = '#243746'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i + 1, x, y);
    });
  }
  async function raster(width, height, token) {
    const data = new ImageData(width, height), matrix = Perspective.transform(points, width, height);
    const input = pixels;
    for (let row = 0; row < height; row += 12) {
      if (disposed || token !== revision) return null;
      Perspective.renderRows(input, data, matrix, row, Math.min(height, row + 12));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return disposed || token !== revision ? null : data;
  }
  async function updatePreview(token) {
    if (!pixels || points.length !== 4) return;
    try {
      const size = Perspective.dimensions(points), scale = Math.min(1, 640 / size.width, 480 / size.height);
      const data = await raster(Math.max(2, Math.round(size.width * scale)), Math.max(2, Math.round(size.height * scale)), token);
      if (!data) return;
      preview.width = data.width; preview.height = data.height; preview.getContext('2d').putImageData(data, 0, 0);
      preview.hidden = false; empty.hidden = true;
      status.textContent = '校正尺寸：' + size.width + ' × ' + size.height + ' 像素。拖动角点可继续微调，下载使用原图分辨率。';
    } catch (e) { if (token === revision) status.textContent = e.message; }
  }
  function changed() {
    revision++; clearTimeout(timer); preview.hidden = true; empty.hidden = false;
    status.textContent = '已选 ' + points.length + ' / 4 个角点。' + (points.length === 4 ? '正在生成预览…' : '请继续选点。');
    controls(); draw(); const token = revision;
    timer = setTimeout(() => updatePreview(token), 90);
  }
  async function load(imageFile) {
    if (!imageFile || busy) return;
    const id = ++loadId;
    status.textContent = '正在读取图片…';
    let next;
    try {
      if (imageFile.size > 50 * 1024 * 1024) throw Error('请选择小于 50 MB 的图片');
      next = await createImageBitmap(imageFile, { imageOrientation: 'from-image' });
      if (disposed || id !== loadId) { next.close(); return; }
      if (next.width * next.height > 24000000 || Math.max(next.width, next.height) > 10000) throw Error('图片过大，请先缩小至 2400 万像素以内，且单边不超过 10000 像素');
      const canvas = document.createElement('canvas'); canvas.width = next.width; canvas.height = next.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(next, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      bitmap?.close(); bitmap = next; next = null; pixels = data; points = []; drag = null;
      filename = (imageFile.name || 'image').replace(/\.[^.]+$/, '');
      info.textContent = (imageFile.name || '粘贴的图片') + ' · ' + pixels.width + ' × ' + pixels.height + ' 像素';
      coordinates.hidden = false; changed();
    } catch (e) { next?.close(); if (!disposed && id === loadId) status.textContent = '无法打开：' + (e.name === 'InvalidStateError' ? '请使用浏览器支持的 JPG、PNG、WebP 或 BMP 图片。TIFF 请先转换为 PNG。' : e.message); }
    finally { if (id === loadId) file.value = ''; }
  }
  file.onchange = () => load(file.files[0]);
  root.addEventListener('dragover', e => { e.preventDefault(); });
  root.addEventListener('drop', e => { e.preventDefault(); load(e.dataTransfer.files[0]); });
  const paste = e => { const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/')); if (item) { e.preventDefault(); load(item.getAsFile()); } };
  document.addEventListener('paste', paste);
  function position(e) { const r = source.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function imagePoint(p) { return [Math.max(0, Math.min(pixels.width - 1, (p[0] - view.x) / view.scale)), Math.max(0, Math.min(pixels.height - 1, (p[1] - view.y) / view.scale))]; }
  source.onpointerdown = e => {
    if (!pixels || busy || e.button !== 0) return;
    e.preventDefault(); source.focus({ preventScroll: true }); const p = position(e);
    const nearest = points.findIndex(q => Math.hypot(view.x + q[0] * view.scale - p[0], view.y + q[1] * view.scale - p[1]) < 20);
    if (nearest >= 0) drag = nearest;
    else if (points.length < 4 && p[0] >= view.x && p[0] <= view.x + view.width && p[1] >= view.y && p[1] <= view.y + view.height) { points.push(imagePoint(p)); drag = points.length - 1; changed(); }
    if (drag !== null) source.setPointerCapture(e.pointerId);
  };
  source.onpointermove = e => { if (drag !== null && !busy) { points[drag] = imagePoint(position(e)); changed(); } };
  source.onpointerup = source.onpointercancel = source.onlostpointercapture = () => { drag = null; };
  undo.onclick = () => { if (!busy) { points.pop(); drag = null; changed(); } };
  clear.onclick = () => { if (!busy) { points = []; drag = null; changed(); } };
  save.onclick = async () => {
    if (save.disabled) return;
    busy = true; revision++; clearTimeout(timer); controls(); const token = revision;
    status.textContent = '正在生成原尺寸图片…';
    try {
      const size = Perspective.dimensions(points);
      if (size.width * size.height > 32000000 || Math.max(size.width, size.height) > 14000) throw Error('输出尺寸过大，请缩小选区');
      const data = await raster(size.width, size.height, token); if (!data) return;
      const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
      const ctx = canvas.getContext('2d'); ctx.putImageData(data, 0, 0);
      if (format.value === 'jpeg') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/' + format.value, 0.95));
      if (disposed || token !== revision) return;
      if (!blob) throw Error('浏览器无法导出此尺寸的图片，请缩小选区');
      const url = URL.createObjectURL(blob), link = el('a', { href: url, download: filename + '_processed.' + (format.value === 'jpeg' ? 'jpg' : 'png') });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = '已生成下载：' + size.width + ' × ' + size.height + ' 像素。';
    } catch (e) { if (!disposed) status.textContent = '下载失败：' + e.message; }
    finally { busy = false; if (!disposed) controls(); }
  };
  const keyboard = e => {
    if (busy || !pixels || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === 'Escape') { e.preventDefault(); clear.click(); }
    if (e.key === 'Backspace') { e.preventDefault(); undo.click(); }
    if (e.key === 'Enter') { e.preventDefault(); save.click(); }
  };
  document.addEventListener('keydown', keyboard);
  const observer = new ResizeObserver(draw); observer.observe(sourceBox); draw();
  return () => { disposed = true; revision++; loadId++; clearTimeout(timer); observer.disconnect(); bitmap?.close(); document.removeEventListener('paste', paste); document.removeEventListener('keydown', keyboard); };
}
