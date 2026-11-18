'use strict';
(() => {
  const numeric={height_scale:[1,'高度系数'],mask_dark:[.25,'暗阈值'],mask_mod:[.3,'调制阈值'],mask_saturation:[1.01,'过曝阈值'],mask_window:[21,'统计窗口 / px'],mask_min_blob:[100,'最小区域 / px'],mask_grow:[2,'扩张 / px'],mask_guard:[10,'保护带 / px'],fill_ring:[20,'填充环 / px'],cal_x_slope:[1.022,'X 斜率'],cal_y_slope:[1.020,'Y 斜率'],cal_x_offset_cm:[.04,'X 截距 / cm'],cal_y_offset_cm:[.05,'Y 截距 / cm'],cal_slope_error:[.001,'斜率不确定度'],cal_offset_error_cm:[.02,'截距不确定度 / cm'],rms_min_fraction:[.8,'有效帧比例'],frequency_hz:[6,'频率 / Hz']};
  const booleans={masking:[true,'遮挡处理'],coordinate_calibration:[true,'坐标标定'],displacement_calibration:[true,'位移标定'],lockin:[false,'锁相']};
  const input=(id,title,value,type='number')=>`<label>${title}<input id="${id}" type="${type}" value="${value}"${type==='number'?' step="any"':''}></label>`;
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
    <div class="mini-actions"><button id="batch-scan">识别</button><button id="batch-run">处理</button></div><div id="batch-list"></div><p id="repeat-notice" role="status" hidden></p>`;
  document.querySelector('aside').append(batchPanel);
  const focalPanel=document.createElement('section');focalPanel.className='panel';
  focalPanel.innerHTML=`<h2>RMS 与聚焦</h2><div class="import-grid">
    <label class="file-button">导入 RMS<input id="rms-file" type="file" accept=".mat,.npz"></label>
    <label class="file-button">无片 RMS<input id="reference-rms-file" type="file" accept=".mat,.npz"></label>
    <label class="file-button">无片静水图<input id="raw-reference-static" type="file" accept="image/*,.tif,.tiff"></label>
    <label class="file-button">无片图片／视频<input id="raw-reference-files" type="file" multiple accept="image/*,video/*,.tif,.tiff,.avi,.mkv"></label>
    <label class="file-button">无片文件夹<input id="raw-reference-folder" type="file" multiple webkitdirectory></label><button id="compute-reference">恢复无片参考</button></div>
    <p id="reference-field-name"></p><label>工况<select id="focal-condition"></select></label>
    <div class="focal-view"><img id="focal-image" alt="RMS"><span id="focal-marker" hidden>＋</span></div>
    <div class="two">${input('focus-x','X / cm',0)}${input('focus-y','Y / cm',12.6)}${input('focus-half','搜索半宽 / cm',2.5)}${input('focus-line','线长 / cm',3)}${input('focus-axis-a','长全轴 / cm',9)}${input('focus-axis-b','短全轴 / cm',3)}</div>
    <label class="check"><input id="focus-fill" type="checkbox" checked>模型补齐</label>
    <label class="check"><input id="focus-auto-angle" type="checkbox" checked>拟合方向</label>${input('focus-angle','方向 / °',0)}
    <div class="mini-actions"><button id="focus-save">保存焦点</button><button id="focus-analyze">分析</button><button id="focus-export">导出 RMS</button></div><pre id="focal-metrics"></pre>`;
  document.querySelector('.workspace').append(focalPanel);
  const offline=document.createElement('a');offline.textContent='下载离线版';offline.href='offline-download.html';document.querySelector('header nav').append(offline);
  if(WATERWAVE_RUNTIME.offline){offline.remove();$('home-link').removeAttribute('href');$('home-link').hidden=true;const foot=document.querySelector('footer');foot.replaceChildren();const link=document.createElement('a');link.textContent='kotokowa · 在线版';link.href='https://kotokowa.github.io/webtools/water-wave/';link.target='_blank';link.rel='noopener';foot.append(link);}
  const entries=[], centers=new Map();let root, referenceRoot, tasks=[], referenceTasks=[], current=null, commonReference=null, rawFiles=[], rawStatic=null, outputRoot=null;
  const recordIds=['batch-variable','batch-amp','batch-unit','batch-format','static-format','batch-extensions','batch-repeats','batch-start','batch-end','batch-stride','reference-format','reference-static-format','reference-rms-format','focus-half','focus-line','focus-axis-a','focus-axis-b','focus-angle'];
  function advancedConfig(){const c={pipeline:$('pipeline').value,excitation_amplitude:readCoordinate($('batch-amp')),amplitude_unit:$('batch-unit').value};for(const id of Object.keys(numeric))c[id]=readCoordinate($(id));for(const id of Object.keys(booleans))c[id]=$(id).checked;return c;}
  function record(){return {settings:Object.fromEntries(recordIds.map(id=>[id,$(id).value])),centers:Object.fromEntries(centers),fill_model:$('focus-fill').checked,auto_angle:$('focus-auto-angle').checked};}
  function restoreRecord(r){for(const id of Object.keys(numeric))$(id).value=r.config?.[id]??numeric[id][0];for(const id of Object.keys(booleans))$(id).checked=r.config?.[id]??booleans[id][0];$('pipeline').value=r.config?.pipeline||'final3';for(const id of recordIds)if(r.advanced?.settings?.[id]!==undefined)$(id).value=r.advanced.settings[id];if(r.advanced?.centers)for(const [key,value] of Object.entries(r.advanced.centers))centers.set(key,value);if(r.advanced?.fill_model!==undefined)$('focus-fill').checked=r.advanced.fill_model;if(r.advanced?.auto_angle!==undefined)$('focus-auto-angle').checked=r.advanced.auto_angle;}
  function addField(info,name,extra={}){globalThis.WaterWaveLayout?.fieldReady();if(info.field&&entries.some(e=>e.field===info.field))return;entries.push({...info,name,...extra});const opt=new Option(name,String(entries.length-1));$('focal-condition').add(opt);$('focal-condition').value=String(entries.length-1);showField(entries.length-1);}
  function mark(){if(!current)return;const x=Number($('focus-x').value),y=Number($('focus-y').value),xs=current.x_cm,ys=current.y_cm;const marker=$('focal-marker');marker.hidden=false;marker.style.left=((x-xs[0])/(xs.at(-1)-xs[0])*100)+'%';marker.style.top=((y-ys[0])/(ys.at(-1)-ys[0])*100)+'%';}
  function showField(index){current=entries[index];if(!current)return;$('focal-image').src='data:image/png;base64,'+current.preview;const center=centers.get(current.condition||current.name);$('focus-x').value=center?.[0]??((current.x_cm[0]+current.x_cm.at(-1))/2);$('focus-y').value=center?.[1]??Math.max(current.y_cm[0],Math.min(current.y_cm.at(-1),12.6));mark();if(!state.busy)catchAction(()=>recolor($('colormap').value))();}
  function saveCenter(){if(!current)throw Error('缺少 RMS');const c=[readCoordinate($('focus-x')),readCoordinate($('focus-y'))];if(c[0]<current.x_cm[0]||c[0]>current.x_cm.at(-1)||c[1]<current.y_cm[0]||c[1]>current.y_cm.at(-1))throw Error('焦点超出 RMS 场');centers.set(current.condition||current.name,c);return c;}
  $('focal-condition').onchange=()=>showField(Number($('focal-condition').value));
  $('focal-image').onclick=e=>{if(state.busy||!current)return;const r=e.target.getBoundingClientRect();$('focus-x').value=current.x_cm[0]+(e.clientX-r.left)/r.width*(current.x_cm.at(-1)-current.x_cm[0]);$('focus-y').value=current.y_cm[0]+(e.clientY-r.top)/r.height*(current.y_cm.at(-1)-current.y_cm[0]);saveCenter();mark();};
  for(const id of ['focus-x','focus-y']){$(id).oninput=mark;$(id).onchange=catchAction(saveCenter);}
  $('focus-save').onclick=catchAction(()=>{saveCenter();mark();status('焦点已保存');});
  async function importRMS(file){return rpc({op:'field_import',data:await b64(file),name:file.name,colormap:$('colormap').value});}
  $('rms-file').onchange=catchAction(async e=>{const file=e.target.files[0];if(file)addField(await importRMS(file),file.name);});
  $('reference-rms-file').onchange=catchAction(async e=>{const file=e.target.files[0];if(file){const next=await importRMS(file);if(commonReference)await rpc({op:'field_dispose',field:commonReference});commonReference=next.field;$('reference-field-name').textContent=file.name;}});
  $('raw-reference-static').onchange=e=>{rawStatic=e.target.files[0];};
  $('raw-reference-files').onchange=e=>{rawFiles=[...e.target.files];};
  $('raw-reference-folder').onchange=e=>{rawFiles=[...e.target.files];const refs=rawFiles.filter(f=>refPattern.test(f.name));if(refs.length===1)rawStatic=refs[0];};
  async function directory(){if(!window.showDirectoryPicker)throw Error('当前浏览器不支持本地目录读写');return window.showDirectoryPicker({mode:'readwrite'});}
  function showDirectory(nameId,name){$(nameId).textContent=name;$(nameId.replace('-name','-clear')).hidden=!name;}
  function clearExperimentDirectory(){root=null;tasks=[];$('batch-list').replaceChildren();showDirectory('batch-root-name','');status('已解除实验数据目录关联。');}
  function clearReferenceDirectory(){referenceRoot=null;referenceTasks=[];$('reference-root-name').textContent='';$('reference-root-clear').hidden=true;status('已解除参考场文件目录关联。');}
  $('batch-directory').onclick=catchAction(async()=>{root=await directory();showDirectory('batch-root-name',root.name);});
  $('reference-directory').onclick=catchAction(async()=>{referenceRoot=await directory();showDirectory('reference-root-name',referenceRoot.name);});
  $('batch-root-clear').onclick=clearExperimentDirectory;
  $('reference-root-clear').onclick=clearReferenceDirectory;
  async function scan(dir,prefix=''){const found=[];for await(const [name,handle] of dir.entries()){if(name==='results'||name.startsWith('.'))continue;const path=prefix+name;if(handle.kind==='directory')found.push(...await scan(handle,path+'/'));else found.push({path,handle});}return found;}
  function batchOptions(){return {extensions:$('batch-extensions').value,defaults:{depth:Number($('water_depth_mm').value),freq:Number($('frequency_hz').value),amp:Number($('batch-amp').value)},amplitudeUnit:$('batch-unit').value};}
  function listTasks(){const list=$('batch-list');list.replaceChildren();for(const t of tasks){const row=document.createElement('div');row.textContent=t.entries[0].path+' · '+(t.errors.join('；')||'就绪');list.append(row);}}
  async function identify(){if(!root)throw Error('请选择批处理目录');const pattern=WaterWaveBatch.compile($('batch-format').value,$('batch-extensions').value);if(!pattern.keys.includes($('batch-variable').value))throw Error('实验格式未包含所选变量');const options=batchOptions();tasks=WaterWaveBatch.group(await scan(root),$('batch-format').value,$('static-format').value,options);if(!tasks.length)throw Error('没有匹配的实验');referenceTasks=[];
    if(referenceRoot){const files=await scan(referenceRoot);referenceTasks=WaterWaveBatch.group(files,$('reference-format').value,$('reference-static-format').value,options);const rmsPattern=WaterWaveBatch.compile($('reference-rms-format').value,options.extensions);for(const entry of files){const v=rmsPattern.match(entry.path);if(v){const values={...options.defaults,...v};referenceTasks.push({condition:JSON.stringify([values.depth,values.freq,values.amp,options.amplitudeUnit]),run:v.run??0,runText:v.run_text||'0',values,entries:[entry],rms:true,errors:[]});}}}
    const refKeys=new Map();for(const task of referenceTasks){const key=task.condition+':'+task.run;if(refKeys.has(key)){task.errors.push('无片参考匹配不唯一');refKeys.get(key).errors.push('无片参考匹配不唯一');}else refKeys.set(key,task);}
    listTasks();const first=tasks.find(t=>!t.errors.length);if(first){await setReference(await first.reference.handle.getFile(),true);$('batch-root-name').textContent=root.name;}status(`识别 ${tasks.length} 次实验`);}
  $('batch-scan').onclick=catchAction(identify);
  function safeName(s){return s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,150)||'results';}
  async function uniqueDirectory(parent,base){for(let i=0;;i++){const name=base+(i?'_'+i:'');try{await parent.getDirectoryHandle(name);}catch(e){if(e.name!=='NotFoundError')throw e;return parent.getDirectoryHandle(name,{create:true});}}}
  async function writeText(dir,name,text){const handle=await dir.getFileHandle(name,{create:true});const stream=await handle.createWritable();try{await stream.write(text);await stream.close();}catch(e){await stream.abort();throw e;}}
  async function persistField(info,dir){const file=await dir.getFileHandle('RMS.npz',{create:true});await saveArtifact(await rpc({op:'field_file',field:info.field}),'RMS.npz',dir);await rpc({op:'field_dispose',field:info.field});return {...info,field:null,file};}
  async function acquire(entry){return entry.field||((await importRMS(await entry.file.getFile())).field);}
  async function release(entry,key){if(!entry.field)await rpc({op:'field_dispose',field:key});}
  async function average(runs){const keys=[];try{for(const run of runs)keys.push(await acquire(run));return await rpc({op:'field_average',fields:keys});}finally{for(let i=0;i<keys.length;i++)await release(runs[i],keys[i]);}}
  async function saveArtifact(result,name,dir){const chunks=[];let stream;if(dir)stream=await(await dir.getFileHandle(safeName(name),{create:true})).createWritable();try{for(let offset=0;offset<result.size;){const r=await rpc({op:'artifact_chunk',artifact:result.artifact,offset});if(!r.size)throw Error('结果文件不完整');const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));if(stream)await stream.write(bytes);else chunks.push(bytes);offset+=r.size;}if(stream)await stream.close();else downloadBlob(new Blob(chunks,{type:'application/zip'}),safeName(name));}catch(e){if(stream)await stream.abort();throw e;}finally{await rpc({op:'artifact_dispose',artifact:result.artifact});}}
  async function decoder(file){const worker=new Worker('video-worker.js');const pending=new Map();let seq=0;worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progressText){status(data.progressText);return;}pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));pending.clear();};const call=m=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,...m});});try{return {info:await call({op:'open',file}),call,close:()=>worker.terminate()};}catch(e){worker.terminate();throw e;}}
  async function measure(task,options,dir){
    if(task.errors?.length)throw Error(task.errors.join('；'));
    if(task.rms)return importRMS(await task.entries[0].handle.getFile());
    const ref=task.staticFile||await task.reference.handle.getFile();const data=await b64(ref);let session,video,done=0;
    const files=task.files||await Promise.all(task.entries.map(e=>e.handle.getFile()));
    options=structuredClone(options);options.reference_name=ref.name;options.exports=options.exports.filter(e=>e!=='video');
    if(task.values){options.config.water_depth_mm=task.values.depth;options.config.frequency_hz=task.values.freq;options.config.excitation_amplitude=task.values.amp;}
    try{
      let frames;
      if(files.length===1&&videoPattern.test(files[0].name)){video=await decoder(files[0]);options.config.fps=video.info.fps;frames=Array.from({length:video.info.count},(_,i)=>({index:i,id:i+1}));}
      else frames=files.filter(f=>f!==ref&&imagePattern.test(f.name)).map((file,i)=>({file,index:i,id:task.entries?.[i]?.values?.frame??frameId(file,i)}));
      const start=Number($('batch-start').value),end=Number($('batch-end').value)||frames.length,stride=Number($('batch-stride').value);
      if(![start,end,stride].every(Number.isSafeInteger)||start<1||end<start||stride<1)throw Error('批处理帧范围无效');
      const origin=frames.some(f=>f.id===0)?0:1;frames=frames.filter((_,i)=>i>=start-1&&i<end&&(i-start+1)%stride===0);if(!frames.length)throw Error('没有选中的帧');
      const init=await rpc({op:'start',data,settings:options});session=init.session;
      for(const frame of frames){if(state.stop)break;status(`${files[0].name} · ${done+1}/${frames.length}`);document.title=progressTitle(done,frames.length);$('progress').max=frames.length;$('progress').value=done;
        const data=video?await b64(new Blob([(await video.call({op:'frame',index:frame.index})).bytes])):await b64(frame.file);
        await rpc({op:'frame',session,data,name:video?files[0].name:frame.file.name,frame_id:frame.id,time_s:options.config.fps>0?(frame.id-origin)/options.config.fps:null});done++;}
      if(!done)throw Error('已取消');const result=await rpc({op:'finish',session,partial:state.stop});const name=resultFilename(files.map(f=>f.name),!!video);
      if(dir)await saveArtifact(result,name,dir);
      return {...result.field,partial:state.stop};
    }finally{video?.close();if(session)await rpc({op:'dispose',session});}
  }
  $('compute-reference').onclick=catchAction(async()=>{if(!rawStatic||!rawFiles.length)throw Error('缺少无片静水图或动态图');const options=settings();options.geometry={lines:[],points:[]};options.exports=['rms_npz','rms_mat'];busy(true);state.stop=false;try{const info=await measure({staticFile:rawStatic,files:rawFiles.filter(f=>f!==rawStatic).sort((a,b)=>collator.compare(a.name,b.name))},options);if(info.partial)throw Error('无片参考未完成');commonReference=info.field;$('reference-field-name').textContent=rawFiles[0].name;status('无片参考已恢复');}finally{busy(false);document.title=idleTitle;}});
  $('batch-run').onclick=catchAction(async()=>{
    await identify();const options=settings(),limit=Number($('batch-repeats').value);const selected=WaterWaveBatch.selectRepeats(tasks,limit),refs=WaterWaveBatch.selectRepeats(referenceTasks,limit);
    const notices=[selected.notice,refs.notice].filter(Boolean);if(notices.length){const min=Math.min(...notices.map(n=>Number(n.match(/次数(\d+)次/)[1])));$('repeat-notice').textContent=`部分数据实际实验次数${min}次，小于设置次数${limit}次`;$('repeat-notice').hidden=false;setTimeout(()=>$('repeat-notice').hidden=true,15000);}
    const resultDir=await root.getDirectoryHandle('results',{create:true});outputRoot=await uniqueDirectory(resultDir,new Date().toISOString().replace(/[:.]/g,'-'));await writeText(outputRoot,'selection.json',JSON.stringify({schema:'waterwave-selection-v2',image_size:[state.width,state.height],...options},null,2));
    busy(true);state.stop=false;const log=[],conditions=new Map(),references=new Map();
    try{
      for(const [list,target,kind] of [[refs.selected,references,'reference'],[selected.selected,conditions,'experiment']])for(const task of list){
        if(state.stop)break;const label=safeName(kind+'_'+task.entries[0].path.replace(/\.[^.]+$/,''));
        try{const dir=await uniqueDirectory(outputRoot,label+'_results');const taskOptions=structuredClone(options);if(kind==='reference'){taskOptions.geometry={lines:[],points:[]};taskOptions.exports=options.exports.filter(v=>!['lines','points','spectrum','wavelength','temporal','focal'].includes(v));}const info=await measure(task,taskOptions,dir);log.push({kind,source:task.entries[0].path,run:task.runText,condition:task.condition,status:info.partial?'partial':'complete'});const saved=await persistField(info,dir);if(info.partial)continue;if(!target.has(task.condition))target.set(task.condition,[]);target.get(task.condition).push({...saved,name:label,dir,run:task.runText});}
        catch(e){log.push({kind,source:task.entries[0].path,run:task.runText,condition:task.condition,status:'failed',error:String(e.message||e)});if(['NotAllowedError','QuotaExceededError'].includes(e.name))throw e;}
        await writeText(outputRoot,'tasks.json',JSON.stringify(log,null,2));
      }
      if(!state.stop)for(const [condition,runs] of conditions){try{const info=await average(runs);const values=JSON.parse(condition),name=safeName(`depth_${values[0]}_freq_${values[1]}_amp_${values[2]}`);const dir=await uniqueDirectory(outputRoot,name+'_results');let reference=null;if(references.has(condition)){const refdir=await uniqueDirectory(dir,'reference');reference=await persistField(await average(references.get(condition)),refdir);}const artifact=await rpc({op:'field_export',field:info.field,exports:options.exports});await saveArtifact(artifact,name+'_RMS_results.zip',dir);const saved=await persistField(info,dir);addField(saved,name,{condition,runs,reference,dir,outputRoot});}catch(e){log.push({condition,status:'average_failed',error:e.message});if(['NotAllowedError','QuotaExceededError'].includes(e.name))throw e;}}
      const failures=log.filter(t=>t.status.includes('failed')).length;
      status(state.stop?'已停止，已保存完成结果':`恢复完成，${failures} 次失败；请逐工况保存焦点并分析`);
    }finally{try{await writeText(outputRoot,'tasks.json',JSON.stringify(log,null,2));$('batch-list').replaceChildren();for(const item of log){const row=document.createElement('div');row.textContent=(item.source||item.condition)+' · '+(item.error||item.status);$('batch-list').append(row);}}finally{busy(false);document.title=idleTitle;}}
  });
  function gainSelection(){const selected=exportsSelected();return ['line','area'].filter(k=>selected.includes('focal_'+k)||selected.includes('focal'));}
  function focusOptions(){const o={half_width_cm:readCoordinate($('focus-half')),line_length_cm:readCoordinate($('focus-line')),axes_cm:[readCoordinate($('focus-axis-a')),readCoordinate($('focus-axis-b'))],fill_model:$('focus-fill').checked};if(!$('focus-auto-angle').checked)o.theta_deg=readCoordinate($('focus-angle'));return o;}
  async function analyzeCurrent(){if(!current||!centers.has(current.condition||current.name))throw Error('请先选择焦点');const center=saveCenter(),entry=current,options=focusOptions();busy(true);state.stop=false;document.title='聚焦分析';let field,reference;try{field=await acquire(entry);reference=entry.reference?await acquire(entry.reference):commonReference;const all=[];for(const run of entry.runs||[]){if(state.stop)break;status('分析 '+run.name);const key=await acquire(run);let result;try{result=await rpc({op:'field_analyze',field:key,center,options,reference,exports:[],colormap:$('colormap').value,gain_selection:gainSelection(),full_analysis:exportsSelected().includes('focal')});}finally{await release(run,key);}all.push({run:run.run,metrics:result.metrics});await saveArtifact(result,run.name+'_focal_results.zip',run.dir);}
    if(state.stop)return;const result=await rpc({op:'field_analyze',field,center,options,reference,exports:exportsSelected(),colormap:$('colormap').value,gain_selection:gainSelection(),full_analysis:exportsSelected().includes('focal')});await saveArtifact(result,entry.name+'_focal_results.zip',entry.dir);$('focal-metrics').textContent=JSON.stringify(result.metrics,null,2);globalThis.WaterWaveLayout?.showMetrics(result.metrics);
    if(entry.dir){await writeText(entry.dir,'focal-summary.json',JSON.stringify({center,individual:all,average_field:result.metrics},null,2));await writeText(entry.dir,'focus.json',JSON.stringify({center,options}));const numericKeys=Object.keys(result.metrics).filter(k=>typeof result.metrics[k]==='number');const lines=['metric,individual_mean,individual_standard_error,average_field'];for(const k of numericKeys){const a=all.map(r=>r.metrics[k]).filter(Number.isFinite),mean=a.reduce((s,x)=>s+x,0)/a.length,se=a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length*(a.length-1))):'';lines.push([k,a.length?mean:'',se,result.metrics[k]].join(','));}await writeText(entry.dir,'focal-summary.csv',lines.join('\n'));}
    status('聚焦分析完成');
  }finally{if(field)await release(entry,field);if(reference&&entry.reference)await release(entry.reference,reference);busy(false);document.title=idleTitle;}}
  $('focus-analyze').onclick=catchAction(analyzeCurrent);
  $('focus-export').onclick=catchAction(async()=>{if(!current)throw Error('缺少 RMS');const entry=current;busy(true);let field;try{field=await acquire(entry);const r=await rpc({op:'field_export',field,exports:exportsSelected(),colormap:$('colormap').value});await saveArtifact(r,entry.name+'_RMS_results.zip',entry.dir);}finally{if(field)await release(entry,field);busy(false);}});
  let colorRequest=0;
  async function recolor(colormap){
    const version=++colorRequest,entry=current;if(!entry)return;const field=await acquire(entry);
    try{const info=await rpc({op:'field_info',field,colormap});if(version===colorRequest&&current===entry){entry.preview=info.preview;$('focal-image').src='data:image/png;base64,'+info.preview;}}
    finally{await release(entry,field);}
  }
  globalThis.WaterWaveAdvanced={config:advancedConfig,record,restoreRecord,addField,recolor};
})();
