import { LogitechHidppClient } from '@openmouse/protocol/drivers/logitech/hidpp';
import { LOGITECH_BUTTON_ACTIONS } from '@openmouse/protocol/drivers/logitech/onboard-profiles';
import { HIDPP_USAGE_PAGE, LOGITECH_PRODUCTS } from '@openmouse/protocol/logitech';
import { numberOptions, profileChanges, verifyProfile } from './settings.mjs';

const byId = id => document.getElementById(id);
const model = byId('model');
const connect = byId('connect');
const refresh = byId('refresh');
const disconnect = byId('disconnect');
const workspace = byId('workspace');
const modes = { Onboard: '板载模式', Host: '主机模式' };
const actionNames = {
  Disabled: '禁用', 'Left click': '左键', 'Right click': '右键', 'Middle click': '中键', Back: '后退', Forward: '前进',
  'Tilt left': '滚轮左拨', 'Tilt right': '滚轮右拨', 'Next DPI': '提高 DPI', 'Previous DPI': '降低 DPI',
  'Cycle DPI': '循环 DPI 档位', 'Default DPI': '默认 DPI', 'DPI Shift': '临时 DPI', 'Next profile': '下一配置',
  'Previous profile': '上一配置', 'Cycle profiles': '循环配置', 'G-Shift': 'G-Shift', 'Battery indicator': '电量指示', Custom: '当前自定义（保留）'
};
const effectNames = { Off: '关闭', Static: '常亮', Cycling: '循环变色', Wave: '波浪', Spectrum: '光谱', Reactive: '响应', 'Breathing single': '单色呼吸', 'Breathing dual': '双色呼吸' };
let client = null;
let busy = false;
let epoch = 0;
let selectedSector;

function node(tag, { text = '', className = '' } = {}, ...children) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  element.append(...children);
  return element;
}
function button(text, action, className = '') {
  const control = node('button', { text, className });
  control.type = 'button';
  control.onclick = action;
  return control;
}
function select(options, value) {
  const control = node('select');
  control.append(...options.map(([key, name]) => new Option(name, key)));
  if (value != null) control.value = value;
  return control;
}
function numberSelect(options, value, unit = '') {
  const values = numberOptions([...options, value]);
  return select(values.map(option => [option, `${option}${unit}`]), value);
}
const field = (text, control) => node('label', {}, text, control);
const hint = text => node('p', { text, className: 'muted' });
const panel = (text, ...children) => node('section', { className: 'panel' }, node('h2', { text }), ...children);
const group = (...children) => node('div', { className: 'toolbar controls' }, ...children);
const fields = (...children) => node('div', { className: 'fields' }, ...children);

function setStatus(text, error = false) {
  byId('status').textContent = text;
  byId('status').dataset.error = String(error);
}
function controls() {
  connect.hidden = Boolean(client);
  refresh.hidden = disconnect.hidden = !client;
  connect.disabled = busy || !navigator.hid;
  refresh.disabled = disconnect.disabled = busy;
  model.disabled = busy || Boolean(client);
  workspace.inert = busy;
}
async function run(message, action) {
  if (busy) return;
  const turn = epoch;
  busy = true;
  controls();
  setStatus(message);
  try {
    await action();
  } catch (error) {
    if (turn === epoch) setStatus(`操作未完成：${error.message || error}`, true);
  } finally {
    busy = false;
    controls();
  }
}
function clearConnection() {
  epoch += 1;
  client = null;
  selectedSector = undefined;
  workspace.replaceChildren();
  workspace.hidden = true;
  controls();
}
function updateModelHelp(device) {
  const g309 = device ? /\bG309\b/i.test(device.name) || device.modelId === 'B03C40B10000' : false;
  byId('model-help').textContent = model.value === 'g309'
    ? device && !g309
      ? `选的是 G309，实际连接的是 ${device.name}。下方只显示实际设备的能力。`
      : 'G309 推荐使用 LIGHTSPEED USB 接收器；匹配设备后会自动显示设置。'
    : model.value.startsWith('usb:') ? '只列出所选型号的有线接口。用接收器或蓝牙时，请切换为自动识别。'
      : '在弹窗中选择鼠标或接收器；页面会读取实际型号和能力。';
}

async function requestMouse(preset) {
  if (!preset.startsWith('usb:')) return LogitechHidppClient.requestReceiver();
  const productId = Number(preset.slice(4));
  const filters = [1, 2].map(usage => ({ vendorId: 0x046d, productId, usagePage: HIDPP_USAGE_PAGE, usage }));
  const devices = (await navigator.hid.requestDevice({ filters })).filter(device => LogitechHidppClient.isSupported(device));
  devices.sort((left, right) => LogitechHidppClient.supportScore(right) - LogitechHidppClient.supportScore(left));
  return devices.length ? new LogitechHidppClient(devices[0]) : null;
}

async function readDevice(target, success = '已读取设备设置。') {
  const status = await target.readStatus();
  const dpiOptions = numberOptions(await target.getDpiOptions().catch(() => []));
  let profiles = [];
  let profileError = '';
  if (status.onboardProfileFormat?.supported) {
    try { profiles = await target.readOnboardProfiles(); }
    catch (error) { profileError = String(error.message || error); }
  }
  if (target !== client) return;
  render(target, status, dpiOptions, profiles, profileError);
  updateModelHelp(status);
  setStatus(success);
}
function apply(target, message, operation) {
  return run(message, async () => {
    const success = await operation();
    if (target === client) await readDevice(target, success);
  });
}

function performancePanel(target, status, dpiOptions) {
  const horizontal = numberSelect(dpiOptions, status.dpi);
  const vertical = status.supportsSeparateDpiAxes ? numberSelect(dpiOptions, status.dpiY ?? status.dpi) : horizontal;
  const applyDpi = button('应用当前 DPI', () => apply(target, '正在设置 DPI…', async () => {
    const x = Number(horizontal.value);
    const y = Number(vertical.value);
    if (!dpiOptions.includes(x) || !dpiOptions.includes(y)) throw new Error('设备未公布这个 DPI 值。');
    await target.setDpi(x, y);
    return `已应用 ${x === y ? x : `${x} × ${y}`} DPI。`;
  }));
  const rates = numberOptions(status.supportedPollingRates);
  const rate = numberSelect(rates, status.pollingRateHz, ' Hz');
  const applyRate = button('应用回报率', () => apply(target, '正在设置回报率…', async () => {
    const value = Number(rate.value);
    if (!rates.includes(value)) throw new Error('设备未公布这个回报率。');
    const confirmed = await target.setPollingRate(value);
    if (confirmed !== value) throw new Error('设备未确认预期回报率。');
    return `已应用 ${confirmed} Hz。`;
  }));
  const inOnboardMode = status.deviceMode === 'Onboard';
  const children = [];
  if (dpiOptions.length) children.push(group(field(vertical === horizontal ? 'DPI' : 'X 轴 DPI', horizontal),
    ...(vertical === horizontal ? [] : [field('Y 轴 DPI', vertical)]), applyDpi));
  if (rates.length && !status.ui?.pollingReadOnly) children.push(group(field('回报率', rate), applyRate));
  if (!children.length) return null;
  if (inOnboardMode) applyDpi.disabled = true;
  return panel('DPI 与回报率', ...children, hint(inOnboardMode
    ? '当前为板载模式。要保存 DPI 请编辑板载档位；要临时调 DPI，请先切到主机模式。'
    : '当前 DPI 是即时设置。要在重启后保留，请写入板载档位。'));
}

function backupProfiles(profiles, formatId) {
  const snapshot = { format: 'logitech-hidpp-onboard', version: 1, profileFormatId: formatId,
    profiles: profiles.map(({ sector, enabled, crcValid, raw }) => ({ sector, enabled, crcValid, raw: Array.from(raw) })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = 'logitech-onboard-backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onboardPanel(target, status, dpiOptions, profiles, profileError) {
  const format = status.onboardProfileFormat;
  if (!format) return null;
  if (!profiles.length) return panel('板载配置', hint(profileError ? `无法读取板载配置：${profileError}` : '这台设备没有可读取的板载档位。'));
  const profile = profiles.find(entry => entry.sector === selectedSector) ?? profiles.find(entry => entry.isCurrent) ?? profiles[0];
  const chooser = select(profiles.map((entry, index) => [entry.sector,
    `${entry.name || `档位 ${index + 1}`}${entry.isCurrent ? ' · 当前' : ''}${entry.enabled ? '' : ' · 未启用'}`]), profile.sector);
  chooser.onchange = () => {
    selectedSector = Number(chooser.value);
    render(target, status, dpiOptions, profiles, profileError);
    workspace.querySelector('#profile-choice')?.focus();
  };
  chooser.id = 'profile-choice';
  const top = group(field('板载档位', chooser), button('导出备份', () => backupProfiles(profiles, format.id)));
  if (status.deviceMode === 'Host' || status.deviceMode === 'Onboard') {
    const nextMode = status.deviceMode === 'Host' ? 'Onboard' : 'Host';
    top.append(button(`切到${modes[nextMode]}`, () => apply(target, '正在切换模式…', async () => {
      if (await target.setOnboardMode(nextMode) !== nextMode) throw new Error('设备未确认模式切换。');
      return `已切到${modes[nextMode]}。`;
    })));
  }
  if (!profile.isCurrent && profile.enabled && status.deviceMode === 'Onboard') top.append(button('启用此档位', () =>
    apply(target, '正在切换板载档位…', async () => {
      await target.setCurrentProfile(profile.sector);
      if (!(await target.readOnboardProfiles()).some(entry => entry.sector === profile.sector && entry.isCurrent))
        throw new Error('设备未确认档位切换。');
      return '已切换并回读板载档位。';
    })));
  const writable = format.writable && profile.crcValid;
  const editDpi = writable && dpiOptions.length > 0 && profile.dpiStages.length > 0 && profile.defaultDpiIndex != null;
  const stages = profile.dpiStages.map(stage => {
    const x = numberSelect(dpiOptions, stage.x);
    const y = status.supportsSeparateDpiAxes && format.id >= 6 ? numberSelect(dpiOptions, stage.y) : null;
    x.disabled = !editDpi;
    if (y) y.disabled = !editDpi;
    return { x, y, original: stage };
  });
  const defaultStage = select(stages.map((stage, index) => [index, `档位 ${index + 1}`]), profile.defaultDpiIndex);
  defaultStage.disabled = !editDpi;
  const stageInputs = stages.flatMap(({ x, y }, index) => y
    ? [field(`档位 ${index + 1} · X`, x), field(`档位 ${index + 1} · Y`, y)] : [field(`档位 ${index + 1} · DPI`, x)]);
  const assignments = profile.buttonAssignments.filter(entry => entry.raw.some(byte => byte !== 255)).map(entry => {
    const actions = [...new Set([entry.action, ...LOGITECH_BUTTON_ACTIONS])];
    const control = select(actions.map(action => [action, actionNames[action] || action]), entry.action);
    control.disabled = !writable || entry.action === 'Left click' || entry.action === 'Right click';
    return { entry, control };
  });
  const pieces = [top];
  if (stages.length) pieces.push(node('h3', { text: 'DPI 档位' }), fields(...stageInputs, field('默认 DPI 档', defaultStage)));
  if (assignments.length) pieces.push(node('details', {}, node('summary', { text: '功能键映射' }),
    fields(...assignments.map(({ entry, control }) => field(`按键 ${entry.button + 1}`, control))), hint('主左右键和未改动的自定义动作会保留。')));
  if (writable && (editDpi || assignments.some(({ control }) => !control.disabled))) {
    pieces.push(group(button('保存到鼠标', () => {
      let changes;
      try {
        changes = profileChanges(profile, {
          stages: editDpi ? stages.map(({ x, y, original }) => ({ x: Number(x.value), y: y ? Number(y.value) : original.x === original.y ? Number(x.value) : original.y })) : undefined,
          defaultIndex: Number(defaultStage.value),
          buttons: assignments.filter(({ control }) => !control.disabled).map(({ entry, control }) => ({ button: entry.button, binding: control.value }))
        }, dpiOptions);
      } catch (error) { setStatus(error.message, true); return; }
      if (!changes) { setStatus('没有需要保存的变更。'); return; }
      if (!window.confirm('将更改写入所选板载档位。请勿拔下接收器或关闭鼠标。继续吗？')) return;
      apply(target, '正在写入并校验板载配置…', async () => {
        await target.writeActiveProfile(changes);
        const verified = (await target.readOnboardProfiles()).find(entry => entry.sector === changes.sector);
        if (!verifyProfile(verified, changes)) throw new Error('回读与预期不符，请检查设备后再尝试。');
        return '已写入并回读验证。可在板载模式下断电重连，确认设置仍在。';
      });
    }, 'primary')));
  } else if (!writable) pieces.push(hint(profile.crcValid ? '这个板载格式只读，暂不开放写入。' : '此档位校验未通过，禁止写入。'));
  return panel('板载配置', ...pieces);
}

function lightingPanel(target, status) {
  const lighting = status.lighting;
  if (!lighting?.modes?.length) return null;
  const mode = select(lighting.modes.map(value => [value, effectNames[value] || value]), lighting.mode);
  const color = node('input');
  const second = node('input');
  color.type = second.type = 'color';
  color.value = lighting.color || '#66ccff';
  second.value = lighting.color2 || '#ffffff';
  const mainColor = field('颜色', color);
  const otherColor = field('第二颜色', second);
  const sync = () => {
    mainColor.hidden = !lighting.colorModes.includes(mode.value);
    otherColor.hidden = !lighting.dualColorModes.includes(mode.value);
  };
  mode.onchange = sync;
  sync();
  return panel('灯光', group(field('灯效', mode), mainColor, otherColor, button('应用灯效', () =>
    apply(target, '正在设置灯效…', async () => {
      if (!lighting.modes.includes(mode.value)) throw new Error('请选择设备支持的灯效。');
      await target.setLighting({ ...lighting, mode: mode.value, color: color.value, color2: second.value });
      return '设备已接受灯效设置；部分型号断开后会恢复板载灯效。';
    }))), hint('可能临时切换到主机模式；灯效不保证可写入板载。'));
}

function render(target, status, dpiOptions, profiles, profileError) {
  const stats = [
    ['连接', status.connectionDetail || status.connectionType || '—'], ['电量', status.batteryPercent == null ? '—' : `${status.batteryPercent}%`],
    ['当前 DPI', status.dpi > 0 ? (status.supportsSeparateDpiAxes ? `${status.dpi} × ${status.dpiY ?? status.dpi}` : status.dpi) : '—'],
    ['回报率', status.pollingRateHz > 0 ? `${status.pollingRateHz} Hz` : '—'], ['模式', modes[status.deviceMode] || '—']
  ];
  const summary = node('dl', { className: 'stats' }, ...stats.map(([name, value]) => node('div', {}, node('dt', { text: name }), node('dd', { text: value }))));
  workspace.replaceChildren(panel(status.name || 'Logitech 鼠标', summary),
    ...[performancePanel(target, status, dpiOptions), onboardPanel(target, status, dpiOptions, profiles, profileError), lightingPanel(target, status)].filter(Boolean));
  workspace.hidden = false;
}

const wired = node('optgroup');
wired.label = '指定有线型号';
wired.append(...[...LOGITECH_PRODUCTS].sort((left, right) => left[1].name.localeCompare(right[1].name))
  .map(([productId, { name }]) => new Option(name, `usb:${productId}`)));
model.append(new Option('G309 LIGHTSPEED（推荐 USB 接收器）', 'g309'), wired);
model.onchange = () => { if (!client) updateModelHelp(); };
connect.onclick = () => run('等待浏览器授权…', async () => {
  const target = await requestMouse(model.value);
  if (!target) { setStatus('没有选择可用设备。'); return; }
  client = target;
  setStatus('正在识别设备并读取配置…');
  try { await readDevice(target); }
  catch (error) {
    await target.close().catch(() => {});
    if (client === target) client = null;
    throw error;
  }
});
refresh.onclick = () => { if (client) apply(client, '正在重新读取…', async () => '已重新读取设备。'); };
disconnect.onclick = () => run('正在断开…', async () => {
  try { await client?.close(); }
  finally { clearConnection(); }
  setStatus('已断开。');
});
navigator.hid?.addEventListener('disconnect', ({ device }) => {
  if (client?.device !== device) return;
  const disconnected = client;
  clearConnection();
  disconnected.close().catch(() => {});
  setStatus('设备已断开，请重新连接。');
});
if (!navigator.hid) setStatus('当前浏览器不支持 WebHID。请用电脑版 Chrome 或 Edge 打开 HTTPS 页面。', true);
controls();
