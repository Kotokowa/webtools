// Add tools here, each with an independent mount function. Keep the bare
// fragment route reserved for 8A cards so existing physical tags stay valid.
const TOOLS = [
  { id: 'nfc', name: 'NFC 卡片解码', tag: '8A · v2 / v3', description: '从卡片链接还原字符头像、颜色和完整留言。也可以下载一份离线解码器。', mount: mountNfc },
  { id: 'text', name: '文本编码转换', tag: 'UTF-8 · 浏览器本地', description: '在文字、Base64、URL 编码和十六进制之间转换，支持中文。', mount: mountText }
];
const app = document.getElementById('app');
function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children); return node;
}
function title(name, description) {
  return [el('p', { class: 'eyebrow', text: 'KOTOKOWA / WEBTOOLS' }), el('h1', { text: name }), el('p', { class: 'muted lead', text: description })];
}
function mountHome() {
  const grid = el('div', { class: 'grid' });
  for (const tool of TOOLS) grid.append(el('section', { class: 'tile' }, [
    el('span', { class: 'tag', text: tool.tag }), el('h2', { text: tool.name }),
    el('p', { class: 'muted', text: tool.description }), el('a', { class: 'button', href: '?tool=' + tool.id, text: '打开工具 →' })
  ]));
  app.replaceChildren(...title('小工具，随手可用。', '编码、解码和一些轻巧的实验。无需注册，打开就能用。'), grid);
}
function mountNfc(initial = '') {
  app.replaceChildren(...title('卡里的小小世界', '头像和留言来自卡片中的链接。这个页面负责把它们展开。'));
  const status = el('p', { class: 'status', role: 'status', id: 'nfc-status' });
  const card = el('article', { class: 'panel card-content', hidden: '', id: 'nfc-card' });
  const pre = el('pre', { class: 'avatar', 'aria-label': '由字符8组成的头像', id: 'nfc-avatar' });
  const message = el('div', { class: 'message', id: 'nfc-message' });
  const website = el('a', { class: 'website', text: '来我的网页玩', target: '_blank', rel: 'noopener noreferrer', id: 'nfc-website' });
  card.append(pre, message, website);
  const input = el('textarea', { id: 'nfc-input', spellcheck: 'false', placeholder: '粘贴完整链接或 # 后的编码', 'aria-label': '卡片链接' });
  const button = el('button', { class: 'primary', text: '展开内容', type: 'button', id: 'nfc-decode' });
  const details = el('details', {}, [el('summary', { text: '手动解码与离线备份' }),
    el('p', { text: '离线解码器自带全部代码。保存后，无网络也能打开它，粘贴完整卡片链接来还原内容。' }), input,
    el('div', { class: 'toolbar' }, [button, el('a', { class: 'button', download: 'nfc-offline.html', href: 'nfc-offline.html', text: '下载离线解码器' })])]);
  app.append(status, card, details);
  const fit = () => { pre.style.fontSize = Math.min(13.5, Math.max(4, (card.clientWidth - (innerWidth <= 480 ? 24 : 48)) / (64 * 0.601))) + 'px'; };
  window.onresize = fit;
  function render(value) {
    try {
      const data = decodeCard(value);
      pre.replaceChildren(); pre.style.color = data.color;
      for (let y = 0; y < data.rows.length; y++) {
        for (let x = 0; x < data.rows[y].length; x++) {
          if (data.accent[y][x]) { const span = el('span', { text: data.rows[y][x] }); span.style.color = data.accentColor; pre.append(span); }
          else pre.append(document.createTextNode(data.rows[y][x]));
        }
        if (y < data.rows.length - 1) pre.append(document.createTextNode('\n'));
      }
      message.textContent = data.message; website.href = data.website;
      card.hidden = false; status.textContent = ''; fit();
    } catch (e) { card.hidden = true; status.textContent = '未能展开：' + String(e.message || e); details.open = true; }
  }
  button.onclick = () => render(input.value);
  if (initial) render(initial); else details.open = true;
}
function mountText() {
  app.replaceChildren(...title('文本编码转换', '支持中文的 UTF-8 转换。输入留在当前浏览器中。'));
  const panel = el('section', { class: 'panel' });
  const format = el('select', { id: 'text-format', 'aria-label': '编码格式' }, [
    el('option', { value: 'base64', text: 'Base64' }), el('option', { value: 'url', text: 'URL 百分号编码' }), el('option', { value: 'hex', text: 'UTF-8 十六进制' })
  ]);
  const input = el('textarea', { id: 'text-input', spellcheck: 'false', placeholder: '输入要转换的内容' });
  const output = el('textarea', { id: 'text-output', readonly: '', 'aria-label': '转换结果' });
  const encode = el('button', { class: 'primary', text: '编码', id: 'text-encode' });
  const decode = el('button', { text: '解码', id: 'text-decode' });
  const copy = el('button', { text: '复制结果', id: 'text-copy' });
  const status = el('p', { class: 'status', role: 'status' });
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  function convert(reverse) {
    try {
      const s = input.value; let result;
      if (s.length > 1000000) throw Error('请使用小于一百万字符的输入');
      if (format.value === 'url') result = reverse ? decodeURIComponent(s) : encodeURIComponent(s);
      else if (format.value === 'hex') {
        if (reverse) {
          const clean = s.replace(/\s/g, '');
          if (!/^(?:[0-9a-f]{2})*$/i.test(clean)) throw Error('十六进制须为完整的两位字节');
          result = utf8.decode(Uint8Array.from(clean.match(/../g) || [], h => parseInt(h, 16)));
        } else result = Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join(' ');
      } else if (reverse) result = utf8.decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
      else {
        let binary = ''; for (const b of new TextEncoder().encode(s)) binary += String.fromCharCode(b);
        result = btoa(binary);
      }
      output.value = result; status.textContent = '已完成，结果共 ' + result.length + ' 个字符。';
    } catch (e) { output.value = ''; status.textContent = '转换失败：' + e.message; }
  }
  encode.onclick = () => convert(false); decode.onclick = () => convert(true);
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(output.value); status.textContent = '已复制结果。'; }
    catch { output.focus(); output.select(); status.textContent = '请手动复制已选中的结果。'; }
  };
  panel.append(format, el('label', { for: 'text-input', text: '输入' }), input, el('div', { class: 'toolbar' }, [encode, decode]), el('label', { for: 'text-output', text: '结果' }), output, copy, status);
  app.append(panel);
}
function route() {
  window.onresize = null;
  // Raw fragment is a permanent, short NFC entry point. Do not repurpose it.
  if (location.hash.length > 1) return mountNfc(location.hash);
  const tool = new URLSearchParams(location.search).get('tool');
  const entry = TOOLS.find(t => t.id === tool);
  if (entry) entry.mount(); else mountHome();
}
addEventListener('hashchange', route);
route();
