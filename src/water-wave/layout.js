'use strict';
(() => {
  function group(title, nodes, id) {
    const details=document.createElement('details');details.className='option-group';if(id)details.id=id;
    const summary=document.createElement('summary');summary.textContent=title;details.append(summary,...nodes);return details;
  }
  function module(panel,title,id) {
    const heading=panel.querySelector('h2');heading?.remove();
    const details=group(title,[],id);details.className='module';
    const body=document.createElement('div');body.className='module-body';body.append(...panel.childNodes);details.append(body);panel.append(details);return details;
  }
  const sidebar=document.querySelector('.layout > aside');
  const [source,physical]=sidebar.children;
  const recovery=$('pipeline').closest('section'),batch=$('batch-directory').closest('section'),focus=$('focal-condition').closest('section');
  const workbench=$('workbench');
  const sourceFold=module(source,'影像来源','source-options');
  module(physical,'物理标定','physical-options');
  const recoveryBody=recovery.querySelector('.two');
  for(const [title,keys] of [['遮挡参数',['bridge_occlusions','mask_dark','mask_mod','mask_saturation','mask_window','mask_min_blob','mask_grow','mask_guard','fill_ring']],['经验标定',['height_scale','cal_x_slope','cal_y_slope','cal_x_offset_cm','cal_y_offset_cm','cal_slope_error','cal_offset_error_cm']],['色散与波陡',['gravity_m_s2','density_kg_m3','surface_tension_n_m','ak_linear_limit']]]) {
    const grid=document.createElement('div');grid.className='two';for(const key of keys)grid.append($(key).closest('label'));
    recovery.append(group(title,[grid]));
  }
  recoveryBody.append($('lockin').closest('label'));
  module(recovery,'恢复与 RMS','recovery-options');
  const batchFrame=group('帧范围',[$('batch-start').parentElement.parentElement]);
  $('batch-repeats').closest('label').after(batchFrame);
  const batchReference=group('无波带片参考',[$('reference-directory'),$('reference-root-row'),...['reference-format','reference-static-format','reference-rms-format'].map(id=>$(id).closest('label'))],'batch-reference-options');
  const batchActions=batch.querySelector('.mini-actions');batchActions.before(batchReference);batchActions.id='batch-actions';$('other-actions').prepend(batchActions);
  const naming=group('命名规则',['batch-format','static-format','batch-extensions'].map(id=>$(id).closest('label')),'batch-naming');
  $('batch-variable').closest('label').after(naming);
  const excitation=group('振幅设置',['batch-amp','batch-unit'].map(id=>$(id).closest('label')));naming.after(excitation);
  const batchFold=module(batch,'本地批处理','batch-options');
  const frameRange=group('帧范围',[$('start').parentElement.parentElement,$('frame-list').closest('label')],'frame-options');
  $('fps').closest('label').before(frameRange);
  const sourceInfo=group('文件信息',[$('source-info'),$('video-note')]);sourceFold.querySelector('.module-body').append(sourceInfo);
  frameRange.open=true;
  document.querySelector('.geometry-editor').open=false;
  const rawReference=group('恢复无波带片参考', ['raw-reference-static','raw-reference-files','raw-reference-folder'].map(id=>$(id).closest('label')).concat($('compute-reference')),'raw-reference-options');
  focus.querySelector('.import-grid').after(rawReference);
  const focusGrid=$('focus-x').parentElement.parentElement;
  const focusExtra=document.createElement('div');focusExtra.className='two';
  for(const id of ['focus-half','focus-line','focus-axis-a','focus-axis-b'])focusExtra.append($(id).closest('label'));
  const focusDetails=group('分析参数',[focusExtra,$('focus-fwhm').closest('label'),$('focus-fill').closest('label'),$('focus-auto-angle').closest('label'),$('focus-angle').closest('label'),$('focus-method'),$('focus-design')],'focus-options');
  focusGrid.after(focusDetails);
  const focusFold=module(focus,'RMS 来源','focal-module');
  focusFold.open=true;
  const dialogs=[['selection-open','selection-dialog'],['export-open','export-dialog'],['focus-open','focus-dialog'],['focus-batch-open','focus-batch-dialog']];
  for(const [button,id] of dialogs){
    const dialog=$(id),notice=document.createElement('p');notice.className='dialog-warning warning';notice.hidden=true;notice.setAttribute('role','alert');dialog.querySelector('.dialog-body').prepend(notice);
    $(button).onclick=()=>{if(dialog.open)return;notice.hidden=true;dialog.showModal();if(id==='selection-dialog')draw();};
    for(const close of dialog.querySelectorAll('[data-dialog-close]'))close.onclick=()=>dialog.close();
  }
  const exportGrid=document.querySelector('.export-grid');
  const moreGrid=document.createElement('div');moreGrid.className='export-grid';
  const common=new Set(['height_npz','height_png','height_csv','lines','points','video','focal_line','focal_area']);
  for(const label of [...exportGrid.children])if(!common.has(label.querySelector('input').dataset.export))moreGrid.append(label);
  const moreExports=group('更多导出',[moreGrid],'more-exports');exportGrid.after(moreExports);
  const palette=document.createElement('label');palette.innerHTML='色图<select id="colormap"></select>';
  for(const name of Object.keys(WaterWaveColors))palette.querySelector('select').add(new Option(name,name));
  document.querySelector('.output-options').prepend(palette);
  const tasks=document.querySelector('.task-nav');
  for(const [key,title] of [['images','图片／序列'],['folder','文件夹'],['video','视频'],['batch','本地批处理'],['focus','聚焦分析']]){
    const button=document.createElement('button');button.type='button';button.dataset.task=key;button.textContent=title;button.setAttribute('aria-pressed','false');button.onclick=()=>selectTask(key);tasks.append(button);
  }
  function selectTask(key){
    workbench.dataset.task=key;for(const button of tasks.children)button.setAttribute('aria-pressed',String(button.dataset.task===key));
    source.hidden=key==='batch'||key==='focus';batch.hidden=key!=='batch';focus.hidden=key!=='focus';
    sidebar.prepend(key==='batch'?batch:key==='focus'?focus:source);
    $('single-actions').hidden=source.hidden;batchActions.hidden=batch.hidden;$('focus-actions').hidden=focus.hidden;
    $('result-empty').textContent=key==='focus'?'暂无 RMS 场':'暂无恢复结果';
    sourceFold.open=['images','folder','video'].includes(key);batchFold.open=key==='batch';
    for(const [task,id] of [['images','files'],['folder','folder'],['video','video-file']])$(id).closest('label').hidden=key!==task;
    if(key==='focus'){
      rawReference.append(batchFrame,$('fps').closest('label'));
    } else {
      $('batch-repeats').closest('label').after(batchFrame);
      if(key==='batch')batchFrame.append($('fps').closest('label'));
      else sourceInfo.before($('fps').closest('label'));
    }
    refreshControls();
  }
  function refreshExports(){
    const count=moreGrid.querySelectorAll('input:checked').length;
    moreExports.querySelector('summary').textContent='更多导出'+(count?'（已选 '+count+'）':'');
  }
  function refreshControls(){
    refreshRun();
    $('selection-open').disabled=state.busy||!state.image;
    for(const id of ['focus-open','focus-analyze','focus-export'])$(id).disabled=state.busy||!$('focal-condition').options.length;
  }
  function requestSamples({exports,geometry}){
    const missing=[];
    if(!geometry.lines?.length&&exports.some(item=>['lines','wavelength'].includes(item)))missing.push('剖面线');
    if(!geometry.points?.length&&exports.some(item=>['points','spectrum'].includes(item)))missing.push('采样点');
    if(!missing.length||$('selection-open').disabled)return false;
    $('selection-open').click();warning('所选导出项需要'+missing.join('和')+'。');return true;
  }
  function gradient(){const colors=WaterWaveColors[$('colormap').value];return 'linear-gradient(to top,'+colors.map(c=>'rgb('+c.join(',')+')').join(',')+')';}
  function legend(){document.querySelector('.color-legend div').style.background=gradient();}
  let renderVersion=0;
  async function recolor(){
    legend();const version=++renderVersion,colormap=$('colormap').value;
    await globalThis.WaterWaveAdvanced?.recolor(colormap);
    if(state.session&&!$('result-panel').hidden&&!state.busy){
      const result=await rpc({op:'preview',session:state.session,colormap});
      if(version===renderVersion)$('result').src='data:image/png;base64,'+result.preview;
    }
  }
  $('colormap').addEventListener('change',catchAction(recolor));
  document.addEventListener('change',e=>{if(e.target.matches('[data-export]'))refreshExports();});
  globalThis.WaterWaveLayout={
    recolor,refreshControls,requestSamples,
    refreshExports(){refreshExports();legend();},
    showMetrics(metrics){
      const summary=$('focal-summary');summary.replaceChildren();
      const formatted=value=>Number.isFinite(value)?value.toPrecision(4):'—';
      const append=(title,text,hint)=>{const item=document.createElement('div'),value=document.createElement('b');item.textContent=title;value.textContent=text;if(hint)item.title=hint;item.append(value);summary.append(item);};
      for(const [key,title] of [['line_gain','线增益'],['area_gain','面增益 · 固定轴长'],['fwhm_area_gain','面增益 · 半高宽']])if(key in (metrics?.fit_gain||{}))append(title,formatted(metrics.fit_gain[key]));
      if(metrics){const sources={measured:'实测',model:'模型估算',unavailable:'未找到半高交点'};
        append('半高宽 X × Y',[metrics.fit_x_fwhm_cm,metrics.fit_y_fwhm_cm].map(formatted).join(' × ')+' cm',`X：${sources[metrics.fit_x_fwhm_source]||'—'}；Y：${sources[metrics.fit_y_fwhm_source]||'—'}`);}
      summary.hidden=!summary.childElementCount;
    }
  };
  selectTask('images');
  refreshExports();legend();
})();
