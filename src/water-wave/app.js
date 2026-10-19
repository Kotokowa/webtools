'use strict';
const $ = id => document.getElementById(id);
const {sampleGeometry, resultFilename, progressTitle} = WaterWaveUI;
const idleTitle = document.title;
const state = {local: false, backend: null, ready: false, busy: false, stop: false, groups: [], files: [], refFile: null, refData: null,
  image: null, width: 0, height: 0, roi: null, geometry: {lines: [], points: []}, history: [], mode: 'roi',
  drag: null, view: null, video: null, session: null, downloadUrl: null, referenceGeneration: 0};
const imagePattern = /\.(png|jpe?g|tiff?|bmp|webp)$/i;
const videoPattern = /\.(mp4|avi|mov|mkv|webm|m4v)$/i;
const refPattern = /^(jt|ref|reference|static|静态|静水|基准)([_.\-\d ]|$)/i;
const collator = new Intl.Collator('zh', {numeric: true, sensitivity: 'base'});
const numericConfig = ['water_depth_mm','acrylic_mm','n_water','n_acrylic','n_air','square_mm','mm_per_pixel','edge_crop','filter_ratio','color_limit_mm','fps','temporal_limit_mb'];
function status(text) { $('status').textContent = text; }
function warning(text) { $('warnings').textContent = text; $('warnings').hidden = !text; }
function report(error) { warning(String(error.message || error)); status('操作未完成，请检查上方提示。'); }
function catchAction(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(report); }
function b64(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); }); }
function from64(s, name) { const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0)); return new File([bytes], name, {type:'image/png'}); }
function loadImage(data) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error('预览图加载失败')); im.src = 'data:image/png;base64,' + data; }); }
function refreshRun() { $('run').disabled = state.busy || !state.refData || (!state.video && !dynamicFiles().length); }
function busy(value) {
  state.busy = value;
  document.querySelectorAll('button,input,select').forEach(el => {
    if (value) { el.dataset.wasDisabled = el.disabled ? '1':'0'; el.disabled = true; }
    else el.disabled = el.dataset.wasDisabled === '1';
  });
  $('stop').disabled = !value;
  refreshRun();
}
async function detect() {
  try {
    const r = await fetch('/api/info', {signal: AbortSignal.timeout(2500)});
    state.local = r.ok && (await r.json()).mode === 'local';
  } catch { state.local = false; }
  $('engine').textContent = state.local ? '本地 Python · 离线计算' : '浏览器 Python · 本机计算';
  if (state.local) $('home-link').hidden = true;
  const videoExport = document.querySelector('[data-export="video"]');
  videoExport.disabled = !state.local;
  if (!state.local) $('video-note').textContent = 'AVI 使用浏览器内解码并读取帧率；其他视频按输入帧率抽帧。大视频或变帧率视频建议本地版。';
}
const detected = detect();
async function engine() {
  await detected;
  if (state.backend) return state.backend;
  if (!state.booting) state.booting = initializeEngine().catch(error => { state.booting=null; throw error; });
  return state.booting;
}
async function initializeEngine() {
  if (state.local) {
    state.backend = async message => {
      const r = await fetch('/api/rpc', {method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(message)});
      const result = await r.json();
      if (!r.ok || result.error) throw Error(result.error || '本地服务异常');
      return result;
    };
  } else {
    status('首次正在下载 Python 科学计算环境（数十 MB），之后开始读取图片…');
    const worker = new Worker('worker.js');
    let seq = 0;
    const pending = new Map();
    worker.onmessage = ({data}) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      data.error ? entry.reject(Error(data.error)) : entry.resolve(data.result);
    };
    worker.onerror = event => { for (const p of pending.values()) p.reject(Error(event.message || 'Python 环境加载失败，请检查网络或使用本地版')); pending.clear(); };
    const rpc = message => new Promise((resolve,reject) => { const id=++seq; pending.set(id,{resolve,reject}); worker.postMessage({id,message}); });
    try { await rpc({op:'boot'}); state.backend=rpc; }
    catch (e) { worker.terminate(); throw e; }
  }
  state.ready=true;
  return state.backend;
}
async function rpc(m) { return (await engine())(m); }
function setOptions(select, entries, placeholder) {
  select.replaceChildren();
  if (placeholder) select.add(new Option(placeholder,''));
  entries.forEach(([value,text]) => select.add(new Option(text,String(value))));
}
function dynamicFiles() { return state.files.filter(f => f !== state.refFile && !refPattern.test(f.name)); }
function frameId(file, i) { const m=file.name.replace(/\.[^.]+$/,'').match(/(\d+)$/); return m ? Number(m[1]) : i+1; }
function updateCount() {
  const count=state.video ? state.video.count : dynamicFiles().length;
  $('end').value=Math.max(1,count); $('end').max=count; $('start').value=1; $('stride').value=1; $('frame-list').value='';
  $('source-info').textContent=state.video ? `视频：${state.video.file.name} · ${state.video.count} 帧 · ${state.video.fps} fps${state.video.decoder||state.video.key?'（文件帧率）':'（按输入帧率抽帧）'}` : `${count} 张动态图片；按文件名数字排序，参考图与常见输出图已排除。`;
  refreshRun();
}
async function releaseVideo() {
  if (!state.video) return;
  if (state.video.key) await rpc({op:'release_video',video:state.video.key});
  if (state.video.decoder) state.video.decoder.close();
  if (state.video.url) URL.revokeObjectURL(state.video.url);
  state.video=null;
}
async function importFiles(files) {
  if (!files.length) return;
  await releaseVideo();
  const groups=new Map();
  for (const file of files) {
    const relative=file.webkitRelativePath || file.name;
    const folder=relative.includes('/') ? relative.slice(0,relative.lastIndexOf('/')) : '所选图片';
    if (imagePattern.test(file.name) && !/(分析|水位场|形变场|_height_|_phaseamp_)/i.test(file.name)) {
      if (!groups.has(folder)) groups.set(folder,{name:folder,files:[]});
      groups.get(folder).files.push(file);
    } else if (videoPattern.test(file.name)) groups.set(relative,{name:'视频 · '+relative,video:file});
  }
  state.groups=[...groups.values()].sort((a,b)=>collator.compare(a.name,b.name));
  if (!state.groups.length) throw Error('未找到支持的图片或视频。请选择原始影像文件夹。');
  setOptions($('dataset'),state.groups.map((g,i)=>[i,g.name]));
  await chooseGroup(0);
}
async function chooseGroup(i) {
  await releaseVideo();
  const group=state.groups[i];
  if (!group) return;
  if (group.video) { state.files=[]; return importVideo(group.video); }
  state.files=group.files.slice().sort((a,b)=>collator.compare(a.name,b.name));
  setOptions($('reference'),state.files.map((f,i)=>[i,f.name]),'选择静水参考图');
  const index=state.files.findIndex(f=>refPattern.test(f.name));
  if (index>=0) { $('reference').value=index; await setReference(state.files[index]); }
  else if (!state.externalReference) {
    state.refFile=null;state.refData=null;state.image=null;state.roi=null;state.geometry={lines:[],points:[]};state.history=[];
    $('empty-state').hidden=false;$('ref-info').textContent='当前数据组没有自动识别到静水参考图，请手动选择。';draw();
    status('已识别图片序列；请从下拉框选择静水参考图，或单独导入。');
  }
  updateCount();
}
async function setReference(file, external=false) {
  const generation=++state.referenceGeneration;
  status('读取参考图…'); warning('');
  const data=await b64(file);
  const info=await rpc({op:'inspect',data});
  const image=await loadImage(info.preview);
  if (generation!==state.referenceGeneration) return;
  const changed=state.width!==info.width || state.height!==info.height;
  state.refFile=file; state.refData=data; state.externalReference=external; state.image=image; state.width=info.width; state.height=info.height;
  if (changed || !state.roi) { state.roi=[0,0,state.width,state.height]; state.geometry={lines:[],points:[]}; state.history=[]; }
  $('ref-info').textContent=`参考：${file.name} · ${info.width} × ${info.height} px。${changed?'已重置范围，请框选或导入记录。':'已保留原尺寸范围记录。'}`;
  $('empty-state').hidden=true; syncROI(); draw(); updateCount();
  status('参考图已就绪。框选无遮挡格纹范围，按需添加剖面线与采样点。');
}
async function importVideo(file) {
  await detected; await releaseVideo();
  busy(true);
  try {
  status('正在导入视频…');
  if (state.local) {
    const r=await fetch('/api/video',{method:'POST',headers:{'Content-Type':file.type || (file.name.endsWith('.avi')?'video/avi':'video/mp4')},body:file});
    const info=await r.json(); if (!r.ok) throw Error(info.error);
    state.video={file,key:info.video,count:info.count,fps:info.fps,width:info.width,height:info.height};
    $('fps').value=info.fps;
  } else if (/\.avi$/i.test(file.name)) {
    status('正在加载 AVI 解码器（首次需下载约 32 MB），文件只在本机读取…');
    const worker=new Worker('video-worker.js'),pending=new Map();let seq=0;
    worker.onmessage=({data})=>{const entry=pending.get(data.id);if(!entry)return;if(data.progressText){status(data.progressText);return;}pending.delete(data.id);data.error?entry.reject(Error(data.error)):entry.resolve(data.result);};
    worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'AVI 解码器加载失败，请检查网络'));pending.clear();};
    const decoder={call:message=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,...message});}),close:()=>{worker.terminate();for(const p of pending.values())p.reject(Error('视频已关闭'));pending.clear();}};
    try{const info=await decoder.call({op:'open',file});state.video={file,decoder,...info};$('fps').value=info.fps;warning('AVI 在浏览器内按帧解码，不上传、不转为有损视频。高分辨率长序列建议使用本地版。');}
    catch(error){decoder.close();throw error;}
  } else {
    const video=document.createElement('video'); video.muted=true; video.playsInline=true; video.preload='auto';
    const url=URL.createObjectURL(file);
    try {
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('视频加载超时；请使用本地版或转换为 MP4')),20000); video.onloadeddata=()=>{clearTimeout(timer);resolve();}; video.onerror=()=>{clearTimeout(timer);reject(Error('浏览器不能解码此视频；请使用本地 Python 版（支持 AVI）或转为 MP4。'));};video.src=url;});
      if (!Number.isFinite(video.duration)) throw Error('无法读取视频长度');
      const fps=Number($('fps').value)||30; $('fps').value=fps;
      state.video={file,element:video,url,fps,count:Math.floor(video.duration*fps),width:video.videoWidth,height:video.videoHeight};
      warning('浏览器无法可靠读取采集帧率，当前按 '+fps+' fps 抽帧。请核实并修改；恒定帧率视频才有准确的帧号对应。');
    } catch(e) { URL.revokeObjectURL(url); throw e; }
  }
  state.files=[]; setOptions($('reference'),[],'请单独导入静水参考图'); updateCount();
  status('视频已导入。请单独选择相同尺寸的静水参考图，再选择处理范围。');
  } finally {busy(false);}
}
function config() {
  const out={}; numericConfig.forEach(id=>{const v=Number($(id).value);if (!Number.isFinite(v) || $(id).value==='') throw Error('参数不能为空：'+id);out[id]=v;});
  out.unwrap=$('unwrap').checked;out.remove_mean_displacement=$('remove_mean_displacement').checked;
  out.detrend=$('detrend').value;out.integration=$('integration').value;return out;
}
function exportsSelected() { return [...document.querySelectorAll('[data-export]:checked')].map(e=>e.dataset.export); }
function readROI() {
  const v=['roi-x','roi-y','roi-w','roi-h'].map(id=>Number($(id).value));
  if(!v.every(Number.isInteger)||v[0]<0||v[1]<0||v[2]<64||v[3]<64||v[0]+v[2]>state.width||v[1]+v[3]>state.height) throw Error('范围无效或超出图片；最小 64×64');
  return [v[0],v[1],v[0]+v[2],v[1]+v[3]];
}
function settings() { state.roi=readROI();syncROI();draw();return {config:config(),roi:state.roi,geometry:state.geometry,exports:exportsSelected(),reference_name:state.refFile?.name}; }
function syncROI() {
  if (!state.roi) return;
  const [x,y,x1,y1]=state.roi;
  ['roi-x','roi-y','roi-w','roi-h'].forEach((id,i)=>$(id).value=[x,y,x1-x,y1-y][i]);
  $('geometry-info').textContent=`原图 ${state.width} × ${state.height} px · ROI ${x1-x} × ${y1-y} px · ${state.geometry.lines.length} 条线 / ${state.geometry.points.length} 个点。虚线内为裁边后有效区域。`;
  $('geometry-list').replaceChildren();
  for (const kind of ['lines','points']) state.geometry[kind].forEach((value,i)=>{
    const row=document.createElement('div');row.className='sample-row';
    const name=`${kind==='lines'?'线':'点'} ${i+1}`,title=document.createElement('b');title.textContent=name;row.append(title);
    const values=kind==='lines'?value.flat():value,inputs=[];
    values.forEach((v,j)=>{const label=document.createElement('label');label.textContent=(j%2?'Y':'X')+(kind==='lines'?Math.floor(j/2)+1:'');const input=document.createElement('input');input.type='number';input.step='any';input.value=v;input.setAttribute('aria-label',name+' '+label.textContent);input.disabled=state.busy;inputs.push(input);label.append(input);row.append(label);});
    const apply=document.createElement('button');apply.textContent='应用';apply.setAttribute('aria-label','应用'+name+'坐标');apply.disabled=state.busy;
    apply.onclick=catchAction(()=>{state.roi=readROI();const v=inputs.map(readCoordinate);const sample=sampleGeometry(kind==='lines'?'line':'point',v.slice(0,2),kind==='lines'?v.slice(2):v,effectiveBounds());state.geometry[kind][i]=sample.value;warning('');syncROI();draw();});
    row.append(apply);$('geometry-list').append(row);
  });
}
function draw() {
  const canvas=$('canvas'),ctx=canvas.getContext('2d');
  const width=Math.max(280,canvas.parentElement.clientWidth-2),height=state.image?Math.max(240,Math.min(600,width*state.height/state.width)):360;
  const dpr=window.devicePixelRatio||1;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.height=height+'px';ctx.scale(dpr,dpr);
  ctx.fillStyle='#edf2f5';ctx.fillRect(0,0,width,height);
  if (!state.image) return;
  const scale=Math.min(width/state.width,height/state.height),ox=(width-state.width*scale)/2,oy=(height-state.height*scale)/2;
  state.view={scale,ox,oy};ctx.drawImage(state.image,ox,oy,state.width*scale,state.height*scale);
  const pos=p=>[ox+p[0]*scale,oy+p[1]*scale];
  const rect=r=>{const [x,y]=pos(r);ctx.strokeRect(x,y,(r[2]-r[0])*scale,(r[3]-r[1])*scale);};
  if (state.roi) {
    const [x0,y0,x1,y1]=state.roi,[x,y]=pos([x0,y0]);
    ctx.fillStyle='#102d4966';ctx.beginPath();ctx.rect(ox,oy,state.width*scale,state.height*scale);ctx.rect(x,y,(x1-x0)*scale,(y1-y0)*scale);ctx.fill('evenodd');
    ctx.strokeStyle='#50e7e1';ctx.lineWidth=2;rect(state.roi);
    const e=Number($('edge_crop').value)||0;ctx.setLineDash([4,4]);ctx.strokeStyle='#fff9';ctx.lineWidth=1;rect([x0+e,y0+e,x1-e,y1-e]);ctx.setLineDash([]);
  }
  function line(points,color,label) {ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...pos(points[0]));ctx.lineTo(...pos(points[1]));ctx.stroke();if(label)text(label,pos(points[0]),color);}
  function text(label,p,color) {ctx.font='bold 12px sans-serif';ctx.strokeStyle='#102737';ctx.lineWidth=3;ctx.strokeText(label,p[0]+6,p[1]-6);ctx.fillStyle=color;ctx.fillText(label,p[0]+6,p[1]-6);}
  state.geometry.lines.forEach((l,i)=>line(l,'#ffe68b','L'+(i+1)));
  state.geometry.points.forEach((p,i)=>{const [x,y]=pos(p);ctx.strokeStyle='#ffb6d5';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-6,y);ctx.lineTo(x+6,y);ctx.moveTo(x,y-6);ctx.lineTo(x,y+6);ctx.stroke();text('P'+(i+1),[x,y],'#ffb6d5');});
  if(state.drag){if(state.mode==='roi'){ctx.strokeStyle='#4ee9dc';rect([...state.drag.start,...state.drag.end]);}else line([state.drag.start,state.drag.end],'#fff');}
}
function pointer(event) {
  if(!state.view)return null;const rect=$('canvas').getBoundingClientRect(),{scale,ox,oy}=state.view;
  return [Math.max(0,Math.min(state.width-1,(event.clientX-rect.left-ox)/scale)),Math.max(0,Math.min(state.height-1,(event.clientY-rect.top-oy)/scale))];
}
function effectiveBounds(){const e=Number($('edge_crop').value)||0,[x,y,x1,y1]=state.roi;return [x+e,y+e,x1-e-1,y1-e-1];}
function addGeometry(start,end,mode=state.mode){
  const {kind,value}=sampleGeometry(mode,start,end,effectiveBounds());
  state.geometry[kind].push(value);state.history.push(kind);
}
function readCoordinate(input){if(input.value.trim()===''||!Number.isFinite(Number(input.value)))throw Error('请填写有效的坐标数值');return Number(input.value);}
$('sample-type').onchange=()=>{const mode=$('sample-type').value;$('sample-x-label').hidden=mode==='hline';$('sample-y-label').hidden=mode==='vline';$('sample-x2-label').hidden=$('sample-y2-label').hidden=mode!=='line';};
$('add-sample').onclick=catchAction(()=>{
  if(!state.image)throw Error('请先导入参考图');state.roi=readROI();const mode=$('sample-type').value;
  const start=[mode==='hline'?0:readCoordinate($('sample-x')),mode==='vline'?0:readCoordinate($('sample-y'))];
  const end=mode==='line'?[readCoordinate($('sample-x2')),readCoordinate($('sample-y2'))]:start;
  addGeometry(start,end,mode);warning('');syncROI();draw();
});
$('canvas').onpointerdown=e=>{if(state.busy||!state.image)return;const p=pointer(e);state.drag={start:p,end:p};$('canvas').setPointerCapture(e.pointerId);draw();};
$('canvas').onpointermove=e=>{if(!state.drag)return;state.drag.end=pointer(e);draw();};
$('canvas').onpointerup=e=>{
  if(!state.drag)return;const {start}=state.drag,end=pointer(e);state.drag=null;
  try{if(state.mode==='roi'){const r=[Math.floor(Math.min(start[0],end[0])),Math.floor(Math.min(start[1],end[1])),Math.ceil(Math.max(start[0],end[0])),Math.ceil(Math.max(start[1],end[1]))];if(Math.min(r[2]-r[0],r[3]-r[1])<64)throw Error('选区至少需要 64 × 64 像素');state.roi=r;}else addGeometry(start,end);warning('');syncROI();}catch(e){report(e);}draw();
};
$('canvas').onpointercancel=()=>{state.drag=null;draw();};
document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{state.mode=el.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b===el));});
$('undo').onclick=()=>{const kind=state.history.pop();if(kind)state.geometry[kind].pop();syncROI();draw();};
$('clear-geometry').onclick=()=>{state.geometry={lines:[],points:[]};state.history=[];syncROI();draw();};
$('full-roi').onclick=()=>{if(state.image){state.roi=[0,0,state.width,state.height];syncROI();draw();}};
['roi-x','roi-y','roi-w','roi-h'].forEach(id=>{
  $(id).onchange=()=>{try{state.roi=readROI();syncROI();draw();}catch(e){report(e);}};
  $(id).oninput=()=>{try{state.roi=readROI();draw();}catch{/* A partially typed number is validated on blur or run. */}};
});
$('edge_crop').onchange=draw;
$('detrend').onchange=()=>{$('detrend-note').textContent=$('detrend').value==='quadratic'?'注意：二次曲面扣除会同时削弱真实长波和大尺度起伏。建议同时导出去趋势前高度。':'恢复的是相对高度；去平面会移除整体倾斜，不能测出绝对水位。';};
function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('save-record').onclick=catchAction(()=>{if(!state.roi||!state.refFile)throw Error('请先导入参考图');const record={schema:'waterwave-selection-v1',image_size:[state.width,state.height],coordinate_convention:'zero-based original image; ROI [x0,y0,x1,y1) exclusive end',...settings()};downloadBlob(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),'water-wave-selection.json');});
$('load-record').onclick=()=>$('record-file').click();
$('record-file').onchange=catchAction(async e=>{
  const file=e.target.files[0];if(!file)return;if(!state.image)throw Error('请先导入参考图，再导入范围记录');
  const r=JSON.parse(await file.text());
  if(r.schema!=='waterwave-selection-v1'||!Array.isArray(r.image_size)||r.image_size[0]!==state.width||r.image_size[1]!==state.height)throw Error('记录格式不匹配或图像尺寸不同；未自动缩放旧坐标');
  // Validate using the same Python rules before changing the UI.
  const check=await rpc({op:'start',data:state.refData,settings:{...r,exports:[]}});await rpc({op:'dispose',session:check.session});
  state.roi=r.roi;state.geometry=r.geometry||{lines:[],points:[]};state.history=[];
  for(const id of numericConfig)if(r.config?.[id]!==undefined)$(id).value=r.config[id];
  for(const id of ['unwrap','remove_mean_displacement'])if(r.config?.[id]!==undefined)$(id).checked=r.config[id];
  for(const id of ['detrend','integration'])if(r.config?.[id]!==undefined)$(id).value=r.config[id];
  if(r.exports)document.querySelectorAll('[data-export]').forEach(el=>el.checked=!el.disabled&&r.exports.includes(el.dataset.export));
  syncROI();draw();$('detrend').onchange();status('已导入选区、线点、物理参数和导出选项。');warning('');
});
function selectedFrames(){
  const files=dynamicFiles(),count=state.video?state.video.count:files.length;
  let items=Array.from({length:count},(_,i)=>({index:i,id:state.video?i+1:frameId(files[i],i),file:files[i]}));
  const list=$('frame-list').value.trim();
  if(list){const ids=list.split(/[,，\s]+/).map(Number);if(!ids.every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('指定帧号格式不正确');const set=new Set(ids);items=items.filter(v=>set.has(v.id));if(items.length!==set.size)throw Error('指定的部分帧号不存在或文件名帧号重复，请核对文件列表');}
  else{const start=Number($('start').value),end=Number($('end').value),step=Number($('stride').value);if(![start,end,step].every(Number.isInteger)||start<1||end<start||end>count||step<1)throw Error('帧范围无效');items=items.filter((_,i)=>i>=start-1&&i<end&&(i-start+1)%step===0);}
  if(!items.length)throw Error('没有选中的动态图');
  if(items.some((v,i)=>i>0&&v.id<=items[i-1].id))throw Error('原始帧号重复或不递增；请分开处理不同命名的实验序列');
  return items;
}
async function videoFrame(item){
  if(state.video.decoder){const {bytes}=await state.video.decoder.call({op:'frame',index:item.index});return b64(new Blob([bytes],{type:'image/bmp'}));}
  const v=state.video.element,target=Math.min((item.index+.25)/Number($('fps').value),v.duration-.001);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('视频抽帧超时')),15000);const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};v.addEventListener('seeked',done);if(Math.abs(v.currentTime-target)<1e-6){done();}else v.currentTime=target;});
  const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png').split(',')[1];
}
async function finish(partial){
  const result=await rpc({op:'finish',session:state.session,partial});
  if(state.downloadUrl){URL.revokeObjectURL(state.downloadUrl);state.downloadUrl=null;}
  $('download').download=state.resultName;
  if(state.local)$('download').href='/api/download?session='+state.session+'&filename='+encodeURIComponent(state.resultName);
  else{const {bytes}=await rpc({op:'download',session:state.session});state.downloadUrl=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));$('download').href=state.downloadUrl;}
  $('download').textContent='下载 '+state.resultName+' ↓';$('download').hidden=false;
  if(result.note)warning(result.note);
  return result;
}
async function run(){
  warning('');const cfg=config(),items=selectedFrames(),options=settings();
  const timeOrigin=state.video?1:(dynamicFiles().some((f,i)=>frameId(f,i)===0)?0:1);
  if(!state.refData)throw Error('缺少静水参考图');
  if(state.video&&(state.width!==state.video.width||state.height!==state.video.height))throw Error('视频与参考图尺寸不同；请使用相同裁剪与机位的数据');
  if(state.video?.key||state.video?.decoder)cfg.fps=options.config.fps=state.video.fps;
  if(options.exports.includes('spectrum')&&!state.geometry.points.length)throw Error('点频谱需要至少一个采样点');
  const group=state.groups[Number($('dataset').value)];
  state.resultName=resultFilename(state.video?[state.video.file.name]:items.map(item=>item.file.name),!!state.video,group?.name==='所选图片'?'':group?.name||'');
  if(state.session){await rpc({op:'dispose',session:state.session});state.session=null;}
  busy(true);state.stop=false;$('download').hidden=true;$('progress').max=items.length;$('progress').value=0;
  document.title=progressTitle(0,items.length);
  let done=0;
  try{
    const init=await rpc({op:'start',data:state.refData,settings:options});state.session=init.session;
    const m=init.metadata;
    $('metrics').replaceChildren();
    for(const [label,value] of [['像素尺度',m.mm_per_pixel.toFixed(6)+' mm/px'],['有效光学长度',m.effective_optical_length_mm.toFixed(3)+' mm'],['输出尺寸',m.output_shape[1]+' × '+m.output_shape[0]],['选中帧数',items.length]]){const box=document.createElement('div');box.textContent=label;const b=document.createElement('b');b.textContent=value;box.append(b);$('metrics').append(box);}
    if(m.warnings.length)warning(m.warnings.join('；'));
    for(const item of items){
      if(state.stop)break;
      status(`正在恢复 ${done+1} / ${items.length} · 原始帧 ${item.id}…`);
      let result;
      if(state.video?.key)result=await rpc({op:'video_frame',video:state.video.key,index:item.index,session:state.session,name:state.video.file.name});
      else{const data=state.video?await videoFrame(item):await b64(item.file);result=await rpc({op:'frame',session:state.session,data,name:state.video?state.video.file.name:item.file.name,frame_id:item.id,time_s:cfg.fps>0?(item.id-timeOrigin)/cfg.fps:null});}
      done++;$('progress').value=done;$('result-panel').hidden=false;$('result').src='data:image/png;base64,'+result.preview;
      document.title=progressTitle(done,items.length);
      $('result-frame').textContent=`原始帧 ${item.id} · RMS ${result.summary.rms_mm.toFixed(4)} mm`;
      $('max-label').textContent='+'+cfg.color_limit_mm+' mm';$('min-label').textContent='−'+cfg.color_limit_mm+' mm';
      if(result.summary.warnings.length)warning(result.summary.warnings.join('；'));
    }
    if(done){document.title=progressTitle(done,items.length,true);status('正在打包结果…');const result=await finish(state.stop);status(`${state.stop?'已停止并保留':'处理完成'}：${done} 帧，结果 ${(result.size/1024**2).toFixed(2)} MiB。请下载 ZIP 保存。`);}
    else status('已取消，尚未处理任何帧。');
  }catch(error){
    if(done){try{await finish(true);warning(String(error.message||error));status(`处理在第 ${done+1} 帧停止，已保留 ${done} 帧，可下载部分结果。`);}catch(packError){warning(String(error.message||error)+'；打包失败：'+packError.message);status('处理未完成。');}}
    else report(error);
  }finally{document.title=idleTitle;busy(false);}
}
$('run').onclick=catchAction(run);$('stop').onclick=()=>{state.stop=true;status('将在当前帧计算结束后停止，并打包已完成数据。');};
$('files').onchange=catchAction(e=>importFiles([...e.target.files]));$('folder').onchange=catchAction(e=>importFiles([...e.target.files]));
$('dataset').onchange=catchAction(e=>chooseGroup(Number(e.target.value)));
$('reference').onchange=catchAction(e=>{if(e.target.value!=='')return setReference(state.files[Number(e.target.value)]);});
$('ref-file').onchange=catchAction(e=>{if(e.target.files[0])return setReference(e.target.files[0],true);});
$('video-file').onchange=catchAction(e=>{if(e.target.files[0])return importFiles([e.target.files[0]]);});
$('fps').onchange=()=>{if(state.video?.element){const fps=Number($('fps').value);if(fps>0){state.video.fps=fps;state.video.count=Math.floor(state.video.element.duration*fps);updateCount();}}else if(state.video?.key||state.video?.decoder){$('fps').value=state.video.fps;warning('该视频帧率从文件读取；若元数据不正确，请先修正视频时间信息。');}};
$('demo').onclick=catchAction(async()=>{
  busy(true);try{status('生成已知高度的合成棋盘格序列…');const ref=await rpc({op:'demo',reference:true});const files=[from64(ref.data,'reference.png')];for(let i=0;i<12;i++){const r=await rpc({op:'demo',phase:i*Math.PI/6});files.push(from64(r.data,`demo_${String(i+1).padStart(4,'0')}.png`));}await importFiles(files);$('fps').value=12;$('water_depth_mm').value=20;$('acrylic_mm').value=10;$('square_mm').value=1.5;$('mm_per_pixel').value=0;$('n_water').value=1.33;$('n_acrylic').value=1.49;$('n_air').value=1.00029;$('edge_crop').value=10;$('filter_ratio').value=1;$('unwrap').checked=true;$('integration').value='difference';$('remove_mean_displacement').checked=true;$('detrend').value='plane';$('color_limit_mm').value=.4;state.roi=[0,0,256,256];state.geometry={lines:[[[20,128],[235,128]]],points:[[128,128]]};state.history=['lines','points'];document.querySelectorAll('[data-export]').forEach(el=>el.checked=['height_npz','height_png','lines','points'].includes(el.dataset.export));syncROI();draw();status('合成示例已就绪：12 帧、峰值高度 0.3 mm。点击“开始恢复波场”。');}finally{busy(false);}
});
new ResizeObserver(draw).observe($('canvas').parentElement);draw();
