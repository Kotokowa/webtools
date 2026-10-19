/* Shared UI rules, kept inside the water-wave tool. */
(function (root) {
  'use strict';
  function sampleGeometry(mode, start, end, bounds) {
    const [x, y, x1, y1] = bounds;
    const valid = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
      p[0] >= x && p[0] <= x1 && p[1] >= y && p[1] <= y1;
    if (mode === 'point') {
      if (!valid(end)) throw Error('点须在裁边后的有效区域内');
      return {kind: 'points', value: [...end]};
    }
    if (mode === 'hline') { start = [x, end[1]]; end = [x1, end[1]]; }
    else if (mode === 'vline') { start = [end[0], y]; end = [end[0], y1]; }
    else if (mode !== 'line') throw Error('请选择线或采样点');
    if (!valid(start) || !valid(end)) throw Error('线段两端须在裁边后的有效区域内');
    if (Math.hypot(start[0]-end[0], start[1]-end[1]) < 1) throw Error('线段长度至少为一个像素');
    return {kind: 'lines', value: [[...start], [...end]]};
  }
  function resultFilename(names, video = false, folder = '') {
    const stems = names.map(name => name.replace(/\.[^.]+$/, ''));
    const prefixes = video ? stems : stems.map(name => name.replace(/[\s_.-]*\d+$/, ''));
    let prefix = prefixes[0] || '';
    for (const name of prefixes.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
      prefix = prefix.slice(0, i);
    }
    prefix = prefix.replace(/[\s_.-]+$/, '') || folder.split(/[\\/]/).pop() || 'images';
    prefix = prefix.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'images';
    return prefix + '_results.zip';
  }
  function progressTitle(done, total, packing = false) {
    const percent = total > 0 ? Math.min(100, Math.floor(done/total*100)) : 0;
    return `恢复中-${percent}%（${done}/${total}${packing ? '，打包中' : ''}） · 水波场恢复`;
  }
  const api = {sampleGeometry, resultFilename, progressTitle};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterWaveUI = api;
})(globalThis);
