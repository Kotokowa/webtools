'use strict';
(() => {
  const numeric={height_scale:[1,'高度系数'],mask_dark:[.25,'暗阈值'],mask_mod:[.3,'调制阈值'],mask_saturation:[1.01,'过曝阈值'],mask_window:[21,'统计窗口 / px'],mask_min_blob:[100,'最小区域 / px'],mask_grow:[2,'扩张 / px'],mask_guard:[10,'保护带 / px'],fill_ring:[20,'填充环 / px'],cal_x_slope:[1.022,'X 斜率'],cal_y_slope:[1.020,'Y 斜率'],cal_x_offset_cm:[.04,'X 截距 / cm'],cal_y_offset_cm:[.05,'Y 截距 / cm'],cal_slope_error:[.001,'斜率不确定度'],cal_offset_error_cm:[.02,'截距不确定度 / cm'],rms_min_fraction:[.8,'有效帧比例'],frequency_hz:[6,'频率 / Hz']};
  Object.assign(numeric,{gravity_m_s2:[9.796,'重力加速度 / m/s²'],density_kg_m3:[998,'水密度 / kg/m³'],surface_tension_n_m:[.072,'表面张力 / N/m'],ak_linear_limit:[.15,'线性波陡上限']});
  const booleans={masking:[true,'遮挡处理'],bridge_occlusions:[true,'遮挡区位移桥接'],coordinate_calibration:[true,'坐标标定'],displacement_calibration:[true,'位移标定'],lockin:[false,'锁相']};
  const input=(id,title,value,type='number')=>`<label>${title}<input id="${id}" type="${type}" value="${value}"${type==='number'?' step="any"':''}></label>`;
  const fitInputs={'focus-fit-line':['fit_line_cm','拟合中心线长 / cm',''],'focus-fit-x':['fit_half_x_cm','拟合窗 X 半宽 / cm',''],'focus-fit-y':['fit_half_y_cm','拟合窗 Y 半宽 / cm',''],'focus-incident':['incident_y_cm','入射截面 Y / cm',''],'focus-noise':['background_pct','背景噪声分位 / %',2],'focus-core-level':['core_level','主峰功率阈值',.5]};
  const designInputs={'design-f':['focus_cm','设计焦距 / cm',''],'design-d':['aperture_cm','设计口径 / cm',''],'design-wave':['wavelength_cm','设计波长 / cm（可空）',''],'design-coeff':['coefficient','焦斑系数',.886]};
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML='<h2>恢复与 RMS</h2><label>算法<select id="pipeline"><option value="final3">最终版3</option><option value="legacy">旧版</option></select></label>'+Object.entries(booleans).map(([id,[checked,title]])=>`<label class="check"><input id="${id}" type="checkbox" ${checked?'checked':''}>${title}</label>`).join('')+'<div class="two">'+Object.entries(numeric).map(([id,[value,title]])=>input(id,title,value)).join('')+'</div>';
  document.querySelector('aside').append(panel);
  $('water_depth_mm').value=30;$('fps').value=100;$('detrend').value='quadratic';
  for(const [id,title] of Object.entries({rms_npz:'RMS NPZ',rms_mat:'RMS MAT',rms_csv:'RMS CSV',rms_png:'RMS 图片',focal:'完整聚焦分析',focal_line:'线聚焦效率',focal_area:'面聚焦效率'})){
    const label=document.createElement('label');label.className='export-item';label.innerHTML=`<input type="checkbox" data-export="${id}" ${['rms_npz','focal_line','focal_area'].includes(id)?'checked':''}><span>${title}</span>`;document.querySelector('.export-grid').append(label);
  }
  const batchPanel=document.createElement('section');batchPanel.className='panel';
  batchPanel.innerHTML=`<h2>本地批处理</h2><button id="batch-directory">选择本地实验数据目录</button><div class="directory-row" id="batch-root-row"><span id="batch-root-name"></span><button type="button" class="directory-clear" id="batch-root-clear" aria-label="解除实验数据目录" title="解除关联" hidden>×</button></div>
    <label>变量<select id="batch-variable"><option value="depth">水深</option><option value="freq">频率</option><option value="amp">振幅</option></select></label>
    ${input('batch-amp','振幅',0)}${input('batch-unit','振幅单位','mm','text')}
    ${input('batch-format','实验格式','{run}_{depth}mm.avi','text')}${input('static-format','静水格式','{run}_jt.tiff','text')}
    ${input('batch-extensions','文件扩展名','avi,mp4,mov,mkv,webm,tif,tiff,png,jpg,jpeg,bmp,mat,npz','text')}
    ${input('batch-repeats','重复次数',0)}<div class="three">${input('batch-start','起始序号',1)}${input('batch-end','结束序号',0)}${input('batch-stride','间隔',1)}</div>
    <button id="reference-directory">选择本地参考场文件目录</button><div class="directory-row" id="reference-root-row"><span id="reference-root-name"></span><button type="button" class="directory-clear" id="reference-root-clear" aria-label="解除参考场文件目录" title="解除关联" hidden>×</button></div>
    ${input('reference-format','无片实验格式','{run}_{depth}mm.avi','text')}${input('reference-static-format','无片静水格式','{run}_jt.tiff','text')}${input('reference-rms-format','无片 RMS 格式','{run}_{depth}mm_RMS.{ext}','text')}
    <div class="mini-actions"><button id="batch-scan">识别</button><button id="batch-run" class="primary">处理</button><button id="batch-continue" hidden>继续</button></div><details id="batch-preview" class="option-group" hidden><summary>任务预检</summary><div id="batch-list"></div></details><p id="repeat-notice" role="status" hidden></p>`;
  document.querySelector('aside').append(batchPanel);
  const focalPanel=document.createElement('section');focalPanel.className='panel';
  focalPanel.innerHTML=`<h2>RMS 与聚焦</h2><div class="import-grid">
    <label class="file-button">导入 RMS<input id="rms-file" type="file" multiple accept=".mat,.npz"></label>
    <label class="file-button">无片 RMS<input id="reference-rms-file" type="file" accept=".mat,.npz"></label>
    <label class="file-button">无片静水图<input id="raw-reference-static" type="file" accept="image/*,.tif,.tiff"></label>
    <label class="file-button">无片图片／视频<input id="raw-reference-files" type="file" multiple accept="image/*,video/*,.tif,.tiff,.avi,.mkv"></label>
    <label class="file-button">无片文件夹<input id="raw-reference-folder" type="file" multiple webkitdirectory></label><button id="compute-reference">恢复无片参考</button></div>
    <p id="reference-field-name" class="help"></p><label>工况<select id="focal-condition"></select></label>`;
  document.querySelector('aside').append(focalPanel);
  const focusDialog=document.createElement('dialog');focusDialog.id='focus-dialog';focusDialog.setAttribute('aria-labelledby','focus-title');
  focusDialog.innerHTML=`<div class="dialog-head"><h2 id="focus-title">选取焦点</h2><div class="mini-actions"><button data-dialog-close>关闭</button><button id="focus-save" class="primary">确认焦点</button></div></div><div class="dialog-body focus-editor">
    <div class="focal-view"><img id="focal-image" alt="在 RMS 图上点选焦点，或在下方输入坐标"><div class="focal-overlay" aria-hidden="true" hidden><i class="focal-ellipse"></i><i class="focal-fwhm"></i><i class="focal-line"></i><span class="focal-marker">+</span></div></div>
    <div class="two">${input('focus-x','X / cm',0)}${input('focus-y','Y / cm',12.6)}${input('focus-half','搜索半宽 / cm',2.5)}${input('focus-line','线长 / cm',3)}${input('focus-axis-a','长全轴 / cm',9)}${input('focus-axis-b','短全轴 / cm',3)}</div>
    <label class="check"><input id="focus-fill" type="checkbox" checked>模型补齐</label>
    <label class="check"><input id="focus-fwhm" type="checkbox">另算半高宽椭圆增益</label>
    <label class="check"><input id="focus-auto-angle" type="checkbox" checked>对齐拟合长轴</label>${input('focus-angle','手动长轴方向 / °',0)}
    <details id="focus-method" class="option-group"><summary>拟合与诊断</summary><div class="two">
    <label>拟合模型<select id="focus-model"><option value="auto">自动比较 3 个模型</option><option value="gaussian">高斯</option><option value="supergauss">超高斯</option><option value="core_halo">核晕</option></select></label>
    <label>主峰范围<select id="focus-core"><option value="soft">剖面边界</option><option value="radial">径向极小值</option><option value="threshold">阈值连通区</option><option value="all">拟合窗口全域</option></select></label>
    ${Object.entries(fitInputs).map(([id,[key,title,value]])=>input(id,title,value)).join('')}</div><div class="mini-actions"><button id="focus-pair-check">检查有片／无片配对</button><output id="focus-pair-status"></output></div></details>
    <details id="focus-design" class="option-group"><summary>设计尺度</summary><div class="two">${Object.entries(designInputs).map(([id,[key,title,value]])=>input(id,title,value)).join('')}</div><p class="help">同时填写焦距和口径才计算；波长留空时按水深与频率计算。</p></details>
    </div>`;
  document.body.append(focusDialog);
  const focusBatchDialog=document.createElement('dialog');focusBatchDialog.id='focus-batch-dialog';focusBatchDialog.setAttribute('aria-labelledby','focus-batch-title');
  focusBatchDialog.innerHTML=`<div class="dialog-head"><h2 id="focus-batch-title">批量聚焦</h2><div class="mini-actions"><button data-dialog-close>关闭</button><button id="focus-batch-run" class="primary">分析</button></div></div><div class="dialog-body">
    <p id="focus-batch-count" class="help"></p><label>未标记的工况<select id="focus-batch-mode"><option value="manual">先逐工况标记焦点</option><option value="auto">按走廊自动锁焦</option></select></label>
    <label id="focus-repeat-option" class="check"><input id="focus-repeat-plots" type="checkbox">保存每次重复的完整诊断图</label>
    <details id="focus-lock-options" class="option-group" hidden><summary>自动锁焦范围</summary><div class="two">${input('lock-x-span','中心走廊半宽 / cm',10)}${input('lock-y-min','Y 下限 / cm',8)}${input('lock-y-max','Y 上限 / cm',22)}${input('lock-y-expected','预期焦点 Y / cm',13)}${input('lock-y-sigma','Y 权重尺度 / cm',6)}${input('lock-smoothing','平滑 σ / px',5)}</div></details></div>`;
  document.body.append(focusBatchDialog);
  $('focal-result').querySelector('.focal-plots').insertAdjacentHTML('beforeend','<details id="focal-profile" class="option-group" hidden><summary>水平 RMS 剖面</summary><img id="focal-profile-image" alt="水平 RMS 剖面与积分范围"></details>');
  $('focal-result').insertAdjacentHTML('beforeend','<div id="focal-summary" class="metrics" hidden></div><details id="full-metrics" class="option-group" hidden><summary>完整指标</summary><pre id="focal-metrics"></pre></details>');
  $('other-actions').insertAdjacentHTML('beforeend','<div id="focus-actions" class="mini-actions" hidden><button id="focus-open" aria-haspopup="dialog" aria-controls="focus-dialog" disabled>选取焦点</button><button id="focus-analyze" class="primary" disabled>分析</button><button id="focus-batch-open" aria-haspopup="dialog" aria-controls="focus-batch-dialog" hidden>批量分析</button><button id="focus-export" disabled>导出 RMS</button></div>');
  const offline=document.createElement('a');offline.id='offline-link';offline.textContent='离线版';offline.href='https://kotokowa.github.io/FresnelWaterwave/offline-download.html';document.querySelector('header nav').append(offline);
  if(WATERWAVE_RUNTIME.offline){
    const home=$('home-link');home.target='_blank';home.rel='noopener';
  }
  const entries=[], centers=new Map(), staticOverrides=new Map(), referenceStaticOverrides=new Map();let root, referenceRoot, tasks=[], referenceTasks=[], current=null, commonReference=null, rawFiles=[], rawStatic=null, outputRoot=null, resumeRoot=null;
  const recordIds=['batch-variable','batch-amp','batch-unit','batch-format','static-format','batch-extensions','batch-repeats','batch-start','batch-end','batch-stride','reference-format','reference-static-format','reference-rms-format','focus-half','focus-line','focus-axis-a','focus-axis-b','focus-angle','focus-model','focus-core',...Object.keys(fitInputs),...Object.keys(designInputs)];
  function advancedConfig(){const c={pipeline:$('pipeline').value,excitation_amplitude:readCoordinate($('batch-amp')),amplitude_unit:$('batch-unit').value};for(const id of Object.keys(numeric))c[id]=readCoordinate($(id));for(const id of Object.keys(booleans))c[id]=$(id).checked;return c;}
  function record(){return {settings:Object.fromEntries(recordIds.map(id=>[id,$(id).value])),centers:Object.fromEntries(centers),fill_model:$('focus-fill').checked,auto_angle:$('focus-auto-angle').checked,use_fwhm:$('focus-fwhm').checked,
    static_choices:Object.fromEntries(staticOverrides),reference_static_choices:Object.fromEntries(referenceStaticOverrides)};}
  function restoreRecord(r){for(const id of Object.keys(numeric))$(id).value=r.config?.[id]??numeric[id][0];for(const id of Object.keys(booleans))$(id).checked=r.config?.[id]??booleans[id][0];$('pipeline').value=r.config?.pipeline||'final3';for(const id of recordIds)if(r.advanced?.settings?.[id]!==undefined)$(id).value=r.advanced.settings[id];if(r.advanced?.centers)for(const [key,value] of Object.entries(r.advanced.centers))centers.set(key,value);if(r.advanced?.fill_model!==undefined)$('focus-fill').checked=r.advanced.fill_model;if(r.advanced?.auto_angle!==undefined)$('focus-auto-angle').checked=r.advanced.auto_angle;if(r.advanced?.use_fwhm!==undefined)$('focus-fwhm').checked=r.advanced.use_fwhm;}
  function restoreStaticChoices(saved){for(const [map,key] of [[staticOverrides,'static_choices'],[referenceStaticOverrides,'reference_static_choices']]){if(!saved.advanced?.[key])continue;map.clear();for(const [task,value] of Object.entries(saved.advanced[key]))if(typeof value==='string')map.set(task,value);}}
  function addField(info,name,extra={}){
    if(info.field&&entries.some(entry=>entry.field===info.field))return;
    let index=extra.outputRoot?entries.findIndex(entry=>entry.outputRoot?.name===extra.outputRoot.name&&entry.condition===extra.condition):-1;
    if(index<0){index=entries.length;$('focal-condition').add(new Option(name,String(index)));}
    entries[index]={...info,name,...extra};$('focal-condition').value=String(index);showField(index);globalThis.WaterWaveLayout?.refreshControls();
  }
  function paint(overlay,center,opts,angle,selection,fwhm){
    overlay.hidden=!center;if(!center)return;
    const [x,y]=center,xs=current.x_cm,ys=current.y_cm,sx=xs.at(-1)-xs[0],sy=ys.at(-1)-ys[0];
    if(!sx||!sy)return;
    const left=(x-xs[0])/sx*100+'%',top=(y-ys[0])/sy*100+'%';
    const marker=overlay.querySelector('.focal-marker'),ellipse=overlay.querySelector('.focal-ellipse'),line=overlay.querySelector('.focal-line'),fwhmEllipse=overlay.querySelector('.focal-fwhm');
    for(const item of [marker,ellipse,line,fwhmEllipse]){item.style.left=left;item.style.top=top;}
    const ellipseSize=(element,axes)=>{
      element.hidden=angle==null||!axes?.every(width=>Number.isFinite(width)&&width>0);
      if(element.hidden)return;
      element.style.width=axes[0]/sx*100+'%';element.style.height=axes[1]/sy*100+'%';element.style.rotate=angle+'deg';
    };
    ellipseSize(ellipse,selection.includes('area')?opts.axes_cm:null);
    ellipseSize(fwhmEllipse,selection.includes('fwhm')?fwhm?.axes_cm:null);
    line.hidden=!selection.includes('line');
    line.style.width=opts.line_length_cm/sx*100+'%';
  }
  function mark(){
    if(!current)return;
    $('focal-profile').hidden=!current.profilePreview;
    if(current.profilePreview)$('focal-profile-image').src='data:image/png;base64,'+current.profilePreview;
    const fit=current.fitMetrics,value=id=>Math.max(0,Number($(id).value)||0);
    const coordinates=[$('focus-x').value,$('focus-y').value],center=coordinates.every(v=>v.trim()&&Number.isFinite(Number(v)))?coordinates.map(Number):null;
    const areaAngle=fit?(fit.area_theta_rad??fit.theta_rad)*180/Math.PI:null,auto=$('focus-auto-angle').checked;
    $('focus-angle').closest('label').hidden=auto;
    paint($('focus-dialog').querySelector('.focal-overlay'),center,{axes_cm:[value('focus-axis-a'),value('focus-axis-b')],line_length_cm:value('focus-line')},auto?areaAngle:Number($('focus-angle').value),gainSelection(),fit?.user_fwhm_ellipse);
    paint($('focal-result').querySelector('.focal-overlay'),fit?.center_cm,fit&&{...fit.options,line_length_cm:fit.options.fit_line_cm??fit.options.line_length_cm},areaAngle,fit?.gain_selection||['area','line'],fit?.fit_fwhm_ellipse);
    $('full-metrics').hidden=!fit;$('focal-metrics').textContent=fit?JSON.stringify(fit,null,2):'';
    globalThis.WaterWaveLayout?.showMetrics(fit);
  }
  function editFocus(){if(current){delete current.fitMetrics;delete current.profilePreview;}$('focal-profile').hidden=true;mark();}
  function showFieldImage(preview){for(const id of ['focal-image','focal-result-image'])$(id).src='data:image/png;base64,'+preview;}
  function centerKey(entry){return entry.outputRoot?entry.outputRoot.name+':'+entry.condition:entry.name;}
  function selectedCenter(entry){return centers.get(centerKey(entry))??(entry.condition?centers.get(entry.condition):undefined);}
  function resetFocus(){if(!current)return;const center=selectedCenter(current)||current.autoCenter;$('focus-x').value=center?.[0]??((current.x_cm[0]+current.x_cm.at(-1))/2);$('focus-y').value=center?.[1]??Math.max(current.y_cm[0],Math.min(current.y_cm.at(-1),12.6));$('focus-pair-status').textContent='';mark();}
  function showField(index){current=entries[index];if(!current)return;showFieldImage(current.preview);$('focal-result').hidden=false;$('focal-result-name').textContent=current.name;$('focus-batch-open').hidden=focusBatchEntries().length===0;resetFocus();if(current.colormap&&current.colormap!==$('colormap').value&&!state.busy)catchAction(()=>recolor($('colormap').value))();}
  function saveCenter(){if(!current)throw Error('缺少 RMS');const c=[readCoordinate($('focus-x')),readCoordinate($('focus-y'))];if(c[0]<current.x_cm[0]||c[0]>current.x_cm.at(-1)||c[1]<current.y_cm[0]||c[1]>current.y_cm.at(-1))throw Error('焦点超出 RMS 场');const old=selectedCenter(current)??current.autoCenter;centers.set(centerKey(current),c);if(old?.some((value,index)=>value!==c[index]))editFocus();return c;}
  $('focal-condition').onchange=()=>showField(Number($('focal-condition').value));
  focusDialog.addEventListener('close',resetFocus);
  $('focal-image').onclick=e=>{if(state.busy||!current)return;const r=e.target.getBoundingClientRect();$('focus-x').value=current.x_cm[0]+(e.clientX-r.left)/r.width*(current.x_cm.at(-1)-current.x_cm[0]);$('focus-y').value=current.y_cm[0]+(e.clientY-r.top)/r.height*(current.y_cm.at(-1)-current.y_cm[0]);mark();};
  for(const id of ['focus-x','focus-y'])$(id).oninput=mark;
  for(const id of ['focus-half','focus-line','focus-axis-a','focus-axis-b','focus-angle'])$(id).oninput=editFocus;
  for(const id of ['focus-model','focus-core',...Object.keys(fitInputs),...Object.keys(designInputs)])$(id).onchange=editFocus;
  $('focus-auto-angle').onchange=editFocus;
  $('focus-fwhm').onchange=editFocus;
  $('focus-fill').onchange=editFocus;
  $('focus-save').onclick=catchAction(()=>{saveCenter();mark();warning('');$('focus-dialog').close();status('焦点已保存。');});
  async function importRMS(file){
    await detected;
    const colormap=$('colormap').value;
    if(state.nativeFeatures?.includes('field_upload')){
      if(file.size>1024**3)throw Error('RMS 文件超过本地版 1 GiB 导入限制');
      const response=await fetch(apiURL('/api/field?'+new URLSearchParams({name:file.name,colormap})),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      const result=await response.json();if(!response.ok||result.error)throw Error(result.error||'RMS 导入失败');return result;
    }
    if(state.local&&4*Math.ceil(file.size/3)+4096>200*1024**2)throw Error('当前本机引擎不支持大 RMS 文件，请更新本机加速器');
    return rpc({op:'field_import',data:await b64(file),name:file.name,colormap});
  }
  $('rms-file').onchange=catchAction(async e=>{
    const files=[...e.target.files].sort((left,right)=>collator.compare(left.name,right.name));e.target.value='';
    if(!files.length)return;
    const group=files.length>1?{}:null,errors=[];
    busy(true);state.stop=false;warning('');
    try{for(const file of files){if(state.stop)break;status('导入 RMS · '+file.name);try{addField(await importRMS(file),file.name,{importGroup:group,runs:[],referenceRuns:[]});}catch(error){errors.push(file.name+'：'+error.message);}}}
    finally{busy(false);}
    status(`RMS 导入结束${errors.length?' · '+errors.length+' 个失败':''}`);if(errors.length)warning(errors.join('；'));
  });
  $('reference-rms-file').onchange=catchAction(async e=>{const file=e.target.files[0];if(file){const next=await importRMS(file);if(commonReference)await rpc({op:'field_dispose',field:commonReference});commonReference=next.field;$('reference-field-name').textContent=file.name;}});
  $('raw-reference-static').onchange=e=>{rawStatic=e.target.files[0];};
  $('raw-reference-files').onchange=e=>{rawFiles=[...e.target.files];};
  $('raw-reference-folder').onchange=e=>{rawFiles=[...e.target.files];const refs=rawFiles.filter(f=>refPattern.test(f.name));if(refs.length===1)rawStatic=refs[0];};
  async function directory(){if(!window.showDirectoryPicker)throw Error('当前浏览器不支持本地目录读写');return window.showDirectoryPicker({mode:'readwrite'});}
  function showDirectory(nameId,name){$(nameId).textContent=name;$(nameId.replace('-name','-clear')).hidden=!name;}
  function hideBatchPreview(){$('batch-preview').hidden=true;$('batch-preview').open=false;$('batch-list').replaceChildren();}
  function clearExperimentDirectory(){root=null;resumeRoot=null;tasks=[];staticOverrides.clear();hideBatchPreview();$('batch-continue').hidden=true;showDirectory('batch-root-name','');status('已解除实验数据目录关联。');}
  function clearReferenceDirectory(){referenceRoot=null;referenceTasks=[];referenceStaticOverrides.clear();hideBatchPreview();showDirectory('reference-root-name','');status('已解除参考场文件目录关联。');}
  $('batch-directory').onclick=catchAction(async()=>{root=await directory();staticOverrides.clear();hideBatchPreview();showDirectory('batch-root-name',root.name);await refreshResume();});
  $('reference-directory').onclick=catchAction(async()=>{referenceRoot=await directory();referenceStaticOverrides.clear();hideBatchPreview();showDirectory('reference-root-name',referenceRoot.name);});
  $('batch-root-clear').onclick=clearExperimentDirectory;
  $('reference-root-clear').onclick=clearReferenceDirectory;
  async function readJsonFile(dir,name){try{return JSON.parse(await (await dir.getFileHandle(name)).getFile().then(f=>f.text()));}catch{return null;}}
  async function findResume(dir){try{const results=await dir.getDirectoryHandle('results'),found=[];for await(const [name,handle] of results.entries()){if(handle.kind!=='directory')continue;const selection=await readJsonFile(handle,'selection.json'),log=await readJsonFile(handle,'tasks.json');if(selection&&!selection.diagnostic)found.push({name,handle,selection,log:Array.isArray(log)?log:[]});}return found.sort((a,b)=>b.name.localeCompare(a.name))[0]||null;}catch{return null;}}
  async function refreshResume(){resumeRoot=await findResume(root);const button=$('batch-continue');if(!button)return;button.hidden=!resumeRoot;if(resumeRoot)status(`发现可继续结果：${root.name}/results/${resumeRoot.name}`);}
  async function scan(dir,prefix=''){const found=[];for await(const [name,handle] of dir.entries()){if(name==='results'||name.startsWith('.'))continue;const path=prefix+name;if(handle.kind==='directory')found.push(...await scan(handle,path+'/'));else found.push({path,handle});}return found;}
  function batchOptions(){return {extensions:$('batch-extensions').value,defaults:{depth:Number($('water_depth_mm').value),freq:Number($('frequency_hz').value),amp:Number($('batch-amp').value)},amplitudeUnit:$('batch-unit').value};}
  function referenceChoice(task,title,overrides){
    const label=document.createElement('label');label.textContent=title;
    const select=document.createElement('select');select.add(new Option('选择静水图',''));
    for(const item of task.referenceChoices)select.add(new Option(item.path,item.path));
    select.value=task.reference?.path||'';select.onchange=catchAction(async()=>{overrides.set(task.key,select.value);await identify();});
    label.append(select);return label;
  }
  function listTasks(){
    const list=$('batch-list'),preview=$('batch-preview'),refs=new Map(),paired=new Set();list.replaceChildren();
    for(const item of referenceTasks){const key=item.condition+':'+item.run;refs.set(key,[...(refs.get(key)||[]),item]);}
    const start=$('batch-start').value,end=Number($('batch-end').value)||'末帧',stride=$('batch-stride').value;
    const region=state.roi?`${state.roi[0]}, ${state.roi[1]}, ${state.roi[2]-state.roi[0]} × ${state.roi[3]-state.roi[1]}`:'全图';
    for(const task of tasks){
      const row=document.createElement('div'),detail=document.createElement('details'),heading=document.createElement('summary'),ref=refs.get(task.key)||[];
      ref.forEach(item=>paired.add(item));const errors=[...task.errors,...ref.flatMap(item=>item.errors)];
      heading.textContent=task.entries[0].path+(task.entries.length>1?` 等 ${task.entries.length} 张`:'')+' · '+(errors.join('；')||(referenceRoot&&!ref.length?'未配对无片场':'就绪'));
      const text=document.createElement('div');text.textContent=`静水：${task.reference?.path??'未选'}；无片：${ref.map(item=>item.entries[0].path+(item.rms?' (RMS)':item.reference?` (${item.reference.path})`:'')).join(' / ')||'未配对'}；帧：${start}–${end} / ${stride}；ROI：${region}`;
      detail.append(heading,text);
      if(task.referenceChoices.length>1)detail.append(referenceChoice(task,'实验静水图',staticOverrides));
      for(const item of ref)if(item.referenceChoices?.length>1)detail.append(referenceChoice(item,'无片静水图',referenceStaticOverrides));
      detail.open=Boolean(errors.length);row.append(detail);list.append(row);
    }
    for(const item of referenceTasks.filter(task=>!paired.has(task))){const row=document.createElement('div');row.textContent='未配对无片：'+item.entries[0].path+' · '+(item.errors.join('；')||'未找到同编号实验');list.append(row);}
    preview.querySelector('summary').textContent=`任务预检（${tasks.length}）`;preview.hidden=false;
    if([...tasks,...referenceTasks].some(task=>task.errors.length))preview.open=true;
  }
  async function identify(){if(!root)throw Error('请选择批处理目录');const pattern=WaterWaveBatch.compile($('batch-format').value,$('batch-extensions').value);if(!pattern.keys.includes($('batch-variable').value))throw Error('实验格式未包含所选变量');const options=batchOptions();tasks=WaterWaveBatch.group(await scan(root),$('batch-format').value,$('static-format').value,{...options,staticOverrides});if(!tasks.length)throw Error('没有匹配的实验');referenceTasks=[];
    if(referenceRoot){const files=await scan(referenceRoot);referenceTasks=WaterWaveBatch.group(files,$('reference-format').value,$('reference-static-format').value,{...options,staticOverrides:referenceStaticOverrides});const rmsPattern=WaterWaveBatch.compile($('reference-rms-format').value,options.extensions);for(const entry of files){const v=rmsPattern.match(entry.path);if(v){const values={...options.defaults,...v};referenceTasks.push({condition:JSON.stringify([values.depth,values.freq,values.amp,options.amplitudeUnit]),run:v.run??0,runText:v.run_text||'0',values,entries:[entry],rms:true,errors:[]});}}}
    const refKeys=new Map();for(const task of referenceTasks){const key=task.condition+':'+task.run;if(refKeys.has(key)){task.errors.push('无片参考匹配不唯一');refKeys.get(key).errors.push('无片参考匹配不唯一');}else refKeys.set(key,task);}
    const first=tasks.find(t=>!t.errors.length);if(first){await setReference(await first.reference.handle.getFile(),true);$('batch-root-name').textContent=root.name;}listTasks();status(`识别 ${tasks.length} 次实验`);}
  $('batch-scan').onclick=catchAction(identify);
  function safeName(s){return s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,150)||'results';}
  async function uniqueDirectory(parent,base){for(let i=0;;i++){const name=base+(i?'_'+i:'');try{await parent.getDirectoryHandle(name);}catch(e){if(e.name!=='NotFoundError')throw e;return parent.getDirectoryHandle(name,{create:true});}}}
  async function writeText(dir,name,text){const handle=await dir.getFileHandle(name,{create:true});const stream=await handle.createWritable();try{await stream.write(text);await stream.close();}catch(e){await stream.abort();throw e;}}
  async function persistField(info,dir){const file=await dir.getFileHandle('RMS.npz',{create:true});await saveArtifact(await rpc({op:'field_file',field:info.field}),'RMS.npz',dir);await rpc({op:'field_dispose',field:info.field});return {...info,field:null,file};}
  async function acquire(entry){return entry.field||((await importRMS(await entry.file.getFile())).field);}
  async function release(entry,key){if(!entry.field)await rpc({op:'field_dispose',field:key});}
  async function average(runs){const keys=[];try{for(const run of runs)keys.push(await acquire(run));return await rpc({op:'field_average',fields:keys});}finally{for(let i=0;i<keys.length;i++)await release(runs[i],keys[i]);}}
  async function artifactFile(dir,name){const parts=String(name).split(/[\\/]+/).filter(Boolean);let parent=dir;for(const part of parts.slice(0,-1))parent=await parent.getDirectoryHandle(safeName(part),{create:true});return parent.getFileHandle(safeName(parts.at(-1)),{create:true});}
  async function saveArtifact(result,name,dir){const chunks=[];let stream;if(dir)stream=await(await artifactFile(dir,name)).createWritable();try{for(let offset=0;offset<result.size;){const r=await rpc({op:state.local?'artifact_chunk':'artifact_bytes',artifact:result.artifact,offset});if(!r.size)throw Error('结果文件不完整');const bytes=r.bytes?new Uint8Array(r.bytes):Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));if(stream)await stream.write(bytes);else chunks.push(bytes);offset+=r.size;}if(stream)await stream.close();else downloadBlob(new Blob(chunks,{type:'application/zip'}),safeName(name));}catch(e){if(stream)await stream.abort();throw e;}finally{await rpc({op:'artifact_dispose',artifact:result.artifact});}}
  let sharedDecoder;
  function releaseDecoder(){sharedDecoder?.worker.terminate();sharedDecoder=null;}
  async function decoder(file){
    await detected;
    if(state.local){const response=await fetch(apiURL('/api/video'),{method:'POST',headers:{'Content-Type':/\.avi$/i.test(file.name)?'video/avi':'video/mp4'},body:file});const info=await response.json();if(!response.ok)throw Error(info.error);return {info,key:info.video,close:()=>rpc({op:'release_video',video:info.video})};}
    if(!sharedDecoder){
      const worker=new Worker('video-worker.js'),pending=new Map();let seq=0;
      worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progressText){status(data.progressText);return;}pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
      worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));pending.clear();};
      const call=m=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,...m});});
      sharedDecoder={worker,call};
    }
    const {call}=sharedDecoder;
    try{return {info:await call({op:'open',file}),call,close:()=>call({op:'close'})};}
    catch(e){releaseDecoder();throw e;}
  }
  function showBatchPreview(result,phase,name,done,total){
    if(!result?.preview)return;
    $('result-panel').hidden=false;
    $('result').src='data:image/png;base64,'+(result.rms_preview||result.preview);
    $('result-panel').querySelector('h2').firstChild.textContent=result.rms_preview?'累计 RMS 预览 ':'恢复预览 ';
    $('result-frame').textContent=`${phase} · ${name} · ${done}/${total}`;
    $('max-label').textContent=result.rms_preview?result.rms_limit_mm.toFixed(3)+' mm':'+'+$('color_limit_mm').value+' mm';
    $('min-label').textContent=result.rms_preview?'0 mm':'−'+$('color_limit_mm').value+' mm';
  }
  async function measure(task,options,dir,phase='恢复',resume=false){
    if(task.errors?.length)throw Error(task.errors.join('；'));
    if(task.rms)return importRMS(await task.entries[0].handle.getFile());
    const ref=task.staticFile||await task.reference.handle.getFile();const data=await b64(ref);let session,video,done=0;
    const files=task.files||await Promise.all(task.entries.map(e=>e.handle.getFile()));
    options=structuredClone(options);options.reference_name=ref.name;options.direct_files=Boolean(dir);
    if(task.values){options.config.water_depth_mm=task.values.depth;options.config.frequency_hz=task.values.freq;options.config.excitation_amplitude=task.values.amp;}
    try{
      let frames;
      if(files.length===1&&videoPattern.test(files[0].name)){video=await decoder(files[0]);options.config.fps=video.info.fps;frames=Array.from({length:video.info.count},(_,i)=>({index:i,id:i+1}));}
      else frames=files.filter(f=>f!==ref&&imagePattern.test(f.name)).map((file,i)=>({file,index:i,id:task.entries?.[i]?.values?.frame??frameId(file,i)}));
      const start=Number($('batch-start').value),end=Number($('batch-end').value)||frames.length,stride=Number($('batch-stride').value);
      if(![start,end,stride].every(Number.isSafeInteger)||start<1||end<start||stride<1)throw Error('批处理帧范围无效');
      const origin=frames.some(f=>f.id===0)?0:1;frames=frames.filter((_,i)=>i>=start-1&&i<end&&(i-start+1)%stride===0);if(!frames.length)throw Error('没有选中的帧');
      if(dir){
        const describe=f=>({name:f.name,size:f.size,modified:f.lastModified});
        const fingerprint={config:options.config,roi:options.roi,geometry:options.geometry,exports:options.exports,frames:frames.map(f=>f.id),reference:describe(ref),sources:files.map(describe)};
        const previous=await readJsonFile(dir,'input.json');
        if(resume&&previous&&JSON.stringify(previous)!==JSON.stringify(fingerprint))throw Error('源文件或参数已变化，请新建处理任务');
        await writeText(dir,'input.json',JSON.stringify(fingerprint));
      }
      const init=await rpc({op:'start',data,settings:options});session=init.session;
      for(const frame of frames){if(state.stop)break;const began=performance.now();status(`${phase} · ${files[0].name} · ${done+1}/${frames.length} · 读取帧`);document.title=progressTitle(done,frames.length);$('progress').max=frames.length;$('progress').value=done;
        const preview=done===0||(done+1)%50===0||done+1===Math.ceil(frames.length/2)||done+1===frames.length;
        const args={session,name:video?files[0].name:frame.file.name,frame_id:frame.id,time_s:options.config.fps>0?(frame.id-origin)/options.config.fps:null,preview};
        let frameResult,reused=false;
        if(resume&&dir&&!options.exports.some(e=>['raw_npz','height_csv','height_mat','displacement','quality','lines','points','spectrum','temporal','wavelength','video'].includes(e))){
          try{const tag=String(done+1).padStart(6,'0')+'_frame_'+frame.id;
            const saved=await(await(await dir.getDirectoryHandle('height')).getFileHandle(tag+'.npz')).getFile();
            if(options.exports.includes('height_png')){const png=await(await(await dir.getDirectoryHandle('images')).getFileHandle(tag+'.png')).getFile();if(!png.size)throw Error('图片未完成');}
            if(saved.size){status(`${phase} · ${files[0].name} · ${done+1}/${frames.length} · 读取已保存高度场`);frameResult=await rpc({op:'frame_cached',...args,data:await b64(saved)});reused=true;}
          }catch(e){if(['NotAllowedError','QuotaExceededError'].includes(e.name))throw e;}
        }
        const readEnd=performance.now();
        if(!frameResult&&video?.key){status(`${phase} · ${files[0].name} · ${done+1}/${frames.length} · 恢复高度场`);frameResult=await rpc({op:'video_frame',...args,video:video.key,index:frame.index});}
        if(!frameResult){const data=video?await b64(new Blob([(await video.call({op:'frame',index:frame.index})).bytes])):await b64(frame.file);
          status(`${phase} · ${files[0].name} · ${done+1}/${frames.length} · 恢复高度场`);
          frameResult=await rpc({op:'frame',...args,data});}
        const saveStart=performance.now();
        if(dir){status(`${phase} · ${files[0].name} · ${done+1}/${frames.length} · 保存中`);for(const file of frameResult.files||[])await saveArtifact(file,file.name,dir);}
        done++;$('progress').value=done;document.title=progressTitle(done,frames.length);
        const timing={frame_id:frame.id,reused,elapsed_s:(performance.now()-began)/1000,read_s:(readEnd-began)/1000,save_s:(performance.now()-saveStart)/1000,...frameResult.timings};
        if(dir)await writeText(dir,'progress.json',JSON.stringify({completed:done,total:frames.length,last_frame:frame.id,timing},null,2));
        if(preview){showBatchPreview(frameResult,phase,files[0].name,done,frames.length);}
        status(`${phase} · ${files[0].name} · ${done}/${frames.length} · ${reused?'已复用':'已保存'} · ${timing.elapsed_s.toFixed(1)} 秒/帧${preview?' · 已更新预览':''}`);
      }
      if(!done)throw Error('已取消');document.title=progressTitle(done,frames.length,true);status(`${phase} · ${files[0].name} · ${done}/${frames.length} · 正在保存结果`);const result=await rpc({op:'finish',session,partial:state.stop});const name=resultFilename(files.map(f=>f.name),!!video);
      if(dir){for(const file of result.files||[])await saveArtifact(file,file.name,dir);await saveArtifact(result,name,dir);}
      return {...result.field,partial:state.stop};
    }finally{await video?.close();if(session&&state.ready)await rpc({op:'dispose',session});}
  }
  $('compute-reference').onclick=catchAction(async()=>{if(!rawStatic||!rawFiles.length)throw Error('缺少无片静水图或动态图');const options=settings();options.geometry={lines:[],points:[]};options.exports=['rms_npz','rms_mat'];busy(true);state.stop=false;try{const info=await measure({staticFile:rawStatic,files:rawFiles.filter(f=>f!==rawStatic).sort((a,b)=>collator.compare(a.name,b.name))},options,undefined,'无波带片参考');if(info.partial)throw Error('无片参考未完成');commonReference=info.field;$('reference-field-name').textContent=rawFiles[0].name;status('无片参考已恢复');}finally{releaseDecoder();busy(false);document.title=idleTitle;}});
  async function existingDirectory(parent,name){try{return await parent.getDirectoryHandle(name);}catch(e){if(e.name!=='NotFoundError')throw e;return await parent.getDirectoryHandle(name,{create:true});}}
  async function loadSavedField(dir,label,task){const completed=await readJsonFile(dir,'completed.json');if(!completed?.complete)throw Error('任务尚未完整保存');
    const input=await readJsonFile(dir,'input.json');
    if(task.entries&&input){const describe=f=>({name:f.name,size:f.size,modified:f.lastModified});const sources=await Promise.all(task.entries.map(async e=>describe(await e.handle.getFile())));const reference=task.reference?describe(await task.reference.handle.getFile()):null;if(JSON.stringify(sources)!==JSON.stringify(input.sources)||(reference&&JSON.stringify(reference)!==JSON.stringify(input.reference)))throw Error('源文件已变化');}
    const file=await dir.getFileHandle('RMS.npz'),info=await importRMS(await file.getFile());await rpc({op:'field_dispose',field:info.field});return {...info,field:null,file,name:label,dir,run:task.runText};}
  async function restoreResumeSelection(){
    if(!resumeRoot?.selection)return;const saved=resumeRoot.selection;
    restoreRecord(saved);
    restoreStaticChoices(saved);
    for(const id of numericConfig)if(saved.config?.[id]!==undefined)$(id).value=saved.config[id];
    for(const id of ['unwrap','remove_mean_displacement'])if(saved.config?.[id]!==undefined)$(id).checked=saved.config[id];
    for(const id of ['detrend','integration','colormap'])if(saved.config?.[id]!==undefined)$(id).value=saved.config[id];
    if(saved.exports)document.querySelectorAll('[data-export]').forEach(el=>el.checked=!el.disabled&&saved.exports.includes(el.dataset.export));
    if(state.width&&saved.roi){state.roi=saved.roi;state.geometry=saved.geometry||{lines:[],points:[]};syncROI();draw();}
    globalThis.WaterWaveLayout?.refreshExports();
  }
  async function runBatch(resume=false){
    if(resume)await restoreResumeSelection();await identify();if(resume)await restoreResumeSelection();const options=settings(),limit=Number($('batch-repeats').value);if(globalThis.WaterWaveLayout?.requestSamples(options))return;const selected=WaterWaveBatch.selectRepeats(tasks,limit),refs=WaterWaveBatch.selectRepeats(referenceTasks,limit);
    const notices=[selected.notice,refs.notice].filter(Boolean);if(notices.length){const min=Math.min(...notices.map(n=>Number(n.match(/次数(\d+)次/)[1])));$('repeat-notice').textContent=`部分数据实际实验次数${min}次，小于设置次数${limit}次`;$('repeat-notice').hidden=false;setTimeout(()=>$('repeat-notice').hidden=true,15000);}
    if(resume&&resumeRoot)outputRoot=resumeRoot.handle;else{const resultDir=await root.getDirectoryHandle('results',{create:true});outputRoot=await uniqueDirectory(resultDir,new Date().toISOString().replace(/[:.]/g,'-'));await writeText(outputRoot,'selection.json',JSON.stringify({schema:'waterwave-selection-v2',image_size:[state.width,state.height],...options},null,2));}
    status(`${resume?'继续':'结果目录'}：${root.name}/results/${outputRoot.name} · 开始处理无波带片参考`);
    busy(true);state.stop=false;const log=[],conditions=new Map(),references=new Map();
    try{
      for(const [list,target,kind] of [[refs.selected,references,'reference'],[selected.selected,conditions,'experiment']])for(const task of list){
        if(state.stop)break;const label=safeName(kind+'_'+task.entries[0].path.replace(/\.[^.]+$/,''));
        try{const dir=resume?await existingDirectory(outputRoot,label+'_results'):await uniqueDirectory(outputRoot,label+'_results');let saved=resume?await loadSavedField(dir,label,task).catch(()=>null):null;if(saved){log.push({kind,source:task.entries[0].path,run:task.runText,condition:task.condition,status:'reused'});if(!target.has(task.condition))target.set(task.condition,[]);target.get(task.condition).push(saved);status(`${kind==='reference'?'无波带片参考':'实验数据'} · ${task.entries[0].path} · 已复用已有 RMS`);continue;}const taskOptions=structuredClone(options);taskOptions.direct_files=true;if(kind==='reference'){taskOptions.geometry={lines:[],points:[]};taskOptions.exports=taskOptions.exports.filter(e=>!['lines','points','spectrum','wavelength'].includes(e));}await writeText(outputRoot,'tasks.json',JSON.stringify([...log,{kind,source:task.entries[0].path,status:'running'}],null,2));const info=await measure(task,taskOptions,dir,kind==='reference'?'无波带片参考':'实验数据',resume);log.push({kind,source:task.entries[0].path,run:task.runText,condition:task.condition,status:info.partial?'partial':'complete'});saved=await persistField(info,dir);await writeText(dir,'completed.json',JSON.stringify({complete:!info.partial}));if(info.partial)continue;if(!target.has(task.condition))target.set(task.condition,[]);target.get(task.condition).push({...saved,name:label,dir,run:task.runText});status(`${kind==='reference'?'无波带片参考':'实验数据'} · ${task.entries[0].path} · 已完成并写入 ${outputRoot.name}/${label}_results`);}
        catch(e){log.push({kind,source:task.entries[0].path,run:task.runText,condition:task.condition,status:'failed',error:String(e.message||e)});if(['NotAllowedError','QuotaExceededError'].includes(e.name))throw e;}
        await writeText(outputRoot,'tasks.json',JSON.stringify(log,null,2));
      }
      if(!state.stop)for(const [condition,runs] of conditions){try{
        const expected=selected.selected.filter(t=>t.condition===condition).length;
        const expectedRefs=refs.selected.filter(t=>t.condition===condition).length;
        if(runs.length!==expected||(references.get(condition)?.length||0)!==expectedRefs)throw Error('该工况尚有未完成任务，请继续处理');
        const values=JSON.parse(condition),name=safeName(`depth_${values[0]}_freq_${values[1]}_amp_${values[2]}`);
        const dir=resume?await existingDirectory(outputRoot,name+'_results'):await uniqueDirectory(outputRoot,name+'_results');
        status('汇总 RMS 与重复实验不确定度 · '+name);
        const info=await average(runs);let reference=null;
        if(references.has(condition)){
          const refdir=await existingDirectory(dir,'reference'),refInfo=await average(references.get(condition));
          reference=await persistField(refInfo,refdir);
        }
        const extraExports=options.exports.filter(option=>['rms_mat','rms_png','rms_csv'].includes(option));
        if(extraExports.length)await saveArtifact(await rpc({op:'field_export',field:info.field,exports:extraExports}),name+'_RMS_results.zip',dir);
        const saved=await persistField(info,dir);
        await writeText(dir,'ensemble.json',JSON.stringify({experiments:runs.map(r=>r.name),references:(references.get(condition)||[]).map(r=>r.name),repeats:runs.length,method:'arithmetic mean of per-video RMS; uncertainty combines repeat standard error and per-video measurement uncertainty'},null,2));
        addField(saved,name,{condition,runs,reference,referenceRuns:references.get(condition)||[],dir,outputRoot});
      }catch(e){log.push({condition,status:'average_failed',error:e.message});if(['NotAllowedError','QuotaExceededError'].includes(e.name))throw e;}}
      const failures=log.filter(t=>t.status.includes('failed')).length;
      status(state.stop?'已停止，已保存完成结果':`恢复完成，${failures} 次失败；可进入聚焦分析`);
    }finally{try{await writeText(outputRoot,'tasks.json',JSON.stringify(log,null,2));$('batch-preview').querySelector('summary').textContent='批处理记录';$('batch-list').replaceChildren();for(const item of log){const row=document.createElement('div');row.textContent=(item.source||item.condition)+' · '+(item.error||item.status);$('batch-list').append(row);}}finally{releaseDecoder();busy(false);document.title=idleTitle;}}
  }
  $('batch-run').onclick=catchAction(()=>runBatch(false));
  $('batch-continue').onclick=catchAction(async()=>{if(!resumeRoot)throw Error('没有可继续的结果');await restoreResumeSelection();await runBatch(true);});
  function gainSelection(){const selected=exportsSelected(),gains=['line','area'].filter(k=>selected.includes('focal_'+k)||selected.includes('focal'));if($('focus-fwhm').checked)gains.push('fwhm');return gains;}
  function focusOptions(){
    const o={half_width_cm:readCoordinate($('focus-half')),line_length_cm:readCoordinate($('focus-line')),axes_cm:[readCoordinate($('focus-axis-a')),readCoordinate($('focus-axis-b'))],fill_model:$('focus-fill').checked,use_fwhm:$('focus-fwhm').checked,core_mode:$('focus-core').value};
    if(!$('focus-auto-angle').checked)o.theta_deg=readCoordinate($('focus-angle'));
    if($('focus-model').value!=='auto')o.fit_models=[$('focus-model').value];
    for(const [id,[key]] of Object.entries(fitInputs))if($(id).value.trim())o[key]=readCoordinate($(id));
    if($('design-f').value.trim()||$('design-d').value.trim()){
      if(!$('design-f').value.trim()||!$('design-d').value.trim())throw Error('设计尺度需同时填写焦距和口径');
      o.design=Object.fromEntries(Object.entries(designInputs).filter(([id])=>$(id).value.trim()).map(([id,[key]])=>[key,readCoordinate($(id))]));
      o.design.coefficient??=.886;
    }
    return o;
  }
  async function analyzeCurrent(){if(!current)throw Error('请先导入 RMS');const center=selectedCenter(current)??current.autoCenter;if(!center){$('focus-open').click();warning('请先选取焦点。');return;}const entry=current,options=focusOptions();busy(true);state.stop=false;document.title='聚焦分析';let field,reference;try{field=await acquire(entry);reference=entry.reference?await acquire(entry.reference):commonReference;
    if(state.stop)return;status(`聚焦分析 · 线长 ${options.line_length_cm} cm · 椭圆 ${options.axes_cm[0]} × ${options.axes_cm[1]} cm`);const result=await rpc({op:'field_analyze',field,center,options,reference,exports:exportsSelected(),colormap:$('colormap').value,gain_selection:gainSelection(),full_analysis:exportsSelected().includes('focal')});await saveArtifact(result,entry.name+'_focal_results.zip',entry.dir);
    if(entry.dir){
      await writeText(entry.dir,'focal-summary.json',JSON.stringify({center,repeats:entry.runs?.length||1,average_field:result.metrics},null,2));
      await writeText(entry.dir,'focus.json',JSON.stringify({center,options}));
      const rows=['metric,value'];
      function flatten(value,prefix=''){for(const [key,item]of Object.entries(value)){const name=prefix+key;if(typeof item==='number'||item===null)rows.push(name+','+(item??''));else if(item&&typeof item==='object'&&!Array.isArray(item))flatten(item,name+'.');}}
      flatten(result.metrics);await writeText(entry.dir,'focal-summary.csv',rows.join('\n'));
    }
    entry.fitMetrics=result.metrics;entry.profilePreview=result.profile_preview;
    mark();status('聚焦分析完成');
  }finally{if(field)await release(entry,field);if(reference&&entry.reference)await release(entry.reference,reference);busy(false);document.title=idleTitle;}}
  $('focus-analyze').onclick=catchAction(analyzeCurrent);
  const lockInputs={x_span_cm:'lock-x-span',y_min_cm:'lock-y-min',y_max_cm:'lock-y-max',expected_y_cm:'lock-y-expected',y_sigma_cm:'lock-y-sigma',smooth_px:'lock-smoothing'};
  const focalColumns={peak_rms_mm:m=>m.measured_peak_mm,model_peak_mm:m=>m.model_peak_mm,fit_x_cm:m=>m.center_cm[0],fit_y_cm:m=>m.center_cm[1],
    width_x_cm:m=>m.fit_x_fwhm_cm,width_y_cm:m=>m.fit_y_fwhm_cm,area_angle_deg:m=>m.area_theta_rad*180/Math.PI,
    line_gain:m=>m.fit_gain?.line_gain,area_gain:m=>m.fit_gain?.area_gain,fwhm_area_gain:m=>m.fit_gain?.fwhm_area_gain,
    fwhm_along_cm:m=>m.fit_fwhm_ellipse?.axes_cm[0],fwhm_across_cm:m=>m.fit_fwhm_ellipse?.axes_cm[1],fit_r_squared:m=>m.r_squared,
    ee50_cm:m=>m.ee50_radius_cm,ee80_cm:m=>m.ee80_radius_cm,ee90_cm:m=>m.ee90_radius_cm,ee95_cm:m=>m.ee95_radius_cm};
  function focusBatchEntries(){return current?.outputRoot?entries.filter(entry=>entry.outputRoot===current.outputRoot):current?.importGroup?entries.filter(entry=>entry.importGroup===current.importGroup):[];}
  function batchFocusForm(){
    const candidates=focusBatchEntries(),missing=candidates.filter(entry=>!selectedCenter(entry)).length,automatic=$('focus-batch-mode').value==='auto';
    $('focus-batch-count').textContent=`${candidates.length} 个工况 · ${missing} 个未标记 · ${candidates.reduce((count,entry)=>count+entry.runs.length,0)} 次重复`;
    $('focus-repeat-option').hidden=!candidates.some(entry=>entry.runs.length);
    $('focus-lock-options').hidden=!automatic;
    $('focus-batch-run').disabled=!automatic&&missing>0;
  }
  $('focus-batch-open').addEventListener('click',batchFocusForm);
  $('focus-batch-mode').onchange=batchFocusForm;
  async function withFields(entry,referenceEntry,fn){
    let field,reference;
    try{field=await acquire(entry);reference=referenceEntry?await acquire(referenceEntry):commonReference;return await fn(field,reference);}
    finally{if(field)await release(entry,field);if(reference&&referenceEntry)await release(referenceEntry,reference);}
  }
  $('focus-pair-check').onclick=catchAction(async()=>{
    const entry=current;if(!entry||!entry.reference&&!commonReference)throw Error('请先导入或配对无片 RMS');
    const position=$('focus-incident').value.trim()?readCoordinate($('focus-incident')):null;
    busy(true);warning('');
    try{
      await withFields(entry,entry.reference,async(field,reference)=>{
        const result=await rpc({op:'field_pair',field,reference,incident_y_cm:position}),metrics=result.metrics;
        $('focus-pair-status').textContent=`入射截面有效 ${(metrics.incident_valid_fraction*100).toFixed(1)}% · ${metrics.same_range&&metrics.same_spacing?'网格一致':'网格不同'}`;
        await saveArtifact(result,entry.name+'_reference-pair.zip',entry.dir);
      });
    }finally{busy(false);}
  });
  function csvText(rows){return '\ufeff'+rows.map(row=>row.map(value=>value==null?'':'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
  function repeatStats(values){
    const valid=values.filter(Number.isFinite),count=valid.length;
    if(!count)return [null,null,0];
    const mean=valid.reduce((sum,value)=>sum+value,0)/count;
    return [mean,count>1?Math.sqrt(valid.reduce((sum,value)=>sum+(value-mean)**2,0)/(count*(count-1))):null,count];
  }
  async function analyzeBatch(){
    await detected;
    if(state.local&&!state.nativeFeatures?.includes('batch_focus'))throw Error('请更新本机加速器后使用批量聚焦');
    const candidates=focusBatchEntries();if(!candidates.length)throw Error('当前工况不属于批处理');
    const batchRoot=current.outputRoot,automatic=$('focus-batch-mode').value==='auto',options=focusOptions(),selection=gainSelection(),repeatPlots=$('focus-repeat-plots').checked;
    if(!batchRoot&&state.local&&!state.nativeFeatures?.includes('batch_imported_rms'))throw Error('请更新本机加速器后批量分析导入的 RMS');
    const gainKeys={line_gain:'line',area_gain:'area',fwhm_area_gain:'fwhm',fwhm_along_cm:'fwhm',fwhm_across_cm:'fwhm'};
    const keys=Object.keys(focalColumns).filter(key=>!gainKeys[key]||selection.includes(gainKeys[key]));
    const lockOptions=automatic?Object.fromEntries(Object.entries(lockInputs).map(([key,id])=>[key,readCoordinate($(id))])):null;
    if(!automatic&&candidates.some(entry=>!selectedCenter(entry)))throw Error('请先标记各工况焦点');
    const exports=exportsSelected().filter(item=>item.startsWith('focal'));
    const reports=[],runs=[['condition','run','reference','lock_x_cm','lock_y_cm',...keys,'status','error']];
    const averages=[['condition','lock_method','lock_x_cm','lock_y_cm','lock_score','complete_repeats','total_repeats',...keys.flatMap(key=>[key+'_avgfield',key+'_mean',key+'_sem',key+'_n']),'status','error']];
    focusBatchDialog.close();busy(true);state.stop=false;warning('');let failures=0;
    try{
      for(const entry of candidates){
        if(state.stop)break;
        let center=selectedCenter(entry),score=null,method=center?'manual':'auto',average,problem='';const repeats=[];
        try{
          status('聚焦分析 · '+entry.name+' · 平均场');
          await withFields(entry,entry.reference,async(field,reference)=>{
            if(!center){const lock=await rpc({op:'field_lock',field,options:lockOptions});center=lock.center_cm;score=lock.score;entry.autoCenter=center;}
            const result=await rpc({op:'field_analyze',field,reference,center,options,exports,colormap:$('colormap').value,gain_selection:selection,full_analysis:exports.includes('focal')});
            if(batchRoot)await saveArtifact(result,entry.name+'_focal_results.zip',entry.dir);
            else reports.push({artifact:result.artifact,name:entry.name});
            average=result.metrics;entry.fitMetrics=average;entry.profilePreview=result.profile_preview;if(current===entry)resetFocus();
          });
          for(const run of entry.runs){
            if(state.stop)break;
            const ref=entry.referenceRuns.find(item=>item.run===run.run)||entry.reference;
            status('聚焦分析 · '+entry.name+' · 第 '+run.run+' 次');
            try{
              const result=await withFields(run,ref,(field,reference)=>rpc({op:'field_analyze',field,reference,center,options,metrics_only:!repeatPlots,full_analysis:repeatPlots,exports:[],gain_selection:selection,colormap:$('colormap').value}));
              if(repeatPlots)await saveArtifact(result,run.name+'_focal_results.zip',run.dir||entry.dir);
              const values=keys.map(key=>focalColumns[key](result.metrics));repeats.push(values);
              runs.push([entry.name,run.run,ref?.name||(ref?'平均无片场':commonReference?'导入的无片场':''),...center,...values,'complete']);
            }catch(error){failures++;runs.push([entry.name,run.run,ref?.name,...center,...keys.map(()=>null),'failed',error.message]);}
          }
        }catch(error){failures++;problem=error.message;}
        averages.push([entry.name,method,...(center||[null,null]),score,repeats.length,entry.runs.length,
          ...keys.flatMap((key,index)=>[average?focalColumns[key](average):null,...repeatStats(repeats.map(row=>row[index]))]),
          problem?'failed':repeats.length===entry.runs.length?'complete':'partial',problem]);
      }
    }finally{
      try{
        if(batchRoot){await writeText(batchRoot,'focal-repeats.csv',csvText(runs));await writeText(batchRoot,'focal-conditions.csv',csvText(averages));}
        else await saveArtifact(await rpc({op:'field_batch_report',reports,conditions:csvText(averages)}),'focal-batch-results.zip');
      }finally{try{for(const item of reports)await rpc({op:'artifact_dispose',artifact:item.artifact});}finally{busy(false);}}
    }
    status(state.stop?'聚焦已停止，已写入完成项':`批量聚焦完成 · ${averages.length-1} 个工况 · ${failures} 次失败`);
    if(failures)warning('失败原因见结果目录中的聚焦 CSV。');
  }
  $('focus-batch-run').onclick=catchAction(analyzeBatch);
  $('focus-export').onclick=catchAction(async()=>{if(!current)throw Error('缺少 RMS');const entry=current;busy(true);let field;try{field=await acquire(entry);const r=await rpc({op:'field_export',field,exports:exportsSelected(),colormap:$('colormap').value});await saveArtifact(r,entry.name+'_RMS_results.zip',entry.dir);}finally{if(field)await release(entry,field);busy(false);}});
  let colorRequest=0;
  async function recolor(colormap){
    const version=++colorRequest,entry=current;if(!entry)return;const field=await acquire(entry);
    try{const info=await rpc({op:'field_info',field,colormap});if(version===colorRequest&&current===entry){entry.preview=info.preview;entry.colormap=colormap;showFieldImage(info.preview);}}
    finally{await release(entry,field);}
  }
  globalThis.WaterWaveAdvanced={config:advancedConfig,record,restoreRecord,addField,recolor,saveArtifact};
})();
